/**
 * MixFetch inside the page (Android browser / installed PWA).
 * No chrome.offscreen document. The same NymOffscreenRuntime loads the
 * packaged WASM siblings from the webapp origin.
 */

import type { NymMixFetchSetupOptions } from '@solanym/wallet-core/src/nym/NymMixFetchBridge.js';
import { NYM_MIXFETCH_DIR } from '../nym-offscreen/assetManifest.js';
import { NymOffscreenRuntime } from '../nym-offscreen/runtime.js';
import type { NymOffscreenStatusPayload } from '../nym-offscreen/protocol.js';
import type { NymSessionBridge } from '../background/nym/NymRuntimeController.js';

function sameOriginAsset(file: string): string {
  const base = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/';
  return new URL(`${NYM_MIXFETCH_DIR}/${file}`, base).href;
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

async function bodyToText(body: BodyInit | null | undefined): Promise<string | null> {
  if (body == null) return null;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body);
  throw new Error('Unsupported request body for in-page MixFetch');
}

function bytesFromBase64(b64: string): Uint8Array {
  if (!b64) return new Uint8Array(0);
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export class InPageMixFetchBridge implements NymSessionBridge {
  private readonly _runtime = new NymOffscreenRuntime(undefined, {
    resolveAssetUrl: sameOriginAsset,
  });

  async setup(options?: NymMixFetchSetupOptions): Promise<void> {
    const connectOptions: {
      preferredGateway?: string;
      gatewayAllowlist?: string[];
      disableCoverTraffic?: boolean;
      forceTls?: boolean;
    } = {};
    if (options?.preferredGateway) connectOptions.preferredGateway = options.preferredGateway;
    if (options?.gatewayAllowlist) connectOptions.gatewayAllowlist = options.gatewayAllowlist;
    if (options?.disableCoverTraffic !== undefined) {
      connectOptions.disableCoverTraffic = options.disableCoverTraffic;
    }
    if (options?.forceTls !== undefined) connectOptions.forceTls = options.forceTls;
    await this._runtime.connect(connectOptions);
  }

  async mixFetch(url: string, init?: RequestInit): Promise<Response> {
    const mode = init && 'mode' in init && typeof init.mode === 'string' ? init.mode : undefined;
    const request: {
      method?: string;
      headers?: Record<string, string>;
      bodyText?: string | null;
      mode?: string;
    } = {};
    if (init?.method) request.method = init.method;
    const headers = headersToRecord(init?.headers);
    if (headers) request.headers = headers;
    const bodyText = await bodyToText(init?.body);
    if (bodyText != null) request.bodyText = bodyText;
    if (mode) request.mode = mode;
    const result = await this._runtime.performProtectedRequest(url, request);
    const bytes = bytesFromBase64(result.bodyBase64);
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return new Response(body as ArrayBuffer, {
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
    });
  }

  async disconnect(): Promise<void> {
    await this._runtime.disconnect();
  }

  async queryStatus(): Promise<NymOffscreenStatusPayload | null> {
    return this._runtime.getStatus();
  }
}
