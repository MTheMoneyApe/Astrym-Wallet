/**
 * Fail-closed guards for private payment execution:
 * authorization fingerprint binding + single-flight / duplicate rejection.
 */

import type { SppPrivateOperation } from './sppNymOption.js';

export type PrivatePaymentAuthMaterial = {
  operation: SppPrivateOperation;
  poolContract: string;
  amountStroops: string;
  recipient?: string | null;
};

/** Deterministic fingerprint of the exact private payment the user authorized. */
export function privatePaymentFingerprint(material: PrivatePaymentAuthMaterial): string {
  const recipient = material.recipient?.trim() ?? '';
  return [
    material.operation,
    material.poolContract.trim(),
    material.amountStroops.trim(),
    recipient,
  ].join('|');
}

export function assertAuthorizationFingerprint(
  material: PrivatePaymentAuthMaterial,
  provided: string | undefined | null,
): void {
  const expected = privatePaymentFingerprint(material);
  if (!provided || provided !== expected) {
    throw new Error(
      'Autorización inválida o desactualizada: los detalles no coinciden con lo autorizado.',
    );
  }
}

export type UnresolvedSubmissionRecord = {
  fingerprint: string;
  hashes: readonly string[];
  at: number;
};

export type UnresolvedSubmissionStore = {
  read(): Promise<readonly UnresolvedSubmissionRecord[]>;
  write(records: readonly UnresolvedSubmissionRecord[]): Promise<void>;
};

export type ReconcileTxStatus = 'SUCCESS' | 'FAILED' | 'NOT_FOUND';

/** Durable lock outcome after allowlisted getTransaction. */
export type SubmissionReconcileResult =
  | { locked: true }
  | { locked: false; confirmation: 'confirmed' | 'failed' };

type PendingSubmission = {
  hashes: readonly string[];
  at: number;
};

function cloneUnresolved(record: UnresolvedSubmissionRecord): UnresolvedSubmissionRecord | null {
  if (typeof record?.fingerprint !== 'string' || record.fingerprint.length < 8) return null;
  if (!Array.isArray(record.hashes) || record.hashes.length === 0) return null;
  const hashes: string[] = [];
  for (const hash of record.hashes) {
    if (typeof hash !== 'string' || hash.length === 0 || hash.length > 128) continue;
    hashes.push(hash);
    if (hashes.length === 20) break;
  }
  if (hashes.length === 0) return null;
  const at = typeof record.at === 'number' && Number.isFinite(record.at) ? record.at : Date.now();
  return { fingerprint: record.fingerprint.slice(0, 256), hashes, at };
}

const memoryBacking: UnresolvedSubmissionRecord[] = [];

const defaultUnresolvedStore: UnresolvedSubmissionStore = {
  async read() {
    return memoryBacking.map((record) => ({ ...record, hashes: [...record.hashes] }));
  },
  async write(records) {
    memoryBacking.splice(0, memoryBacking.length);
    for (const record of records) {
      const copy = cloneUnresolved(record);
      if (copy) memoryBacking.push(copy);
    }
  },
};

let unresolvedStore: UnresolvedSubmissionStore = defaultUnresolvedStore;

/** Extension installs chrome.storage.local here. Tests may inject a store. */
export function setUnresolvedSubmissionStore(store: UnresolvedSubmissionStore | null): void {
  unresolvedStore = store ?? defaultUnresolvedStore;
}

export function resetUnresolvedSubmissionStoreForTests(): void {
  memoryBacking.splice(0, memoryBacking.length);
  unresolvedStore = defaultUnresolvedStore;
}

type GuardState = {
  inFlight: Set<string>;
  recent: Map<string, number>;
  unresolved: Map<string, PendingSubmission>;
};

const globalGuard: GuardState = {
  inFlight: new Set(),
  recent: new Map(),
  unresolved: new Map(),
};

const RECENT_TTL_MS = 15_000;

/**
 * Acquire exclusive execution for a fingerprint. Rejects duplicates while in-flight
 * or within a short post-success window (stale double-submit).
 */
