/**
 * Fase 2.15 — Offline ApprovedIntent model (harness / tests only).
 *
 * This is a **simulated approval model**, not cryptographic authorization and not
 * a substitute for ContextualSignatureGate / WalletSigner. Not exported from
 * production packages/wallet-core/src barrels.
 */

/** Schema version of this offline intent document. */
export const APPROVED_INTENT_SCHEMA_VERSION = 1 as const;

export type SppIntentOp = 'deposit' | 'private_transfer' | 'withdraw';

/**
 * Exact integer amount in asset smallest units (e.g. stroops).
 * Never use IEEE floats for money.
 */
export type ExactAmount = {
  /** Non-negative integer decimal string (no sign, no fraction, no leading zeros except "0"). */
  units: string;
  /** Display decimals for UI (e.g. 7 for XLM). Not used in arithmetic. */
  decimals: number;
};

export type AssetRef = {
  kind: 'native' | 'classic' | 'contract';
  symbol?: string;
  /** Required when kind === 'contract'. */
  contractId?: string;
  code?: string;
  issuer?: string;
};

export type DestinationRef =
  | { mode: 'none' }
  | { mode: 'g_address'; gAddress: string }
  | { mode: 'privacy_keys'; notePublicKeyHex: string; encryptionPublicKeyHex?: string }
  | { mode: 'self' };

export type FeeLine = {
  /** confirmed = known from simulation/envelope; estimated = hint; unknown = must not approve if fee is critical. */
  certainty: 'confirmed' | 'estimated' | 'unknown';
  /** Smallest units; required unless certainty === 'unknown'. */
  units?: string;
  note: string;
};

/** Critical field that the offline model cannot derive from SDK XDR yet. */
export type UnknownCritical = { status: 'unknown'; reason: string };

export type DigestHex = string;

export type IntentDigests = {
  /** Digest of length-prefixed semantic plan fields (see planDigest.ts). */
  planDigestHex: DigestHex;
  /**
   * Digest of the exact operation/XDR bytes that would be signed.
   * Caller supplies bytes to DigestFn — this module does not invent XDR.
   */
  operationDigestHex: DigestHex;
};

/**
 * Semantic intent document. Digests alone do not prove safety — validation
 * must precede any future gate.approve wiring.
 */
export type ApprovedIntent = {
  schemaVersion: typeof APPROVED_INTENT_SCHEMA_VERSION;
  /** Generated outside dApp-controlled data (host / wallet RNG). */
  intentId: string;
  op: SppIntentOp;
  account: string;
  networkPassphrase: string;
  poolContractId: string;
  asset: AssetRef;
  amount: ExactAmount;
  destination: DestinationRef;
  fees: FeeLine[];
  publicEffects: string[];
  privacyLimits: string[];
  digests: IntentDigests;
  createdAtMs: number;
  expiresAtMs: number;
  /**
   * When a critical semantic field cannot be established, approval must fail.
   * Empty array = all critical fields considered present for offline model.
   */
  unknownCritical: UnknownCritical[];
};

export type IntentStatus =
  | 'created'
  | 'prepared'
  | 'awaiting_approval'
  | 'approved'
  | 'consumed'
  | 'rejected'
  | 'expired'
  | 'cancelled'
  | 'failed';

export type IntentTerminalStatus = Extract<
  IntentStatus,
  'consumed' | 'rejected' | 'expired' | 'cancelled' | 'failed'
>;

/** Clock injected for tests — never trust untrusted content timestamps as "now". */
export type Clock = () => number;

/** Deterministic digest of arbitrary bytes → 32-byte hex (64 chars). */
export type DigestFn = (bytes: Uint8Array) => DigestHex;

export type TransitionErrorCode =
  | 'INVALID_TRANSITION'
  | 'EXPIRED'
  | 'VALIDATION_FAILED'
  | 'DIGEST_MISMATCH'
  | 'DIGEST_UNTRUSTED'
  | 'ALREADY_USED_ID'
  | 'INTENT_MUTATED'
  | 'NOT_APPROVED'
  | 'ALREADY_CONSUMED'
  | 'UNKNOWN_CRITICAL'
  | 'CONFLICT';

export class IntentTransitionError extends Error {
  readonly code: TransitionErrorCode;
  constructor(code: TransitionErrorCode, message: string) {
    super(message);
    this.name = 'IntentTransitionError';
    this.code = code;
  }
}
