/**
 * Fase 2.15/2.17 — offline ApprovedIntent + IntentStore tests.
 * Synthetic data only. No SDK private ops, no network, no real signing gate.
 */
import { describe, expect, it } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  APPROVED_INTENT_SCHEMA_VERSION,
  INTENT_LIMITS,
  IntentStore,
  IntentTransitionError,
  assertExactUnits,
  computeOperationDigest,
  computePlanDigest,
  createIntentStore,
  validateApprovedIntentStructure,
  wrapSha256AsTrusted,
  type ApprovedIntent,
  type Clock,
  type TrustedDigestFn,
} from './index.js';

const ACCOUNT = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';
const POOL = 'CACQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQLC2U';
const NETWORK = 'Test SDF Network ; September 2015';
const DEST_G = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';

const sha256Hex = (bytes: Uint8Array) => Buffer.from(sha256(bytes)).toString('hex');
const trusted: TrustedDigestFn = wrapSha256AsTrusted(sha256Hex);
const digestFn = (bytes: Uint8Array) => trusted.digest(bytes);

function clockAt(ms: number): Clock {
  return () => ms;
}

function baseIntent(overrides: Partial<ApprovedIntent> = {}): ApprovedIntent {
  return {
    schemaVersion: APPROVED_INTENT_SCHEMA_VERSION,
    intentId: 'intent-test-0001',
    op: 'deposit',
    account: ACCOUNT,
    networkPassphrase: NETWORK,
    poolContractId: POOL,
    asset: { kind: 'native', symbol: 'XLM' },
    amount: { units: '10000000', decimals: 7 },
    destination: { mode: 'none' },
    fees: [{ certainty: 'estimated', units: '100', note: 'BASE_FEE hint' }],
    publicEffects: ['Sender G… address visible on-chain', 'Pool contract invoke public'],
    privacyLimits: ['RPC/IP metadata not private', 'Offline model is not a real signature gate'],
    digests: {
      planDigestHex: '00'.repeat(32),
      operationDigestHex: '00'.repeat(32),
    },
    createdAtMs: 1_000,
    expiresAtMs: 10_000,
    unknownCritical: [],
    ...overrides,
  };
}

function withDigests(intent: ApprovedIntent, operationBytes: Uint8Array): ApprovedIntent {
  return {
    ...intent,
    digests: {
      planDigestHex: computePlanDigest(intent, digestFn),
      operationDigestHex: computeOperationDigest(operationBytes, digestFn),
    },
  };
}

function createReady(
  store: IntentStore,
  opBytes: Uint8Array,
  intentOverrides: Partial<ApprovedIntent> = {},
  id = 'intent-test-0001',
) {
  let intent = baseIntent({ intentId: id, ...intentOverrides });
  intent = withDigests(intent, opBytes);
  const record = store.create({
    intent,
    trustedDigest: trusted,
    operationBytes: opBytes,
    clock: clockAt(2_000),
  });
  return { record, intent };
}

function toApproved(store: IntentStore, opBytes: Uint8Array, id = 'intent-flow-1') {
  createReady(store, opBytes, {}, id);
  store.prepare(id, clockAt(2_100));
  store.markAwaitingApproval(id, clockAt(2_200));
  return store.approve(id, {
    clock: clockAt(2_300),
    trustedDigest: trusted,
    operationBytes: opBytes,
    authorizationId: 'authz-token-0001',
  });
}

describe('ApprovedIntent amount validation', () => {
  it('accepts integer unit strings and rejects floats/leading zeros', () => {
    expect(assertExactUnits('0').ok).toBe(true);
    expect(assertExactUnits('10000000').ok).toBe(true);
    expect(assertExactUnits('01').ok).toBe(false);
    expect(assertExactUnits('1.5').ok).toBe(false);
    expect(assertExactUnits('-1').ok).toBe(false);
    expect(assertExactUnits(1 as unknown as string).ok).toBe(false);
  });
});

