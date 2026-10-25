import { isJsonRpcPayload } from '@solana/kit';
import { ALLOWED_METHOD_SET, RpcMethodNotAllowedError, RpcTimeoutError, DEFAULT_RPC_TIMEOUT_MS } from '@solanym/wallet-core/src/solana/transport/HttpTransport.js';
import type { DevnetRpcTransport } from '@solanym/wallet-core/src/solana/transport/ITransport.js';
import { NetworkConfigError, resolveNetworkConfig, type NetworkConfig } from '@solanym/wallet-core/src/solana/rpc/endpoints.js';

let creatingPromise: Promise<void> | null = null;
const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';

async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
  });

  if (existingContexts.length > 0) {
    return;
  }

  if (creatingPromise) {
    await creatingPromise;
    return;
  }

  creatingPromise = chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: 'Run Nym mix-fetch and WSS Mixnet connection persistently without SW interruption'
  });

  try {
    await creatingPromise;
  } finally {
    creatingPromise = null;
  }
}

export function createOffscreenNymTransport(config: NetworkConfig, options: { timeoutMs?: number } = {}): DevnetRpcTransport {
  if (config.network !== 'devnet') {
    throw new NetworkConfigError('network must be devnet');
  }
  const validated = resolveNetworkConfig(config.rpcUrl);
  const timeoutMs = options.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;

  const guarded = async <TResponse>({ payload, signal }: any) => {
    // 1. Allowlist
    if (!isJsonRpcPayload(payload) || !ALLOWED_METHOD_SET.has(payload.method)) {
      throw new RpcMethodNotAllowedError();
    }

    // 2. Offscreen document
    await ensureOffscreenDocument();

    // 3. Timeout composition
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const combinedSignal = signal ? AbortSignal.any([timeoutSignal, signal]) : timeoutSignal;

    if (combinedSignal.aborted) {
      throw combinedSignal.reason;
    }

    // 4. Send message to offscreen
    return new Promise<TResponse>((resolve, reject) => {
      combinedSignal.addEventListener('abort', () => {
        if (timeoutSignal.aborted && !(signal?.aborted ?? false)) {
          reject(new RpcTimeoutError(timeoutMs));
        } else {
          reject(combinedSignal.reason);
        }
      });

      chrome.runtime.sendMessage(
        {
          target: 'offscreen-nym',
          type: 'NYM_RPC_REQUEST',
          data: {
            rpcUrl: validated.rpcUrl,
            payload,
            timeoutMs
          }
        },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response) {
            reject(new Error('No response from offscreen document'));
            return;
          }
          if (response.success) {
            resolve(response.data as TResponse);
          } else {
            reject(new Error(response.error));
          }
        }
      );
    });
  };

  return guarded as DevnetRpcTransport;
}
