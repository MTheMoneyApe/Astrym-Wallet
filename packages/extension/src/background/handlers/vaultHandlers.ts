import { generate24WordMnemonic } from '@solanym/wallet-core/src/crypto/mnemonic.js';
import type { VaultService } from '@solanym/wallet-core/src/vault/VaultService.js';
import type { KeyManager } from '@solanym/wallet-core/src/keyManager/KeyManager.js';
import type { 
  UnlockVaultRequest, UnlockVaultResponse, 
  LockVaultRequest, LockVaultResponse,
  GetWalletStateRequest, GetWalletStateResponse,
  CreateVaultRequest, CreateVaultResponse,
  ImportVaultRequest, ImportVaultResponse,
  ResetWalletRequest, ResetWalletResponse
} from '../../shared/ipcTypes.js';
import { stateCoordinator } from '../StateCoordinator.js';
import browser from 'webextension-polyfill';

export function createGetWalletStateHandler(vaultService: VaultService) {
  return async (_payload: GetWalletStateRequest): Promise<GetWalletStateResponse> => {
    return {
      hasVault: await vaultService.hasVault(),
      isLocked: vaultService.isLocked,
    };
  };
}

export function createCreateVaultHandler(vaultService: VaultService, keyManager: KeyManager) {
  return async (payload: CreateVaultRequest): Promise<CreateVaultResponse> => {
    await stateCoordinator.mutex.acquire();
    try {
      const mnemonic = generate24WordMnemonic();
      await vaultService.createVault(payload.password, mnemonic);
      
      const uuid = crypto.randomUUID();
      try {
        await keyManager.addAccount(uuid, 'Account 1');
      } catch (e) {
        await vaultService.deleteVault();
        throw e;
      }
      
      return { recoveryPhrase: mnemonic.split(' ') };
    } finally {
      stateCoordinator.mutex.release();
    }
  };
}

import { makeSeedPhrase } from '@solanym/wallet-core/src/crypto/types.js';
import { validateSeedPhrase } from '@solanym/wallet-core/src/crypto/mnemonic.js';

export function createImportVaultHandler(vaultService: VaultService, keyManager: KeyManager) {
  return async (payload: ImportVaultRequest): Promise<ImportVaultResponse> => {
    await stateCoordinator.mutex.acquire();
    try {
      const mnemonicStr = payload.recoveryPhrase.join(' ');
      const seedPhrase = makeSeedPhrase(mnemonicStr);
      
      if (!validateSeedPhrase(seedPhrase)) {
        throw new Error('Invalid recovery phrase');
      }
      
      await vaultService.createVault(payload.password, seedPhrase);
      
      const uuid = crypto.randomUUID();
      try {
        await keyManager.addAccount(uuid, 'Account 1');
      } catch (e) {
        await vaultService.deleteVault();
        throw e;
      }
      
      return { success: true };
    } finally {
      stateCoordinator.mutex.release();
    }
  };
}

export function createUnlockVaultHandler(vaultService: VaultService) {
  return async (payload: UnlockVaultRequest): Promise<UnlockVaultResponse> => {
    await stateCoordinator.mutex.acquire();
    try {
      if (stateCoordinator.isResetting) throw new Error('Reset in progress');
      await vaultService.unlock(payload.password);
      stateCoordinator.setUnlocked();
      return { success: true };
    } finally {
      stateCoordinator.mutex.release();
    }
  };
}

export function createLockVaultHandler(vaultService: VaultService) {
  return async (_payload: LockVaultRequest): Promise<LockVaultResponse> => {
    await stateCoordinator.mutex.acquire();
    try {
      await vaultService.lock();
      stateCoordinator.setLocked();
      return { success: true };
    } catch (e) {
      stateCoordinator.enterErrorState();
      throw e;
    } finally {
      stateCoordinator.mutex.release();
    }
  };
}

export function createResetWalletHandler(vaultService: VaultService) {
  return async (payload: ResetWalletRequest, sender?: browser.Runtime.MessageSender): Promise<ResetWalletResponse> => {
    // 1. Strict Allowlist MV3 sender check
    if (!sender || !sender.url || sender.url !== browser.runtime.getURL('/popup.html')) {
      throw new Error('UnauthorizedSenderError: Reset must originate from trusted popup UI');
    }

    // 2. Payload check
    if (payload.userConfirmed !== true) {
      throw new Error('userConfirmed flag required');
    }

    await stateCoordinator.mutex.acquire();
    try {
      // 3. Setup barrier
      stateCoordinator.beginReset();

      // 4. Write marker (Must happen before ANY destructive operation)
      try {
        await browser.storage.local.set({ solanym_reset_in_progress: true });
      } catch (e) {
        // Read back
        const marker = await browser.storage.local.get('solanym_reset_in_progress').catch(() => ({}));
        if (marker.solanym_reset_in_progress !== true) {
          stateCoordinator.enterErrorState();
          throw new Error('Failed to set reset marker');
        }
      }

      // Verify marker strictly
      const verify = await browser.storage.local.get('solanym_reset_in_progress');
      if (verify.solanym_reset_in_progress !== true) {
        stateCoordinator.enterErrorState();
        throw new Error('Reset marker verification failed');
      }

      // 5. Memory revocation and storage wipe
      await vaultService.deleteVault(); // Zeroes buffers and clears storage

      // 6. Execute deletions
      await browser.storage.local.remove('solanym_accounts');
      await browser.storage.local.remove('solanym_active_index');
      await browser.storage.local.remove('solanym_add_account_intent');


      // 7. Clear marker
      await browser.storage.local.remove('solanym_reset_in_progress');
      
      stateCoordinator.finishReset();
      return { success: true };
    } finally {
      stateCoordinator.mutex.release();
    }
  };
}