describe('ApprovedIntent structure per op', () => {
  const opBytes = new TextEncoder().encode('synthetic-op-xdr-v1');

  it('validates deposit', () => {
    const intent = withDigests(baseIntent({ op: 'deposit', destination: { mode: 'none' } }), opBytes);
    expect(validateApprovedIntentStructure(intent)).toEqual({ ok: true });
  });

  it('validates private_transfer to G address', () => {
    const intent = withDigests(
      baseIntent({
        intentId: 'intent-xfer-g',
        op: 'private_transfer',
        destination: { mode: 'g_address', gAddress: DEST_G },
      }),
      opBytes,
    );
    expect(validateApprovedIntentStructure(intent)).toEqual({ ok: true });
  });

  it('validates private_transfer to privacy keys', () => {
    const intent = withDigests(
      baseIntent({
        intentId: 'intent-xfer-keys',
        op: 'private_transfer',
        destination: {
          mode: 'privacy_keys',
          notePublicKeyHex: 'ab'.repeat(32),
        },
      }),
      opBytes,
    );
    expect(validateApprovedIntentStructure(intent)).toEqual({ ok: true });
  });

  it('validates withdraw self / g_address', () => {
    const selfIntent = withDigests(
      baseIntent({
        intentId: 'intent-wd-self',
        op: 'withdraw',
        destination: { mode: 'self' },
      }),
      opBytes,
    );
    expect(validateApprovedIntentStructure(selfIntent)).toEqual({ ok: true });
    const gIntent = withDigests(
      baseIntent({
        intentId: 'intent-wd-g',
        op: 'withdraw',
        destination: { mode: 'g_address', gAddress: DEST_G },
      }),
      opBytes,
    );
    expect(validateApprovedIntentStructure(gIntent)).toEqual({ ok: true });
  });

  it('rejects missing required fields', () => {
    const bad = withDigests(baseIntent(), opBytes) as unknown as Record<string, unknown>;
    delete bad.publicEffects;
    const res = validateApprovedIntentStructure(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reasons.some((r) => /publicEffects/.test(r))).toBe(true);
  });

  it('rejects invalid amount precision / shape', () => {
    const intent = baseIntent({
      amount: { units: '12.34', decimals: 7 },
      digests: {
        planDigestHex: 'ab'.repeat(32),
        operationDigestHex: 'cd'.repeat(32),
      },
    });
    const res = validateApprovedIntentStructure(intent);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reasons.some((r) => /units|integer/i.test(r))).toBe(true);
  });

  it('rejects wrong network account shapes', () => {
    const intent = withDigests(baseIntent({ account: 'not-a-key' }), opBytes);
    expect(validateApprovedIntentStructure(intent).ok).toBe(false);
  });

  it('rejects deposit with destination', () => {
    const intent = withDigests(
      baseIntent({
        destination: { mode: 'g_address', gAddress: DEST_G },
      }),
      opBytes,
    );
    expect(validateApprovedIntentStructure(intent).ok).toBe(false);
  });

  it('allows estimated vs confirmed fees; unknown without units', () => {
    const estimated = withDigests(
      baseIntent({
        fees: [{ certainty: 'estimated', units: '100', note: 'hint' }],
      }),
      opBytes,
    );
    expect(validateApprovedIntentStructure(estimated).ok).toBe(true);
    const confirmed = withDigests(
      baseIntent({
        intentId: 'intent-fee-conf',
        fees: [{ certainty: 'confirmed', units: '100', note: 'from sim' }],
      }),
      opBytes,
    );
    expect(validateApprovedIntentStructure(confirmed).ok).toBe(true);
    const unknown = withDigests(
      baseIntent({
        intentId: 'intent-fee-unk',
        fees: [{ certainty: 'unknown', note: 'fee not available offline' }],
      }),
      opBytes,
    );
    expect(validateApprovedIntentStructure(unknown).ok).toBe(true);
    const badUnknown = withDigests(
      baseIntent({
        intentId: 'intent-fee-bad',
        fees: [{ certainty: 'unknown', units: '1', note: 'conflict' }],
      }),
      opBytes,
    );
    expect(validateApprovedIntentStructure(badUnknown).ok).toBe(false);
  });
});

