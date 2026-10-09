import { describe, expect, it, vi } from 'vitest';
import { createGetAccountsHandler, createGetBalanceHandler } from '../../../src/background/handlers/accountHandlers.js';
import type { SolanaReadClient } from '@solanym/wallet-core/src/solana/read/SolanaReadClient.js';
import type { AccountService } from '@solanym/wallet-core/src/solana/accounts/AccountService.js';
import type { Address } from '@solanym/wallet-core/node_modules/@solana/kit'; 

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: { id: 'test' },
    storage: { local: { get: vi.fn(), set: vi.fn(), remove: vi.fn() } }
  }
}));

// Wait, no. I won't import Address from solana/kit here. I will just typecast it as any or use string.

describe('accountHandlers', () => {
  it('GET_ACCOUNTS calls AccountService and maps successfully', async () => {
    const mockAccountService = {
      getAccounts: vi.fn().mockResolvedValue([
        { index: 0, address: '4Nd1mBQtrCGZXm3XgMy5b2nStJcQG3FmPkWG3wVvjT8Q' as any, label: 'Account 1' },
        { index: 1, address: '9Nd1mBQtrCGZXm3XgMy5b2nStJcQG3FmPkWG3wVvjT8Q' as any, label: 'Account 2' }
      ])
    } as unknown as AccountService;

    const handler = createGetAccountsHandler(mockAccountService);
    const result = await handler({});

    expect(mockAccountService.getAccounts).toHaveBeenCalled();
    expect(result).toEqual([
      { index: 0, publicKey: '4Nd1mBQtrCGZXm3XgMy5b2nStJcQG3FmPkWG3wVvjT8Q', label: 'Account 1' },
      { index: 1, publicKey: '9Nd1mBQtrCGZXm3XgMy5b2nStJcQG3FmPkWG3wVvjT8Q', label: 'Account 2' }
    ]);
  });
});
