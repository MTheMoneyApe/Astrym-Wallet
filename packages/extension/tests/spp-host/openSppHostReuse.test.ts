import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const tabs = {
  query: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  get: vi.fn(),
};
const runtime = {
  getContexts: vi.fn(),
};
const windows = { update: vi.fn() };

beforeEach(() => {
  vi.resetModules();
  tabs.query.mockReset();
  tabs.create.mockReset();
  tabs.update.mockReset();
  tabs.get.mockReset();
  runtime.getContexts.mockReset();
  windows.update.mockReset();
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      id: 'test-extension-id',
      getURL: (path: string) => `chrome-extension://test-extension-id/${path}`,
      getContexts: runtime.getContexts,
    },
    tabs: {
      ...tabs,
      create: tabs.create,
      query: tabs.query,
      update: tabs.update,
      get: tabs.get,
    },
    windows,
  };
});

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome;
});

describe('openSppHostInternal tab reuse', () => {
  it('focuses an existing spp-host tab instead of creating another', async () => {
    runtime.getContexts.mockResolvedValue([{ tabId: 42 }]);
    tabs.get.mockResolvedValue({ id: 42, windowId: 7 });
    tabs.update.mockResolvedValue({});
    windows.update.mockResolvedValue({});
    const { openSppHostInternal } = await import('../../src/spp-host/openSppHost.js');
    openSppHostInternal({ active: true });
    await vi.waitFor(() => expect(tabs.update).toHaveBeenCalled());
    expect(tabs.create).not.toHaveBeenCalled();
    expect(tabs.update).toHaveBeenCalledWith(42, { active: true });
  });

  it('coalesces concurrent open requests while the host lookup is pending', async () => {
    let resolveContexts!: (contexts: Array<{ tabId?: number }>) => void;
    runtime.getContexts.mockImplementation(
      () => new Promise((resolve) => {
        resolveContexts = resolve;
      }),
    );
    tabs.create.mockResolvedValue({ id: 99 });

    const { openSppHostInternal } = await import('../../src/spp-host/openSppHost.js');
    openSppHostInternal({ active: false });
    openSppHostInternal({ active: false });

    await vi.waitFor(() => expect(runtime.getContexts).toHaveBeenCalledTimes(1));
    resolveContexts([]);
    await vi.waitFor(() => expect(tabs.create).toHaveBeenCalledTimes(1));
    expect(tabs.create.mock.calls[0][0].url).toContain('spp-host.html');
  });

  it('creates a tab when none exists', async () => {
    runtime.getContexts.mockResolvedValue([]);
    tabs.create.mockResolvedValue({ id: 1 });
    const { openSppHostInternal } = await import('../../src/spp-host/openSppHost.js');
    openSppHostInternal({ active: false });
    await vi.waitFor(() => expect(tabs.create).toHaveBeenCalled());
    expect(tabs.create.mock.calls[0][0].url).toContain('spp-host.html');
  });
});
