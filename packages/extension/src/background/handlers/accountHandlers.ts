import type { SolanaReadClient } from '@solanym/wallet-core/src/solana/read/SolanaReadClient.js';
import type { KeyManager } from '@solanym/wallet-core/src/keyManager/KeyManager.js';
import type { StellarReadClient } from '@solanym/wallet-core/src/stellar/read/StellarReadClient.js';
import { StrKey } from '@solanym/wallet-core';
import { getBase58Decoder } from '@solana/kit';
import type { 
  GetAccountsRequest, GetAccountsResponse,
  GetActiveAccountRequest, GetActiveAccountResponse,
  GetBalanceRequest, GetBalanceResponse,
  GetStellarBalanceRequest, GetStellarBalanceResponse,
  FundStellarTestnetRequest, FundStellarTestnetResponse,
  AddAccountRequest, AddAccountResponse,
  SetActiveAccountRequest, SetActiveAccountResponse,
  RenameAccountRequest, RenameAccountResponse
} from '../../shared/ipcTypes.js';
import { stateCoordinator } from '../StateCoordinator.js';
import { activeAccountManager, type IAccountService } from '../accounts/ActiveAccountManager.js';

export function createGetAccountsHandler(accountService: IAccountService) {
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

export function createGetActiveAccountHandler(accountService: IAccountService) {
  return async (_payload: GetActiveAccountRequest): Promise<GetActiveAccountResponse> => {
    if (stateCoordinator.state === 'ERROR_STATE' || stateCoordinator.state === 'RESET_BLOCKED') {
      throw new Error('System in degraded state');
    }

    const accounts = await accountService.getAccounts();
    if (accounts.length === 0) {
      return { status: 'NONE', index: null };
    }

    try {
      const activeIndex = activeAccountManager.getActiveAccountIndex();
      const isValid = accounts.some((account) => account.index === activeIndex);

      if (!isValid) {
        return { status: 'INVALID', index: null };
      }

      return { status: 'VALID', index: activeIndex };
    } catch {
      return { status: 'INVALID', index: null };
    }
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

export function createGetStellarBalanceHandler(readClient: StellarReadClient) {
  return async (payload: GetStellarBalanceRequest): Promise<GetStellarBalanceResponse> => {
    return await readClient.getBalance(payload.address);
  };
}

export function createFundStellarTestnetHandler(readClient: StellarReadClient) {
  return async (payload: FundStellarTestnetRequest): Promise<FundStellarTestnetResponse> => {
    return await readClient.fundTestnetAccount(payload.address);
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
      
      const accounts = await keyManager.getAccounts();
      const updated = accounts.find(a => a.index === account.index);
      
      const address = updated?.chain === 'stellar'
        ? StrKey.encodeEd25519PublicKey(updated.publicKey)
        : getBase58Decoder().decode(updated!.publicKey);

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

export function createSetActiveAccountHandler(accountService: IAccountService) {
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

