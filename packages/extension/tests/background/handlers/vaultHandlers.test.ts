import { describe, expect, it, vi } from 'vitest';
import { 
  createUnlockVaultHandler, 
  createLockVaultHandler,
  createGetWalletStateHandler,
  createCreateVaultHandler
} from '../../../src/background/handlers/vaultHandlers.js';
import type { VaultService } from '@solanym/wallet-core/src/vault/VaultService.js';
import type { KeyManager } from '@solanym/wallet-core/src/keyManager/KeyManager.js';

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: { id: 'test' },
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
      addAccount: vi.fn().mockResolvedValue(undefined)
    } as unknown as KeyManager;

    const handler = createCreateVaultHandler(mockVaultService, mockKeyManager);
    const result = await handler({ password: 'my-password' });

    expect(mockVaultService.createVault).toHaveBeenCalledWith('my-password', 'test test test test test test test test test test test test test test test test test test test test test test test test');
    expect(mockKeyManager.addAccount).toHaveBeenCalledWith(expect.any(String), 'Account 1');
    expect(result.recoveryPhrase).toHaveLength(24);
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
});

