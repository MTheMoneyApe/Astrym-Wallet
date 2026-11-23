/**
 * Durable ambiguous-submission lock and getTransaction reconciliation.
 * The only RPC method this module builds is getTransaction, and only after
 * the Soroban read allowlist accepts the body.
 */

import { STELLAR_SOROBAN_TESTNET_RPC } from '@solanym/wallet-core/src/stellar/spp/sppNymOption.js';
import {
  reconcileUnresolvedSubmission,
  setUnresolvedSubmissionStore,
  type ReconcileTxStatus,
  type SubmissionReconcileResult,
  type UnresolvedSubmissionRecord,
  type UnresolvedSubmissionStore,
} from '@solanym/wallet-core/src/stellar/spp/sppExecutionGuard.js';
import {
  allowlistedGetTransactionBody,
  allowlistedSorobanReadBody,
} from './sppHostBridgeHandlers.js';

export const SPP_UNRESOLVED_SUBMISSIONS_KEY = 'astrym.spp.unresolvedSubmissions';

type ChromeLocalArea = {
  get: (
    key: string,
    callback?: (items: Record<string, unknown>) => void,
  ) => Promise<Record<string, unknown>> | void;
  set: (
    items: Record<string, unknown>,
    callback?: () => void,
  ) => Promise<void> | void;
};

function chromeLocal(): ChromeLocalArea | null {
  const local = (globalThis as { chrome?: { storage?: { local?: ChromeLocalArea } } }).chrome?.storage
    ?.local;
  if (!local?.get || !local?.set) return null;
  return local;
}

function lastChromeError(): string | null {
  try {
    const message = (globalThis as { chrome?: { runtime?: { lastError?: { message?: string } } } }).chrome
      ?.runtime?.lastError?.message;
    return message ?? null;
  } catch {
    return null;
  }
}

function storageGet(local: ChromeLocalArea, key: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (items: Record<string, unknown> | undefined) => {
      if (settled) return;
      settled = true;
      resolve(items ?? {});
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    try {
      const maybe = local.get(key, (items) => {
        const err = lastChromeError();
        if (err) fail(new Error(err));
        else finish(items);
      });
      if (maybe && typeof (maybe as Promise<unknown>).then === 'function') {
        void (maybe as Promise<Record<string, unknown>>).then(finish, fail);
      }
    } catch (error) {
      fail(error);
    }
  });
}

function storageSet(local: ChromeLocalArea, items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    try {
      const maybe = local.set(items, () => {
        const err = lastChromeError();
        if (err) fail(new Error(err));
        else finish();
      });
      if (maybe && typeof (maybe as Promise<unknown>).then === 'function') {
        void (maybe as Promise<void>).then(finish, fail);
      }
    } catch (error) {
      fail(error);
    }
  });
}

export function parseUnresolvedSubmissionRecords(raw: unknown): UnresolvedSubmissionRecord[] {
  if (!Array.isArray(raw)) return [];
  const records: UnresolvedSubmissionRecord[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const fingerprint = (item as { fingerprint?: unknown }).fingerprint;
    const hashes = (item as { hashes?: unknown }).hashes;
    const at = (item as { at?: unknown }).at;
    if (typeof fingerprint !== 'string' || !Array.isArray(hashes)) continue;
    const kept = hashes.filter((hash): hash is string => typeof hash === 'string' && hash.length > 0);
    if (kept.length === 0) continue;
    records.push({
      fingerprint,
      hashes: kept,
      at: typeof at === 'number' && Number.isFinite(at) ? at : Date.now(),
    });
  }
  return records;
}

export function chromeLocalUnresolvedStore(local: ChromeLocalArea = chromeLocal()!): UnresolvedSubmissionStore {
  return {
    async read() {
      const raw = await storageGet(local, SPP_UNRESOLVED_SUBMISSIONS_KEY);
      return parseUnresolvedSubmissionRecords(raw[SPP_UNRESOLVED_SUBMISSIONS_KEY]);
    },
    async write(records) {
      await storageSet(local, {
        [SPP_UNRESOLVED_SUBMISSIONS_KEY]: records.map((record) => ({
          fingerprint: record.fingerprint,
          hashes: [...record.hashes],
          at: record.at,
        })),
      });
    },
  };
}

/** Point the guard at chrome.storage.local. No-op when the extension API is absent. */
export function installChromeUnresolvedSubmissionStore(): void {
  const local = chromeLocal();
  if (!local) return;
  setUnresolvedSubmissionStore(chromeLocalUnresolvedStore(local));
}

export type SorobanTxStatus = ReconcileTxStatus | 'UNKNOWN';

export function parseSorobanGetTransactionStatus(body: string): SorobanTxStatus {
  try {
    const parsed = JSON.parse(body) as { result?: { status?: unknown } };
    const status = parsed.result?.status;
    switch (status) {
      case 'SUCCESS':
      case 'FAILED':
      case 'NOT_FOUND':
        return status;
      default:
        return 'UNKNOWN';
    }
  } catch {
    return 'UNKNOWN';
  }
}

/**
 * Fetch one hash with getTransaction. The body is the allowlisted rebuild;
 * anything else is not sent.
 */
export async function readAllowlistedGetTransactionStatus(
  hash: string,
  fetchRead: (url: string, init?: RequestInit) => Promise<Response>,
  rpcUrl: string = STELLAR_SOROBAN_TESTNET_RPC,
): Promise<SorobanTxStatus> {
  const body = allowlistedGetTransactionBody(hash);
  if (!body) return 'UNKNOWN';
  const forwarded = allowlistedSorobanReadBody(body);
  if (!forwarded) return 'UNKNOWN';
  let method: unknown;
  try {
    method = (JSON.parse(forwarded) as { method?: unknown }).method;
  } catch {
    return 'UNKNOWN';
  }
  if (method !== 'getTransaction') return 'UNKNOWN';
  try {
    const response = await fetchRead(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: forwarded,
    });
    if (!response.ok) return 'UNKNOWN';
    return parseSorobanGetTransactionStatus(await response.text());
  } catch {
    return 'UNKNOWN';
  }
}

export async function reconcileFingerprintThroughReadAllowlist(input: {
  fingerprint: string;
  fetchRead: (url: string, init?: RequestInit) => Promise<Response>;
  rpcUrl?: string;
}): Promise<SubmissionReconcileResult> {
  return reconcileUnresolvedSubmission({
    fingerprint: input.fingerprint,
    readTransaction: async (hash) => {
      const status = await readAllowlistedGetTransactionStatus(
        hash,
        input.fetchRead,
        input.rpcUrl ?? STELLAR_SOROBAN_TESTNET_RPC,
      );
      switch (status) {
        case 'SUCCESS':
        case 'FAILED':
        case 'NOT_FOUND':
          return status;
        case 'UNKNOWN':
          return 'NOT_FOUND';
        default: {
          const unexpected: never = status;
          void unexpected;
          return 'NOT_FOUND';
        }
      }
    },
  });
}

export async function confirmationFromAllowlistedGetTransaction(
  hash: string,
  fetchRead: (url: string, init?: RequestInit) => Promise<Response>,
  rpcUrl?: string,
): Promise<'confirmed' | 'submitted' | 'failed'> {
  const status = await readAllowlistedGetTransactionStatus(hash, fetchRead, rpcUrl);
  switch (status) {
    case 'SUCCESS':
      return 'confirmed';
    case 'FAILED':
      return 'failed';
    case 'NOT_FOUND':
    case 'UNKNOWN':
      return 'submitted';
    default: {
      const unexpected: never = status;
      return unexpected;
    }
  }
}
