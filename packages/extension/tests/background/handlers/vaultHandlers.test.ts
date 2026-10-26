import { describe, expect, it, vi } from 'vitest';
import { 
  createUnlockVaultHandler, 
  createLockVaultHandler,
  createGetWalletStateHandler,
  createCreateVaultHandler,
  createRevealRecoveryPhraseHandler,
} from '../../../src/background/handlers/vaultHandlers.js';
import type { VaultService } from '@solanym/wallet-core/src/vault/VaultService.js';
import type { KeyManager } from '@solanym/wallet-core/src/keyManager/KeyManager.js';
import type { AccountService } from '@solanym/wallet-core/src/solana/accounts/AccountService.js';

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: {
      id: 'test',
      getURL: (path: string) => `chrome-extension://test${path}`,
    },
    storage: { local: { get: vi.fn(), set: vi.fn(), remove: vi.fn() } }
  }
}));

// Mock mnemonic generator
vi.mock('@solanym/wallet-core/src/crypto/mnemonic.js', () => {
  return {
    generate24WordMnemonic: vi.fn().mockReturnValue('test test test test test test test test test test test test test test test test test test test test test test test test')
  };
});

describe('vaultHandlers', () => {
  it('GET_WALLET_STATE returns correct state', async () => {
    const mockVaultService = {
      hasVault: vi.fn().mockResolvedValue(true),
      isLocked: false
    } as unknown as VaultService;

    const handler = createGetWalletStateHandler(mockVaultService);
    const result = await handler({});

    expect(result).toEqual({ hasVault: true, isLocked: false });
  });

  it('CREATE_VAULT creates vault, adds account, and returns phrase', async () => {
    const mockVaultService = {
      createVault: vi.fn().mockResolvedValue(undefined),
      deleteVault: vi.fn().mockResolvedValue(undefined)
    } as unknown as VaultService;
    
    const mockKeyManager = {
      addAccount: vi.fn().mockResolvedValue({ index: 4 })
    } as unknown as KeyManager;
    const mockAccountService = { getAccounts: vi.fn() } as unknown as AccountService;
    const activeIndexWriter = { setActiveAccountIndex: vi.fn().mockResolvedValue(undefined) };

    const handler = createCreateVaultHandler(mockVaultService, mockKeyManager, mockAccountService, activeIndexWriter);
    const result = await handler({ password: 'my-password' });

    expect(mockVaultService.createVault).toHaveBeenCalledWith('my-password', 'test test test test test test test test test test test test test test test test test test test test test test test test');
    expect(mockKeyManager.addAccount).toHaveBeenCalledWith(expect.any(String), 'Account 1');
    expect(activeIndexWriter.setActiveAccountIndex).toHaveBeenCalledWith(4, mockAccountService);
    expect(result.recoveryPhrase).toHaveLength(24);
  });

  it('CREATE_VAULT does not report success if the initial active index cannot be persisted', async () => {
    const mockVaultService = {
      createVault: vi.fn().mockResolvedValue(undefined),
      deleteVault: vi.fn().mockResolvedValue(undefined),
    } as unknown as VaultService;
    const mockKeyManager = {
      addAccount: vi.fn().mockResolvedValue({ index: 7 }),
    } as unknown as KeyManager;
    const mockAccountService = { getAccounts: vi.fn() } as any;
    const activeIndexWriter = {
      setActiveAccountIndex: vi.fn().mockRejectedValue(new Error('storage unavailable')),
    };

    const handler = createCreateVaultHandler(mockVaultService, mockKeyManager, mockAccountService, activeIndexWriter);

    await expect(handler({ password: 'my-password' })).rejects.toThrow('active account index could not be saved');
    expect(activeIndexWriter.setActiveAccountIndex).toHaveBeenCalledWith(7, mockAccountService);
    expect(mockVaultService.deleteVault).not.toHaveBeenCalled();
  });

  it('UNLOCK_VAULT calls unlock and returns success', async () => {
    const mockVaultService = {
      unlock: vi.fn().mockResolvedValue(undefined)
    } as unknown as VaultService;

    const handler = createUnlockVaultHandler(mockVaultService);
    const result = await handler({ password: 'my-password' });

    expect(mockVaultService.unlock).toHaveBeenCalledWith('my-password');
    expect(result).toEqual({ success: true });
  });

  it('LOCK_VAULT calls lock and returns success', async () => {
    const mockVaultService = {
      lock: vi.fn().mockResolvedValue(undefined)
    } as unknown as VaultService;

    const handler = createLockVaultHandler(mockVaultService);
    const result = await handler({});

    expect(mockVaultService.lock).toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  it('REVEAL_RECOVERY_PHRASE rejects non-popup senders before authentication', async () => {
    const mockVaultService = {
      unlock: vi.fn(),
      getMnemonic: vi.fn(),
    } as unknown as VaultService;
    const handler = createRevealRecoveryPhraseHandler(mockVaultService);

    await expect(handler(
      { auth: 'user-password' },
      { id: 'other-extension', url: 'chrome-extension://test/popup.html' } as any,
    )).rejects.toThrow('UnauthorizedSenderError');
    expect(mockVaultService.unlock).not.toHaveBeenCalled();
    expect(mockVaultService.getMnemonic).not.toHaveBeenCalled();
  });

  it('REVEAL_RECOVERY_PHRASE does not read the mnemonic after authentication fails', async () => {
    const mockVaultService = {
      unlock: vi.fn().mockRejectedValue(new Error('Invalid password')),
      getMnemonic: vi.fn(),
    } as unknown as VaultService;
    const handler = createRevealRecoveryPhraseHandler(mockVaultService);

    await expect(handler(
      { auth: 'wrong-password' },
      { id: 'test', url: 'chrome-extension://test/popup.html' } as any,
    )).rejects.toThrow('Invalid password');
    expect(mockVaultService.unlock).toHaveBeenCalledWith('wrong-password');
    expect(mockVaultService.getMnemonic).not.toHaveBeenCalled();
  });
});
