/**
 * Offscreen document entry — hosts official Nym mix-fetch.
 * A named runtime port lets the background authenticate this document through sender metadata.
 */

import { classifyNymFailure } from './diagnostics.js';
import {
  createOffscreenBridgeReconnectController,
  dispatchOffscreenBridgePortMessage,
  registerOffscreenBridgePagehideHandler,
} from './bridgeReconnect.js';
import { NymOffscreenRuntime } from './runtime.js';
import {
  isNymOffscreenRequest,
  nymOffscreenError,
  nymOffscreenOk,
  NYM_OFFSCREEN_PORT_NAME,
  type NymOffscreenResponse,
} from './protocol.js';

const runtime = new NymOffscreenRuntime();

async function handleMessage(raw: unknown): Promise<NymOffscreenResponse> {
  if (!isNymOffscreenRequest(raw)) {
    const id =
      raw && typeof raw === 'object' && typeof (raw as { id?: unknown }).id === 'string'
        ? (raw as { id: string }).id
        : 'unknown';
    return nymOffscreenError(id, 'INVALID_MESSAGE', 'Invalid Nym offscreen request');
  }

  const requestId = raw.id;
  try {
    switch (raw.type) {
      case 'ping':
        return nymOffscreenOk(requestId, { pong: true, documentReady: true });
      case 'status': {
        // Cheap status; optionally refresh asset probe without connecting.
        if (!runtime.getStatus().assetsReady) {
          await runtime.probePackagedAssets().catch(() => false);
        }
        return nymOffscreenOk(requestId, runtime.getStatus());
      }
      case 'connect': {
        const status = await runtime.connect(raw.options);
        return nymOffscreenOk(requestId, status);
      }
      case 'disconnect': {
        const status =
          raw.strict === undefined
            ? await runtime.disconnect()
            : await runtime.disconnect({ strict: raw.strict });
        return nymOffscreenOk(requestId, status);
      }
      case 'fetch': {
        const result = await runtime.performProtectedRequest(
          raw.url,
          raw.init,
          raw.operationId,
        );
        return nymOffscreenOk(requestId, result);
      }
      case 'httpSmokeStatus':
        return nymOffscreenOk(
          requestId,
          runtime.getHttpSmokeOperationStatus(raw.operationId, raw.runtimeGeneration),
        );
      default:
        return nymOffscreenError(requestId, 'UNSUPPORTED', 'Unsupported Nym offscreen operation');
    }
  } catch (cause) {
    const fallback =
      raw.type === 'connect'
        ? 'CONNECT_FAILED'
        : raw.type === 'fetch'
          ? 'REQUEST_FAILED'
          : 'RUNTIME_UNAVAILABLE';
    const d = classifyNymFailure(cause, fallback);
    return nymOffscreenError(requestId, d.code, d.message, d.stage);
  }
}

const bridgeReconnect = createOffscreenBridgeReconnectController(
  ({ onAuthenticated, onDisconnect }) => {
    try {
      console.info('[Astrym][OffscreenBridge] connect_attempt');
    } catch {
      // Diagnostic logging must not affect Port connection behavior.
    }
    const port = chrome.runtime.connect({ name: NYM_OFFSCREEN_PORT_NAME });
    port.onMessage.addListener((message) => {
      dispatchOffscreenBridgePortMessage(message, onAuthenticated, (request) => {
        void handleMessage(request).then((response) => {
          port.postMessage(response);
        });
      });
    });
    port.onDisconnect.addListener(onDisconnect);
  },
  (lastConnectError) => {
    try {
      console.warn(
        '[Astrym][OffscreenBridge] reconnect_limit_reached',
        lastConnectError,
      );
    } catch {
      // Diagnostic logging must not affect Port lifecycle handling.
    }
  },
);

registerOffscreenBridgePagehideHandler(bridgeReconnect);
bridgeReconnect.start();
