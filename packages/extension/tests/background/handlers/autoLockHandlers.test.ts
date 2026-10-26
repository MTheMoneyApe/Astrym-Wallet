import { beforeEach, describe, expect, it, vi } from 'vitest';
import browser from 'webextension-polyfill';
import { createRecordUserActivityHandler } from '../../../src/background/handlers/autoLockHandlers.js';
import { stateCoordinator } from '../../../src/background/StateCoordinator.js';
import type { VaultService } from '@solanym/wallet-core/src/vault/VaultService.js';

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: {
      getURL: vi.fn(() => 'chrome-extension://test/popup.html'),
    },
    storage: { local: { get: vi.fn().mockResolvedValue({}) } },
  },
}));

describe('record user activity IPC handler', () => {
  beforeEach(() => {
    (stateCoordinator as any)._state = 'READY';
    (stateCoordinator as any)._lockRequested = false;
  });

  it('resets the timer only for the exact trusted popup while the vault is unlocked', async () => {
    const resetActivityTimer = vi.fn().mockResolvedValue(undefined);
    const handler = createRecordUserActivityHandler({
      isLocked: false,
      resetActivityTimer,
    } as unknown as VaultService);

    await expect(handler({}, {
      id: 'test',
      url: 'chrome-extension://test/popup.html',
    } as browser.Runtime.MessageSender)).resolves.toEqual({ success: true });
    expect(resetActivityTimer).toHaveBeenCalledTimes(1);
  });

  it('rejects activity claims from any other extension page', async () => {
    const resetActivityTimer = vi.fn().mockResolvedValue(undefined);
    const handler = createRecordUserActivityHandler({
      isLocked: false,
      resetActivityTimer,
    } as unknown as VaultService);

    await expect(handler({}, {
      id: 'test',
      url: 'chrome-extension://test-id/untrusted-sender.html',
    } as browser.Runtime.MessageSender)).rejects.toThrow(/trusted wallet popup/);
    expect(resetActivityTimer).not.toHaveBeenCalled();
  });

  it('does not reset the timer while locking or when the vault is locked', async () => {
    const resetActivityTimer = vi.fn().mockResolvedValue(undefined);
    const handler = createRecordUserActivityHandler({
      isLocked: false,
      resetActivityTimer,
    } as unknown as VaultService);
    (stateCoordinator as any)._lockRequested = true;

    await expect(handler({}, {
      id: 'test',
      url: 'chrome-extension://test/popup.html',
    } as browser.Runtime.MessageSender)).resolves.toEqual({ success: false });
    expect(resetActivityTimer).not.toHaveBeenCalled();

    (stateCoordinator as any)._lockRequested = false;
    const lockedHandler = createRecordUserActivityHandler({
      isLocked: true,
      resetActivityTimer,
    } as unknown as VaultService);
    await expect(lockedHandler({}, {
      id: 'test',
      url: 'chrome-extension://test/popup.html',
    } as browser.Runtime.MessageSender)).resolves.toEqual({ success: false });
  });
});
