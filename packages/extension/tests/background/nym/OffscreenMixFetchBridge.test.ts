/**
 * Offscreen bridge + fail-closed routing — mocked IPC, no network / Mixnet.
 */

import { describe, expect, it, vi } from 'vitest';

import { MixFetchNymTransport, NymTransportError } from '@solanym/wallet-core/src/nym/NymTransport.js';
import { FailClosedTransportRouter } from '@solanym/wallet-core/src/nym/NymTransportPolicy.js';
import { isAuthoritativeHttpSmokeStatus, OffscreenMixFetchBridge } from '../../../src/background/nym/OffscreenMixFetchBridge.js';
import { OffscreenDocumentManager } from '../../../src/background/nym/OffscreenDocumentManager.js';
import {
  NYM_OFFSCREEN_CHANNEL,
  isNymOffscreenBridgeAuthenticatedSignal,
  type NymOffscreenRequest,
  type NymOffscreenResponse,
} from '../../../src/nym-offscreen/protocol.js';
import {
  createOffscreenBridgeHarness,
  createOffscreenBridgeTestHarness,
  createOffscreenExtensionContext,
  OFFSCREEN_TEST_COMPACT_DOCUMENT_ID,
  OFFSCREEN_TEST_DOCUMENT_ID,
  OFFSCREEN_TEST_URL,
} from './offscreenBridgeHarness.js';

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
    expect(mgr.getDocumentUrl()).toBe('chrome-extension://test/nym-offscreen.html');
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

  it('strict close rejects if the offscreen document remains open', async () => {
    const mgr = new OffscreenDocumentManager({
      hasDocument: async () => true,
      createDocument: async () => undefined,
      closeDocument: async () => undefined,
    });

    await expect(mgr.closeDocumentStrict()).rejects.toThrow(/remains open/i);
  });

  it('strict close accepts an already-closed document after a close error', async () => {
    const mgr = new OffscreenDocumentManager({
      hasDocument: async () => false,
      createDocument: async () => undefined,
      closeDocument: async () => {
        throw new Error('document already closed');
      },
    });

    await expect(mgr.closeDocumentStrict()).resolves.toBeUndefined();
  });
});

describe('OffscreenMixFetchBridge lifecycle', () => {
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
    const bridge = createOffscreenBridgeHarness(sendMessage);
    await bridge.setup({ preferredGateway: 'q2A2cbooyC16YJzvdYaSMH9X3cSiieZNtfBr8cE8Fi1' });
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

  it('forwards the Smoke operation ID separately from IPC correlation and queries its state', async () => {
    const sendMessage = vi.fn(async (msg: NymOffscreenRequest) => {
      if (msg.type === 'ping') return okResponse(msg.id, { pong: true, documentReady: true });
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
          runtimeGeneration: 'offscreen-test-generation',
        });
      }
      if (msg.type === 'fetch') {
        return okResponse(msg.id, {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: {},
          bodyBase64: 'b2s=',
        });
      }
      if (msg.type === 'httpSmokeStatus') {
        return okResponse(msg.id, {
          operationId: msg.operationId,
          runtimeGeneration: msg.runtimeGeneration,
          state: 'completed',
        });
      }
      return errResponse(msg.id, 'RUNTIME_UNAVAILABLE', 'unexpected');
    });
    const bridge = createOffscreenBridgeHarness(sendMessage);
    await bridge.setup();

    await expect(
      bridge.mixFetch(
        'https://postman-echo.com/post',
        {
          method: 'POST',
          httpSmokeOperationId: 'smoke-operation-1',
        } as RequestInit & { httpSmokeOperationId: string },
      ),
    ).resolves.toMatchObject({ status: 200 });
    const status = await bridge.queryHttpSmokeOperation(
      'smoke-operation-1',
      'offscreen-test-generation',
    );

    expect(
      sendMessage.mock.calls.map(([message]) => message).find((message) => message.type === 'fetch'),
    ).toMatchObject({
      type: 'fetch',
      operationId: 'smoke-operation-1',
    });
    expect(status).toEqual({
      operationId: 'smoke-operation-1',
      runtimeGeneration: 'offscreen-test-generation',
      state: 'completed',
    });
    expect(isAuthoritativeHttpSmokeStatus(status!)).toBe(true);
  });

  it('retries ping until offscreen runtime is ready after createDocument', async () => {
    let pings = 0;
    const sendMessage = vi.fn(async (msg: NymOffscreenRequest) => {
      if (msg.type === 'ping') {
        pings += 1;
        if (pings < 3) {
          return errResponse(msg.id, 'RUNTIME_UNAVAILABLE', 'Receiving end does not exist');
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
    const bridge = createOffscreenBridgeHarness(sendMessage);
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
    const bridge = createOffscreenBridgeHarness(sendMessage);
    await expect(bridge.setup()).rejects.toThrow(/connected=true/i);
    expect(bridge.setupComplete).toBe(false);
  });

  it('IPC failure surfaces as setup error', async () => {
    const bridge = createOffscreenBridgeHarness(async (msg) =>
      errResponse(msg.id, 'RUNTIME_UNAVAILABLE', 'Extension context invalidated'), {
      readinessTimeoutMs: 100,
    });
    await expect(bridge.setup()).rejects.toMatchObject({
      code: 'NYM_OFFSCREEN_READINESS_TIMEOUT',
    });
    expect(bridge.setupComplete).toBe(false);
  });

  it('queries status without creating or waiting on an offscreen document', async () => {
    const sendMessage = vi.fn(async (msg: NymOffscreenRequest) => {
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
    const bridge = createOffscreenBridgeHarness(sendMessage);
    const status = await bridge.queryStatus();
    expect(sendMessage.mock.calls.map(([message]) => message.type)).toEqual(['status']);
    expect(status?.assetsReady).toBe(true);
    expect(status?.connected).toBe(false);
  });

  it('does not create an offscreen document when status is requested while absent', async () => {
    const sendMessage = vi.fn();
    const bridge = createOffscreenBridgeHarness(sendMessage, { documentOpen: false });

    await expect(bridge.queryStatus()).resolves.toBeNull();

    expect(sendMessage).not.toHaveBeenCalled();
    expect(bridge.setupComplete).toBe(false);
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
    const bridge = createOffscreenBridgeHarness(sendMessage);
    await bridge.setup();
    await bridge.disconnect();
    expect(bridge.setupComplete).toBe(false);
  });

  it('strict disconnect surfaces runtime failure and still attempts document closure', async () => {
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
          gatewayAllowlistConfigured: true,
        });
      }
      if (msg.type === 'disconnect') {
        return errResponse(msg.id, 'RUNTIME_UNAVAILABLE', 'mix-fetch disconnect failed');
      }
      return errResponse(msg.id, 'RUNTIME_UNAVAILABLE', 'unexpected');
    });
    const bridge = createOffscreenBridgeHarness(sendMessage);
    await bridge.setup();

    await expect(bridge.disconnect({ strict: true })).rejects.toThrow(
      /mix-fetch disconnect failed/,
    );
    expect(sendMessage.mock.calls.some(([message]) =>
      message.type === 'disconnect' && message.strict === true,
    )).toBe(true);
  });

  it('strict disconnect reports a document that remains open', async () => {
    const sendMessage = vi.fn(async (msg: NymOffscreenRequest) => {
      if (msg.type === 'ping') return okResponse(msg.id, { pong: true });
      if (msg.type === 'disconnect') {
        return okResponse(msg.id, {
          state: 'disconnected',
          connected: false,
          lastError: null,
          diagnosticCode: 'OK',
          implementation: 'mix-fetch-offscreen',
          documentReady: false,
          assetsReady: true,
          gatewayAllowlistConfigured: true,
        });
      }
      return errResponse(msg.id, 'RUNTIME_UNAVAILABLE', 'unexpected');
    });
    const bridge = createOffscreenBridgeHarness(sendMessage);

    await expect(bridge.disconnect({ strict: true })).rejects.toThrow(
      /document remains open/i,
    );
  });
});

