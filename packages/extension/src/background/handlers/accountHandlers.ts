import type { AccountService } from '@solanym/wallet-core/src/solana/accounts/AccountService.js';
import type { SolanaReadClient } from '@solanym/wallet-core/src/solana/read/SolanaReadClient.js';
import type { KeyManager } from '@solanym/wallet-core/src/keyManager/KeyManager.js';
import type { 
  GetAccountsRequest, GetAccountsResponse, GetBalanceRequest, GetBalanceResponse,
  AddAccountRequest, AddAccountResponse,
  SetActiveAccountRequest, SetActiveAccountResponse,
  RenameAccountRequest, RenameAccountResponse
} from '../../shared/ipcTypes.js';
import { stateCoordinator } from '../StateCoordinator.js';
import { activeAccountManager } from '../accounts/ActiveAccountManager.js';

export function createGetAccountsHandler(accountService: AccountService) {
  return async (_payload: GetAccountsRequest): Promise<GetAccountsResponse> => {
    // Allows reading even if state is READY_WITH_MUTATION_LOCK
    if (stateCoordinator.state === 'ERROR_STATE' || stateCoordinator.state === 'RESET_BLOCKED') {
      throw new Error('System in degraded state');
    }
    const accounts = await accountService.getAccounts();
    return accounts.map(a => ({
      index: a.index,
      publicKey: a.address,
      label: a.label
    }));
  };
}

export function createGetBalanceHandler(readClient: SolanaReadClient) {
  return async (payload: GetBalanceRequest): Promise<GetBalanceResponse> => {
    const balance = await readClient.getSolBalance(payload.address);
    return {
      lamports: balance.lamports.toString()
    };
  };
}

export function createAddAccountHandler(keyManager: KeyManager) {
  return async (payload: AddAccountRequest): Promise<AddAccountResponse> => {
    await stateCoordinator.mutex.acquire();
    try {
      if (stateCoordinator.state !== 'READY') {
        throw new Error(`System state ${stateCoordinator.state} does not allow new account creation`);
      }
      if (stateCoordinator.isResetting) {
        throw new Error('Reset in progress');
      }

      const account = await keyManager.addAccount(payload.idempotencyUuid, payload.label);
      
      // We must encode the Uint8Array to base58 for IPC. KeyManager returns Uint8Array publicKey.
      // AccountService has getAccounts which formats to address. For this handler, we can rely on formatting here.
      // We will need a local base58 encoder for the response. Or we can just fetch from accountService.
      const accounts = await keyManager.getAccounts();
      const updated = accounts.find(a => a.index === account.index);
      
      const { getBase58Decoder } = await import('@solana/kit');
      const address = getBase58Decoder().decode(updated!.publicKey);

      return {
        account: {
          index: updated!.index,
          publicKey: address,
          label: updated!.label
        }
      };
    } catch (e: any) {
      if (e.name === 'UncertainCommitStateError') {
        stateCoordinator.enterErrorState();
      }
      throw e;
    } finally {
      stateCoordinator.mutex.release();
    }
  };
}

export function createSetActiveAccountHandler(accountService: AccountService) {
  return async (payload: SetActiveAccountRequest): Promise<SetActiveAccountResponse> => {
    await stateCoordinator.mutex.acquire();
    try {
      if (stateCoordinator.state !== 'READY') {
        throw new Error(`System state ${stateCoordinator.state} does not allow mutation`);
      }
      if (stateCoordinator.isResetting) {
        throw new Error('Reset in progress');
      }

      await activeAccountManager.setActiveAccountIndex(payload.index, accountService);
      return { success: true };
    } catch (e: any) {
      if (e.name === 'UncertainCommitStateError') {
        stateCoordinator.enterErrorState();
      }
      throw e;
    } finally {
      stateCoordinator.mutex.release();
    }
  };
}

export function createRenameAccountHandler(keyManager: KeyManager) {
  return async (payload: RenameAccountRequest): Promise<RenameAccountResponse> => {
    await stateCoordinator.mutex.acquire();
    try {
      if (stateCoordinator.state !== 'READY') {
        throw new Error(`System state ${stateCoordinator.state} does not allow mutation`);
      }
      if (stateCoordinator.isResetting) {
        throw new Error('Reset in progress');
      }

      await keyManager.renameAccount(payload.index, payload.label);
      return { success: true };
    } catch (e: any) {
      if (e.name === 'UncertainCommitStateError') {
        stateCoordinator.enterErrorState();
      }
      throw e;
    } finally {
      stateCoordinator.mutex.release();
    }
  };
}