export function beginPrivatePaymentExecution(
  fingerprint: string,
  now = Date.now(),
  state: GuardState = globalGuard,
): { release: (opts?: { completed?: boolean; reconcile?: boolean }) => void } {
  for (const [key, at] of state.recent) {
    if (now - at > RECENT_TTL_MS) state.recent.delete(key);
  }
  if (state.unresolved.has(fingerprint)) {
    throw new Error(
      'Reautorización bloqueada hasta reconciliar la operación por getTransaction.',
    );
  }
  if (state.inFlight.has(fingerprint)) {
    throw new Error('Ya hay un pago privado en curso con los mismos detalles (duplicado).');
  }
  const recentAt = state.recent.get(fingerprint);
  if (recentAt !== undefined && now - recentAt < RECENT_TTL_MS) {
    throw new Error(
      'Pago privado duplicado rechazado: la misma operación se envió hace unos segundos.',
    );
  }
  state.inFlight.add(fingerprint);
  return {
    release: (opts) => {
      state.inFlight.delete(fingerprint);
      if (opts?.completed || opts?.reconcile) state.recent.set(fingerprint, Date.now());
    },
  };
}

function isTerminalStatus(status: ReconcileTxStatus): boolean {
  switch (status) {
    case 'SUCCESS':
    case 'FAILED':
      return true;
    case 'NOT_FOUND':
      return false;
    default: {
      const unexpected: never = status;
      void unexpected;
      return false;
    }
  }
}

/** Load durable unresolved submissions into this process (service-worker start). */
export async function hydrateUnresolvedSubmissions(state: GuardState = globalGuard): Promise<void> {
  state.unresolved.clear();
  for (const record of await unresolvedStore.read()) {
    const copy = cloneUnresolved(record);
    if (!copy) continue;
    state.unresolved.set(copy.fingerprint, { hashes: copy.hashes, at: copy.at });
  }
}

export async function hasUnresolvedSubmission(fingerprint: string): Promise<boolean> {
  for (const record of await unresolvedStore.read()) {
    const copy = cloneUnresolved(record);
    if (copy?.fingerprint === fingerprint) return true;
  }
  return false;
}

/** Remember an ambiguous submit. Empty hash lists are not locks. */
export async function persistUnresolvedSubmission(
  record: UnresolvedSubmissionRecord,
  state: GuardState = globalGuard,
): Promise<void> {
  const copy = cloneUnresolved(record);
  if (!copy) return;
  const current: UnresolvedSubmissionRecord[] = [];
  for (const item of await unresolvedStore.read()) {
    const kept = cloneUnresolved(item);
    if (kept && kept.fingerprint !== copy.fingerprint) current.push(kept);
  }
  current.push(copy);
  await unresolvedStore.write(current);
  state.unresolved.set(copy.fingerprint, { hashes: copy.hashes, at: copy.at });
}

/**
 * Clear the durable lock only after every hash has a terminal getTransaction
 * status. SUCCESS unlocks as confirmed. FAILED unlocks as failed. NOT_FOUND
 * keeps the lock. The reader must be the read allowlist.
 */
export async function reconcileUnresolvedSubmission(input: {
  fingerprint: string;
  readTransaction: (hash: string) => Promise<ReconcileTxStatus>;
  state?: GuardState;
}): Promise<SubmissionReconcileResult> {
  const state = input.state ?? globalGuard;
  await hydrateUnresolvedSubmissions(state);
  const pending = state.unresolved.get(input.fingerprint);
  if (!pending) return { locked: false, confirmation: 'confirmed' };
  let failed = false;
  for (const hash of pending.hashes) {
    const status = await input.readTransaction(hash);
    if (!isTerminalStatus(status)) return { locked: true };
    if (status === 'FAILED') failed = true;
  }
  state.unresolved.delete(input.fingerprint);
  state.recent.delete(input.fingerprint);
  const remaining: UnresolvedSubmissionRecord[] = [];
  for (const item of await unresolvedStore.read()) {
    const copy = cloneUnresolved(item);
    if (copy && copy.fingerprint !== input.fingerprint) remaining.push(copy);
  }
  await unresolvedStore.write(remaining);
  if (failed) return { locked: false, confirmation: 'failed' };
  return { locked: false, confirmation: 'confirmed' };
}

/** Test helper — clears process-local guard state. */
export function resetPrivatePaymentExecutionGuardForTests(state: GuardState = globalGuard): void {
  state.inFlight.clear();
  state.recent.clear();
  state.unresolved.clear();
  if (state === globalGuard && unresolvedStore === defaultUnresolvedStore) {
    memoryBacking.splice(0, memoryBacking.length);
  }
}
