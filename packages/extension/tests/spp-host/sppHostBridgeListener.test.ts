import { afterEach, describe, expect, it, vi } from 'vitest';

const executePayment = vi.fn(async (_request: unknown) => ({ ok: true }));
const executeQuery = vi.fn(async (_request: unknown) => ({ ok: true }));
const clearPool = vi.fn((_reason?: string) => undefined);

vi.mock('../../src/spp-host/sppHostWritePool.js', () => ({
  executeSppHostWritePool: (request: unknown) => executePayment(request),
  clearSppHostWritePool: (reason?: string) => clearPool(reason),
  setSppHostLifecyclePublisher: () => undefined,
}));

vi.mock('../../src/spp-host/sppHostAccountQuery.js', () => ({
  executeSppHostAccountQuery: (request: unknown) => executeQuery(request),
}));

import { SPP_HOST_BRIDGE_CHANNEL } from '../../src/shared/sppHostBridge.js';
import {
  installSppHostBridgeListener,
  isSppServiceWorkerSender,
} from '../../src/spp-host/sppHostBridgeListener.js';

const RUNTIME_ID = 'test-extension-id';

type Listener = (
  message: unknown,
  sender: { id?: string; url?: string; tab?: { id: number } },
  sendResponse: (response: unknown) => void,
) => boolean | void;

function installWithChrome(): Listener[] {
  const listeners: Listener[] = [];
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      id: RUNTIME_ID,
      onMessage: {
        addListener(fn: Listener) {
          listeners.push(fn);
        },
        removeListener(fn: Listener) {
          const index = listeners.indexOf(fn);
          if (index >= 0) listeners.splice(index, 1);
        },
      },
      sendMessage: () => undefined,
    },
  };
  installSppHostBridgeListener();
  return listeners;
}

const worker = { id: RUNTIME_ID };
const popup = { id: RUNTIME_ID, url: `chrome-extension://${RUNTIME_ID}/popup.html` };
const hostTab = {
  id: RUNTIME_ID,
  url: `chrome-extension://${RUNTIME_ID}/spp-host.html`,
  tab: { id: 4 },
};

describe('spp-host bridge listener sender', () => {
  afterEach(() => {
    executePayment.mockClear();
    executeQuery.mockClear();
    clearPool.mockClear();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it('accepts only a tab-less service worker from this extension', () => {
    expect(isSppServiceWorkerSender(worker, RUNTIME_ID)).toBe(true);
    expect(isSppServiceWorkerSender({
      id: RUNTIME_ID,
      url: `chrome-extension://${RUNTIME_ID}/background.js`,
    }, RUNTIME_ID)).toBe(true);
    expect(isSppServiceWorkerSender({
      id: 'astrym-android-webapp',
      url: '/webapp.html',
    }, 'astrym-android-webapp')).toBe(true);
    expect(isSppServiceWorkerSender(popup, RUNTIME_ID)).toBe(false);
    expect(isSppServiceWorkerSender(hostTab, RUNTIME_ID)).toBe(false);
    expect(isSppServiceWorkerSender({
      id: RUNTIME_ID,
      url: 'https://evil.example/background.js',
    }, RUNTIME_ID)).toBe(false);
    expect(isSppServiceWorkerSender(undefined, RUNTIME_ID)).toBe(false);
  });

  it('runs execute and account query only for the service worker', async () => {
    const listeners = installWithChrome();
    const execute = {
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_EXECUTE_PRIVATE_PAYMENT',
      id: 'e1',
      payload: {
        operation: 'deposit',
        poolContract: 'C'.padEnd(56, 'A'),
        amountStroops: '10',
        rpcUrl: 'https://soroban-testnet.stellar.org',
        nymMode: 'nym',
        nymConnected: true,
        sppSelected: true,
      },
    };
    const query = {
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_ACCOUNT_QUERY',
      id: 'q1',
      payload: { action: 'snapshot', nymMode: 'nym', nymConnected: true },
    };
    const sendResponse = () => undefined;
    for (const listener of listeners) {
      listener(execute, popup, sendResponse);
      listener(query, popup, sendResponse);
    }
    expect(executePayment).not.toHaveBeenCalled();
    expect(executeQuery).not.toHaveBeenCalled();

    for (const listener of listeners) {
      listener(execute, worker, sendResponse);
      listener(query, worker, sendResponse);
    }
    await Promise.resolve();
    expect(executePayment).toHaveBeenCalledOnce();
    expect(executeQuery).toHaveBeenCalledOnce();
  });

  it('clears the write pool only when the service worker says cleared', () => {
    const listeners = installWithChrome();
    const cleared = {
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_POOL_LIFECYCLE',
      generation: 1,
      state: 'cleared',
    };
    for (const listener of listeners) {
      listener(cleared, hostTab, () => undefined);
    }
    expect(clearPool).not.toHaveBeenCalled();
    for (const listener of listeners) {
      listener(cleared, worker, () => undefined);
    }
    expect(clearPool).toHaveBeenCalledOnce();
  });
});