describe('IntentStore state machine', () => {
  const opBytes = new TextEncoder().encode('synthetic-op-xdr-machine');

  it('happy path created → prepared → awaiting → approved → consumed', () => {
    const store = createIntentStore();
    createReady(store, opBytes, {}, 'intent-happy');
    store.prepare('intent-happy', clockAt(2_100));
    store.markAwaitingApproval('intent-happy', clockAt(2_200));
    const approved = store.approve('intent-happy', {
      clock: clockAt(2_300),
      trustedDigest: trusted,
      operationBytes: opBytes,
      authorizationId: 'authz-happy-0001',
    });
    expect(approved.status).toBe('approved');
    expect(approved.authorizationId).toBe('authz-happy-0001');
    const consumed = store.consume('intent-happy', {
      clock: clockAt(2_400),
      trustedDigest: trusted,
      operationBytes: opBytes,
      authorizationId: 'authz-happy-0001',
    });
    expect(consumed.status).toBe('consumed');
  });

  it('rejects impossible transitions', () => {
    const store = createIntentStore();
    createReady(store, opBytes, {}, 'intent-bad-tx');
    expect(() =>
      store.approve('intent-bad-tx', {
        clock: clockAt(2_000),
        trustedDigest: trusted,
        operationBytes: opBytes,
        authorizationId: 'authz-bad-tx-01',
      }),
    ).toThrow(IntentTransitionError);
    expect(() =>
      store.consume('intent-bad-tx', {
        clock: clockAt(2_000),
        trustedDigest: trusted,
        operationBytes: opBytes,
        authorizationId: 'authz-bad-tx-01',
      }),
    ).toThrow(/not allowed|NOT_APPROVED|authorizationId/i);
  });

  it('single-use consume', () => {
    const store = createIntentStore();
    toApproved(store, opBytes, 'intent-once');
    store.consume('intent-once', {
      clock: clockAt(3_000),
      trustedDigest: trusted,
      operationBytes: opBytes,
      authorizationId: 'authz-token-0001',
    });
    expect(() =>
      store.consume('intent-once', {
        clock: clockAt(3_100),
        trustedDigest: trusted,
        operationBytes: opBytes,
        authorizationId: 'authz-token-0001',
      }),
    ).toThrow(/already consumed|not allowed/i);
  });

  it('rejects plan↔operation digest discrepancy at create', () => {
    const store = createIntentStore();
    let intent = withDigests(baseIntent({ intentId: 'intent-mismatch' }), opBytes);
    intent = {
      ...intent,
      digests: {
        ...intent.digests,
        operationDigestHex: '11'.repeat(32),
      },
    };
    expect(() =>
      store.create({
        intent,
        trustedDigest: trusted,
        operationBytes: opBytes,
        clock: clockAt(2_000),
      }),
    ).toThrow(/digest/i);
  });

  it('rejects digest change after approve (operation bytes drift)', () => {
    const store = createIntentStore();
    toApproved(store, opBytes, 'intent-drift');
    const otherBytes = new TextEncoder().encode('tampered-op-xdr');
    expect(() =>
      store.consume('intent-drift', {
        clock: clockAt(3_000),
        trustedDigest: trusted,
        operationBytes: otherBytes,
        authorizationId: 'authz-token-0001',
      }),
    ).toThrow(/digest|drift/i);
  });

  it('expiry before approval', () => {
    const store = createIntentStore();
    createReady(store, opBytes, { createdAtMs: 1_000, expiresAtMs: 2_500 }, 'intent-exp-pre');
    store.prepare('intent-exp-pre', clockAt(2_000));
    store.markAwaitingApproval('intent-exp-pre', clockAt(2_100));
    expect(() =>
      store.approve('intent-exp-pre', {
        clock: clockAt(3_000),
        trustedDigest: trusted,
        operationBytes: opBytes,
        authorizationId: 'authz-late-0001',
      }),
    ).toThrow(/expired/i);
  });

  it('expiry after approval blocks consume', () => {
    const store = createIntentStore();
    const shortBytes = new TextEncoder().encode('short-ttl-op');
    createReady(store, shortBytes, { createdAtMs: 1_000, expiresAtMs: 5_000 }, 'intent-exp-post-2');
    store.prepare('intent-exp-post-2', clockAt(2_000));
    store.markAwaitingApproval('intent-exp-post-2', clockAt(2_100));
    store.approve('intent-exp-post-2', {
      clock: clockAt(2_200),
      trustedDigest: trusted,
      operationBytes: shortBytes,
      authorizationId: 'authz-short-01',
    });
    expect(() =>
      store.consume('intent-exp-post-2', {
        clock: clockAt(6_000),
        trustedDigest: trusted,
        operationBytes: shortBytes,
        authorizationId: 'authz-short-01',
      }),
    ).toThrow(/expired/i);
  });

  it('cancel and reject are terminal', () => {
    const store = createIntentStore();
    createReady(store, opBytes, {}, 'intent-cancel');
    store.prepare('intent-cancel', clockAt(2_000));
    const cancelled = store.cancel('intent-cancel', clockAt(2_100));
    expect(cancelled.status).toBe('cancelled');
    expect(() => store.prepare('intent-cancel', clockAt(2_200))).toThrow(/not allowed/i);

    createReady(store, opBytes, {}, 'intent-reject');
    store.prepare('intent-reject', clockAt(2_000));
    store.markAwaitingApproval('intent-reject', clockAt(2_100));
    const rejected = store.reject('intent-reject', clockAt(2_200));
    expect(rejected.status).toBe('rejected');
    expect(() =>
      store.approve('intent-reject', {
        clock: clockAt(2_300),
        trustedDigest: trusted,
        operationBytes: opBytes,
        authorizationId: 'authz-nope-0001',
      }),
    ).toThrow(/not allowed/i);
  });

  it('refuse reuse of same intentId', () => {
    const store = createIntentStore();
    createReady(store, opBytes, {}, 'intent-dup');
    const intent = withDigests(baseIntent({ intentId: 'intent-dup' }), opBytes);
    expect(() =>
      store.create({
        intent,
        trustedDigest: trusted,
        operationBytes: opBytes,
        clock: clockAt(2_000),
      }),
    ).toThrow(/already registered/i);
  });

  it('detects external mutation of presented intent at consume', () => {
    const store = createIntentStore();
    const record = toApproved(store, opBytes, 'intent-mut');
    const mutated = {
      ...record.intent,
      amount: { units: '999', decimals: 7 },
    } as ApprovedIntent;
    expect(() =>
      store.consume('intent-mut', {
        clock: clockAt(3_000),
        trustedDigest: trusted,
        operationBytes: opBytes,
        authorizationId: 'authz-token-0001',
        presentedIntent: mutated,
      }),
    ).toThrow(/mutat|fingerprint|digest/i);
  });

  it('unknown critical fields block approval', () => {
    const store = createIntentStore();
    const bytes = new TextEncoder().encode('unk-crit-op');
    createReady(
      store,
      bytes,
      {
        unknownCritical: [{ status: 'unknown', reason: 'destination effect not derivable from XDR' }],
      },
      'intent-unk',
    );
    store.prepare('intent-unk', clockAt(2_000));
    store.markAwaitingApproval('intent-unk', clockAt(2_100));
    expect(() =>
      store.approve('intent-unk', {
        clock: clockAt(2_200),
        trustedDigest: trusted,
        operationBytes: bytes,
        authorizationId: 'authz-unk-0001',
      }),
    ).toThrow(/unknown critical/i);
  });

  it('fail transition from prepared', () => {
    const store = createIntentStore();
    createReady(store, opBytes, {}, 'intent-fail');
    store.prepare('intent-fail', clockAt(2_000));
    const failed = store.fail('intent-fail', clockAt(2_100));
    expect(failed.status).toBe('failed');
    expect(() => store.markAwaitingApproval('intent-fail', clockAt(2_200))).toThrow(/not allowed/i);
  });

  it('refreshExpiry flips to expired without approving', () => {
    const store = createIntentStore();
    createReady(store, opBytes, { createdAtMs: 1_000, expiresAtMs: 3_000 }, 'intent-refresh');
    const expired = store.refreshExpiry('intent-refresh', clockAt(4_000));
    expect(expired.status).toBe('expired');
  });

  it('returns immutable intent snapshots (frozen)', () => {
    const store = createIntentStore();
    const { record } = createReady(store, opBytes, {}, 'intent-freeze');
    expect(Object.isFrozen(record.intent)).toBe(true);
    expect(() => {
      (record.intent as { amount: { units: string } }).amount.units = '0';
    }).toThrow();
  });
});

