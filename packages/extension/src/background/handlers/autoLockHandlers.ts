import browser from 'webextension-polyfill';
import type { LockTimeoutMinutes } from '@solanym/wallet-core/src/vault/IAlarmService.js';
import type { VaultService } from '@solanym/wallet-core/src/vault/VaultService.js';
import type { ChromeAlarmService } from '../alarms/ChromeAlarmService.js';
import { stateCoordinator } from '../StateCoordinator.js';
import { isTrustedWalletPageUrl } from '../trustedWalletOrigin.js';

type AutoLockSettings = Pick<ChromeAlarmService, 'getTimeoutMinutes' | 'setTimeoutMinutes'>;

export function createGetAutoLockTimeoutHandler(alarmService: AutoLockSettings) {
  return async (): Promise<{ timeoutMinutes: LockTimeoutMinutes }> => ({
    timeoutMinutes: await alarmService.getTimeoutMinutes(),
  });
}

export function createSetAutoLockTimeoutHandler(alarmService: AutoLockSettings, vaultService: VaultService) {
  return async (payload: { timeoutMinutes: LockTimeoutMinutes }): Promise<{ success: boolean }> => {
    try {
      await alarmService.setTimeoutMinutes(payload.timeoutMinutes);
    } catch (cause) {
      if (
        !vaultService.isLocked &&
        !stateCoordinator.isLocking &&
        (stateCoordinator.state === 'READY' || stateCoordinator.state === 'READY_WITH_MUTATION_LOCK')
      ) {
        await stateCoordinator.runLockOperation(() => vaultService.lock());
      }
      throw cause;
    }
    return { success: true };
  };
}

export function createRecordUserActivityHandler(vaultService: VaultService) {
  return async (
    _payload: Record<string, never>,
    sender?: browser.Runtime.MessageSender,
  ): Promise<{ success: boolean }> => {
    if (!isTrustedWalletPageUrl(sender?.url)) {
      throw new Error('User activity must originate from the trusted wallet popup');
    }
    if (
      vaultService.isLocked ||
      stateCoordinator.isLocking ||
      (stateCoordinator.state !== 'READY' && stateCoordinator.state !== 'READY_WITH_MUTATION_LOCK')
    ) {
      return { success: false };
    }

    try {
      await vaultService.resetActivityTimer();
    } catch (cause) {
      await stateCoordinator.runLockOperation(() => vaultService.lock());
      throw cause;
    }
    return { success: true };
  };
}
