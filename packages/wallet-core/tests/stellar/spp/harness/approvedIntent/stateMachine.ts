/**
 * Pure offline intent state machine with authoritative in-memory store (Fase 2.17).
 *
 * Atomic consume is provided by {@link IntentStore.tryConsume}: a single
 * check-and-set against the store cell. Comparing two immutable snapshots is
 * NOT single-use — callers must share one IntentStore.
 *
 * In-memory atomicity does NOT prevent cross-process / post-restart replay;
 * persistent coordination is required for integration.
 *
 * Simulated approval only — does NOT call ContextualSignatureGate / real signer.
 */

import { asDigestFn, assertTrustedDigestFn, type TrustedDigestFn } from './digestSecurity.js';
import { computePlanDigest } from './planDigest.js';
import {
  assertAuthorizationId,
  assertNoUnknownCritical,
  assertOperationDigestConcordance,
  assertPlanDigestConcordance,
  freezeIntent,
  intentFingerprint,
  validateApprovedIntentStructure,
} from './validate.js';
import {
  IntentTransitionError,
  type ApprovedIntent,
  type Clock,
  type IntentStatus,
} from './types.js';

const ALLOWED: Record<IntentStatus, ReadonlySet<IntentStatus>> = {
  created: new Set(['prepared', 'cancelled', 'failed', 'expired']),
  prepared: new Set(['awaiting_approval', 'cancelled', 'failed', 'expired']),
  awaiting_approval: new Set(['approved', 'rejected', 'cancelled', 'failed', 'expired']),
  approved: new Set(['consumed', 'cancelled', 'failed', 'expired']),
  consumed: new Set(),
  rejected: new Set(),
  expired: new Set(),
  cancelled: new Set(),
  failed: new Set(),
};

export type IntentRecord = {
  readonly status: IntentStatus;
  readonly intent: Readonly<ApprovedIntent>;
  readonly authorizationId: string | null;
  readonly fingerprintAtApproval: string | null;
};

function assertAllowed(from: IntentStatus, to: IntentStatus): void {
  if (!ALLOWED[from].has(to)) {
    throw new IntentTransitionError(
      'INVALID_TRANSITION',
      `transition ${from} → ${to} is not allowed`,
    );
  }
}

function isExpired(intent: ApprovedIntent, nowMs: number): boolean {
  return nowMs >= intent.expiresAtMs;
}

function applyExpiry(record: IntentRecord, nowMs: number): IntentRecord {
  if (
    record.status === 'consumed' ||
    record.status === 'rejected' ||
    record.status === 'expired' ||
    record.status === 'cancelled' ||
    record.status === 'failed'
  ) {
    return record;
  }
  if (isExpired(record.intent, nowMs)) {
    return {
      status: 'expired',
      intent: record.intent,
      authorizationId: null,
      fingerprintAtApproval: null,
    };
  }
  return record;
}

function snapshot(record: IntentRecord): IntentRecord {
  return {
    status: record.status,
    intent: record.intent,
    authorizationId: record.authorizationId,
    fingerprintAtApproval: record.fingerprintAtApproval,
  };
}

function requireTrusted(digest: unknown): TrustedDigestFn {
  const check = assertTrustedDigestFn(digest);
  if (!check.ok) {
    throw new IntentTransitionError(
      'DIGEST_UNTRUSTED',
      `TrustedDigestFn rejected: ${check.reason}`,
    );
  }
  return check.trusted;
}

export type CreateInStoreArgs = {
  intent: ApprovedIntent;
  trustedDigest: TrustedDigestFn;
  operationBytes: Uint8Array;
  clock: Clock;
};

export type ConsumeAttemptResult =
  | { ok: true; record: IntentRecord }
  | { ok: false; error: IntentTransitionError };

/**
 * Authoritative in-process store. All mutating transitions go through here.
 */
export class IntentStore {
  private readonly cells = new Map<string, IntentRecord>();

  /** Read-only snapshot; undefined if unknown. */
  get(intentId: string): IntentRecord | undefined {
    const cur = this.cells.get(intentId);
    return cur ? snapshot(cur) : undefined;
  }

  has(intentId: string): boolean {
    return this.cells.has(intentId);
  }

