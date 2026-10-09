import { describe, expect, it, beforeEach, vi } from 'vitest';
vi.mock('webextension-polyfill', () => {
  return {
    default: {
      runtime: {
        id: 'test-extension-id',
        getURL: vi.fn().mockReturnValue('chrome-extension://test-extension-id/popup.html')
      },
      storage: {
        local: {
          get: vi.fn(),
          set: vi.fn(),
          remove: vi.fn()
        }
      }
    }
  };
});
import browser from 'webextension-polyfill';
import { StateCoordinator } from '../../../src/background/StateCoordinator.js';
import { createResetWalletHandler } from '../../../src/background/handlers/vaultHandlers.js';

describe('Reset Failure Injection', () => {
  let mockVaultService: any;
  let handler: any;
  let activeCoordinator: StateCoordinator;

  beforeEach(() => {
    vi.clearAllMocks();
    activeCoordinator = new StateCoordinator();
    mockVaultService = { 
      lock: vi.fn().mockResolvedValue(undefined),
      deleteVault: vi.fn().mockResolvedValue(undefined) 
    };
    handler = createResetWalletHandler(mockVaultService);
  });

  const runSimulation = async (setup: () => void, expectError: string, expectedRestartState: string) => {
    setup();
    await expect(handler({ userConfirmed: true }, { url: 'chrome-extension://test-extension-id/popup.html' } as any))
      .rejects.toThrow(expectError);
      
    // Fresh restart simulation (new JS context)
    const freshCoordinator = new StateCoordinator();
    await freshCoordinator.initializeHolistic(true, true, false);
    expect(freshCoordinator.state).toBe(expectedRestartState);
  };

  it('marker write rejection', async () => {
    await runSimulation(() => {
      (browser.storage.local.set as any).mockRejectedValueOnce(new Error('Write failed'));
      (browser.storage.local.get as any).mockResolvedValue({}); 
      (browser.storage.local.get as any).mockResolvedValue({}); 
    }, 'Failed to set reset marker', 'LOCKED');
    expect(mockVaultService.lock).not.toHaveBeenCalled();
  });

  it('marker read-back mismatch', async () => {
    await runSimulation(() => {
      (browser.storage.local.set as any).mockResolvedValueOnce(undefined);
      (browser.storage.local.get as any).mockResolvedValueOnce({ solanym_reset_in_progress: false }); 
      (browser.storage.local.get as any).mockResolvedValueOnce({}); 
    }, 'Reset marker verification failed', 'LOCKED');
    expect(mockVaultService.lock).not.toHaveBeenCalled();
  });

  it('vault lock failure (memory wipe fails)', async () => {
    await runSimulation(() => {
      (browser.storage.local.set as any).mockResolvedValueOnce(undefined);
      (browser.storage.local.get as any).mockResolvedValueOnce({ solanym_reset_in_progress: true });
      (browser.storage.local.get as any).mockResolvedValueOnce({ solanym_reset_in_progress: true });
      mockVaultService.deleteVault.mockRejectedValueOnce(new Error('Lock failed'));
    }, 'Lock failed', 'RESET_BLOCKED');
  });

  it('session storage deletion failure (via remove accounts)', async () => {
    await runSimulation(() => {
      (browser.storage.local.set as any).mockResolvedValueOnce(undefined);
      (browser.storage.local.get as any).mockResolvedValueOnce({ solanym_reset_in_progress: true });
      (browser.storage.local.get as any).mockResolvedValueOnce({ solanym_reset_in_progress: true });
      (browser.storage.local.remove as any).mockRejectedValueOnce(new Error('Remove accounts failed'));
    }, 'Remove accounts failed', 'RESET_BLOCKED');
  });

  it('final marker removal failure', async () => {
    await runSimulation(() => {
      (browser.storage.local.set as any).mockResolvedValueOnce(undefined);
      (browser.storage.local.get as any).mockResolvedValueOnce({ solanym_reset_in_progress: true });
      (browser.storage.local.get as any).mockResolvedValueOnce({ solanym_reset_in_progress: true });
      
      // Succeed 3 removes (accounts, index, intent) - since persistent_vault is now handled by deleteVault
      (browser.storage.local.remove as any).mockResolvedValueOnce(undefined);
      (browser.storage.local.remove as any).mockResolvedValueOnce(undefined);
      (browser.storage.local.remove as any).mockResolvedValueOnce(undefined);
      
      // 4th remove (marker) throws
      (browser.storage.local.remove as any).mockRejectedValueOnce(new Error('Marker remove failed'));
    }, 'Marker remove failed', 'RESET_BLOCKED');
  });
  
  it('startup with marker and partial state', async () => {
    const freshCoordinator = new StateCoordinator();
    (browser.storage.local.get as any).mockResolvedValueOnce({ solanym_reset_in_progress: true });
    await freshCoordinator.initializeHolistic(true, true, false);
    expect(freshCoordinator.state).toBe('RESET_BLOCKED');
  });
});
