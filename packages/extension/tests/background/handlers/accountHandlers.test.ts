import { beforeEach, describe, expect, it, vi } from 'vitest';
import { 
  createGetAccountsHandler, 
  createGetActiveAccountHandler, 
  createSetActiveAccountHandler,
  createGetStellarBalanceHandler,
  createFundStellarTestnetHandler,
  createAddAccountHandler,
} from '../../../src/background/handlers/accountHandlers.js';
import { resolveRestoredAccountSelection } from '../../../src/popup/Dashboard.js';
import { activeAccountManager } from '../../../src/background/accounts/ActiveAccountManager.js';
import { stateCoordinator } from '../../../src/background/StateCoordinator.js';
import type { SolanaReadClient } from '@solanym/wallet-core/src/solana/read/SolanaReadClient.js';
import type { AccountService } from '@solanym/wallet-core/src/solana/accounts/AccountService.js';
import type { StellarReadClient } from '@solanym/wallet-core/src/stellar/read/StellarReadClient.js';
import type { KeyManager } from '@solanym/wallet-core/src/keyManager/KeyManager.js';
import { StrKey } from '@solanym/wallet-core';
import type { Address } from '@solanym/wallet-core/node_modules/@solana/kit'; 

const storage = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: { id: 'test' },
    storage: { local: storage }
  }
}));

// Wait, no. I won't import Address from solana/kit here. I will just typecast it as any or use string.

