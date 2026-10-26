import { describe, expect, it } from 'vitest';
import {
  StellarAccountService,
  LegacySolanaAccountDetectedError,
} from '../../src/stellar/accounts/StellarAccountService.js';
import type { IAccountProvider, IRawAccountInfo } from '../../src/stellar/accounts/types.js';

class MockAccountProvider implements IAccountProvider {
  constructor(private readonly _accounts: IRawAccountInfo[]) {}
  async getAccounts(): Promise<IRawAccountInfo[]> {
    return this._accounts;
  }
}

describe('StellarAccountService', () => {
  it('formats 32-byte Ed25519 public key as Stellar StrKey G... format', async () => {
    // 32-byte zeroes produces GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF
    const rawAccount: IRawAccountInfo = {
      index: 0,
      publicKey: new Uint8Array(32),
      label: 'Account 1',
      chain: 'stellar',
    };
    const provider = new MockAccountProvider([rawAccount]);
    const service = new StellarAccountService(provider);

    const accounts = await service.getAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.index).toBe(0);
    expect(accounts[0]!.address).toBe('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF');
    expect(accounts[0]!.label).toBe('Account 1');
  });

  it('rejects legacy Solana accounts and prevents silent reinterpretation', async () => {
    const legacySolanaAccount: IRawAccountInfo = {
      index: 0,
      publicKey: new Uint8Array(32),
      label: 'Legacy Account',
      chain: 'solana',
    };
    const provider = new MockAccountProvider([legacySolanaAccount]);
    const service = new StellarAccountService(provider);

    await expect(service.getAccounts()).rejects.toThrow(LegacySolanaAccountDetectedError);
  });

  it('validates Stellar address strings correctly', () => {
    const service = new StellarAccountService(new MockAccountProvider([]));
    expect(service.validateAddress('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF')).toBe(true);
    expect(service.validateAddress('GC3MMSXBWHL6CPOAVERSJITX7BH76YU252WGLUOM5CJX3E7UCYZBTPJQ')).toBe(true);
    // Invalid addresses (wrong length, wrong prefix, invalid checksum)
    expect(service.validateAddress('invalid-address')).toBe(false);
    expect(service.validateAddress('11111111111111111111111111111111')).toBe(false);
    expect(service.validateAddress('')).toBe(false);
  });
});
