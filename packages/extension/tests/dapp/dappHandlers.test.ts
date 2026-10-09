import { describe, expect, it, beforeEach, vi } from 'vitest';
import { handleDappConnect, handleDappDisconnect, handleDappSignTransaction, permissionManager, pendingManager } from '../../src/background/handlers/dappHandlers.js';

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: {
      id: 'test-extension-id',
      getURL: () => 'popup.html'
    },
    windows: {
      getAll: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
    }
  }
}));

describe('dappHandlers', () => {
  let mockSender: any;
  let mockState: any;
  let mockKeyManager: any;

  beforeEach(async () => {
    mockSender = { url: 'https://dapp.com' };
    mockState = { isLocked: false, hasVault: true };
    
    (globalThis as any).vaultService = {
      isLocked: mockState.isLocked,
      hasVault: vi.fn().mockResolvedValue(mockState.hasVault)
    };

    const browser = (await import('webextension-polyfill')).default;
    (browser.storage as any) = { local: { get: vi.fn().mockResolvedValue({ solanym_active_index: 0 }), set: vi.fn(), remove: vi.fn() } };
    const { activeAccountManager } = await import('../../src/background/accounts/ActiveAccountManager.js');
    await activeAccountManager.initialize();
    
    mockKeyManager = {
      getAccounts: vi.fn().mockResolvedValue([{ publicKey: new Uint8Array(32).fill(1), index: 0 }])
    };
    (globalThis as any).keyManager = mockKeyManager;

    (globalThis as any).accountService = {
      getAccounts: vi.fn().mockResolvedValue([{ address: 'A'.repeat(32), index: 0 }])
    };
    
    // reset managers
    vi.spyOn(permissionManager, 'isTrusted').mockResolvedValue(false);
    vi.spyOn(permissionManager, 'grantPermission').mockResolvedValue();
    vi.spyOn(permissionManager, 'revokePermission').mockResolvedValue();
    
    // fake browser popup
    (globalThis as any).browser = {
      runtime: { getURL: () => 'popup.html' },
      windows: {
        getAll: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({}),
      }
    };
  });

  it('connect with valid HTTPS origin accepted', async () => {
    // we need to mock pendingManager to auto-approve for this test
    const createReqSpy = vi.spyOn(pendingManager, 'createConnectRequest').mockResolvedValue(true);
    
    const res = await handleDappConnect({} as any, mockSender);
    expect(res.publicKey).toBeDefined(); // base58 string
    expect(createReqSpy).toHaveBeenCalledWith('https://dapp.com');
  });

  it('missing sender.url rejected', async () => {
    await expect(handleDappConnect({} as any, {})).rejects.toThrow(/Unauthorized/);
  });
  
  it('malformed origin rejected', async () => {
    await expect(handleDappConnect({} as any, { url: 'not-a-url' })).rejects.toThrow();
  });

  it('onlyIfTrusted on unknown origin fails without prompt', async () => {
    vi.spyOn(permissionManager, 'isTrusted').mockResolvedValue(false);
    await expect(handleDappConnect({ onlyIfTrusted: true } as any, mockSender)).rejects.toThrow(/Not trusted/);
  });

  it('onlyIfTrusted on approved + unlocked succeeds', async () => {
    vi.spyOn(permissionManager, 'isTrusted').mockResolvedValue(true);
    const { stateCoordinator } = await import('../../src/background/StateCoordinator.js');
    vi.spyOn(stateCoordinator, 'state', 'get').mockReturnValue('READY');
    const res = await handleDappConnect({ onlyIfTrusted: true } as any, mockSender);
    expect(res.publicKey).toBeDefined();
  });

  it('onlyIfTrusted on locked fails without prompt', async () => {
    vi.spyOn(permissionManager, 'isTrusted').mockResolvedValue(true);
    const { stateCoordinator } = await import('../../src/background/StateCoordinator.js');
    vi.spyOn(stateCoordinator, 'state', 'get').mockReturnValue('LOCKED');
    await expect(handleDappConnect({ onlyIfTrusted: true } as any, mockSender)).rejects.toThrow(/Not trusted or locked/);
  });
});
