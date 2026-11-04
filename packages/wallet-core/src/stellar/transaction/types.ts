export interface SendXlmRequest {
  sourceAccountIndex: number;
  destination: string;
  amountXlm: string;
  memo?: string | undefined;
  /**
   * When set (SEND path), balance checks and the returned fee use this exact
   * stroop value instead of re-fetching Horizon's base fee.
   */
  approvedFeeStroops?: number | undefined;
}

export interface XlmTransferSummary {
  sourceAddress: string;
  destinationAddress: string;
  amountXlm: string;
  feeXlm: string;
  /** Integer stroops corresponding to feeXlm (avoids float round-trip). */
  feeStroops: number;
  balanceXlm: string;
  destinationExists: boolean;
  operationType: 'payment' | 'createAccount';
  memo?: string | undefined;
}

export type StellarTransactionLifecycleStatus =
  | 'SUBMITTING'
  | 'SUBMITTED_INGESTED'
  | 'CONFIRMED'
  | 'FAILED'
  | 'SUBMISSION_UNKNOWN'
  | 'INDETERMINATE';

export type StellarTransactionResultStatus =
  | 'confirmed'
  | 'failed'
  | 'unknown'
  | 'SUBMITTED_INGESTED'
  | 'CONFIRMED'
  | 'FAILED'
  | 'SUBMISSION_UNKNOWN'
  | 'INDETERMINATE';

export interface StellarTransactionResult {
  hash: string;
  ledger?: number | undefined;
  status: StellarTransactionResultStatus;
}

/**
 * Immutable trusted transfer review proposal created at REVIEW time.
 * Validated against signed XDR immediately before submission.
 */
export interface TrustedStellarTransferReview {
  sourceAddress: string;
  destinationAddress: string;
  amountXlm: string;
  approvedFeeStroops: number;
  memo?: string | undefined;
  operationType: 'payment' | 'createAccount';
  timebounds: {
    minTime: number;
    maxTime: number;
  };
  expectedSequence: string;
}

/**
 * Minimal non-sensitive write-ahead record persisted before Horizon dispatch.
 * The storage key is retained for migration from earlier session-only storage.
 */
export interface UncertainTxSessionFlag {
  schemaVersion: 1;
  txHash: string;
  accountIndex: number;
  sourceAddress: string;
  destinationAddress: string;
  amountXlm: string;
  approvedFeeStroops: number;
  expectedSequence: string;
  maxTime: number;
  submittedAt: number;
  lastProbeAt: number;
  status: 'SUBMITTING' | 'SUBMISSION_UNKNOWN' | 'SUBMITTED_INGESTED' | 'INDETERMINATE';
}

/** Durable key; the same key is read from chrome.storage.session during migration. */
export const SESSION_UNCERTAIN_KEY = 'solanym_uncertain_tx_v1';

export interface IUncertainSubmissionStorage {
  load(): Promise<UncertainTxSessionFlag | null>;
  save(record: UncertainTxSessionFlag): Promise<void>;
  clear(): Promise<void>;
}

export interface StellarSubmissionLifecycle {
  beforeDispatch(record: UncertainTxSessionFlag): Promise<void>;
  resolve(record: UncertainTxSessionFlag): Promise<void>;
}

/**
 * Non-sensitive transaction record schema for Module 2 persistent recovery.
 * Strictly free of private keys, seeds, signatures, or signed XDR envelopes.
 *
 * **`status` invariant — why `'SUBMITTED_INGESTED'` is intentionally excluded:**
 * `UncertainTxSessionFlag.status` includes `'SUBMITTED_INGESTED'` because it is a
 * live in-session tracker updated atomically as the submission outcome is determined.
 * `MinimalUncertainSubmissionRecord` is the Module 2 persistent record written to
 * `chrome.storage.local` only when the submission outcome is genuinely uncertain —
 * i.e. the wallet cannot yet confirm inclusion. If `SUBMITTED_INGESTED` is already
 * known, the confirmation tracker moves to ledger polling and no durable record of
 * uncertainty is persisted. Therefore `status` here is restricted to the three states
 * where cross-session recovery may be needed: `'SUBMITTING'` (crash before response),
 * `'SUBMISSION_UNKNOWN'` (network failure after dispatch), and `'INDETERMINATE'`
 * (confirmation polling exhausted; requires manual operator action or Module 2 recovery).
 * See ARCH-03 §4.2 and §4.7 for the full write-ahead and recovery protocol.
 */
export interface MinimalUncertainSubmissionRecord {
  schemaVersion: 1;
  txHash: string;
  sourceAddress: string;
  accountIndex: number;
  sequenceNumber: string;
  destinationAddress: string;
  amountXlm: string;
  feeStroops: number;
  operationType: 'payment' | 'createAccount';
  timebounds: {
    minTime: number;
    maxTime: number;
  };
  submittedAt: number;
  lastProbeAt: number;
  probeCount: number;
  status: 'SUBMITTING' | 'SUBMISSION_UNKNOWN' | 'INDETERMINATE';
}

export interface IAccountMetadataProvider {
  getAccounts(): Promise<Array<{ index: number; publicKey: Uint8Array; label: string; chain?: 'solana' | 'stellar' | undefined }>>;
}

