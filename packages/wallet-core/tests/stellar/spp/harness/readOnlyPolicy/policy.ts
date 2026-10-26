/**
 * Fase 2.24 — Fail-closed read-only allowlist (harness only).
 *
 * Exact method strings only. No prefix / regex / substring matching.
 * Default deny. Does not invoke the SDK.
 *
 * Transitive RPC safety of aspState / allContractsData is established by
 * FASE-2.8–2.12 source audit (getLedgerEntries only) — this module enforces
 * the public surface allowlist, not WASM internals.
 */

import { DecisionLog } from './decisionLog.js';
import type {
  PolicyDecision,
  ReadOnlyAllowedMethod,
  ReadOnlyCallRequest,
  ReadOnlyClientNewArgs,
  ReadOnlyStorageOpenArgs,
} from './types.js';
import { G8_HOST_STATUS, G9_CONFIG_STATUS } from './types.js';

const ALLOWED: ReadonlySet<string> = new Set([
  'Storage.open',
  'Client.new',
  'Client.aspState',
  'Client.allContractsData',
]);

/** Explicit denials for documentation + faster reason codes (still exact-match). */
const EXPLICIT_DENY: ReadonlyMap<string, string> = new Map([
  ['Client.sync', 'sync triggers catch-up / getEvents+getLatestLedger (FASE-2.10/2.23)'],
  ['Client.backgroundSync', 'backgroundSync starts indexer (FASE-2.23 DENY)'],
  ['Client.stopBackgroundSync', 'not in RO-1 allowlist (FASE-2.24 four-API scope)'],
  ['ensure_synced', 'internal sync gate — not a public RO API'],
  ['Client.operationalFeed', 'calls ensure_synced (FASE-2.11)'],
  ['Client.recipientLookup', 'calls ensure_synced (FASE-2.11)'],
  ['Client.verifySelectiveDisclosure', 'invokes prover / ZK verification path'],
  ['verifySelectiveDisclosure', 'standalone disclosure verify uses prover'],
  ['Client.contractConfig', 'not in RO-1 four-API allowlist (local-safe but out of scope)'],
  ['Client.dispose', 'not in RO-1 four-API allowlist'],
  ['Client.account', 'opens PrivatePool mutation surface'],
  ['deriveAspUserLeaf', 'not in RO-1 four-API allowlist'],
  ['bootnodeRequired', 'getEvents probe — not ledger-entries RO'],
  ['readTokenDecimals', 'simulateTransaction only (FASE-2.7)'],
  ['PrivatePool.deposit', 'mutation / execute_plan'],
  ['PrivatePool.transfer', 'mutation / execute_plan'],
  ['PrivatePool.transferToKeys', 'mutation / execute_plan'],
  ['PrivatePool.withdraw', 'mutation / execute_plan'],
  ['PrivatePool.transact', 'mutation / execute_plan'],
  ['PrivatePool.estimate', 'un-audited for RO-1; may couple to synced state'],
  ['PrivatePool.notes', 'un-audited; sync coupling risk'],
  ['PrivatePool.balance', 'un-audited; sync coupling risk'],
  ['execute_plan', 'mutation loop prove→sim→sign→submit'],
  ['prove_next', 'ZK proof generation'],
  ['signTransaction', 'signing forbidden in read-only mode'],
  ['signAuthEntry', 'signing forbidden in read-only mode'],
  ['signMessage', 'signing forbidden in read-only mode'],
  ['sendTransaction', 'write RPC forbidden'],
]);

const CLIENT_NEW_KEYS: ReadonlySet<string> = new Set([
  'rpcUrl',
  'contractConfig',
  'storage',
  'storageWorkerUrl',
  'circuitsBaseUrl',
  'circuitLock',
  'prover',
  'proverWorkerUrl',
]);

const STORAGE_OPEN_KEYS: ReadonlySet<string> = new Set(['workerUrl']);

function nowIso(): string {
  return new Date().toISOString();
}

function deny(method: string, reason: string, log?: DecisionLog): PolicyDecision {
  const decision: PolicyDecision = { ok: false, method, reason, at: nowIso() };
  log?.record(decision);
  return decision;
}

function allow(method: ReadOnlyAllowedMethod, log?: DecisionLog): PolicyDecision {
  const decision: PolicyDecision = { ok: true, method, at: nowIso() };
  log?.record(decision);
  return decision;
}

/**
 * Loopback-only rpcUrl for harness RO-1 (FASE-2.25 hardened).
 *
 * Requires an *explicit* literal host in the input string — does not accept
 * URL-parser aliases that canonicalize to 127.0.0.1 (`127.1`, `0x7f000001`,
 * decimal IPv4, credentials, `@`-authority tricks).
 */
const LITERAL_LOOPBACK_RPC =
  /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?(\/[\w.~:/?#[\]@!$&'()*+,;=%-]*)?$/i;

export function isHarnessLoopbackRpcUrl(rpcUrl: unknown): boolean {
  if (typeof rpcUrl !== 'string' || rpcUrl.trim() === '') return false;
  const trimmed = rpcUrl.trim();
  // Reject credentials / userinfo before parse (also blocked by literal regex).
  if (trimmed.includes('@')) return false;
  if (!LITERAL_LOOPBACK_RPC.test(trimmed)) return false;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username !== '' || url.password !== '') return false;
  const host = url.hostname.toLowerCase();
  // WHATWG may yield "[::1]" for IPv6 loopback.
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1';
}

function isLocalWorkerOrAssetUrl(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== 'string' || value.trim() === '') return false;
  const trimmed = value.trim();
  if (trimmed.includes('@')) return false;
  // Relative paths / same-bundle workers (harness / extension packaging)
  if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) return true;
  if (trimmed.startsWith('blob:')) return true;
  try {
    const url = new URL(trimmed);
    if (url.username !== '' || url.password !== '') return false;
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return isHarnessLoopbackRpcUrl(trimmed);
    }
    // file: / chrome-extension: treated as local packaging, not remote RPC
    return url.protocol === 'file:' || url.protocol === 'chrome-extension:';
  } catch {
    return false;
  }
}

