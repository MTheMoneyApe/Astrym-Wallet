/**
 * solana/read/SolanaReadClient.ts — Read-only balances and token discovery (Phase 5b).
 *
 * Implements SOL balance, account info, and SPL token discovery.
 * - Enforces bigint for all exact quantities.
 * - Extracts only public, non-secret data.
 * - Protects internal RPC representation from leaking.
 * - Rejects malformed addresses safely.
 *
 * SECURITY INVARIANTS:
 *   - No imports from crypto/, vault/, signer/, or keyManager/.
 *   - No console.* calls.
 *   - Errors must not leak raw RPC responses or secrets.
 *   - Follows Phase 5a RPC method allowlist.
 */

import { address, isAddress, type Address } from '@solana/kit';
import type { DevnetRpcClient } from '../rpc/RpcClient.js';
import {
  type AccountInfo,
  type SolBalance,
  SolanaReadError,
  type TokenAccountInfo,
} from './types.js';

/** Standard SPL Token Program ID. */
const TOKEN_PROGRAM_ID = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

export class SolanaReadClient {
  constructor(private readonly _rpc: DevnetRpcClient) {}

  /**
   * Safely decodes and validates a public key string into a Kit Address.
   */
  private _validateAddress(pubkey: string): Address {
    if (!isAddress(pubkey)) {
      throw new SolanaReadError('Invalid Solana address format');
    }
    return address(pubkey);
  }

  /**
   * Fetch the exact SOL balance in lamports for the given address.
   */
  async getSolBalance(pubkey: string): Promise<SolBalance> {
    const validAddress = this._validateAddress(pubkey);
    try {
      const response = await this._rpc.getBalance(validAddress).send();
      return { lamports: response.value };
    } catch (e) {
      if (e instanceof SolanaReadError) throw e;
      throw new SolanaReadError('Failed to fetch SOL balance', e);
    }
  }

  /**
   * Fetch normalized read-only account information.
   * Resolves gracefully to exists=false if the account is unallocated.
   */
  async getAccountInfo(pubkey: string): Promise<AccountInfo> {
    const validAddress = this._validateAddress(pubkey);
    try {
      const response = await this._rpc.getAccountInfo(validAddress).send();
      if (!response.value) {
        return { exists: false, lamports: 0n, owner: null, executable: false };
      }
      return {
        exists: true,
        lamports: response.value.lamports,
        owner: response.value.owner,
        executable: response.value.executable,
        
      };
    } catch (e) {
      if (e instanceof SolanaReadError) throw e;
      throw new SolanaReadError('Failed to fetch account info', e);
    }
  }

  /**
   * Discover SPL token accounts owned by the given address.
   * Only returns parsed standard SPL tokens.
   */
  async getTokenAccounts(pubkey: string): Promise<TokenAccountInfo[]> {
    const validAddress = this._validateAddress(pubkey);
    try {
      // getTokenAccountsByOwner using jsonParsed encoding returns human-readable
      // structures and avoids manually decoding binary structs.
      const response = await this._rpc
        .getTokenAccountsByOwner(
          validAddress,
          { programId: TOKEN_PROGRAM_ID },
          { encoding: 'jsonParsed' },
        )
        .send();

      const results: TokenAccountInfo[] = [];

      for (const item of response.value) {
        const accountData = item.account.data;

        // If the RPC returned raw string/binary data despite requesting jsonParsed,
        // it means the data cannot be parsed. We skip or fail safely.
        if (typeof accountData === 'string' || Array.isArray(accountData)) {
          throw new SolanaReadError('Unexpected raw binary data in token account');
        }

        if (accountData.program !== 'spl-token') {
          continue;
        }

        // Safely extract the parsed info object.
        // We use explicit structural checks to prevent runtime TypeError panics
        // if the RPC returns malformed but technically "JSON" data.
        const parsed = (accountData as any).parsed;
        if (!parsed || typeof parsed !== 'object') {
          throw new SolanaReadError('Malformed parsed token account structure');
        }

        const info = parsed.info;
        if (!info || typeof info.mint !== 'string' || typeof info.owner !== 'string') {
          throw new SolanaReadError('Malformed token account info');
        }

        const tokenAmount = info.tokenAmount;
        if (
          !tokenAmount ||
          tokenAmount.amount === undefined ||
          typeof tokenAmount.decimals !== 'number'
        ) {
          throw new SolanaReadError('Malformed token amount data');
        }

        // Preserve precision by parsing the string/number into a BigInt directly.
        let amountBigInt: bigint;
        try {
          amountBigInt = BigInt(tokenAmount.amount);
        } catch {
          throw new SolanaReadError('Invalid token amount numeric format');
        }

        results.push({
          address: item.pubkey,
          mint: this._validateAddress(info.mint),
          owner: this._validateAddress(info.owner),
          amount: amountBigInt,
          decimals: tokenAmount.decimals,
          uiAmountString: typeof tokenAmount.uiAmountString === 'string' ? tokenAmount.uiAmountString : undefined,
          program: item.account.owner,
        });
      }

      return results;
    } catch (e) {
      if (e instanceof SolanaReadError) throw e;
      throw new SolanaReadError('Failed to fetch token accounts', e);
    }
  }
}
