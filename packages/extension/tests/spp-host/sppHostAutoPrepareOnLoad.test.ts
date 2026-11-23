/**
 * On-load auto-prepare: one host-load call, no-op when no intent is pending.
 * Storage lab stays default-closed. No signing or broadcast.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { STORAGE_LAB_EXECUTION_AUTHORIZED } from '../../src/spp-host/storageLabPrep.js';

const harness = vi.hoisted(() => ({
  autoPrepareCalls: [] as unknown[],
  storageGets: [] as unknown[],
  storageSets: [] as unknown[],
  sentMessages: [] as unknown[],
  onChangedListeners: [] as Array<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void>,
}));

vi.mock('../../src/spp-host/sppHostAutoPrepare.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/spp-host/sppHostAutoPrepare.js')>();
  return {
    ...actual,
    runSppHostAutoPrepareIfRequested: (
      controller: Parameters<typeof actual.runSppHostAutoPrepareIfRequested>[0],
    ) => {
      harness.autoPrepareCalls.push(controller);
      return actual.runSppHostAutoPrepareIfRequested(controller);
    },
  };
});

const HOST_ELEMENT_IDS = [
  'spp-phase',
  'spp-wasm-phase',
  'spp-session-state',
  'spp-session-gen',
  'spp-storage-lab-phase',
  'spp-detail',
  'spp-error',
  'spp-probe-btn',
  'spp-wasm-btn',
  'spp-session-construct-btn',
  'spp-session-init-btn',
  'spp-session-clear-btn',
  'spp-write-pool-btn',
  'spp-storage-eval-btn',
  'spp-storage-run-btn',
  'spp-storage-free-btn',
  'spp-boot',
  'spp-gate-lab-profile',
  'spp-gate-opfs-risk',
  'spp-gate-phase-diff',
  'spp-session-rpc',
  'spp-session-contracts',
  'spp-session-circuits',
  'spp-write-pool-contract',
] as const;

function mountHostDom(): void {
  const nodes = new Map<string, HTMLElement>();
  for (const id of HOST_ELEMENT_IDS) {
    nodes.set(id, {
      textContent: '',
      hidden: false,
      dataset: {},
      addEventListener: () => undefined,
    } as unknown as HTMLElement);
  }
  (globalThis as { document: Document }).document = {
    getElementById: (id: string) => nodes.get(id) ?? null,
  } as unknown as Document;
  (globalThis as { window: Window & typeof globalThis }).window = globalThis as Window & typeof globalThis;
}

function installChrome(): void {
  const chromeStub = {
    storage: {
      local: {
        get: async (keys: unknown) => {
          harness.storageGets.push(keys);
          return {};
        },
        set: async (value: unknown) => {
          harness.storageSets.push(value);
        },
      },
      onChanged: {
        addListener: (
          fn: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void,
        ) => {
          harness.onChangedListeners.push(fn);
        },
      },
    },
    runtime: {
      onMessage: {
        addListener: () => undefined,
        removeListener: () => undefined,
      },
      sendMessage: (message: unknown) => {
        harness.sentMessages.push(message);
        return Promise.resolve(undefined);
      },
    },
  };
  (globalThis as { chrome: typeof chrome }).chrome = chromeStub as unknown as typeof chrome;
}

mountHostDom();
installChrome();

await import('../../src/spp-host/main.js');

describe('spp-host on-load auto-prepare', () => {
  it('fires once and is a no-op without a pending intent', async () => {
    const mainSrc = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../src/spp-host/main.ts'),
      'utf8',
    );
    const onLoadCalls = mainSrc.match(/^  processAutoPrepareIntent\(\);$/gm) ?? [];
    expect(onLoadCalls).toHaveLength(1);
    expect(STORAGE_LAB_EXECUTION_AUTHORIZED).toBe(false);

    await vi.waitFor(() => {
      expect(harness.storageGets).toEqual(['astrym_spp_auto_prepare_intent']);
    });
    expect(harness.autoPrepareCalls).toHaveLength(1);
    expect(harness.onChangedListeners).toHaveLength(1);
    expect(harness.storageSets).toEqual([]);
    expect(harness.sentMessages).toEqual([]);

    await Promise.resolve();
    expect(harness.autoPrepareCalls).toHaveLength(1);
    expect(harness.storageSets).toEqual([]);
    expect(harness.sentMessages).toEqual([]);
  });
});
