/**
 * Fase 2.24 — Read-only policy types (harness only).
 *
 * Allowlist is exact-string only. Default deny. Not production.
 *
 * G8 / G9 remain FAIL per FASE-2.23 — this module must not claim otherwise.
 */

/** Exact method identifiers authorized for RO-1 (FASE-2.24). */
export type ReadOnlyAllowedMethod =
  | 'Storage.open'
  | 'Client.new'
  | 'Client.aspState'
  | 'Client.allContractsData';

/**
 * Explicit denials (non-exhaustive). Unknown methods are also denied.
 * Names match public JS / documented internal entry points — exact match only.
 */
export type ReadOnlyDeniedMethod =
  | 'Client.sync'
  | 'Client.backgroundSync'
  | 'Client.stopBackgroundSync'
  | 'ensure_synced'
  | 'Client.operationalFeed'
  | 'Client.recipientLookup'
  | 'Client.verifySelectiveDisclosure'
  | 'verifySelectiveDisclosure'
  | 'Client.contractConfig'
  | 'Client.dispose'
  | 'Client.account'
  | 'deriveAspUserLeaf'
  | 'bootnodeRequired'
  | 'readTokenDecimals'
  | 'PrivatePool.deposit'
  | 'PrivatePool.transfer'
  | 'PrivatePool.transferToKeys'
  | 'PrivatePool.withdraw'
  | 'PrivatePool.transact'
  | 'PrivatePool.estimate'
  | 'PrivatePool.notes'
  | 'PrivatePool.balance'
  | 'execute_plan'
  | 'prove_next'
  | 'signTransaction'
  | 'signAuthEntry'
  | 'signMessage'
  | 'sendTransaction';

export type ReadOnlyMethod = ReadOnlyAllowedMethod | ReadOnlyDeniedMethod | (string & {});

export type PolicyDecision =
  | {
      ok: true;
      method: ReadOnlyAllowedMethod;
      at: string;
    }
  | {
      ok: false;
      method: string;
      reason: string;
      at: string;
    };

/** Client.new options accepted by the harness policy (strict key set). */
export type ReadOnlyClientNewArgs = {
  rpcUrl: string;
  contractConfig: Record<string, unknown>;
  /** Optional pre-opened storage handle (opaque to policy). */
  storage?: unknown;
  storageWorkerUrl?: string;
  circuitsBaseUrl?: string;
  circuitLock?: unknown;
  /** Preconfigured prover — allowed for init load only; prove APIs remain denied. */
  prover?: unknown;
  proverWorkerUrl?: string;
};

export type ReadOnlyStorageOpenArgs = {
  workerUrl?: string;
};

export type ReadOnlyCallRequest =
  | { method: 'Storage.open'; args?: ReadOnlyStorageOpenArgs }
  | { method: 'Client.new'; args: ReadOnlyClientNewArgs }
  | { method: 'Client.aspState'; args?: Record<string, never> }
  | { method: 'Client.allContractsData'; args?: Record<string, never> }
  | { method: string; args?: unknown };

/** Documented gate status — policy must not elevate these. */
export const G8_HOST_STATUS = 'FAIL' as const;
export const G9_CONFIG_STATUS = 'FAIL' as const;
