import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storage = new Map<string, unknown>();
type StorageChangeListener = (
  changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
  areaName: string,
) => void;
const storageChangeListeners: StorageChangeListener[] = [];
let localSet: (items: Record<string, unknown>) => Promise<void>;

vi.mock('../../../src/spp-host/openSppHost.js', () => ({
  openSppHostInternal: vi.fn(),
}));

describe('ensureSppAutoPrepareIfNeeded', () => {
  beforeEach(() => {
    storage.clear();
    storageChangeListeners.length = 0;
    vi.resetModules();
    localSet = vi.fn(async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) storage.set(k, v);
    });
    globalThis.chrome = {
      storage: {
        onChanged: {
          addListener: vi.fn((listener: StorageChangeListener) => {
            storageChangeListeners.push(listener);
          }),
        },
        local: {
          get: vi.fn(async (keys: string | string[]) => {
            const list = Array.isArray(keys) ? keys : [keys];
            const out: Record<string, unknown> = {};
            for (const key of list) {
              if (storage.has(key)) out[key] = storage.get(key);
            }
            return out;
          }),
          set: localSet,
          remove: vi.fn(async (keys: string | string[]) => {
            const list = Array.isArray(keys) ? keys : [keys];
            for (const key of list) storage.delete(key);
          }),
        },
      },
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('repairs a stale host status write to the current service-worker intent generation', async () => {
    const {
      installSppPrepareGenerationGuard,
    } = await import('../../../src/background/spp/sppAutoPrepare.js');
    const statusKey = 'astrym_spp_prepare_status';
    const intentKey = 'astrym_spp_auto_prepare_intent';
    const poolContract = 'CAMWBUWHYXEGBM3Q7M5DBGW7LLJL3I4QGANQEZFEWLRNTOJMTT2WG24U';
    storage.set(statusKey, {
      phase: 'initializing_write_pool',
      message: 'late host status',
      poolContract,
      updatedAt: Date.now(),
      generation: 7,
    });
    storage.set(intentKey, {
      generation: 8,
      requestedAt: Date.now(),
      poolContract,
      autoRun: true,
    });

    installSppPrepareGenerationGuard();
    expect(storageChangeListeners).toHaveLength(1);
    storageChangeListeners[0]!({
      [statusKey]: {
        newValue: storage.get(statusKey),
      },
    }, 'local');

    await vi.waitFor(() => {
      expect(storage.get(statusKey)).toMatchObject({
        phase: 'opening_host',
        generation: 8,
      });
    });
    expect(storage.get(intentKey)).toMatchObject({
      autoRun: true,
      generation: 8,
    });
    expect(localSet).toHaveBeenCalledTimes(1);
  });

  it('does not start prepare when Nym is not connected', async () => {
    const { ensureSppAutoPrepareIfNeeded, resetSppAutoPrepareEnsureLockForTests } =
      await import('../../../src/background/spp/sppAutoPrepare.js');
    const { openSppHostInternal } = await import('../../../src/spp-host/openSppHost.js');
    resetSppAutoPrepareEnsureLockForTests();
    await ensureSppAutoPrepareIfNeeded({ nymConnected: false, nymMode: 'direct' });
    expect(openSppHostInternal).not.toHaveBeenCalled();
  });

  it('starts prepare when idle and Nym is ready', async () => {
    const { ensureSppAutoPrepareIfNeeded, resetSppAutoPrepareEnsureLockForTests } =
      await import('../../../src/background/spp/sppAutoPrepare.js');
    const { openSppHostInternal } = await import('../../../src/spp-host/openSppHost.js');
    resetSppAutoPrepareEnsureLockForTests();
    await ensureSppAutoPrepareIfNeeded({ nymConnected: true, nymMode: 'nym' });
    expect(openSppHostInternal).toHaveBeenCalledTimes(1);
    const status = storage.get('astrym_spp_prepare_status') as { generation: number };
    const intent = storage.get('astrym_spp_auto_prepare_intent') as { generation: number };
    expect(status).toMatchObject({ phase: 'opening_host' });
    expect(intent).toMatchObject({ autoRun: true });
    expect(intent.generation).toBe(status.generation);
  });

  it('skips duplicate start while prepare is in flight', async () => {
    const { ensureSppAutoPrepareIfNeeded, resetSppAutoPrepareEnsureLockForTests } =
      await import('../../../src/background/spp/sppAutoPrepare.js');
    const { openSppHostInternal } = await import('../../../src/spp-host/openSppHost.js');
    resetSppAutoPrepareEnsureLockForTests();
    storage.set('astrym_spp_prepare_status', {
      phase: 'probing_assets',
      message: 'working',
      poolContract: null,
      updatedAt: Date.now(),
      generation: 1,
    });
    await ensureSppAutoPrepareIfNeeded({ nymConnected: true, nymMode: 'nym' });
    expect(openSppHostInternal).not.toHaveBeenCalled();
  });

  it('skips when write_pool_ready already verified', async () => {
    const { ensureSppAutoPrepareIfNeeded, resetSppAutoPrepareEnsureLockForTests } =
      await import('../../../src/background/spp/sppAutoPrepare.js');
    const { openSppHostInternal } = await import('../../../src/spp-host/openSppHost.js');
    resetSppAutoPrepareEnsureLockForTests();
    storage.set('astrym_spp_prepare_status', {
      phase: 'ready',
      message: 'ready',
      poolContract: 'CAMWBUWHYXEGBM3Q7M5DBGW7LLJL3I4QGANQEZFEWLRNTOJMTT2WG24U',
      updatedAt: Date.now(),
      generation: 3,
    });
    await ensureSppAutoPrepareIfNeeded({ nymConnected: true, nymMode: 'nym' });
    expect(openSppHostInternal).not.toHaveBeenCalled();
  });

  it('retries when opening_host is stalled', async () => {
    const { ensureSppAutoPrepareIfNeeded, resetSppAutoPrepareEnsureLockForTests } =
      await import('../../../src/background/spp/sppAutoPrepare.js');
    const { openSppHostInternal } = await import('../../../src/spp-host/openSppHost.js');
    resetSppAutoPrepareEnsureLockForTests();
    storage.set('astrym_spp_prepare_status', {
      phase: 'opening_host',
      message: 'stuck',
      poolContract: null,
      updatedAt: Date.now() - 60_000,
      generation: 1,
    });
    await ensureSppAutoPrepareIfNeeded({ nymConnected: true, nymMode: 'nym' });
    expect(openSppHostInternal).toHaveBeenCalledTimes(1);
  });
});
