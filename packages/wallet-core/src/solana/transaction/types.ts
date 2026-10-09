/**
 * solana/transaction/types.ts — Types for the Solana transaction layer (Phase 5c).
 */

import type { Address } from '@solana/kit';

/**
 * Request to construct and sign a SOL transfer transaction.
 */
export interface SendSolRequest {
  /** Source wallet account index to send from (must have sufficient balance). */
  sourceAccountIndex: number;
  /** Destination public address. */
  destination: string;
  /** Exact amount of SOL to transfer in lamports. */
  lamports: bigint;
}

/**
 * Read-only transaction summary representing what will be signed.
 * Does not contain any secrets or raw bytes.
 */
export interface TransactionSummary {
  sourceAddress: Address;
  destinationAddress: Address;
  lamports: bigint;
  feeLamports: bigint | null;
}

/**
 * Result of a transaction confirmation polling loop.
 */
export interface TransactionConfirmation {
  signature: string;
  status: 'confirmed' | 'failed' | 'expired' | 'timeout';
}

/**
 * Base error for transaction operations.
 */
export class TransactionError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'TransactionError';
  }
}

export class InvalidTransactionStructureError extends TransactionError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'InvalidTransactionStructureError';
  }
}

export class InvalidTransactionAmountError extends TransactionError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTransactionAmountError';
  }
}

export class InvalidDestinationError extends TransactionError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDestinationError';
  }
}

export class BlockhashExpiredError extends TransactionError {
  constructor() {
    super('The transaction blockhash expired before confirmation');
    this.name = 'BlockhashExpiredError';
  }
}

export class TransactionConfirmationTimeoutError extends TransactionError {
  constructor() {
    super('Timed out waiting for transaction confirmation');
    this.name = 'TransactionConfirmationTimeoutError';
  }
}

export class TransactionFailedError extends TransactionError {
  constructor(message?: string) {
    super(`Transaction failed to execute: ${message || 'Unknown error'}`);
    this.name = 'TransactionFailedError';
  }
}

/**
 * Dependency inversion interface for resolving account indices to public keys.
 * Satisfied by KeyManager at runtime.
 */
export interface IAccountMetadataProvider {
  getAccounts(): Promise<{ index: number; publicKey: Uint8Array }[]>;
}

/**
 * Dependency inversion interface for securely signing transaction bytes.
 * Satisfied by SoftwareSigner at runtime.
 */
export interface ITransactionSigner {
  sign(accountIndex: number, data: Uint8Array): Promise<Uint8Array>;
}
