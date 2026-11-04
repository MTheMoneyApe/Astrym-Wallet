import type {
  IUncertainSubmissionStorage,
  StellarSubmissionLifecycle,
  UncertainTxSessionFlag,
} from '@solanym/wallet-core';
import { stateCoordinator, type StateCoordinator } from './StateCoordinator.js';

export function createStellarSubmissionLifecycle(
  storage: IUncertainSubmissionStorage,
  coordinator: StateCoordinator = stateCoordinator,
): StellarSubmissionLifecycle {
  return {
    beforeDispatch: async (record: UncertainTxSessionFlag) => {
      await storage.save(record);
      try {
        coordinator.enterUncertainTransaction(record.accountIndex, record.txHash);
      } catch (error) {
        if (coordinator.state !== 'RESET_BLOCKED') coordinator.enterErrorState();
        throw error;
      }
    },
    resolve: async (record: UncertainTxSessionFlag) => {
      const context = coordinator.getUncertainContext();
      if (
        context === null ||
        context.accountIndex !== record.accountIndex ||
        context.txHash !== record.txHash
      ) {
        throw new Error('Uncertain Stellar transaction context does not match the stored record');
      }

      const stored = await storage.load();
      if (stored === null || stored.txHash !== record.txHash) {
        throw new Error('Uncertain Stellar transaction record is missing or has changed');
      }

      await storage.clear();
      coordinator.resolveUncertainTransaction();
    },
  };
}

export async function restoreUncertainSubmission(
  storage: IUncertainSubmissionStorage,
  coordinator: StateCoordinator = stateCoordinator,
): Promise<boolean> {
  try {
    const record = await storage.load();
    if (record === null) return true;
    coordinator.enterUncertainTransaction(record.accountIndex, record.txHash);
    return true;
  } catch {
    if (coordinator.state !== 'RESET_BLOCKED') coordinator.enterErrorState();
    return false;
  }
}
