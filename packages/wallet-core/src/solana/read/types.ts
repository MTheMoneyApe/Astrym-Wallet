/**
 * solana/read/types.ts — Types for the read-only Solana API (Phase 5b).
 *
 * All types represent exact amounts using bigint.
 * No javascript Number is used for lamports or raw token amounts.
 */

import type { Address } from '@solana/kit';

export interface SolBalance {
  /** Exact SOL balance in lamports. */
  lamports: bigint;
}

export interface AccountInfo {
  /** True if the account is allocated and holds state/lamports on chain. */
  exists: boolean;
  /** Balance in lamports. 0n if the account does not exist. */
  lamports: bigint;
  /** Base58 program owner address, or null if account does not exist. */
  owner: Address | null;
  /** True if the account is marked executable. */
  executable: boolean;
  /** Rent epoch if available from the RPC response. */
  rentEpoch?: bigint;
}

export interface TokenAccountInfo {
  /** The base58 address of this specific token account. */
  address: Address;
  /** The base58 address of the SPL token Mint. */
  mint: Address;
  /** The base58 address of the wallet that owns this token account. */
  owner: Address;
  /** The exact raw token amount (e.g. before applying decimals). */
  amount: bigint;
  /** The number of decimals the mint uses. */
  decimals: number;
  /** An optional display string for the token amount (e.g. "1.2345"). */
  uiAmountString?: string;
  /** The base58 address of the token program (usually the standard SPL Token program). */
  program: Address;
}

/**
 * Typed error for read-only operations, preventing leakage of raw RPC data.
 */
export class SolanaReadError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'SolanaReadError';
  }
}
