import { address, getBase58Decoder } from '@solana/kit';
import type { SolanaAccount, IAccountProvider } from './types.js';

export class AccountService {
  constructor(private readonly _accountProvider: IAccountProvider) {}

  /**
   * Retrieves all accounts from the KeyManager and formats their public keys
   * as valid Solana Base58 addresses.
   *
   * SECURITY: This method only returns public metadata. No secrets are accessed.
   */
  public async getAccounts(): Promise<SolanaAccount[]> {
    const rawAccounts = await this._accountProvider.getAccounts();
    const decoder = getBase58Decoder();
    
    return rawAccounts.map((acc) => {
      // Defensive parsing: ensure the Uint8Array is exactly 32 bytes before decoding.
      // If it's corrupted, we fall back to a dummy address (or throw).
      // Since KeyManager already statically ensures 32 bytes in its own validation, 
      // we do a secondary check here.
      if (acc.publicKey.length !== 32) {
        throw new Error(`Corrupted public key length for account index ${acc.index}`);
      }

      const base58String = decoder.decode(acc.publicKey);
      
      return {
        index: acc.index,
        address: address(base58String),
        label: acc.label
      };
    });
  }
}