function assertNoExtraKeys(
  obj: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): string | null {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) return `unsupported argument key: ${key}`;
  }
  return null;
}

function validateStorageOpenArgs(args: unknown, log?: DecisionLog): PolicyDecision {
  if (args === undefined || args === null) {
    return allow('Storage.open', log);
  }
  if (typeof args !== 'object' || Array.isArray(args)) {
    return deny('Storage.open', 'Storage.open args must be an object or omitted', log);
  }
  const o = args as ReadOnlyStorageOpenArgs & Record<string, unknown>;
  const extra = assertNoExtraKeys(o, STORAGE_OPEN_KEYS);
  if (extra) return deny('Storage.open', extra, log);
  if (!isLocalWorkerOrAssetUrl(o.workerUrl)) {
    return deny('Storage.open', 'workerUrl must be local / loopback / relative', log);
  }
  return allow('Storage.open', log);
}

function validateClientNewArgs(args: unknown, log?: DecisionLog): PolicyDecision {
  if (args === undefined || args === null || typeof args !== 'object' || Array.isArray(args)) {
    return deny('Client.new', 'Client.new requires an options object', log);
  }
  const o = args as ReadOnlyClientNewArgs & Record<string, unknown>;
  const extra = assertNoExtraKeys(o, CLIENT_NEW_KEYS);
  if (extra) return deny('Client.new', extra, log);

  // bootnodeUrl intentionally not in CLIENT_NEW_KEYS — if present via cast, extra-key check catches it
  if ('bootnodeUrl' in o) {
    return deny('Client.new', 'bootnodeUrl is forbidden in read-only Client.new', log);
  }

  if (!isHarnessLoopbackRpcUrl(o.rpcUrl)) {
    return deny(
      'Client.new',
      'rpcUrl must be harness loopback (127.0.0.1 / localhost / ::1)',
      log,
    );
  }

  if (
    o.contractConfig === undefined ||
    o.contractConfig === null ||
    typeof o.contractConfig !== 'object' ||
    Array.isArray(o.contractConfig)
  ) {
    return deny('Client.new', 'contractConfig object is required', log);
  }

  if (!isLocalWorkerOrAssetUrl(o.storageWorkerUrl)) {
    return deny('Client.new', 'storageWorkerUrl must be local / loopback / relative', log);
  }
  if (!isLocalWorkerOrAssetUrl(o.circuitsBaseUrl)) {
    return deny('Client.new', 'circuitsBaseUrl must be local / loopback / relative', log);
  }
  if (!isLocalWorkerOrAssetUrl(o.proverWorkerUrl)) {
    return deny('Client.new', 'proverWorkerUrl must be local / loopback / relative', log);
  }

  return allow('Client.new', log);
}

function validateNoArgs(
  method: 'Client.aspState' | 'Client.allContractsData',
  args: unknown,
  log?: DecisionLog,
): PolicyDecision {
  if (args === undefined || args === null) return allow(method, log);
  if (typeof args !== 'object' || Array.isArray(args)) {
    return deny(method, `${method} takes no arguments`, log);
  }
  if (Object.keys(args as object).length > 0) {
    return deny(method, `${method} does not accept argument keys`, log);
  }
  return allow(method, log);
}

/**
 * Authorize a single call. Never invokes SDK. Fail-closed.
 */
export function authorizeReadOnlyCall(
  request: ReadOnlyCallRequest,
  log?: DecisionLog,
): PolicyDecision {
  const method = request?.method;

  if (typeof method !== 'string' || method.length === 0) {
    return deny(String(method), 'method must be a non-empty string', log);
  }

  // Exact deny table first (clear reasons)
  const explicit = EXPLICIT_DENY.get(method);
  if (explicit) {
    return deny(method, explicit, log);
  }

  if (!ALLOWED.has(method)) {
    return deny(method, 'method not on read-only allowlist (default deny)', log);
  }

  switch (method as ReadOnlyAllowedMethod) {
    case 'Storage.open':
      return validateStorageOpenArgs(request.args, log);
    case 'Client.new':
      return validateClientNewArgs(request.args, log);
    case 'Client.aspState':
      return validateNoArgs('Client.aspState', request.args, log);
    case 'Client.allContractsData':
      return validateNoArgs('Client.allContractsData', request.args, log);
    default:
      return deny(method, 'method not on read-only allowlist (default deny)', log);
  }
}

/**
 * Gate status snapshot — always FAIL for G8/G9 in this harness phase.
 * Tests assert these are never reported as PASS.
 */
export function readOnlyGateStatus(): {
  G8_host: typeof G8_HOST_STATUS;
  G9_config: typeof G9_CONFIG_STATUS;
  productionIntegration: 'prohibited';
} {
  return {
    G8_host: G8_HOST_STATUS,
    G9_config: G9_CONFIG_STATUS,
    productionIntegration: 'prohibited',
  };
}

export function isAllowedMethod(method: string): method is ReadOnlyAllowedMethod {
  return ALLOWED.has(method);
}

export function listAllowedMethods(): readonly ReadOnlyAllowedMethod[] {
  return ['Storage.open', 'Client.new', 'Client.aspState', 'Client.allContractsData'] as const;
}

export function listExplicitDenials(): readonly string[] {
  return Object.freeze([...EXPLICIT_DENY.keys()]);
}
