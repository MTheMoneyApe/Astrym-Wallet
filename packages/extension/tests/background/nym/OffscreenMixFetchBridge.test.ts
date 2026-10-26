/**
 * Offscreen bridge + fail-closed routing — mocked IPC, no network / Mixnet.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { MixFetchNymTransport, NymTransportError } from '@solanym/wallet-core/src/nym/NymTransport.js';
import { FailClosedTransportRouter } from '@solanym/wallet-core/src/nym/NymTransportPolicy.js';
import { OffscreenDocumentManager } from '../../../src/background/nym/OffscreenDocumentManager.js';
import { OffscreenMixFetchBridge } from '../../../src/background/nym/OffscreenMixFetchBridge.js';
import {
  NYM_OFFSCREEN_CHANNEL,
  type NymOffscreenRequest,
  type NymOffscreenResponse,
} from '../../../src/nym-offscreen/protocol.js';

function okResponse(id: string, payload: unknown): NymOffscreenResponse {
  return { channel: NYM_OFFSCREEN_CHANNEL, id, ok: true, payload };
}

function errResponse(
  id: string,
  code: 'NOT_CONNECTED' | 'CONNECT_FAILED' | 'REQUEST_FAILED' | 'RUNTIME_UNAVAILABLE',
  message: string,
): NymOffscreenResponse {
  return { channel: NYM_OFFSCREEN_CHANNEL, id, ok: false, error: { code, message } };
}

describe('OffscreenDocumentManager', () => {
  it('ensureDocument does not imply mixnet connected', async () => {
    const createDocument = vi.fn(async () => undefined);
    const mgr = new OffscreenDocumentManager(
      {
        hasDocument: async () => false,
        createDocument,
        closeDocument: async () => undefined,
      },
      (p) => `chrome-extension://test/${p}`,
    );
    await mgr.ensureDocument();
    expect(createDocument).toHaveBeenCalledOnce();
    const firstCall = createDocument.mock.calls.at(0)?.at(0) as
      | { reasons: string[] }
      | undefined;
    expect(firstCall?.reasons).toEqual(['WORKERS']);
  });

  it('reports API unavailable when offscreen missing', () => {
    const mgr = new OffscreenDocumentManager(null);
    expect(mgr.isApiAvailable()).toBe(false);
  });
});

describe('OffscreenMixFetchBridge lifecycle', () => {
  let docs: OffscreenDocumentManager;
  let ensureDocument: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ensureDocument = vi.fn(async () => undefined);
    docs = {
      isApiAvailable: () => true,
      hasOpenDocument: async () => true,
      ensureDocument,
      closeDocument: vi.fn(async () => undefined),
    } as unknown as OffscreenDocumentManager;
  });

  it('setup requires successful connect payload with connected=true', async () => {
    const sendMessage = vi.fn(async (msg: NymOffscreenRequest) => {
      if (msg.type === 'ping') return okResponse(msg.id, { pong: true, documentReady: true });
      if (msg.type === 'connect') {
        expect(msg.options?.forceTls).toBe(true);
        return okResponse(msg.id, {
          state: 'connected',
          connected: true,
          lastError: null,
          diagnosticCode: 'OK',
          implementation: 'mix-fetch-offscreen',
          documentReady: true,
          assetsReady: true,
          gatewayAllowlistConfigured: false,
        });
      }
      return errResponse(msg.id, 'RUNTIME_UNAVAILABLE', 'unexpected');
    });
    const bridge = new OffscreenMixFetchBridge(docs, { sendMessage });
    await bridge.setup({ preferredGateway: 'q2A2cbooyC16YJzvdYaSMH9X3cSiieZNtfBr8cE8Fi1' });
    expect(ensureDocument).toHaveBeenCalled();
    expect(bridge.setupComplete).toBe(true);
    const connectMsg = sendMessage.mock.calls.map((c) => c[0]).find((m) => m.type === 'connect');
    expect(connectMsg?.type).toBe('connect');
    if (connectMsg?.type === 'connect') {
      expect(connectMsg.options?.preferredGateway).toBe(
        'q2A2cbooyC16YJzvdYaSMH9X3cSiieZNtfBr8cE8Fi1',
      );
      expect(connectMsg.options?.forceTls).toBe(true);
    }
  });

  it('retries ping until offscreen runtime is ready after createDocument', async () => {
    let pings = 0;
    const sendMessage = vi.fn(async (msg: NymOffscreenRequest) => {
      if (msg.type === 'ping') {
        pings += 1;
        if (pings < 3) {
          throw new Error('Receiving end does not exist');
        }
        return okResponse(msg.id, { pong: true, documentReady: true });
      }
      if (msg.type === 'connect') {
        return okResponse(msg.id, {
          state: 'connected',
          connected: true,
          lastError: null,
          diagnosticCode: 'OK',
          implementation: 'mix-fetch-offscreen',
          documentReady: true,
          assetsReady: true,
          gatewayAllowlistConfigured: true,
        });
      }
      return errResponse(msg.id, 'RUNTIME_UNAVAILABLE', 'unexpected');
    });
    const bridge = new OffscreenMixFetchBridge(docs, { sendMessage }, { attempts: 5, delayMs: 1 });
    await bridge.setup();
    expect(pings).toBeGreaterThanOrEqual(3);
    expect(bridge.setupComplete).toBe(true);
  });

  it('setup fails when connect returns connected=false (document alone is not Ready)', async () => {
    const sendMessage = vi.fn(async (msg: NymOffscreenRequest) => {
      if (msg.type === 'ping') return okResponse(msg.id, { pong: true, documentReady: true });
      if (msg.type === 'connect') {
        return okResponse(msg.id, {
          state: 'connecting',
          connected: false,
          lastError: null,
          diagnosticCode: 'INIT_FAILED',
          implementation: 'mix-fetch-offscreen',
          documentReady: true,
          assetsReady: true,
          gatewayAllowlistConfigured: false,
        });
      }
      return errResponse(msg.id, 'RUNTIME_UNAVAILABLE', 'unexpected');
    });
    const bridge = new OffscreenMixFetchBridge(docs, { sendMessage });
    await expect(bridge.setup()).rejects.toThrow(/connected=true/i);
    expect(bridge.setupComplete).toBe(false);
  });

  it('IPC failure surfaces as setup error', async () => {
    const bridge = new OffscreenMixFetchBridge(
      docs,
      {
        sendMessage: async () => {
          throw new Error('Extension context invalidated');
        },
      },
      { attempts: 2, delayMs: 1 },
    );
    await expect(bridge.setup()).rejects.toThrow(/not ready|IPC failed/i);
    expect(bridge.setupComplete).toBe(false);
  });

  it('queryStatus waits for offscreen runtime ready before status RPC', async () => {
    let pings = 0;
    const sendMessage = vi.fn(async (msg: NymOffscreenRequest) => {
      if (msg.type === 'ping') {
        pings += 1;
        if (pings < 2) {
          throw new Error('Receiving end does not exist');
        }
        return okResponse(msg.id, { pong: true, documentReady: true });
      }
      if (msg.type === 'status') {
        return okResponse(msg.id, {
          state: 'disconnected',
          connected: false,
          lastError: null,
          diagnosticCode: 'OK',
          implementation: 'mix-fetch-offscreen',
          documentReady: true,
          assetsReady: true,
          gatewayAllowlistConfigured: true,
        });
      }
      return errResponse(msg.id, 'RUNTIME_UNAVAILABLE', 'unexpected');
    });
    const bridge = new OffscreenMixFetchBridge(docs, { sendMessage }, { attempts: 5, delayMs: 1 });
    const status = await bridge.queryStatus();
    expect(pings).toBeGreaterThanOrEqual(2);
    expect(status?.assetsReady).toBe(true);
    expect(status?.connected).toBe(false);
  });

  it('disconnect clears setup even if IPC fails', async () => {
    const sendMessage = vi.fn(async (msg: NymOffscreenRequest) => {
      if (msg.type === 'ping') return okResponse(msg.id, { pong: true });
      if (msg.type === 'connect') {
        return okResponse(msg.id, {
          state: 'connected',
          connected: true,
          lastError: null,
          diagnosticCode: 'OK',
          implementation: 'mix-fetch-offscreen',
          documentReady: true,
          assetsReady: true,
          gatewayAllowlistConfigured: false,
        });
      }
      throw new Error('runtime lost');
    });
    const bridge = new OffscreenMixFetchBridge(docs, { sendMessage });
    await bridge.setup();
    await bridge.disconnect();
    expect(bridge.setupComplete).toBe(false);
    expect(docs.closeDocument).toHaveBeenCalled();
  });
});

describe('MixFetchNymTransport + FailClosed via offscreen bridge', () => {
  it('no clearnet fallback on request failure', async () => {
    const docs = {
      isApiAvailable: () => true,
      hasOpenDocument: async () => true,
      ensureDocument: vi.fn(async () => undefined),
      closeDocument: vi.fn(async () => undefined),
    } as unknown as OffscreenDocumentManager;

    const sendMessage = vi.fn(async (msg: NymOffscreenRequest) => {
      if (msg.type === 'ping') return okResponse(msg.id, { pong: true });
      if (msg.type === 'connect') {
        return okResponse(msg.id, {
          state: 'connected',
          connected: true,
          lastError: null,
          diagnosticCode: 'OK',
          implementation: 'mix-fetch-offscreen',
          documentReady: true,
          assetsReady: true,
          gatewayAllowlistConfigured: false,
        });
      }
      if (msg.type === 'fetch') {
        return errResponse(msg.id, 'REQUEST_FAILED', 'mixnet drop');
      }
      return errResponse(msg.id, 'RUNTIME_UNAVAILABLE', 'nope');
    });

    const bridge = new OffscreenMixFetchBridge(docs, { sendMessage });
    const nym = new MixFetchNymTransport(bridge);
    await nym.connect();
    expect(nym.getSnapshot().connected).toBe(true);

    const directFetch = vi.fn(async () => new Response('clearnet'));
    const router = new FailClosedTransportRouter({
      mode: 'nym',
      nym,
      directFetch: directFetch as typeof fetch,
    });

    await expect(router.fetch('https://horizon.example/x')).rejects.toBeInstanceOf(NymTransportError);
    expect(directFetch).not.toHaveBeenCalled();
  });

  it('nym mode refuses fetch when not connected', async () => {
    const docs = {
      isApiAvailable: () => true,
      hasOpenDocument: async () => false,
      ensureDocument: vi.fn(async () => undefined),
      closeDocument: vi.fn(async () => undefined),
    } as unknown as OffscreenDocumentManager;
    const bridge = new OffscreenMixFetchBridge(docs, {
      sendMessage: async () => {
        throw new Error('should not send');
      },
    });
    const nym = new MixFetchNymTransport(bridge);
    const directFetch = vi.fn(async () => new Response('clearnet'));
    const router = new FailClosedTransportRouter({
      mode: 'nym',
      nym,
      directFetch: directFetch as typeof fetch,
    });
    await expect(router.fetch('https://horizon.example/x')).rejects.toMatchObject({
      code: 'NOT_CONNECTED',
    });
    expect(directFetch).not.toHaveBeenCalled();
  });
});
