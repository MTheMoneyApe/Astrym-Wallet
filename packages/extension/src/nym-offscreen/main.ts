/**
 * Offscreen document entry — hosts official Nym mix-fetch.
 * Only chrome.runtime messaging is used (MV3 offscreen constraint).
 */

import { classifyNymFailure } from './diagnostics.js';
import { NymOffscreenRuntime } from './runtime.js';
import {
  NYM_OFFSCREEN_LIFELINE,
  isNymOffscreenRequest,
  nymOffscreenError,
  nymOffscreenOk,
  type NymOffscreenResponse,
} from './protocol.js';

const runtime = new NymOffscreenRuntime();

if (typeof chrome !== 'undefined' && typeof chrome.runtime?.connect === 'function') {
  try {
    chrome.runtime.connect({ name: NYM_OFFSCREEN_LIFELINE });
  } catch {
    /* RPC still works if the lifeline port cannot be opened. */
  }
}

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
        const status = await runtime.disconnect();
        return nymOffscreenOk(requestId, status);
      }
      case 'fetch': {
        const result = await runtime.performProtectedRequest(raw.url, raw.init);
        return nymOffscreenOk(requestId, result);
      }
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;
  if ((message as { channel?: unknown }).channel !== 'nym-offscreen') return false;
  if ((message as { target?: unknown }).target !== 'nym-runtime') return false;
  // Same-extension only: reject foreign senders. Content scripts share runtime.id
  // but should not drive MixFetch; require missing URL (SW) or extension-page URL.
  if (!sender?.id || sender.id !== chrome.runtime.id) return false;
  if (sender.url) {
    const prefix = `chrome-extension://${chrome.runtime.id}/`;
    if (!sender.url.startsWith(prefix)) return false;
  }

  void handleMessage(message).then((response) => {
    sendResponse(response);
  });
  return true;
});
