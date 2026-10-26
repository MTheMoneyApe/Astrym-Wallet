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

export interface StellarTransactionResult {
  hash: string;
  ledger?: number | undefined;
  status: 'confirmed' | 'failed';
}

export interface IAccountMetadataProvider {
  getAccounts(): Promise<Array<{ index: number; publicKey: Uint8Array; label: string; chain?: 'solana' | 'stellar' | undefined }>>;
}

export interface IStellarTransactionSigner {
  signTransaction(data: Uint8Array, accountIndex: number): Promise<Uint8Array>;
}

export class StellarTransactionError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
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

export class StellarTransactionFailedError extends StellarTransactionError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'StellarTransactionFailedError';
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