describe('OffscreenMixFetchBridge sender authentication', () => {
  it('does not expose a messenger-injection constructor parameter', () => {
    expect(OffscreenMixFetchBridge.length).toBe(0);
  });

  it('emits a frozen authentication diagnostic after accepting the matching port', async () => {
    const onAuthenticated = vi.fn();
    const onDiagnostic = vi.fn();
    const harness = createOffscreenBridgeTestHarness(
      async (request) => okResponse(request.id, {
        operationId: 'smoke-1',
        runtimeGeneration: 'generation-1',
        state: 'completed',
      }),
      { autoConnect: false, onAuthenticated, onDiagnostic },
    );
    const port = harness.connectPort();

    await expect(
      harness.bridge.queryHttpSmokeOperation('smoke-1', 'generation-1'),
    ).resolves.toMatchObject({ state: 'completed' });

    expect(onAuthenticated).toHaveBeenCalledOnce();
    expect(onAuthenticated).toHaveBeenCalledWith({
      authenticated: true,
      senderId: 'test-extension',
      senderUrl: OFFSCREEN_TEST_URL,
      senderDocumentId: OFFSCREEN_TEST_DOCUMENT_ID,
      contextType: 'OFFSCREEN_DOCUMENT',
      contextDocumentUrl: OFFSCREEN_TEST_URL,
      contextDocumentId: OFFSCREEN_TEST_DOCUMENT_ID,
    });
    expect(Object.isFrozen(onAuthenticated.mock.calls[0]?.[0])).toBe(true);
    expect(port.isDisconnected()).toBe(false);
    expect(onDiagnostic).toHaveBeenCalledOnce();
    expect(onDiagnostic).toHaveBeenCalledWith({
      event: 'connect_received',
      portNameMatches: true,
    });
    expect(port.messagesSent[0]).toEqual(
      {
        channel: 'nym-offscreen',
        target: 'nym-runtime',
        type: 'bridgeAuthenticated',
      },
    );
    expect(port.messagesSent.filter(isNymOffscreenBridgeAuthenticatedSignal)).toHaveLength(1);
    expect(port.events.indexOf('message_listener_added')).toBeGreaterThanOrEqual(0);
    expect(port.events.indexOf('message_listener_added')).toBeLessThan(
      port.events.indexOf('bridgeAuthenticatedSignal'),
    );
  });

  it('does not emit an authentication diagnostic for a wrong port name', () => {
    const onAuthenticated = vi.fn();
    const onDiagnostic = vi.fn();
    const harness = createOffscreenBridgeTestHarness(
      async (request) => okResponse(request.id, {}),
      { autoConnect: false, onAuthenticated, onDiagnostic },
    );

    harness.connectPort({ name: 'other-port' });

    expect(onAuthenticated).not.toHaveBeenCalled();
    expect(harness.ports[0]?.messagesSent).toEqual([]);
    expect(onDiagnostic).toHaveBeenNthCalledWith(1, {
      event: 'connect_received',
      portNameMatches: false,
    });
    expect(onDiagnostic).toHaveBeenNthCalledWith(2, {
      event: 'connect_rejected',
      reason: 'wrong_port_name',
    });
  });

  it.each([
    ['missing_or_invalid_sender', { sender: null }],
    ['sender_id_mismatch', {
      sender: {
        id: 'other-extension',
        url: OFFSCREEN_TEST_URL,
        documentId: OFFSCREEN_TEST_DOCUMENT_ID,
      },
    }],
    ['sender_url_mismatch', {
      sender: {
        id: 'test-extension',
        url: 'chrome-extension://test-extension/other.html',
        documentId: OFFSCREEN_TEST_DOCUMENT_ID,
      },
    }],
    ['invalid_document_id', {
      sender: {
        id: 'test-extension',
        url: OFFSCREEN_TEST_URL,
        documentId: 'malformed',
      },
    }],
    ['get_contexts_unavailable', { getContextsAvailable: false }],
    ['get_contexts_failed', {
      getContexts: async () => {
        throw new Error('lookup failed');
      },
    }],
    ['context_count_mismatch', { contexts: [] }],
    ['context_count_mismatch', {
      contexts: [
        createOffscreenExtensionContext(),
        createOffscreenExtensionContext({
          contextId: 'second-offscreen-context',
        }),
      ],
    }],
    ['context_document_id_mismatch', {
      contexts: [
        createOffscreenExtensionContext({
          documentId: OFFSCREEN_TEST_COMPACT_DOCUMENT_ID,
        }),
      ],
    }],
    ['invalid_document_id', {
      contexts: [createOffscreenExtensionContext({ documentId: 'malformed' })],
    }],
  ])('emits one %s rejection diagnostic', async (reason, options) => {
    const onDiagnostic = vi.fn();
    const harness = createOffscreenBridgeTestHarness(
      async (request) => okResponse(request.id, {}),
      { ...options, autoConnect: false, onDiagnostic },
    );
    const port = harness.connectPort();

    await vi.waitFor(() => expect(port.isDisconnected()).toBe(true));

    expect(onDiagnostic.mock.calls.filter(([diagnostic]) =>
      diagnostic.event === 'connect_rejected')).toEqual([
      [{ event: 'connect_rejected', reason }],
    ]);
    expect(port.messagesSent).toEqual([]);
  });

  it('sends no authentication signal while context authentication is pending', async () => {
    let releaseContextCheck:
      | ((contexts: chrome.runtime.ExtensionContext[]) => void)
      | undefined;
    const harness = createOffscreenBridgeTestHarness(
      async (request) => okResponse(request.id, {}),
      {
        autoConnect: false,
        getContexts: () => new Promise((resolve) => {
          releaseContextCheck = resolve;
        }),
      },
    );
    const port = harness.connectPort();
    await vi.waitFor(() => expect(releaseContextCheck).toBeTypeOf('function'));

    expect(port.messagesSent).toEqual([]);
    releaseContextCheck?.([createOffscreenExtensionContext()]);

    await vi.waitFor(() => expect(port.messagesSent).toEqual([
      {
        channel: 'nym-offscreen',
        target: 'nym-runtime',
        type: 'bridgeAuthenticated',
      },
    ]));
  });

  it('emits one candidate_disconnected rejection when authentication races with disconnect', async () => {
    let releaseContextCheck:
      | ((contexts: chrome.runtime.ExtensionContext[]) => void)
      | undefined;
    const onDiagnostic = vi.fn();
    const harness = createOffscreenBridgeTestHarness(
      async (request) => okResponse(request.id, {}),
      {
        autoConnect: false,
        onDiagnostic,
        getContexts: () => new Promise((resolve) => {
          releaseContextCheck = resolve;
        }),
      },
    );
    const port = harness.connectPort();
    await vi.waitFor(() => expect(releaseContextCheck).toBeTypeOf('function'));
    port.disconnect();
    releaseContextCheck?.([createOffscreenExtensionContext()]);

    await vi.waitFor(() => expect(onDiagnostic).toHaveBeenCalledWith({
      event: 'connect_rejected',
      reason: 'candidate_disconnected',
    }));
    expect(onDiagnostic.mock.calls.filter(([diagnostic]) =>
      diagnostic.event === 'connect_rejected')).toHaveLength(1);
  });

  it('emits one candidate_superseded rejection when a newer Port replaces the candidate', async () => {
    let releaseFirstContextCheck:
      | ((contexts: chrome.runtime.ExtensionContext[]) => void)
      | undefined;
    let contextLookups = 0;
    const onAuthenticated = vi.fn();
    const onDiagnostic = vi.fn();
    const harness = createOffscreenBridgeTestHarness(
      async (request) => okResponse(request.id, {}),
      {
        autoConnect: false,
        onAuthenticated,
        onDiagnostic,
        getContexts: () => {
          contextLookups += 1;
          if (contextLookups === 1) {
            return new Promise((resolve) => {
              releaseFirstContextCheck = resolve;
            });
          }
          return Promise.resolve([createOffscreenExtensionContext()]);
        },
      },
    );
    const firstPort = harness.connectPort();
    await vi.waitFor(() => expect(releaseFirstContextCheck).toBeTypeOf('function'));
    const secondPort = harness.connectPort();
    await vi.waitFor(() => expect(onAuthenticated).toHaveBeenCalledOnce());
    releaseFirstContextCheck?.([createOffscreenExtensionContext()]);

    await vi.waitFor(() => expect(onDiagnostic).toHaveBeenCalledWith({
      event: 'connect_rejected',
      reason: 'candidate_superseded',
    }));
    expect(onDiagnostic.mock.calls.filter(([diagnostic]) =>
      diagnostic.event === 'connect_rejected')).toHaveLength(1);
    expect(firstPort.isDisconnected()).toBe(true);
    expect(secondPort.isDisconnected()).toBe(false);
    expect(firstPort.messagesSent.filter(isNymOffscreenBridgeAuthenticatedSignal)).toHaveLength(0);
    expect(secondPort.messagesSent.filter(isNymOffscreenBridgeAuthenticatedSignal)).toHaveLength(1);
    expect(onAuthenticated).toHaveBeenCalledOnce();
  });

  it('keeps superseded diagnostics when the old candidate disconnects before its lookup resolves', async () => {
    let releaseFirstContextCheck:
      | ((contexts: chrome.runtime.ExtensionContext[]) => void)
      | undefined;
    let contextLookups = 0;
    const onAuthenticated = vi.fn();
    const onDiagnostic = vi.fn();
    const harness = createOffscreenBridgeTestHarness(
      async (request) => okResponse(request.id, {
        operationId: 'smoke-1',
        runtimeGeneration: 'generation-1',
        state: 'completed',
      }),
      {
        autoConnect: false,
        onAuthenticated,
        onDiagnostic,
        getContexts: () => {
          contextLookups += 1;
          if (contextLookups === 1) {
            return new Promise((resolve) => {
              releaseFirstContextCheck = resolve;
            });
          }
          return Promise.resolve([createOffscreenExtensionContext()]);
        },
      },
    );
    const firstPort = harness.connectPort();
    await vi.waitFor(() => expect(releaseFirstContextCheck).toBeTypeOf('function'));
    const secondPort = harness.connectPort();

    await vi.waitFor(() => expect(onAuthenticated).toHaveBeenCalledOnce());
    expect(onDiagnostic.mock.calls.filter(([diagnostic]) =>
      diagnostic.event === 'connect_rejected')).toEqual([
      [{ event: 'connect_rejected', reason: 'candidate_superseded' }],
    ]);

    firstPort.disconnect();
    releaseFirstContextCheck?.([createOffscreenExtensionContext()]);
    await vi.waitFor(() => expect(firstPort.isDisconnected()).toBe(true));

    await expect(
      harness.bridge.queryHttpSmokeOperation('smoke-1', 'generation-1'),
    ).resolves.toMatchObject({ state: 'completed' });
    expect(firstPort.requests).toHaveLength(0);
    expect(firstPort.messagesSent.filter(isNymOffscreenBridgeAuthenticatedSignal)).toHaveLength(0);
    expect(secondPort.requests).toHaveLength(1);
    expect(secondPort.messagesSent.filter(isNymOffscreenBridgeAuthenticatedSignal)).toHaveLength(1);
    expect(secondPort.isDisconnected()).toBe(false);
    expect(onAuthenticated).toHaveBeenCalledOnce();
    expect(onDiagnostic.mock.calls.filter(([diagnostic]) =>
      diagnostic.event === 'connect_rejected')).toEqual([
      [{ event: 'connect_rejected', reason: 'candidate_superseded' }],
    ]);
  });

  it('cleans up an authenticated port normally without reporting a rejection', async () => {
    const onAuthenticated = vi.fn();
    const onDiagnostic = vi.fn();
    const harness = createOffscreenBridgeTestHarness(
      () => new Promise(() => undefined),
      { autoConnect: false, onAuthenticated, onDiagnostic },
    );
    const port = harness.connectPort();

    await vi.waitFor(() => expect(onAuthenticated).toHaveBeenCalledOnce());
    const pending = harness.bridge.queryHttpSmokeOperation(
      'smoke-1',
      'generation-1',
    );
    await vi.waitFor(() => expect(port.requests).toHaveLength(1));
    port.disconnect();

    await expect(pending).resolves.toBeNull();
    await expect(
      harness.bridge.queryHttpSmokeOperation('smoke-2', 'generation-1'),
    ).resolves.toBeNull();

    expect(port.isDisconnected()).toBe(true);
    expect(port.requests).toHaveLength(1);
    expect(onAuthenticated).toHaveBeenCalledOnce();
    expect(onDiagnostic.mock.calls.filter(([diagnostic]) =>
      diagnostic.event === 'connect_rejected')).toHaveLength(0);
  });

  it.each([
    ['synchronous throw', () => {
      throw new Error('diagnostic logger failed');
    }],
    ['asynchronous rejection', () => Promise.reject(new Error('diagnostic logger failed'))],
  ])('does not let a diagnostic logger %s interrupt authentication', async (_label, onDiagnostic) => {
    const onAuthenticated = vi.fn();
    const harness = createOffscreenBridgeTestHarness(
      async (request) => okResponse(request.id, {
        operationId: 'smoke-1',
        runtimeGeneration: 'generation-1',
        state: 'completed',
      }),
      {
        autoConnect: false,
        onAuthenticated,
        onDiagnostic,
      },
    );
    const port = harness.connectPort();

    await expect(
      harness.bridge.queryHttpSmokeOperation('smoke-1', 'generation-1'),
    ).resolves.toMatchObject({ state: 'completed' });
    expect(onAuthenticated).toHaveBeenCalledOnce();
    expect(port.isDisconnected()).toBe(false);
  });

  it.each([
    ['wrong sender ID', { id: 'other-extension', url: OFFSCREEN_TEST_URL, documentId: OFFSCREEN_TEST_DOCUMENT_ID }],
    ['wrong sender URL', { id: 'test-extension', url: 'chrome-extension://test-extension/other.html', documentId: OFFSCREEN_TEST_DOCUMENT_ID }],
    ['malformed sender document ID', { id: 'test-extension', url: OFFSCREEN_TEST_URL, documentId: 'not-a-document-id' }],
  ])('does not emit an authentication diagnostic for %s', async (_label, sender) => {
    const onAuthenticated = vi.fn();
    const harness = createOffscreenBridgeTestHarness(
      async (request) => okResponse(request.id, {}),
      { autoConnect: false, onAuthenticated },
    );
    const port = harness.connectPort({ sender });

    await vi.waitFor(() => expect(port.isDisconnected()).toBe(true));
    expect(onAuthenticated).not.toHaveBeenCalled();
  });

  it('does not emit an authentication diagnostic for a mismatched document ID', async () => {
    const onAuthenticated = vi.fn();
    const harness = createOffscreenBridgeTestHarness(
      async (request) => okResponse(request.id, {}),
      {
        autoConnect: false,
        onAuthenticated,
        contexts: [
          createOffscreenExtensionContext({
            documentId: OFFSCREEN_TEST_COMPACT_DOCUMENT_ID,
          }),
        ],
      },
    );
    const port = harness.connectPort();

    await vi.waitFor(() => expect(port.isDisconnected()).toBe(true));
    expect(onAuthenticated).not.toHaveBeenCalled();
  });

  it.each([
    ['a failed lookup', { getContexts: async () => { throw new Error('contexts unavailable'); } }],
    ['zero matching contexts', { contexts: [] }],
    ['multiple matching contexts', {
      contexts: [
        createOffscreenExtensionContext(),
        createOffscreenExtensionContext({
          contextId: 'second-offscreen-context',
          documentId: OFFSCREEN_TEST_COMPACT_DOCUMENT_ID,
        }),
      ],
    }],
  ])('does not emit an authentication diagnostic for %s', async (_label, options) => {
    const onAuthenticated = vi.fn();
    const harness = createOffscreenBridgeTestHarness(
      async (request) => okResponse(request.id, {}),
      { ...options, autoConnect: false, onAuthenticated },
    );
    const port = harness.connectPort();

    await vi.waitFor(() => expect(port.isDisconnected()).toBe(true));
    expect(onAuthenticated).not.toHaveBeenCalled();
  });

  it.each([
    ['a synchronous throw', () => { throw new Error('diagnostic failed'); }],
    ['an asynchronous rejection', () => Promise.reject(new Error('diagnostic failed'))],
  ])('does not break the accepted port when the callback has %s', async (_label, callback) => {
    const harness = createOffscreenBridgeTestHarness(
      async (request) => okResponse(request.id, {
        operationId: 'smoke-1',
        runtimeGeneration: 'generation-1',
        state: 'completed',
      }),
      { autoConnect: false, onAuthenticated: callback },
    );
    const port = harness.connectPort();

    await expect(
      harness.bridge.queryHttpSmokeOperation('smoke-1', 'generation-1'),
    ).resolves.toMatchObject({ state: 'completed' });
    expect(port.isDisconnected()).toBe(false);
  });

  it('retains normal authenticated bridge behavior when the callback is omitted', async () => {
    const harness = createOffscreenBridgeTestHarness(async (request) =>
      okResponse(request.id, {
        operationId: 'smoke-1',
        runtimeGeneration: 'generation-1',
        state: 'completed',
      }), { autoConnect: false });
    const port = harness.connectPort();

    await expect(
      harness.bridge.queryHttpSmokeOperation('smoke-1', 'generation-1'),
    ).resolves.toMatchObject({ state: 'completed' });
    expect(port.isDisconnected()).toBe(false);
  });

  it.each([
    ['unexpected extension ID', { id: 'other-extension', url: OFFSCREEN_TEST_URL, documentId: OFFSCREEN_TEST_DOCUMENT_ID }],
    ['missing extension ID', { url: OFFSCREEN_TEST_URL, documentId: OFFSCREEN_TEST_DOCUMENT_ID }],
    ['unexpected sender URL', { id: 'test-extension', url: 'chrome-extension://test-extension/other.html', documentId: OFFSCREEN_TEST_DOCUMENT_ID }],
    ['malformed sender URL', { id: 'test-extension', url: 'not a URL' }],
    ['missing sender metadata', null],
    ['missing sender URL', { id: 'test-extension' }],
    ['missing sender document ID', { id: 'test-extension', url: OFFSCREEN_TEST_URL }],
    ['empty sender document ID', { id: 'test-extension', url: OFFSCREEN_TEST_URL, documentId: '' }],
    ['whitespace sender document ID', { id: 'test-extension', url: OFFSCREEN_TEST_URL, documentId: ' BC27AD52A2703D75D5B54770A8DD2726' }],
    ['malformed sender document ID', { id: 'test-extension', url: OFFSCREEN_TEST_URL, documentId: 'not-a-document-id' }],
    ['partial compact sender document ID', { id: 'test-extension', url: OFFSCREEN_TEST_URL, documentId: 'BC27AD52A2703D75D5B54770A8DD272' }],
    ['non-hexadecimal compact sender document ID', { id: 'test-extension', url: OFFSCREEN_TEST_URL, documentId: 'BC27AD52A2703D75D5B54770A8DD272G' }],
    ['misplaced hyphen sender document ID', { id: 'test-extension', url: OFFSCREEN_TEST_URL, documentId: 'BC27AD52-A2703D75D5B54770A8DD2726' }],
    ['extra hyphen sender document ID', { id: 'test-extension', url: OFFSCREEN_TEST_URL, documentId: 'BC27AD52A270-3D75D5B54770A8DD2726' }],
  ])('rejects %s without creating authority', async (_description, sender) => {
    const bridge = createOffscreenBridgeHarness(
      async (request) => okResponse(request.id, {
        operationId: 'smoke-1',
        runtimeGeneration: 'generation-1',
        state: 'completed',
      }),
      { sender },
    );

    const status = await bridge.queryHttpSmokeOperation('smoke-1', 'generation-1');
    expect(status).toBeNull();
    expect(isAuthoritativeHttpSmokeStatus({
      operationId: 'smoke-1',
      runtimeGeneration: 'generation-1',
      state: 'completed',
    })).toBe(false);
  });

  it.each([
    ['wrong operation ID', { operationId: 'other-operation', runtimeGeneration: 'generation-1', state: 'completed' }],
    ['wrong generation', { operationId: 'smoke-1', runtimeGeneration: 'other-generation', state: 'completed' }],
    ['unresolved state', { operationId: 'smoke-1', runtimeGeneration: 'generation-1', state: 'pending' }],
    ['invalid state', { operationId: 'smoke-1', runtimeGeneration: 'generation-1', state: 'finished' }],
  ])('does not authorize a response with %s', async (_description, payload) => {
    const bridge = createOffscreenBridgeHarness(async (request) =>
      okResponse(request.id, payload));

    const status = await bridge.queryHttpSmokeOperation('smoke-1', 'generation-1');
    expect(status === null || !isAuthoritativeHttpSmokeStatus(status)).toBe(true);
  });

  it('ignores a port with the wrong name and accepts an exact sender URL', async () => {
    const harness = createOffscreenBridgeTestHarness(
      async (request) => okResponse(request.id, {
        operationId: 'smoke-1',
        runtimeGeneration: 'generation-1',
        state: 'completed',
      }),
      { autoConnect: false },
    );
    harness.connectPort({ name: 'other-port' });
    await expect(
      harness.bridge.queryHttpSmokeOperation('smoke-1', 'generation-1'),
    ).resolves.toBeNull();
    harness.connectPort({
      sender: {
        id: 'test-extension',
        url: OFFSCREEN_TEST_URL,
        documentId: OFFSCREEN_TEST_DOCUMENT_ID,
      },
    });

    const status = await harness.bridge.queryHttpSmokeOperation('smoke-1', 'generation-1');
    expect(status?.state).toBe('completed');
    expect(isAuthoritativeHttpSmokeStatus(status!)).toBe(true);
  });

  it('authenticates against the exact active offscreen URL and document ID', async () => {
    const context = createOffscreenExtensionContext();
    const getContexts = vi.fn(async () => [context]);
    const harness = createOffscreenBridgeTestHarness(
      async (request) => okResponse(request.id, {
        operationId: 'smoke-1',
        runtimeGeneration: 'generation-1',
        state: 'completed',
      }),
      { getContexts },
    );

    await expect(
      harness.bridge.queryHttpSmokeOperation('smoke-1', 'generation-1'),
    ).resolves.toMatchObject({ state: 'completed' });
    expect(getContexts).toHaveBeenCalledWith({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [OFFSCREEN_TEST_URL],
    });
  });

  it.each([
    ['hyphenated UUID', OFFSCREEN_TEST_DOCUMENT_ID],
    ['compact uppercase hexadecimal ID', OFFSCREEN_TEST_COMPACT_DOCUMENT_ID],
    ['compact lowercase hexadecimal ID', OFFSCREEN_TEST_COMPACT_DOCUMENT_ID.toLowerCase()],
  ])('accepts a matching %s', async (_label, documentId) => {
    const harness = createOffscreenBridgeTestHarness(
      async (request) => okResponse(request.id, {
        operationId: 'smoke-1',
        runtimeGeneration: 'generation-1',
        state: 'completed',
      }),
      {
        sender: {
          id: 'test-extension',
          url: OFFSCREEN_TEST_URL,
          documentId,
        },
        contexts: [createOffscreenExtensionContext({ documentId })],
      },
    );

    await expect(
      harness.bridge.queryHttpSmokeOperation('smoke-1', 'generation-1'),
    ).resolves.toMatchObject({ state: 'completed' });
    expect(harness.ports[0]?.isDisconnected()).toBe(false);
  });

  it('rejects individually valid compact IDs when their exact values differ', async () => {
    const harness = createOffscreenBridgeTestHarness(
      async (request) => okResponse(request.id, {
        operationId: 'smoke-1',
        runtimeGeneration: 'generation-1',
        state: 'completed',
      }),
      {
        sender: {
          id: 'test-extension',
          url: OFFSCREEN_TEST_URL,
          documentId: OFFSCREEN_TEST_COMPACT_DOCUMENT_ID.toLowerCase(),
        },
        contexts: [
          createOffscreenExtensionContext({
            documentId: OFFSCREEN_TEST_COMPACT_DOCUMENT_ID,
          }),
        ],
      },
    );

    await expect(
      harness.bridge.queryHttpSmokeOperation('smoke-1', 'generation-1'),
    ).resolves.toBeNull();
    expect(harness.ports[0]?.requests).toHaveLength(0);
    expect(harness.ports[0]?.isDisconnected()).toBe(true);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['malformed', 'not-a-document-id'],
    ['whitespace-containing', ' BC27AD52A2703D75D5B54770A8DD2726'],
    ['partial', 'BC27AD52A2703D75D5B54770A8DD272'],
    ['non-hexadecimal', 'BC27AD52A2703D75D5B54770A8DD272G'],
    ['extra hyphen', 'BC27AD52A270-3D75D5B54770A8DD2726'],
  ])('rejects a %s active context document ID', async (_label, documentId) => {
    const context = createOffscreenExtensionContext();
    if (documentId === undefined) {
      delete context.documentId;
    } else {
      context.documentId = documentId;
    }
    const harness = createOffscreenBridgeTestHarness(
      async (request) => okResponse(request.id, {
        operationId: 'smoke-1',
        runtimeGeneration: 'generation-1',
        state: 'completed',
      }),
      {
        contexts: [context],
      },
    );

    await expect(
      harness.bridge.queryHttpSmokeOperation('smoke-1', 'generation-1'),
    ).resolves.toBeNull();
    expect(harness.ports[0]?.requests).toHaveLength(0);
    expect(harness.ports[0]?.isDisconnected()).toBe(true);
  });

  it.each([
    ['different document ID', [
      createOffscreenExtensionContext({
        documentId: '223e4567-e89b-12d3-a456-426614174000',
      }),
    ]],
    ['wrong context type', [
      createOffscreenExtensionContext({ contextType: 'TAB' }),
    ]],
    ['wrong context URL', [
      createOffscreenExtensionContext({
        documentUrl: 'chrome-extension://test-extension/other.html',
      }),
    ]],
    ['no matching context', []],
    ['ambiguous matching contexts', [
      createOffscreenExtensionContext(),
      createOffscreenExtensionContext({
        contextId: 'second-offscreen-context',
        documentId: '223e4567-e89b-12d3-a456-426614174000',
      }),
    ]],
  ])('rejects a sender when getContexts reports %s', async (_label, contexts) => {
    const harness = createOffscreenBridgeTestHarness(
      async (request) => okResponse(request.id, {
        operationId: 'smoke-1',
        runtimeGeneration: 'generation-1',
        state: 'completed',
      }),
      { contexts },
    );

    await expect(
      harness.bridge.queryHttpSmokeOperation('smoke-1', 'generation-1'),
    ).resolves.toBeNull();
    expect(harness.ports[0]?.requests).toHaveLength(0);
  });

  it.each([
    ['API unavailable', { getContextsAvailable: false }],
    ['API rejects', { getContexts: async () => { throw new Error('contexts unavailable'); } }],
  ])('fails closed when the contexts API is %s', async (_label, options) => {
    const harness = createOffscreenBridgeTestHarness(
      async (request) => okResponse(request.id, {
        operationId: 'smoke-1',
        runtimeGeneration: 'generation-1',
        state: 'completed',
      }),
      options,
    );

    await expect(
      harness.bridge.queryHttpSmokeOperation('smoke-1', 'generation-1'),
    ).resolves.toBeNull();
    expect(harness.ports[0]?.requests).toHaveLength(0);
  });

  it('does not let a rejected candidate replace the current authenticated port', async () => {
    const harness = createOffscreenBridgeTestHarness(async (request) =>
      okResponse(request.id, {
        operationId: 'smoke-1',
        runtimeGeneration: 'generation-1',
        state: 'completed',
      }));
    const activePort = harness.ports[0]!;
    await expect(
      harness.bridge.queryHttpSmokeOperation('smoke-1', 'generation-1'),
    ).resolves.toMatchObject({ state: 'completed' });
    const rejectedCandidate = harness.connectPort({
      sender: {
        id: 'test-extension',
        url: OFFSCREEN_TEST_URL,
        documentId: '223e4567-e89b-12d3-a456-426614174000',
      },
    });
    await vi.waitFor(() => expect(rejectedCandidate.isDisconnected()).toBe(true));
    const status = await harness.bridge.queryHttpSmokeOperation('smoke-1', 'generation-1');
    expect(status?.state).toBe('completed');
    expect(activePort.isDisconnected()).toBe(false);
    expect(rejectedCandidate.requests).toHaveLength(0);
  });

  it('does not accept a port disconnected while its active context is being checked', async () => {
    let releaseContextCheck: ((contexts: chrome.runtime.ExtensionContext[]) => void) | undefined;
    const harness = createOffscreenBridgeTestHarness(
      async (request) => okResponse(request.id, {
        operationId: 'smoke-1',
        runtimeGeneration: 'generation-1',
        state: 'completed',
      }),
      {
        autoConnect: false,
        getContexts: () => new Promise((resolve) => {
          releaseContextCheck = resolve;
        }),
      },
    );
    const candidate = harness.connectPort();
    await vi.waitFor(() => expect(releaseContextCheck).toBeTypeOf('function'));
    candidate.disconnect();
    releaseContextCheck?.([createOffscreenExtensionContext()]);

    await expect(
      harness.bridge.queryHttpSmokeOperation('smoke-1', 'generation-1'),
    ).resolves.toBeNull();
    expect(candidate.isDisconnected()).toBe(true);
    expect(candidate.requests).toHaveLength(0);
  });

  it('uses the latest concurrently authenticated candidate and discards stale checks', async () => {
    const firstDocumentId = OFFSCREEN_TEST_DOCUMENT_ID;
    const secondDocumentId = '223e4567-e89b-12d3-a456-426614174000';
    let releaseFirstCheck: ((contexts: chrome.runtime.ExtensionContext[]) => void) | undefined;
    let contextCalls = 0;
    const harness = createOffscreenBridgeTestHarness(async (request) =>
      okResponse(request.id, {
        operationId: 'smoke-1',
        runtimeGeneration: 'generation-1',
        state: 'completed',
      }), {
      autoConnect: false,
      getContexts: () => {
        contextCalls += 1;
        if (contextCalls === 1) {
          return new Promise((resolve) => {
            releaseFirstCheck = resolve;
          });
        }
        return Promise.resolve([
          createOffscreenExtensionContext({ documentId: secondDocumentId }),
        ]);
      },
    });
    const firstCandidate = harness.connectPort();
    const secondCandidate = harness.connectPort({
      sender: {
        id: 'test-extension',
        url: OFFSCREEN_TEST_URL,
        documentId: secondDocumentId,
      },
    });
    const statusPromise = harness.bridge.queryHttpSmokeOperation(
      'smoke-1',
      'generation-1',
    );
    const status = await statusPromise;
    releaseFirstCheck?.([
      createOffscreenExtensionContext({ documentId: firstDocumentId }),
    ]);
    await vi.waitFor(() => expect(firstCandidate.isDisconnected()).toBe(true));

    expect(status?.state).toBe('completed');
    expect(firstCandidate.requests).toHaveLength(0);
    expect(secondCandidate.requests).toHaveLength(1);
  });
});