  create(args: CreateInStoreArgs): IntentRecord {
    const trusted = requireTrusted(args.trustedDigest);
    const digestFn = asDigestFn(trusted);

    const structural = validateApprovedIntentStructure(args.intent);
    if (!structural.ok) {
      throw new IntentTransitionError('VALIDATION_FAILED', structural.reasons.join('; '));
    }
    if (this.cells.has(args.intent.intentId)) {
      throw new IntentTransitionError(
        'ALREADY_USED_ID',
        `intentId already registered: ${args.intent.intentId}`,
      );
    }
    const plan = assertPlanDigestConcordance(args.intent, digestFn);
    if (!plan.ok) {
      throw new IntentTransitionError('DIGEST_MISMATCH', plan.reasons.join('; '));
    }
    const op = assertOperationDigestConcordance(args.intent, args.operationBytes, digestFn);
    if (!op.ok) {
      throw new IntentTransitionError('DIGEST_MISMATCH', op.reasons.join('; '));
    }

    const frozen = freezeIntent(args.intent);
    let record: IntentRecord = {
      status: 'created',
      intent: frozen,
      authorizationId: null,
      fingerprintAtApproval: null,
    };
    record = applyExpiry(record, args.clock());
    if (record.status === 'expired') {
      throw new IntentTransitionError('EXPIRED', 'intent already expired at creation');
    }
    this.cells.set(args.intent.intentId, record);
    return snapshot(record);
  }

  /**
   * Atomic read-modify-write against the cell. Synchronous = atomic on JS event loop.
   */
  private transition(
    intentId: string,
    clock: Clock,
    mutator: (current: IntentRecord) => IntentRecord,
  ): IntentRecord {
    const cur = this.cells.get(intentId);
    if (!cur) {
      throw new IntentTransitionError('VALIDATION_FAILED', `unknown intentId: ${intentId}`);
    }
    let base = applyExpiry(cur, clock());
    if (base.status === 'expired' && cur.status !== 'expired') {
      this.cells.set(intentId, base);
    }
    const next = mutator(base);
    this.cells.set(intentId, next);
    return snapshot(next);
  }

  prepare(intentId: string, clock: Clock): IntentRecord {
    return this.transition(intentId, clock, (r) => {
      if (r.status === 'expired') {
        throw new IntentTransitionError('EXPIRED', 'cannot prepare an expired intent');
      }
      assertAllowed(r.status, 'prepared');
      return { ...r, status: 'prepared' };
    });
  }

  markAwaitingApproval(intentId: string, clock: Clock): IntentRecord {
    return this.transition(intentId, clock, (r) => {
      if (r.status === 'expired') {
        throw new IntentTransitionError('EXPIRED', 'cannot await approval on expired intent');
      }
      assertAllowed(r.status, 'awaiting_approval');
      return { ...r, status: 'awaiting_approval' };
    });
  }

  approve(
    intentId: string,
    args: {
      clock: Clock;
      trustedDigest: TrustedDigestFn;
      operationBytes: Uint8Array;
      authorizationId: string;
    },
  ): IntentRecord {
    const trusted = requireTrusted(args.trustedDigest);
    const digestFn = asDigestFn(trusted);
    const auth = assertAuthorizationId(args.authorizationId);
    if (!auth.ok) {
      throw new IntentTransitionError('VALIDATION_FAILED', auth.reasons.join('; '));
    }

    return this.transition(intentId, args.clock, (r) => {
      if (r.status === 'expired') {
        throw new IntentTransitionError('EXPIRED', 'cannot approve an expired intent');
      }
      assertAllowed(r.status, 'approved');
      const unk = assertNoUnknownCritical(r.intent);
      if (!unk.ok) {
        throw new IntentTransitionError('UNKNOWN_CRITICAL', unk.reasons.join('; '));
      }
      const plan = assertPlanDigestConcordance(r.intent, digestFn);
      if (!plan.ok) {
        throw new IntentTransitionError('DIGEST_MISMATCH', plan.reasons.join('; '));
      }
      const op = assertOperationDigestConcordance(r.intent, args.operationBytes, digestFn);
      if (!op.ok) {
        throw new IntentTransitionError('DIGEST_MISMATCH', op.reasons.join('; '));
      }
      return {
        status: 'approved',
        intent: r.intent,
        authorizationId: args.authorizationId,
        fingerprintAtApproval: intentFingerprint(r.intent),
      };
    });
  }

