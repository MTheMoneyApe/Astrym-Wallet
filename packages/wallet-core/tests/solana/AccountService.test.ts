import { describe, expect, it, vi } from 'vitest';
import { getBase58Encoder } from '@solana/kit';
import { AccountService } from '../../src/solana/accounts/AccountService.js';
import type { IAccountProvider } from '../../src/solana/accounts/types.js';

describe('AccountService', () => {
  it('maps KeyManager accounts to Solana Base58 addresses successfully', async () => {
    const encoder = getBase58Encoder();
    const pubkey1 = encoder.encode('4Nd1mBQtrCGZXm3XgMy5b2nStJcQG3FmPkWG3wVvjT8Q');
    const pubkey2 = encoder.encode('9Nd1mBQtrCGZXm3XgMy5b2nStJcQG3FmPkWG3wVvjT8Q');

    const mockKeyManager = {
      getAccounts: vi.fn().mockResolvedValue([
        { index: 0, publicKey: pubkey1, label: 'Account 1' },
        { index: 1, publicKey: pubkey2, label: 'Account 2' }
      ])
    } as unknown as IAccountProvider;

    const service = new AccountService(mockKeyManager);
    const result = await service.getAccounts();

    expect(result).toHaveLength(2);
    expect(result[0]?.index).toBe(0);
    expect(result[0]?.address).toBe('4Nd1mBQtrCGZXm3XgMy5b2nStJcQG3FmPkWG3wVvjT8Q');
    expect(result[0]?.label).toBe('Account 1');

    expect(result[1]?.index).toBe(1);
    expect(result[1]?.address).toBe('9Nd1mBQtrCGZXm3XgMy5b2nStJcQG3FmPkWG3wVvjT8Q');
    expect(result[1]?.label).toBe('Account 2');
  });

  it('throws an error if public key is not exactly 32 bytes', async () => {
    const mockKeyManager = {
      getAccounts: vi.fn().mockResolvedValue([
        { index: 0, publicKey: new Uint8Array(31), label: 'Account 1' }, // 31 bytes instead of 32
      ])
    } as unknown as IAccountProvider;

    const service = new AccountService(mockKeyManager);

    await expect(service.getAccounts()).rejects.toThrow('Corrupted public key length');
  });

  it('does not expose secret-bearing fields in the returned objects', async () => {
    const mockKeyManager = {
      getAccounts: vi.fn().mockResolvedValue([
        { index: 0, publicKey: new Uint8Array(32), label: 'Account 1' }
      ])
    } as unknown as IAccountProvider;

    const service = new AccountService(mockKeyManager);
    const result = await service.getAccounts();

    const account = result[0]!;
    // Ensure no unexpected properties are added
    const keys = Object.keys(account);
    expect(keys).toEqual(expect.arrayContaining(['index', 'address', 'label']));
    expect(keys).not.toContain('privateKey');
    expect(keys).not.toContain('seed');
    expect(keys).not.toContain('mnemonic');
    
    // Ensure address is a string, not a Uint8Array
    expect(typeof account.address).toBe('string');
  });
});