describe('accountHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.get.mockReset();
    storage.set.mockReset();
    storage.remove.mockReset();
    (activeAccountManager as any)._isInitialized = true;
    (activeAccountManager as any)._activeAccountIndex = undefined;
    (stateCoordinator as any)._state = 'READY';
    (stateCoordinator as any)._isResetting = false;
  });

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

  it('GET_ACTIVE_ACCOUNT returns VALID when the persisted index matches a real account', async () => {
    const mockAccountService = {
      getAccounts: vi.fn().mockResolvedValue([
        { index: 0, address: '4Nd1mBQtrCGZXm3XgMy5b2nStJcQG3FmPkWG3wVvjT8Q' as any, label: 'Account 1' },
        { index: 3, address: 'aNd1mBQtrCGZXm3XgMy5b2nStJcQG3FmPkWG3wVvjT8Q' as any, label: 'Account 4' },
      ]),
    } as unknown as AccountService;

    (activeAccountManager as any)._activeAccountIndex = 3;

    const handler = createGetActiveAccountHandler(mockAccountService);
    const result = await handler({});

    expect(result).toEqual({ status: 'VALID', index: 3 });
  });

  it('GET_ACTIVE_ACCOUNT returns NONE when there are no accounts to restore from', async () => {
    const mockAccountService = {
      getAccounts: vi.fn().mockResolvedValue([]),
    } as unknown as AccountService;

    const handler = createGetActiveAccountHandler(mockAccountService);
    const result = await handler({});

    expect(result).toEqual({ status: 'NONE', index: null });
  });

  it('GET_ACTIVE_ACCOUNT returns INVALID when the persisted index is stale', async () => {
    const mockAccountService = {
      getAccounts: vi.fn().mockResolvedValue([
        { index: 0, address: '4Nd1mBQtrCGZXm3XgMy5b2nStJcQG3FmPkWG3wVvjT8Q' as any, label: 'Account 1' },
      ]),
    } as unknown as AccountService;

    (activeAccountManager as any)._activeAccountIndex = 9;

    const handler = createGetActiveAccountHandler(mockAccountService);
    const result = await handler({});

    expect(result).toEqual({ status: 'INVALID', index: null });
  });

  it('GET_ACTIVE_ACCOUNT returns INVALID when accounts exist but no active index was saved', async () => {
    const mockAccountService = {
      getAccounts: vi.fn().mockResolvedValue([
        { index: 4, address: '4Nd1mBQtrCGZXm3XgMy5b2nStJcQG3FmPkWG3wVvjT8Q' as any, label: 'Account 5' },
      ]),
    } as unknown as AccountService;

    const result = await createGetActiveAccountHandler(mockAccountService)({});

    expect(result).toEqual({ status: 'INVALID', index: null });
  });

  it('SET_ACTIVE_ACCOUNT persists the requested real index before confirming success', async () => {
    const mockAccountService = {
      getAccounts: vi.fn().mockResolvedValue([
        { index: 2, address: '4Nd1mBQtrCGZXm3XgMy5b2nStJcQG3FmPkWG3wVvjT8Q' as any, label: 'Account 3' },
        { index: 7, address: '9Nd1mBQtrCGZXm3XgMy5b2nStJcQG3FmPkWG3wVvjT8Q' as any, label: 'Account 8' },
      ]),
    } as unknown as AccountService;

    const result = await createSetActiveAccountHandler(mockAccountService)({ index: 7 });

    expect(storage.set).toHaveBeenCalledWith({ solanym_active_index: 7 });
    expect(activeAccountManager.getActiveAccountIndex()).toBe(7);
    expect(result).toEqual({ success: true });
  });

  it('SET_ACTIVE_ACCOUNT does not update active memory or claim success if persistence fails', async () => {
    const mockAccountService = {
      getAccounts: vi.fn().mockResolvedValue([
        { index: 2, address: '4Nd1mBQtrCGZXm3XgMy5b2nStJcQG3FmPkWG3wVvjT8Q' as any, label: 'Account 3' },
        { index: 7, address: '9Nd1mBQtrCGZXm3XgMy5b2nStJcQG3FmPkWG3wVvjT8Q' as any, label: 'Account 8' },
      ]),
    } as unknown as AccountService;
    (activeAccountManager as any)._activeAccountIndex = 2;
    storage.set.mockRejectedValue(new Error('storage unavailable'));

    await expect(createSetActiveAccountHandler(mockAccountService)({ index: 7 })).rejects.toThrow('storage unavailable');
    expect(activeAccountManager.getActiveAccountIndex()).toBe(2);
  });

  it('GET_ACTIVE_ACCOUNT surfaces query failures from the account service', async () => {
    const mockAccountService = {
      getAccounts: vi.fn().mockRejectedValue(new Error('Vault query failed')),
    } as unknown as AccountService;

    const handler = createGetActiveAccountHandler(mockAccountService);

    await expect(handler({})).rejects.toThrow('Vault query failed');
  });

  it('resolveRestoredAccountSelection restores a non-first active account', () => {
    const accounts = [
      { index: 0, publicKey: 'first-account-address', label: 'Account 1' },
      { index: 2, publicKey: 'second-account-address', label: 'Account 3' },
    ];

    expect(resolveRestoredAccountSelection(accounts, { status: 'VALID', index: 2 })).toEqual({
      selectedIndex: 2,
      confirmedActiveIndex: 2,
      account: { address: 'second-account-address', label: 'Account 3', index: 2 },
    });
  });

  describe('Stellar Handlers', () => {
    const testStellarAddress = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';

    it('GET_STELLAR_BALANCE returns parsed balance for funded account', async () => {
      const mockReadClient = {
        getBalance: vi.fn().mockResolvedValue({
          address: testStellarAddress,
          exists: true,
          balance: '10000.0000000',
          asset: 'XLM',
          subentryCount: 0,
          balances: [{ assetType: 'native', balance: '10000.0000000' }],
        }),
      } as unknown as StellarReadClient;

      const handler = createGetStellarBalanceHandler(mockReadClient);
      const result = await handler({ address: testStellarAddress });

      expect(mockReadClient.getBalance).toHaveBeenCalledWith(testStellarAddress);
      expect(result.exists).toBe(true);
      expect(result.balance).toBe('10000.0000000');
      expect(result.asset).toBe('XLM');
    });

    it('GET_STELLAR_BALANCE returns exists=false and balance=0 for unfunded account', async () => {
      const mockReadClient = {
        getBalance: vi.fn().mockResolvedValue({
          address: testStellarAddress,
          exists: false,
          balance: '0',
          asset: 'XLM',
          subentryCount: 0,
          balances: [],
        }),
      } as unknown as StellarReadClient;

      const handler = createGetStellarBalanceHandler(mockReadClient);
      const result = await handler({ address: testStellarAddress });

      expect(result.exists).toBe(false);
      expect(result.balance).toBe('0');
      expect(result.asset).toBe('XLM');
    });

    it('FUND_STELLAR_TESTNET_ACCOUNT calls friendbot funding', async () => {
      const mockReadClient = {
        fundTestnetAccount: vi.fn().mockResolvedValue({
          success: true,
          message: 'Account funded with 10,000 Testnet XLM',
          txHash: 'test-hash-123',
        }),
      } as unknown as StellarReadClient;

      const handler = createFundStellarTestnetHandler(mockReadClient);
      const result = await handler({ address: testStellarAddress });

      expect(mockReadClient.fundTestnetAccount).toHaveBeenCalledWith(testStellarAddress);
      expect(result.success).toBe(true);
      expect(result.txHash).toBe('test-hash-123');
    });

    it('ADD_ACCOUNT encodes public key as StrKey G... for Stellar account', async () => {
      // 32-byte public key
      const rawPubkey = new Uint8Array(32).fill(7);
      const expectedStrKey = StrKey.encodeEd25519PublicKey(rawPubkey);

      const mockKeyManager = {
        addAccount: vi.fn().mockResolvedValue({
          index: 0,
          publicKey: rawPubkey,
          label: 'Stellar Account 1',
          chain: 'stellar',
        }),
        getAccounts: vi.fn().mockResolvedValue([
          {
            index: 0,
            publicKey: rawPubkey,
            label: 'Stellar Account 1',
            chain: 'stellar',
          },
        ]),
      } as unknown as KeyManager;

      const handler = createAddAccountHandler(mockKeyManager);
      const result = await handler({ idempotencyUuid: '123e4567-e89b-12d3-a456-426614174000', label: 'Stellar Account 1' });

      expect(result.account.publicKey).toBe(expectedStrKey);
      expect(result.account.publicKey.startsWith('G')).toBe(true);
      expect(result.account.label).toBe('Stellar Account 1');
    });
  });
});
