/**
 * Temporarily route same-origin Soroban RPC fetch through the SW Nym transport.
 * Fail-closed: non-Soroban origins keep the previous fetch; Nym failures propagate.
 */

import {
  SPP_HOST_BRIDGE_CHANNEL,
  parseSppHostNymFetchResult,
  type SppHostNymFetchRequest,
} from '../shared/sppHostBridge.js';

export type SppHostNymFetchSender = (message: SppHostNymFetchRequest) => Promise<unknown>;

async function defaultSend(message: SppHostNymFetchRequest): Promise<unknown> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    throw new Error('chrome.runtime.sendMessage unavailable for SPP Nym fetch proxy');
  }
  return chrome.runtime.sendMessage(message);
}

function asUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function sameOrigin(url: string, rpcUrl: string): boolean {
  return new URL(url).origin === new URL(rpcUrl).origin;
}

/**
 * Run `fn` while same-origin Soroban requests use the SW Nym fetch proxy.
 * Restores globalThis.fetch in finally. Does not mutate fetch for other origins.
 */
export async function withSppHostNymFetchProxy<T>(
  rpcUrl: string,
  fn: () => Promise<T>,
  send: SppHostNymFetchSender = defaultSend,
): Promise<T> {
  const previous = globalThis.fetch;
  const routed: typeof fetch = async (input, init) => {
    const url = asUrl(input);
    if (!sameOrigin(url, rpcUrl)) {
      return previous.call(globalThis, input, init);
    }
    const id = crypto.randomUUID();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = new Headers(init.headers);
      h.forEach((value, key) => {
        headers[key] = value;
      });
    }
    let body: string | undefined;
    if (init?.body != null && typeof init.body === 'string') {
      body = init.body;
    } else if (init?.body != null) {
      throw new Error('SPP Nym fetch proxy only supports string bodies from the host page');
    }
    const request: SppHostNymFetchRequest = {
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_NYM_FETCH',
      id,
      payload: {
        rpcUrl,
        url,
        method: (init?.method ?? 'GET').toUpperCase(),
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
        ...(body !== undefined ? { body } : {}),
      },
    };
    const raw = await send(request);
    const result = parseSppHostNymFetchResult(raw);
    if (!result || result.id !== id) {
      throw new Error('SPP Nym fetch proxy: invalid SW response');
    }
    if (!result.ok) {
      throw new Error(`SPP Nym fetch proxy failed (${result.code}): ${result.message}`);
    }
    return new Response(result.bodyText, {
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
    });
  };

  globalThis.fetch = routed;
  try {
    return await fn();
  } finally {
    globalThis.fetch = previous;
  }
}