export interface IStellarTransactionSigner {
  signTransaction(data: Uint8Array, accountIndex: number): Promise<Uint8Array>;
}

export class StellarTransactionError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'StellarTransactionError';
  }
}

export class InvalidStellarDestinationError extends StellarTransactionError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidStellarDestinationError';
  }
}

export class InvalidStellarAmountError extends StellarTransactionError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidStellarAmountError';
  }
}

export class InvalidStellarMemoError extends StellarTransactionError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidStellarMemoError';
  }
}

export class InsufficientXlmBalanceError extends StellarTransactionError {
  constructor(message: string) {
    super(message);
    this.name = 'InsufficientXlmBalanceError';
  }
}

export class StellarAccountNotFundedError extends StellarTransactionError {
  constructor(message: string) {
    super(message);
    this.name = 'StellarAccountNotFundedError';
  }
}

/**
 * Thrown only when Horizon returns a recognized HTTP 400 transaction-level code
 * that proves the submission was rejected before inclusion. On-ledger failures
 * are reported by confirmation and are not classified as submission rejections.
 */
export class StellarTransactionFailedError extends StellarTransactionError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'StellarTransactionFailedError';
  }
}

/**
 * Thrown when StellarTransactionClient is instantiated without an injected Nym-aware transport.
 * Enforces fail-closed transport policy and prevents silent clearnet fallback.
 */
export class StellarTransportMissingError extends StellarTransactionError {
  constructor(
    message = 'Stellar transaction transport is required. Injected Nym-aware fetch implementation must be provided.',
  ) {
    super(message);
    this.name = 'StellarTransportMissingError';
  }
}

/**
 * Thrown when the live network base fee exceeds the fee the user approved at REVIEW.
 * Callers must abort before signing/submitting and require a fresh REVIEW.
 */
export class StellarFeeChangedError extends StellarTransactionError {
  constructor(message: string) {
    super(message);
    this.name = 'StellarFeeChangedError';
  }
}

/**
 * Thrown when querying network fee stats from Horizon fails.
 * Silent fallbacks (e.g. defaulting to 100 stroops) are strictly forbidden.
 */
export class StellarFeeQueryFailedError extends StellarTransactionError {
  constructor(message = 'Failed to fetch current network fee from Horizon via Nym transport', cause?: unknown) {
    super(message, cause);
    this.name = 'StellarFeeQueryFailedError';
  }
}

/**
 * Thrown when the current network base fee exceeds the wallet security ceiling.
 */
export class StellarFeeCeilingExceededError extends StellarTransactionError {
  constructor(message: string) {
    super(message);
    this.name = 'StellarFeeCeilingExceededError';
  }
}

/**
 * Thrown when querying timebounds or Horizon server time fails.
 * Unbounded timebounds fallbacks ({ minTime: 0, maxTime: 0 }) are strictly forbidden.
 */
export class StellarTimeboundsQueryFailedError extends StellarTransactionError {
  constructor(message = 'Failed to fetch transaction timebounds from Horizon via Nym transport', cause?: unknown) {
    super(message, cause);
    this.name = 'StellarTimeboundsQueryFailedError';
  }
}

/**
 * Thrown when local machine clock is significantly skewed relative to Horizon server time.
 */
export class StellarClockSkewTooLargeError extends StellarTransactionError {
  constructor(message: string) {
    super(message);
    this.name = 'StellarClockSkewTooLargeError';
  }
}

/**
 * Thrown when signed transaction XDR fails local invariant verification before dispatch.
 */
export class StellarXdrValidationError extends StellarTransactionError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'StellarXdrValidationError';
  }
}

/** Thrown when write-ahead persistence or uncertainty-state cleanup fails. */
export class StellarWriteAheadFailedError extends StellarTransactionError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'StellarWriteAheadFailedError';
  }
}

/**
 * Thrown when a transaction was dispatched to the network but the submission outcome
 * is ambiguous (timeout, connection drop, HTTP 5xx).
 */
export class StellarSubmissionUnknownError extends StellarTransactionError {
  public readonly txHash: string;
  constructor(txHash: string, message = `Stellar transaction submission outcome is unknown (${txHash})`, cause?: unknown) {
    super(message, cause);
    this.name = 'StellarSubmissionUnknownError';
    this.txHash = txHash;
  }
}

/**
 * Thrown when a signing or transfer operation is attempted while an uncertain transaction is unresolved.
 */
export class AccountLockedUncertainTransactionError extends StellarTransactionError {
  public readonly txHash?: string | undefined;
  constructor(message: string, txHash?: string) {
    super(message);
    this.name = 'AccountLockedUncertainTransactionError';
    this.txHash = txHash;
  }
}

/**
 * Thrown when a transaction's maxTime ceiling has passed without inclusion in any closed ledger.
 */
export class StellarTransactionExpiredError extends StellarTransactionError {
  public readonly txHash?: string | undefined;
  constructor(message: string, txHash?: string) {
    super(message);
    this.name = 'StellarTransactionExpiredError';
    this.txHash = txHash;
  }
}

/**
 * Thrown when post-submission state or sequence reconciliation fails.
 */
export class StellarReconciliationFailedError extends StellarTransactionError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'StellarReconciliationFailedError';
  }
}
