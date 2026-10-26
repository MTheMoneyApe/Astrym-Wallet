import { StrKey } from '@stellar/stellar-sdk';
import type { IAccountProvider, StellarAccount } from './types.js';

export class LegacySolanaAccountDetectedError extends Error {
  constructor(index: number) {
    super(
      `Account index ${index} was derived as a Solana account and cannot be reinterpreted as a Stellar account.`,
    );
    this.name = 'LegacySolanaAccountDetectedError';
  }
}

export class StellarAccountService {
  constructor(private readonly _accountProvider: IAccountProvider) {}

  /**
   * Retrieves all accounts and formats their public keys as Stellar StrKey (G...) addresses.
   * Enforces that legacy Solana accounts are never silently reinterpreted as Stellar accounts.
   */
  public async getAccounts(): Promise<StellarAccount[]> {
    const rawAccounts = await this._accountProvider.getAccounts();

    return rawAccounts.map((acc) => {
      if (acc.publicKey.length !== 32) {
        throw new Error(`Corrupted public key length for account index ${acc.index}`);
      }

      if (acc.chain === 'solana') {
        throw new LegacySolanaAccountDetectedError(acc.index);
      }

      const stellarAddress = StrKey.encodeEd25519PublicKey(acc.publicKey);

      return {
        index: acc.index,
        address: stellarAddress,
        label: acc.label,
      };
    });
  }

  /**
   * Formats a raw 32-byte Ed25519 public key as a Stellar StrKey address.
   */
  public formatAddress(publicKey: Uint8Array): string {
    if (publicKey.length !== 32) {
      throw new Error(`Public key must be 32 bytes, got ${publicKey.length}`);
    }
    return StrKey.encodeEd25519PublicKey(publicKey);
  }

  /**
   * Validates whether a string is a valid Stellar Ed25519 public address (G...).
   */
  public validateAddress(address: string): boolean {
    return StrKey.isValidEd25519PublicKey(address);
  }
}