describe('2.17 IntentStore atomic consume', () => {
  const opBytes = new TextEncoder().encode('atomic-consume-op');

  it('two concurrent tryConsume: exactly one success', () => {
    const store = createIntentStore();
    toApproved(store, opBytes, 'intent-atomic');
    const args = {
      clock: clockAt(3_000),
      trustedDigest: trusted,
      operationBytes: opBytes,
      authorizationId: 'authz-token-0001',
    };
    const a = store.tryConsume('intent-atomic', args);
    const b = store.tryConsume('intent-atomic', args);
    const successes = [a, b].filter((r) => r.ok);
    const failures = [a, b].filter((r) => !r.ok);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    if (!failures[0]!.ok) {
      expect(failures[0].error.code).toMatch(/ALREADY_CONSUMED|INVALID_TRANSITION/);
    }
    expect(store.get('intent-atomic')?.status).toBe('consumed');
  });

  it('repeated consume calls: second fails', () => {
    const store = createIntentStore();
    toApproved(store, opBytes, 'intent-repeat');
    expect(
      store.tryConsume('intent-repeat', {
        clock: clockAt(3_000),
        trustedDigest: trusted,
        operationBytes: opBytes,
        authorizationId: 'authz-token-0001',
      }).ok,
    ).toBe(true);
    const second = store.tryConsume('intent-repeat', {
      clock: clockAt(3_100),
      trustedDigest: trusted,
      operationBytes: opBytes,
      authorizationId: 'authz-token-0001',
    });
    expect(second.ok).toBe(false);
  });

  it('concurrent expiry with consume: at most one success', () => {
    const store = createIntentStore();
    createReady(store, opBytes, { createdAtMs: 1_000, expiresAtMs: 5_000 }, 'intent-race-exp');
    store.prepare('intent-race-exp', clockAt(2_000));
    store.markAwaitingApproval('intent-race-exp', clockAt(2_100));
    store.approve('intent-race-exp', {
      clock: clockAt(2_200),
      trustedDigest: trusted,
      operationBytes: opBytes,
      authorizationId: 'authz-race-exp1',
    });
    // Same tick: refreshExpiry at expire boundary then tryConsume with late clock
    // Both see clock >= expires → neither may succeed as consume.
    const expired = store.refreshExpiry('intent-race-exp', clockAt(5_000));
    expect(expired.status).toBe('expired');
    const consume = store.tryConsume('intent-race-exp', {
      clock: clockAt(5_000),
      trustedDigest: trusted,
      operationBytes: opBytes,
      authorizationId: 'authz-race-exp1',
    });
    expect(consume.ok).toBe(false);
  });

  it('concurrent cancel with consume: exactly one wins', () => {
    const store = createIntentStore();
    toApproved(store, opBytes, 'intent-race-cancel');
    // Interleave: cancel then consume (and reverse order in second assertion pattern)
    const cancelled = store.cancel('intent-race-cancel', clockAt(3_000));
    expect(cancelled.status).toBe('cancelled');
    const afterCancel = store.tryConsume('intent-race-cancel', {
      clock: clockAt(3_000),
      trustedDigest: trusted,
      operationBytes: opBytes,
      authorizationId: 'authz-token-0001',
    });
    expect(afterCancel.ok).toBe(false);

    // Opposite order: consume first then cancel
    toApproved(store, opBytes, 'intent-race-cancel-2');
    const consumed = store.tryConsume('intent-race-cancel-2', {
      clock: clockAt(3_000),
      trustedDigest: trusted,
      operationBytes: opBytes,
      authorizationId: 'authz-token-0001',
    });
    expect(consumed.ok).toBe(true);
    expect(() => store.cancel('intent-race-cancel-2', clockAt(3_100))).toThrow(/not allowed/i);
  });
});