  /**
   * Single-success consume against the authoritative cell.
   * Two concurrent callers sharing this store: exactly one ok:true.
   */
  tryConsume(
    intentId: string,
    args: {
      clock: Clock;
      trustedDigest: TrustedDigestFn;
      operationBytes: Uint8Array;
      authorizationId: string;
      presentedIntent?: ApprovedIntent;
    },
  ): ConsumeAttemptResult {
    try {
      const trusted = requireTrusted(args.trustedDigest);
      const digestFn = asDigestFn(trusted);
      const record = this.transition(intentId, args.clock, (r) => {
        if (r.status === 'expired') {
          throw new IntentTransitionError('EXPIRED', 'cannot consume an expired approval');
        }
        if (r.status === 'consumed') {
          throw new IntentTransitionError('ALREADY_CONSUMED', 'authorization already consumed');
        }
        assertAllowed(r.status, 'consumed');

        if (!r.authorizationId || r.authorizationId !== args.authorizationId) {
          throw new IntentTransitionError('NOT_APPROVED', 'authorizationId does not match approval');
        }

        if (args.presentedIntent) {
          if (intentFingerprint(args.presentedIntent) !== r.fingerprintAtApproval) {
            throw new IntentTransitionError(
              'INTENT_MUTATED',
              'presented intent diverged from approved fingerprint',
            );
          }
          const recomputed = computePlanDigest(args.presentedIntent, digestFn);
          if (recomputed !== args.presentedIntent.digests.planDigestHex.toLowerCase()) {
            throw new IntentTransitionError('DIGEST_MISMATCH', 'presented intent plan digest stale');
          }
        }

        if (intentFingerprint(r.intent) !== r.fingerprintAtApproval) {
          throw new IntentTransitionError('INTENT_MUTATED', 'approved intent fingerprint changed');
        }

        const plan = assertPlanDigestConcordance(r.intent, digestFn);
        if (!plan.ok) {
          throw new IntentTransitionError('DIGEST_MISMATCH', plan.reasons.join('; '));
        }
        const op = assertOperationDigestConcordance(r.intent, args.operationBytes, digestFn);
        if (!op.ok) {
          throw new IntentTransitionError(
            'DIGEST_MISMATCH',
            'operation digest changed after approval (plan↔XDR drift)',
          );
        }

        return {
          status: 'consumed',
          intent: r.intent,
          authorizationId: r.authorizationId,
          fingerprintAtApproval: r.fingerprintAtApproval,
        };
      });
      return { ok: true, record };
    } catch (e) {
      if (e instanceof IntentTransitionError) return { ok: false, error: e };
      throw e;
    }
  }

  /** Throwing wrapper for tests that prefer exceptions. */
  consume(intentId: string, args: Parameters<IntentStore['tryConsume']>[1]): IntentRecord {
    const result = this.tryConsume(intentId, args);
    if (!result.ok) throw result.error;
    return result.record;
  }

  reject(intentId: string, clock: Clock): IntentRecord {
    return this.transition(intentId, clock, (r) => {
      if (r.status === 'expired') return r;
      assertAllowed(r.status, 'rejected');
      return {
        status: 'rejected',
        intent: r.intent,
        authorizationId: null,
        fingerprintAtApproval: null,
      };
    });
  }

  cancel(intentId: string, clock: Clock): IntentRecord {
    return this.transition(intentId, clock, (r) => {
      if (r.status === 'expired') return r;
      assertAllowed(r.status, 'cancelled');
      return {
        status: 'cancelled',
        intent: r.intent,
        authorizationId: null,
        fingerprintAtApproval: null,
      };
    });
  }

  fail(intentId: string, clock: Clock): IntentRecord {
    return this.transition(intentId, clock, (r) => {
      if (r.status === 'expired') return r;
      assertAllowed(r.status, 'failed');
      return {
        status: 'failed',
        intent: r.intent,
        authorizationId: null,
        fingerprintAtApproval: null,
      };
    });
  }

  refreshExpiry(intentId: string, clock: Clock): IntentRecord {
    return this.transition(intentId, clock, (r) => applyExpiry(r, clock()));
  }
}

export function allowedTransitions(from: IntentStatus): IntentStatus[] {
  return [...ALLOWED[from]];
}

export function createIntentStore(): IntentStore {
  return new IntentStore();
}

// ---------------------------------------------------------------------------
// Compatibility helpers used by older 2.15 tests (delegate to a store).
// Prefer IntentStore APIs for new code.
// ---------------------------------------------------------------------------

/** @deprecated Prefer IntentStore — kept for 2.15 test migration helpers. */
export type IntentIdRegistry = {
  tryRegister(intentId: string): boolean;
  has(intentId: string): boolean;
};

/** @deprecated Use IntentStore; registry alone cannot provide atomic consume. */
export function createMemoryIntentIdRegistry(): IntentIdRegistry {
  const used = new Set<string>();
  return {
    tryRegister(intentId: string): boolean {
      if (used.has(intentId)) return false;
      used.add(intentId);
      return true;
    },
    has(intentId: string): boolean {
      return used.has(intentId);
    },
  };
}