describe('OffscreenMixFetchBridge IPC response validation', () => {
  it.each([
    ['boolean true', true, true],
    ['boolean false', false, false],
    ['string', 'true', false],
    ['number', 1, false],
    ['object', {}, false],
    ['null', null, false],
  ])('accepts only a valid boolean ok value (%s)', async (_label, ok, authoritative) => {
    const harness = createOffscreenBridgeTestHarness(async (request) => ({
      channel: NYM_OFFSCREEN_CHANNEL,
      id: request.id,
      ok,
      ...(ok === true
        ? {
            payload: {
              operationId: 'smoke-1',
              runtimeGeneration: 'generation-1',
              state: 'completed',
            },
          }
        : { error: { code: 'RUNTIME_UNAVAILABLE', message: 'not available' } }),
    }));

    const status = await harness.bridge.queryHttpSmokeOperation('smoke-1', 'generation-1');
    if (authoritative) {
      expect(status?.state).toBe('completed');
      expect(isAuthoritativeHttpSmokeStatus(status!)).toBe(true);
    } else {
      expect(status).toBeNull();
      expect(isAuthoritativeHttpSmokeStatus({
        operationId: 'smoke-1',
        runtimeGeneration: 'generation-1',
        state: 'completed',
      })).toBe(false);
    }
  });

  it('rejects malformed success and error response schemas', async () => {
    const harness = createOffscreenBridgeTestHarness(async (request) => ({
      channel: NYM_OFFSCREEN_CHANNEL,
      id: request.id,
      ok: true,
      error: { code: 'RUNTIME_UNAVAILABLE', message: 'invalid success shape' },
      payload: {
        operationId: 'smoke-1',
        runtimeGeneration: 'generation-1',
        state: 'completed',
      },
    }));
    await expect(
      harness.bridge.queryHttpSmokeOperation('smoke-1', 'generation-1'),
    ).resolves.toBeNull();
  });
});

