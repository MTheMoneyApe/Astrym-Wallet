import { describe, expect, it, vi } from 'vitest';
import { createImportVaultHandler } from '../../../src/background/handlers/vaultHandlers.js';
import type { VaultService } from '@solanym/wallet-core/src/vault/VaultService.js';
import type { KeyManager } from '@solanym/wallet-core/src/keyManager/KeyManager.js';
import { validateSeedPhrase } from '@solanym/wallet-core/src/crypto/mnemonic.js';
import { makeSeedPhrase } from '@solanym/wallet-core/src/crypto/types.js';

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: { id: 'test' },
    storage: { local: { get: vi.fn(), set: vi.fn(), remove: vi.fn() } }
  }
}));

// We do NOT mock validateSeedPhrase or mnemonic generation, we use the real bip39 library for integration testing.

describe('createImportVaultHandler', () => {
  it('accepts a valid 12-word BIP39 phrase and creates vault', async () => {
    const mockVaultService = {
      createVault: vi.fn().mockResolvedValue(undefined),
      deleteVault: vi.fn().mockResolvedValue(undefined)
    } as unknown as VaultService;
    
    const mockKeyManager = {
      addAccount: vi.fn().mockResolvedValue(undefined)
    } as unknown as KeyManager;

    const handler = createImportVaultHandler(mockVaultService, mockKeyManager);
    
    // Standard test vector for 12 words (abandon x 11 + about)
    const valid12Word = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'.split(' ');
    
    const result = await handler({ password: 'my-password', recoveryPhrase: valid12Word });

    expect(mockVaultService.createVault).toHaveBeenCalledWith('my-password', makeSeedPhrase(valid12Word.join(' ')));
    expect(mockKeyManager.addAccount).toHaveBeenCalledWith(expect.any(String), 'Account 1');
    expect(result).toEqual({ success: true });
  });

  it('accepts a valid 24-word BIP39 phrase and creates vault', async () => {
    const mockVaultService = {
      createVault: vi.fn().mockResolvedValue(undefined),
      deleteVault: vi.fn().mockResolvedValue(undefined)
    } as unknown as VaultService;
    
    const mockKeyManager = {
      addAccount: vi.fn().mockResolvedValue(undefined)
    } as unknown as KeyManager;

    const handler = createImportVaultHandler(mockVaultService, mockKeyManager);
    
    // Standard test vector for 24 words
    const valid24Word = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art'.split(' ');
    
    const result = await handler({ password: 'my-password', recoveryPhrase: valid24Word });

    expect(result).toEqual({ success: true });
    expect(mockVaultService.createVault).toHaveBeenCalledWith('my-password', makeSeedPhrase(valid24Word.join(' ')));
  });

  it('rejects an invalid phrase (wrong checksum) before calling createVault', async () => {
    const mockVaultService = {
      createVault: vi.fn().mockResolvedValue(undefined),
      deleteVault: vi.fn().mockResolvedValue(undefined)
    } as unknown as VaultService;
    
    const mockKeyManager = {
      addAccount: vi.fn().mockResolvedValue(undefined)
    } as unknown as KeyManager;

    const handler = createImportVaultHandler(mockVaultService, mockKeyManager);
    
    // Invalid checksum (abandon x 12 is invalid)
    const invalid12Word = Array(12).fill('abandon');
    
    await expect(handler({ password: 'my-password', recoveryPhrase: invalid12Word }))
      .rejects.toThrow('Invalid recovery phrase');
      
    expect(mockVaultService.createVault).not.toHaveBeenCalled();
    expect(mockKeyManager.addAccount).not.toHaveBeenCalled();
  });

  it('rejects an invalid phrase (unknown words) before calling createVault', async () => {
    const mockVaultService = {
      createVault: vi.fn().mockResolvedValue(undefined),
      deleteVault: vi.fn().mockResolvedValue(undefined)
    } as unknown as VaultService;
    
    const mockKeyManager = {
      addAccount: vi.fn().mockResolvedValue(undefined)
    } as unknown as KeyManager;

    const handler = createImportVaultHandler(mockVaultService, mockKeyManager);
    
    const invalidWords = 'notaword notaword notaword notaword notaword notaword notaword notaword notaword notaword notaword notaword'.split(' ');
    
    await expect(handler({ password: 'my-password', recoveryPhrase: invalidWords }))
      .rejects.toThrow('Invalid recovery phrase');
      
    expect(mockVaultService.createVault).not.toHaveBeenCalled();
  });

  it('rolls back vault creation if addAccount fails after vault creation', async () => {
    const mockVaultService = {
      createVault: vi.fn().mockResolvedValue(undefined),
      deleteVault: vi.fn().mockResolvedValue(undefined)
    } as unknown as VaultService;
    
    const mockKeyManager = {
      addAccount: vi.fn().mockRejectedValue(new Error('Storage failure'))
    } as unknown as KeyManager;

    const handler = createImportVaultHandler(mockVaultService, mockKeyManager);
    const valid12Word = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'.split(' ');
    
    await expect(handler({ password: 'my-password', recoveryPhrase: valid12Word }))
      .rejects.toThrow('Storage failure');
      
    // Vault was created, but account failed -> it must be rolled back.
    expect(mockVaultService.createVault).toHaveBeenCalled();
    expect(mockKeyManager.addAccount).toHaveBeenCalled();
    expect(mockVaultService.deleteVault).toHaveBeenCalled();
  });

  it('throws a controlled error if createVault fails and does not call addAccount', async () => {
    const mockVaultService = {
      createVault: vi.fn().mockRejectedValue(new Error('Vault creation failed')),
      deleteVault: vi.fn().mockResolvedValue(undefined)
    } as unknown as VaultService;
    
    const mockKeyManager = {
      addAccount: vi.fn().mockResolvedValue(undefined)
    } as unknown as KeyManager;

    const handler = createImportVaultHandler(mockVaultService, mockKeyManager);
    const valid12Word = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'.split(' ');
    
    await expect(handler({ password: 'my-password', recoveryPhrase: valid12Word }))
      .rejects.toThrow('Vault creation failed');
      
    expect(mockVaultService.createVault).toHaveBeenCalled();
    expect(mockKeyManager.addAccount).not.toHaveBeenCalled();
    expect(mockVaultService.deleteVault).not.toHaveBeenCalled(); // No rollback if createVault fails
  });

  it('exposes the error if rollback (deleteVault) itself fails', async () => {
    const mockVaultService = {
      createVault: vi.fn().mockResolvedValue(undefined),
      deleteVault: vi.fn().mockRejectedValue(new Error('Rollback failure'))
    } as unknown as VaultService;
    
    const mockKeyManager = {
      addAccount: vi.fn().mockRejectedValue(new Error('Storage failure'))
    } as unknown as KeyManager;

    const handler = createImportVaultHandler(mockVaultService, mockKeyManager);
    const valid12Word = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'.split(' ');
    
    await expect(handler({ password: 'my-password', recoveryPhrase: valid12Word }))
      .rejects.toThrow('Rollback failure');
      
    expect(mockVaultService.createVault).toHaveBeenCalled();
    expect(mockKeyManager.addAccount).toHaveBeenCalled();
    expect(mockVaultService.deleteVault).toHaveBeenCalled();
  });
});
