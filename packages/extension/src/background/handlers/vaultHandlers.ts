import { generate24WordMnemonic } from '@solanym/wallet-core/src/crypto/mnemonic.js';
import type { VaultService } from '@solanym/wallet-core/src/vault/VaultService.js';
import type { KeyManager } from '@solanym/wallet-core/src/keyManager/KeyManager.js';
import type { IAccountService } from '../accounts/ActiveAccountManager.js';
import type { 
  UnlockVaultRequest, UnlockVaultResponse, 
  LockVaultRequest, LockVaultResponse,
  GetWalletStateRequest, GetWalletStateResponse,
  CreateVaultRequest, CreateVaultResponse,
  ImportVaultRequest, ImportVaultResponse,
  ResetWalletRequest, ResetWalletResponse
} from '../../shared/ipcTypes.js';
import { stateCoordinator } from '../StateCoordinator.js';
import { activeAccountManager, type ActiveAccountManager } from '../accounts/ActiveAccountManager.js';
import browser from 'webextension-polyfill';

type ActiveAccountIndexWriter = Pick<ActiveAccountManager, 'setActiveAccountIndex'>;

async function persistInitialActiveAccount(
  index: number,
  accountService: IAccountService,
  activeAccountIndexWriter: ActiveAccountIndexWriter,
): Promise<void> {
  try {
    await activeAccountIndexWriter.setActiveAccountIndex(index, accountService);
  } catch (cause) {
    const error = new Error(
      'The vault and first account were created, but the active account index could not be saved. Do not create another wallet; reopen this wallet and select an account manually.',
      { cause },
    );
    error.name = 'ActiveAccountInitializationError';
    throw error;
  }
}

export function createGetWalletStateHandler(vaultService: VaultService) {
  return async (_payload: GetWalletStateRequest): Promise<GetWalletStateResponse> => {
    return {
      hasVault: await vaultService.hasVault(),
      isLocked: vaultService.isLocked,
    };
  };
}

export function createCreateVaultHandler(
  vaultService: VaultService,
  keyManager: KeyManager,
  accountService: IAccountService,
  activeAccountIndexWriter: ActiveAccountIndexWriter = activeAccountManager,
) {
  return async (payload: CreateVaultRequest): Promise<CreateVaultResponse> => {
    await stateCoordinator.mutex.acquire();
    try {
      const mnemonic = generate24WordMnemonic();
      await vaultService.createVault(payload.password, mnemonic);
      
      const uuid = crypto.randomUUID();
      let firstAccount;
      try {
        firstAccount = await keyManager.addAccount(uuid, 'Account 1');
      } catch (e) {
        await vaultService.deleteVault();
        throw e;
      }

      await persistInitialActiveAccount(firstAccount.index, accountService, activeAccountIndexWriter);
      stateCoordinator.setUnlocked();
      
      return { recoveryPhrase: mnemonic.split(' ') };
    } finally {
      stateCoordinator.mutex.release();
    }
  };
}

import { makeSeedPhrase } from '@solanym/wallet-core/src/crypto/types.js';
import { validateSeedPhrase } from '@solanym/wallet-core/src/crypto/mnemonic.js';

export function createImportVaultHandler(
  vaultService: VaultService,
  keyManager: KeyManager,
  accountService: IAccountService,
  activeAccountIndexWriter: ActiveAccountIndexWriter = activeAccountManager,
) {
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
      let firstAccount;
      try {
        firstAccount = await keyManager.addAccount(uuid, 'Account 1');
      } catch (e) {
        await vaultService.deleteVault();
        throw e;
      }

      await persistInitialActiveAccount(firstAccount.index, accountService, activeAccountIndexWriter);
      stateCoordinator.setUnlocked();
      
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
    await stateCoordinator.runLockOperation(() => vaultService.lock());
    return { success: true };
  };
}

export function createRevealRecoveryPhraseHandler(vaultService: VaultService) {
  return async (
    payload: { auth: string },
    sender?: browser.Runtime.MessageSender,
  ): Promise<{ recoveryPhrase: string[] }> => {
    if (
      !sender ||
      sender.id !== browser.runtime.id ||
      sender.url !== browser.runtime.getURL('/popup.html')
    ) {
      throw new Error('UnauthorizedSenderError: Recovery phrase reveal must originate from trusted popup UI');
    }

    await stateCoordinator.mutex.acquire();
    try {
      if (stateCoordinator.isResetting) throw new Error('Reset in progress');
      await vaultService.unlock(payload.auth);
      const phrase = vaultService.getMnemonic();
      return { recoveryPhrase: phrase.split(' ') };
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
        if ((marker as Record<string, unknown>)['solanym_reset_in_progress'] !== true) {
          stateCoordinator.enterErrorState();
          throw new Error('Failed to set reset marker');
        }
      }

      // Verify marker strictly
      const verify = await browser.storage.local.get('solanym_reset_in_progress');
      if ((verify as Record<string, unknown>)['solanym_reset_in_progress'] !== true) {
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