describe('OffscreenMixFetchBridge port lifecycle', () => {
  it('rejects pending requests before replacing a port and ignores its late response', async () => {
    let firstResponse: ((response: unknown) => void) | undefined;
    const harness = createOffscreenBridgeTestHarness((request) => {
      if (request.type === 'httpSmokeStatus' && request.operationId === 'first') {
        return new Promise((resolve) => {
          firstResponse = resolve;
        });
      }
      return Promise.resolve(okResponse(request.id, {
        operationId: 'second',
        runtimeGeneration: 'generation-1',
        state: 'completed',
      }));
    });
    const oldPort = harness.ports[0]!;
    const firstQuery = harness.bridge.queryHttpSmokeOperation('first', 'generation-1');
    await vi.waitFor(() => expect(oldPort.requests).toHaveLength(1));

    const newPort = harness.connectPort();
    const wrongNamePort = harness.connectPort({ name: 'not-the-offscreen-port' });
    await expect(firstQuery).resolves.toBeNull();
    oldPort.deliver(okResponse(oldPort.requests[0]!.id, {
      operationId: 'first',
      runtimeGeneration: 'generation-1',
      state: 'completed',
    }));

    const secondStatus = await harness.bridge.queryHttpSmokeOperation('second', 'generation-1');
    expect(secondStatus?.operationId).toBe('second');
    expect(newPort.requests).toHaveLength(1);
    expect(wrongNamePort.requests).toHaveLength(0);
    expect(isAuthoritativeHttpSmokeStatus(secondStatus!)).toBe(true);
    firstResponse?.(okResponse(oldPort.requests[0]!.id, {
      operationId: 'first',
      runtimeGeneration: 'generation-1',
      state: 'completed',
    }));
    oldPort.deliverDisconnect();
    expect(harness.ports).toContain(newPort);
    const afterOldDisconnect = await harness.bridge.queryHttpSmokeOperation(
      'second',
      'generation-1',
    );
    expect(afterOldDisconnect?.operationId).toBe('second');
    expect(isAuthoritativeHttpSmokeStatus({
      operationId: 'first',
      runtimeGeneration: 'generation-1',
      state: 'completed',
    })).toBe(false);
  });

  it('rejects pending requests on disconnect and does not authorize queued late delivery', async () => {
    const harness = createOffscreenBridgeTestHarness(
      () => new Promise(() => undefined),
    );
    const port = harness.ports[0]!;
    const pending = harness.bridge.queryHttpSmokeOperation('smoke-1', 'generation-1');
    await vi.waitFor(() => expect(port.requests).toHaveLength(1));
    port.disconnect();

    await expect(pending).resolves.toBeNull();
    port.deliver(okResponse(port.requests[0]!.id, {
      operationId: 'smoke-1',
      runtimeGeneration: 'generation-1',
      state: 'completed',
    }));
    expect(isAuthoritativeHttpSmokeStatus({
      operationId: 'smoke-1',
      runtimeGeneration: 'generation-1',
      state: 'completed',
    })).toBe(false);
  });

  it('times out a silent RPC, ignores its late response, and clears a completed RPC timer', async () => {
    const harness = createOffscreenBridgeTestHarness(
      () => new Promise(() => undefined),
      { rpcTimeoutMs: 20 },
    );
    const port = harness.ports[0]!;
    const request: NymOffscreenRequest = {
      channel: NYM_OFFSCREEN_CHANNEL,
      target: 'nym-runtime',
      type: 'httpSmokeStatus',
      id: 'timeout-request',
      operationId: 'timed-out',
      runtimeGeneration: 'generation-1',
    };
    const rpc = (harness.bridge as unknown as {
      rpc: (rpcRequest: NymOffscreenRequest) => Promise<NymOffscreenResponse>;
    }).rpc.bind(harness.bridge);
    const timedOut = rpc(request);
    const timeoutAssertion = expect(timedOut).rejects.toMatchObject({
      code: 'NYM_OFFSCREEN_RPC_TIMEOUT',
    });
    await vi.waitFor(() => expect(port.requests).toHaveLength(1));
    await timeoutAssertion;
    const lateStatus = harness.bridge.queryHttpSmokeOperation('timed-out', 'generation-1');
    const lateStatusAssertion = expect(lateStatus).resolves.toBeNull();
    await vi.waitFor(() => expect(port.requests).toHaveLength(2));
    await lateStatusAssertion;
    expect(isAuthoritativeHttpSmokeStatus({
      operationId: 'timed-out',
      runtimeGeneration: 'generation-1',
      state: 'completed',
    })).toBe(false);

    const completedHarness = createOffscreenBridgeTestHarness(
      async (request) => okResponse(request.id, {
        operationId: 'completed',
        runtimeGeneration: 'generation-1',
        state: 'completed',
      }),
      { rpcTimeoutMs: 20 },
    );
    const completed = await completedHarness.bridge.queryHttpSmokeOperation(
      'completed',
      'generation-1',
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(completed?.state).toBe('completed');
    expect(isAuthoritativeHttpSmokeStatus(completed!)).toBe(true);
  });

  it('correlates simultaneous RPCs and ignores duplicate responses', async () => {
    const harness = createOffscreenBridgeTestHarness(async (request) =>
      okResponse(request.id, {
        operationId: request.type === 'httpSmokeStatus' ? request.operationId : '',
        runtimeGeneration: request.type === 'httpSmokeStatus'
          ? request.runtimeGeneration
          : '',
        state: 'completed',
      }));
    const port = harness.ports[0]!;
    const results = await Promise.all([
      harness.bridge.queryHttpSmokeOperation('operation-a', 'generation-a'),
      harness.bridge.queryHttpSmokeOperation('operation-b', 'generation-b'),
    ]);

    expect(results.map((result) => result?.operationId)).toEqual([
      'operation-a',
      'operation-b',
    ]);
    expect(port.requests).toHaveLength(2);
    port.deliver(okResponse(port.requests[0]!.id, {
      operationId: 'operation-a',
      runtimeGeneration: 'generation-a',
      state: 'failed',
    }));
    expect(results.every((result) => isAuthoritativeHttpSmokeStatus(result!))).toBe(true);
  });
});

describe('OffscreenMixFetchBridge readiness deadline', () => {
  it('bounds document creation by one readiness deadline without claiming setup', async () => {
    const harness = createOffscreenBridgeTestHarness(
      async (request) => okResponse(request.id, { pong: true, documentReady: true }),
      {
        documentOpen: false,
        readinessTimeoutMs: 20,
        createDocument: () => new Promise(() => undefined),
      },
    );
    const startedAt = Date.now();

    await expect(harness.bridge.setup()).rejects.toMatchObject({
      code: 'NYM_OFFSCREEN_READINESS_TIMEOUT',
    });

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(harness.bridge.setupComplete).toBe(false);
    expect(isAuthoritativeHttpSmokeStatus({
      operationId: 'unresolved',
      runtimeGeneration: 'generation-1',
      state: 'completed',
    })).toBe(false);
  });

  it('expires while waiting for an authenticated port and cleans the port waiter', async () => {
    const harness = createOffscreenBridgeTestHarness(
      async (request) => okResponse(
        request.id,
        request.type === 'httpSmokeStatus'
          ? {
              operationId: request.operationId,
              runtimeGeneration: request.runtimeGeneration,
              state: 'completed',
            }
          : { pong: true, documentReady: true },
      ),
      {
        autoConnect: false,
        readinessTimeoutMs: 30,
      },
    );
    const startedAt = Date.now();

    await expect(harness.bridge.setup()).rejects.toMatchObject({
      code: 'NYM_OFFSCREEN_READINESS_TIMEOUT',
    });

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(harness.bridge.setupComplete).toBe(false);
    harness.connectPort();
    await expect(
      harness.bridge.queryHttpSmokeOperation('smoke-1', 'generation-1'),
    ).resolves.toMatchObject({ state: 'completed' });
  });

  it('uses the same deadline for silent ping RPCs and does not reset it per retry', async () => {
    const silentHarness = createOffscreenBridgeTestHarness(
      () => new Promise(() => undefined),
      { readinessTimeoutMs: 30 },
    );
    const silentStartedAt = Date.now();
    await expect(silentHarness.bridge.setup()).rejects.toMatchObject({
      code: 'NYM_OFFSCREEN_READINESS_TIMEOUT',
    });
    expect(Date.now() - silentStartedAt).toBeLessThan(500);
    expect(silentHarness.ports[0]?.requests.filter((request) => request.type === 'ping'))
      .toHaveLength(1);
    expect(silentHarness.bridge.setupComplete).toBe(false);

    let pingCount = 0;
    const retryHarness = createOffscreenBridgeTestHarness(async (request) => {
      if (request.type === 'ping') {
        pingCount += 1;
        return errResponse(request.id, 'RUNTIME_UNAVAILABLE', 'not ready yet');
      }
      return errResponse(request.id, 'RUNTIME_UNAVAILABLE', 'unexpected request');
    }, { readinessTimeoutMs: 30 });
    const retryStartedAt = Date.now();
    await expect(retryHarness.bridge.setup()).rejects.toMatchObject({
      code: 'NYM_OFFSCREEN_READINESS_TIMEOUT',
    });
    expect(Date.now() - retryStartedAt).toBeLessThan(500);
    expect(pingCount).toBeLessThan(3);
    expect(retryHarness.bridge.setupComplete).toBe(false);
  });

  it('carries the same deadline through the controller readiness status check', async () => {
    const harness = createOffscreenBridgeTestHarness(async (request) => {
      if (request.type === 'ping') {
        return okResponse(request.id, { pong: true, documentReady: true });
      }
      if (request.type === 'connect') {
        return okResponse(request.id, {
          state: 'connected',
          connected: true,
          lastError: null,
          diagnosticCode: 'OK',
          implementation: 'mix-fetch-offscreen',
          documentReady: true,
          assetsReady: true,
          gatewayAllowlistConfigured: true,
          runtimeGeneration: 'generation-1',
        });
      }
      if (request.type === 'status') return new Promise(() => undefined);
      return errResponse(request.id, 'RUNTIME_UNAVAILABLE', 'unexpected request');
    }, { readinessTimeoutMs: 100, rpcTimeoutMs: 500 });

    await harness.bridge.setup();
    const startedAt = Date.now();
    await expect(harness.bridge.queryStatus()).resolves.toBeNull();

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(harness.bridge.setupComplete).toBe(false);
  });
});

describe('MixFetchNymTransport + FailClosed via offscreen bridge', () => {
  it('no clearnet fallback on request failure', async () => {
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

    const bridge = createOffscreenBridgeHarness(sendMessage);
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
    const bridge = createOffscreenBridgeHarness(async () => {
      throw new Error('should not send');
    }, { documentOpen: false });
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
