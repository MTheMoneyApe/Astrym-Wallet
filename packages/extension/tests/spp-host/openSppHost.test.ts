import { afterEach, describe, expect, it, vi } from 'vitest';

describe('openSppHostInternal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock('../../src/spp-host/sppHostWebappEmbed.js');
    Reflect.deleteProperty(globalThis, 'chrome');
    Reflect.deleteProperty(globalThis, 'window');
  });

  it('opens an extension tab for real extension hosts', async () => {
    const create = vi.fn();
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        id: 'abcdefghijklmnopqrstuvwxyzabcdef',
        getURL: (p: string) => `chrome-extension://id/${p}`,
      },
      tabs: { create },
    };
    const { openSppHostInternal } = await import('../../src/spp-host/openSppHost.js');
    openSppHostInternal({ active: false });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'chrome-extension://id/spp-host.html',
        active: false,
      }),
    );
  });

  it('embeds in-page host for astrym-android-webapp runtime (no window.open)', async () => {
    const ensure = vi.fn(async () => undefined);
    vi.doMock('../../src/spp-host/sppHostWebappEmbed.js', () => ({
      ensureWebappSppHostAndPrepare: ensure,
    }));
    const openSpy = vi.fn();
    (globalThis as { window?: unknown }).window = { open: openSpy };
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: { id: 'astrym-android-webapp', getURL: (p: string) => `/${p}` },
    };
    const { openSppHostInternal } = await import('../../src/spp-host/openSppHost.js');
    openSppHostInternal({ active: false });
    await vi.waitFor(() => expect(ensure).toHaveBeenCalled());
    expect(openSpy).not.toHaveBeenCalled();
  });
});
