/**
 * Install spp-host runtime message listeners for the SW bridge.
 * Safe to call once from main.ts after the controller is constructed.
 */

import {
  isSppHostBridgeMessage,
  parseSppHostExecuteRequest,
  type SppHostLifecycleEvent,
} from '../shared/sppHostBridge.js';
import {
  clearSppHostWritePool,
  executeSppHostWritePool,
  setSppHostLifecyclePublisher,
} from './sppHostWritePool.js';

export type SppHostBridgeListenerHandles = {
  dispose: () => void;
};

function publishLifecycleToBackground(event: SppHostLifecycleEvent): void {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      void chrome.runtime.sendMessage(event);
    }
  } catch {
    // Host may outlive the SW briefly; lifecycle is best-effort.
  }
}

/**
 * Listen for execute requests from the SW and publish lifecycle events back.
 * Also clears the write pool when the SW broadcasts a disconnect lifecycle clear
 * is not required here — host clears on its own when told via custom event.
 */
export function installSppHostBridgeListener(): SppHostBridgeListenerHandles {
  setSppHostLifecyclePublisher(publishLifecycleToBackground);

  const onMessage = (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ): boolean => {
    if (!isSppHostBridgeMessage(message)) return false;

    const request = parseSppHostExecuteRequest(message);
    if (!request) return false;

    void executeSppHostWritePool(request)
      .then((result) => sendResponse(result))
      .catch((cause: unknown) => {
        const messageText = cause instanceof Error ? cause.message : 'host execute failed';
        sendResponse({
          channel: request.channel,
          type: 'SPP_HOST_EXECUTE_PRIVATE_PAYMENT_RESULT',
          id: request.id,
          ok: false,
          code: 'EXECUTION_FAILED',
          message: messageText.slice(0, 500),
        });
      });
    // Keep the message channel open for the async response.
    return true;
  };

  const onDisconnectClear = (message: unknown): void => {
    if (!isSppHostBridgeMessage(message)) return;
    const maybe = message as { type?: string; state?: string };
    if (maybe.type === 'SPP_HOST_POOL_LIFECYCLE' && maybe.state === 'cleared') {
      clearSppHostWritePool('background cleared lifecycle');
    }
  };

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener(onMessage);
    chrome.runtime.onMessage.addListener(onDisconnectClear);
  }

  return {
    dispose: () => {
      setSppHostLifecyclePublisher(null);
      if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.removeListener(onMessage);
        chrome.runtime.onMessage.removeListener(onDisconnectClear);
      }
      clearSppHostWritePool('listener disposed');
    },
  };
}
