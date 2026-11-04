import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storage = new Map<string, unknown>();

vi.mock('../../../src/spp-host/openSppHost.js', () => ({
  openSppHostInternal: vi.fn(),
}));

describe('ensureSppAutoPrepareIfNeeded', () => {
  beforeEach(() => {
    storage.clear();
    vi.resetModules();
    // @ts-expect-error test chrome stub
    globalThis.chrome = {
      storage: {
        local: {
          get: vi.fn(async (keys: string | string[]) => {
            const list = Array.isArray(keys) ? keys : [keys];
            const out: Record<string, unknown> = {};
            for (const key of list) {
              if (storage.has(key)) out[key] = storage.get(key);
            }
            return out;
          }),
          set: vi.fn(async (items: Record<string, unknown>) => {
            for (const [k, v] of Object.entries(items)) storage.set(k, v);
          }),
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
    expect(storage.get('astrym_spp_prepare_status')).toMatchObject({ phase: 'opening_host' });
    expect(storage.get('astrym_spp_auto_prepare_intent')).toMatchObject({ autoRun: true });
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
