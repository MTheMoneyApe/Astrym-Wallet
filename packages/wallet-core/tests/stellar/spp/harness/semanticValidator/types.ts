/**
 * Fase 2.19–2.21 — Offline partial semantic validator types (harness only).
 *
 * Authoritative outcome fields (Fase 2.21):
 *   - `classification` — scope of what was verified
 *   - `safetyClaim` — always `not_full_protocol_safety`
 *   - `bindingId` — mandatory fingerprint of intent+evidence
 *
 * Deprecated / non-authoritative:
 *   - `status` / `verifiable_complete` — legacy alias only; NEVER use as
 *     an authorization or “fully secure” condition.
 *
 * Not exported from production packages/wallet-core/src.
 */

/** Ops this prototype may attempt to validate. */
export type VerifiableSppOp = 'deposit' | 'withdraw';

/** Ops / modes explicitly blocked (fail closed). */
export type BlockedSppOp = 'private_transfer' | 'transfer_to_keys' | 'transact_raw';

export type ExpectedDestination =
  | { mode: 'none' }
  | { mode: 'self' }
  | { mode: 'g_address'; gAddress: string }
  | { mode: 'privacy_keys'; notePublicKeyHex: string; encryptionPublicKeyHex?: string };

/**
 * Caller-supplied approved intent surface (not an ApprovedIntent wire-up).
 * Digests are intentionally omitted — opaque digests are not semantic proof.
 */
export type ExpectedSemanticIntent = {
  op: VerifiableSppOp | BlockedSppOp;
  account: string;
  networkPassphrase: string;
  poolContractId: string;
  /** Required for deposit auth-tree token.transfer check (FASE-2.18 / check_transact_auth). */
  tokenContractId: string;
  /** Exact integer decimal string (stroops / smallest units). */
  amountUnits: string;
  destination: ExpectedDestination;
  /**
   * Declared number of on-chain txs for the logical plan.
   * Prototype only accepts `1`. Values >1 or missing when multi-tx is implied → reject.
   */
  planTxCount: number;
};

/**
 * Verifiable operation evidence produced after simulate (synthetic in tests).
 * Auth entries are the SorobanAuthorizationEntry XDRs (base64), matching SPP
 * PreparedSorobanTx.auth_entries — not HashIdPreimage digests.
 */
export type OperationEvidence = {
  networkPassphrase: string;
  /** Unsigned (or auth-patched) transaction envelope XDR (base64). */
  transactionXdr: string;
  /** Base64 SorobanAuthorizationEntry encodings (typically length 1 for transact). */
  authEntryXdrs: string[];
};

export type FieldVerdict =
  | { field: string; status: 'verified'; detail?: string }
  | { field: string; status: 'unverified'; reason: string }
  | { field: string; status: 'mismatch'; reason: string }
  | { field: string; status: 'blocked'; reason: string };

/**
 * @deprecated Non-authoritative legacy status (Fase 2.21).
 * Do not use for acceptance / authorization. Use `classification` instead.
 *
 * - rejected
 * - partial — unused on success path
 * - verifiable_complete — **deprecated alias** of surface verification only
 */
export type SemanticValidationStatus = 'rejected' | 'partial' | 'verifiable_complete';

/**
 * Authoritative outcome label (Fase 2.20/2.21).
 * Consumers MUST use this field (via {@link acceptSurfaceVerification}), not `status`.
 */
export type SemanticClassification =
  | 'rejected'
  | 'surface_verified_with_opaque_remainder';

export type SafetyClaim = 'not_full_protocol_safety';

export type SemanticValidationResult = {
  /**
   * @deprecated Legacy mirror of classification. `verifiable_complete` ≠ full safety.
   * Not an authorization condition.
   */
  status: SemanticValidationStatus;
  /** Authoritative scope of verification. */
  classification: SemanticClassification;
  /** Always `not_full_protocol_safety`; missing/wrong values fail contract parse. */
  safetyClaim: SafetyClaim;
  /** Human summary; never claims full SPP safety. */
  summary: string;
  verifiedFields: readonly string[];
  unverifiedFields: ReadonlyArray<{ field: string; reason: string }>;
  rejectionReasons: readonly string[];
  fieldVerdicts: readonly FieldVerdict[];
  /** Extracted ExtData / invoke facts when parse succeeded (even on reject). */
  extracted?: ExtractedTransactFacts;
  /**
   * Mandatory binding fingerprint of (intent surface + evidence XDRs).
   * Always set by {@link validateSemanticConcordance}.
   */
  bindingId: string;
};

/** Facts derived from invoke HostFunction + ExtData map + auth tree. */
export type ExtractedTransactFacts = {
  readonly sourceAccount: string;
  readonly poolContractId: string;
  readonly functionName: string;
  readonly senderAddress: string;
  readonly extAmount: bigint;
  readonly recipientAddress: string;
  readonly encryptedOutput0ByteLength: number;
  readonly encryptedOutput1ByteLength: number;
  readonly authEntryCount: number;
  readonly authRootFunctionName: string | null;
  readonly authRootContractId: string | null;
  readonly authSubInvocationCount: number;
  readonly tokenTransfer?: {
    readonly tokenContractId: string;
    readonly from: string;
    readonly to: string;
    readonly amount: bigint;
  };
  readonly operationCount: number;
  readonly isFeeBump: boolean;
  /** True when auth root args were byte-compared to invoke args (Fase 2.20). */
  readonly authBoundToInvoke: boolean;
};
