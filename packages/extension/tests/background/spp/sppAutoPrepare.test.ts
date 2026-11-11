import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureSppAutoPrepareIfNeeded,
  installSppPrepareGenerationGuard,
  resetSppAutoPrepareEnsureLockForTests,
  resetSppPrepareGenerationGuardForTests,
} from '../../../src/background/spp/sppAutoPrepare.js';
import { openSppHostInternal } from '../../../src/spp-host/openSppHost.js';

const storage = new Map<string, unknown>();
type StorageChangeListener = (
  changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
  areaName: string,
) => void | Promise<void>;
const storageChangeListeners: StorageChangeListener[] = [];
let localSet: (items: Record<string, unknown>) => Promise<void>;

vi.mock('../../../src/spp-host/openSppHost.js', () => ({
  openSppHostInternal: vi.fn(),
}));

describe('ensureSppAutoPrepareIfNeeded', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.clear();
    storageChangeListeners.length = 0;
    resetSppAutoPrepareEnsureLockForTests();
    resetSppPrepareGenerationGuardForTests();
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
      } as unknown as typeof chrome.storage,
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('repairs a stale host status write to the current service-worker intent generation', async () => {
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
    await storageChangeListeners[0]!({
      [statusKey]: {
        newValue: storage.get(statusKey),
      },
    }, 'local');

    expect(storage.get(statusKey)).toMatchObject({
      phase: 'opening_host',
      generation: 8,
    });
    expect(storage.get(intentKey)).toMatchObject({
      autoRun: true,
      generation: 8,
    });
    expect(localSet).toHaveBeenCalledTimes(1);
  });

  it('does not start prepare when Nym is not connected', async () => {
    await ensureSppAutoPrepareIfNeeded({ nymConnected: false, nymMode: 'direct' });
    expect(openSppHostInternal).not.toHaveBeenCalled();
  });

  it('starts prepare when idle and Nym is ready', async () => {
    await ensureSppAutoPrepareIfNeeded({ nymConnected: true, nymMode: 'nym' });
    expect(openSppHostInternal).toHaveBeenCalledTimes(1);
    const status = storage.get('astrym_spp_prepare_status') as { generation: number };
    const intent = storage.get('astrym_spp_auto_prepare_intent') as { generation: number };
    expect(status).toMatchObject({ phase: 'opening_host' });
    expect(intent).toMatchObject({ autoRun: true });
    expect(intent.generation).toBe(status.generation);
  });

  it('coalesces simultaneous Nym-ready requests into one prepare generation', async () => {

    const input = { nymConnected: true, nymMode: 'nym' as const };
    const [first, second] = await Promise.all([
      ensureSppAutoPrepareIfNeeded(input),
      ensureSppAutoPrepareIfNeeded(input),
    ]);

    expect(openSppHostInternal).toHaveBeenCalledTimes(1);
    expect(first?.phase).toBe('opening_host');
    expect(second?.generation).toBe(first?.generation);
    expect(storage.get('astrym_spp_auto_prepare_intent')).toMatchObject({
      autoRun: true,
      generation: first?.generation,
    });
  });

  it('skips duplicate start while prepare is in flight', async () => {
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
