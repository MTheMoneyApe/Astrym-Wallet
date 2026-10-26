import { describe, expect, it, vi, beforeEach } from 'vitest';
import { activeAccountManager, ActiveAccountManager } from '../../src/background/accounts/ActiveAccountManager.js';

vi.mock('webextension-polyfill', () => {
  return {
    default: {
      storage: {
        local: {
          get: vi.fn(),
          set: vi.fn(),
          remove: vi.fn()
        }
      }
    }
  };
});

import browser from 'webextension-polyfill';
import type { AccountService } from '@solanym/wallet-core/src/solana/accounts/AccountService.js';

describe('ActiveAccountManager', () => {
  let mockAccountService: any;
  let manager: ActiveAccountManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new (ActiveAccountManager as any)(); // Create fresh instance
    mockAccountService = {
      getAccounts: vi.fn().mockResolvedValue([
        { index: 1, address: 'addr1' },
        { index: 2, address: 'addr2' }
      ])
    };
  });

  it('throws if accessing before initialization', () => {
    expect(() => manager.getActiveAccountIndex()).toThrow('not initialized');
  });

  it('throws if data is missing or corrupted', async () => {
    vi.spyOn(browser.storage.local, 'get').mockResolvedValue({});
    await manager.initialize();
    expect(() => manager.getActiveAccountIndex()).toThrow('missing or corrupted');
  });

  it('recovers successfully from valid persisted data', async () => {
    vi.spyOn(browser.storage.local, 'get').mockResolvedValue({ solanym_active_index: 2 });
    await manager.initialize();
    expect(manager.getActiveAccountIndex()).toBe(2);
  });

  it('throws if persisted index does not exist in metadata', async () => {
    vi.spyOn(browser.storage.local, 'get').mockResolvedValue({ solanym_active_index: 99 });
    await manager.initialize();
    
    await expect(manager.getActiveAccountPublicKey(mockAccountService)).rejects.toThrow('not found in wallet metadata');
  });

  it('throws if setting an index that does not exist', async () => {
    vi.spyOn(browser.storage.local, 'get').mockResolvedValue({ solanym_active_index: 2 });
    await manager.initialize();

    await expect(manager.setActiveAccountIndex(99, mockAccountService)).rejects.toThrow('not found in wallet metadata');
  });

  it('can set and get active account index', async () => {
    vi.spyOn(browser.storage.local, 'get').mockResolvedValue({ solanym_active_index: 2 });
    await manager.initialize();
    
    await manager.setActiveAccountIndex(1, mockAccountService);
    expect(manager.getActiveAccountIndex()).toBe(1);
    const addr = await manager.getActiveAccountPublicKey(mockAccountService);
    expect(addr).toBe('addr1');
  });

  it('reads the persisted index after a new manager instance initializes', async () => {
    vi.spyOn(browser.storage.local, 'get').mockResolvedValue({ solanym_active_index: 2 });
    await manager.initialize();
    await manager.setActiveAccountIndex(1, mockAccountService);

    vi.spyOn(browser.storage.local, 'get').mockResolvedValue({ solanym_active_index: 1 });
    const restartedManager = new (ActiveAccountManager as any)() as ActiveAccountManager;
    await restartedManager.initialize();

    expect(restartedManager.getActiveAccountIndex()).toBe(1);
  });

  it('does not claim an index was persisted when storage write rejects', async () => {
    vi.spyOn(browser.storage.local, 'get').mockResolvedValue({ solanym_active_index: 2 });
    await manager.initialize();
    vi.spyOn(browser.storage.local, 'set').mockRejectedValue(new Error('storage unavailable'));

    await expect(manager.setActiveAccountIndex(1, mockAccountService)).rejects.toThrow('storage unavailable');
    expect(manager.getActiveAccountIndex()).toBe(2);
  });
});