describe('2.17 input limits', () => {
  it('rejects narrative at max+1; accepts exact max', () => {
    const max = INTENT_LIMITS.narrativeStringMax;
    const ok = baseIntent({
      intentId: 'limits-narr-ok',
      publicEffects: ['x'.repeat(max)],
      privacyLimits: ['y'.repeat(max)],
      digests: { planDigestHex: 'ab'.repeat(32), operationDigestHex: 'cd'.repeat(32) },
    });
    expect(validateApprovedIntentStructure(ok).ok).toBe(true);

    const over = baseIntent({
      intentId: 'limits-narr-over',
      publicEffects: ['x'.repeat(max + 1)],
      digests: { planDigestHex: 'ab'.repeat(32), operationDigestHex: 'cd'.repeat(32) },
    });
    expect(validateApprovedIntentStructure(over).ok).toBe(false);
  });

  it('rejects empty narrative strings and empty intentId', () => {
    expect(
      validateApprovedIntentStructure(
        baseIntent({
          intentId: 'limits-empty-fx',
          publicEffects: [''],
          digests: { planDigestHex: 'ab'.repeat(32), operationDigestHex: 'cd'.repeat(32) },
        }),
      ).ok,
    ).toBe(false);
    expect(
      validateApprovedIntentStructure(
        baseIntent({
          intentId: '',
          digests: { planDigestHex: 'ab'.repeat(32), operationDigestHex: 'cd'.repeat(32) },
        }),
      ).ok,
    ).toBe(false);
  });

  it('counts Unicode by JS string length (codepoints may be multi-unit)', () => {
    // One emoji = 2 UTF-16 code units in JS .length
    const emoji = '🔐';
    expect(emoji.length).toBe(2);
    const almost = emoji.repeat(Math.floor(INTENT_LIMITS.narrativeStringMax / 2));
    expect(almost.length).toBeLessThanOrEqual(INTENT_LIMITS.narrativeStringMax);
    expect(
      validateApprovedIntentStructure(
        baseIntent({
          intentId: 'limits-unicode',
          publicEffects: [almost],
          digests: { planDigestHex: 'ab'.repeat(32), operationDigestHex: 'cd'.repeat(32) },
        }),
      ).ok,
    ).toBe(true);
    const over = almost + emoji;
    if (over.length > INTENT_LIMITS.narrativeStringMax) {
      expect(
        validateApprovedIntentStructure(
          baseIntent({
            intentId: 'limits-unicode-over',
            publicEffects: [over],
            digests: { planDigestHex: 'ab'.repeat(32), operationDigestHex: 'cd'.repeat(32) },
          }),
        ).ok,
      ).toBe(false);
    }
  });

  it('rejects intentId at max+1; accepts exact max', () => {
    const max = INTENT_LIMITS.intentIdMax;
    expect(
      validateApprovedIntentStructure(
        baseIntent({
          intentId: 'i'.repeat(max),
          digests: { planDigestHex: 'ab'.repeat(32), operationDigestHex: 'cd'.repeat(32) },
        }),
      ).ok,
    ).toBe(true);
    expect(
      validateApprovedIntentStructure(
        baseIntent({
          intentId: 'i'.repeat(max + 1),
          digests: { planDigestHex: 'ab'.repeat(32), operationDigestHex: 'cd'.repeat(32) },
        }),
      ).ok,
    ).toBe(false);
  });
});
