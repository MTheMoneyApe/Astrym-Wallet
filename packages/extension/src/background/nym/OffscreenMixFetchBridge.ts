/**
 * NymMixFetchBridge over chrome.runtime ↔ offscreen document.
 * Never uses clearnet fetch; never reports setup success without offscreen ack.
 */

import type {
  NymMixFetchBridge,
  NymMixFetchSetupOptions,
} from '@solanym/wallet-core/src/nym/NymMixFetchBridge.js';
import {
  NYM_OFFSCREEN_CHANNEL,
  NYM_OFFSCREEN_TARGET,
  isNymOffscreenChannelMessage,
  type NymOffscreenFetchResult,
  type NymOffscreenRequest,
  type NymOffscreenResponse,
  type NymOffscreenStatusPayload,
} from '../../nym-offscreen/protocol.js';
import type { OffscreenDocumentManager } from './OffscreenDocumentManager.js';

function newId(): string {
  return `nym-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function base64ToBytes(b64: string): Uint8Array {
  if (!b64) return new Uint8Array(0);
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function headersFromInit(init?: RequestInit): Record<string, string> | undefined {
  if (!init?.headers) return undefined;
  if (init.headers instanceof Headers) {
    const out: Record<string, string> = {};
    init.headers.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }
  if (Array.isArray(init.headers)) {
    return Object.fromEntries(init.headers);
  }
  return { ...init.headers };
}

async function bodyToText(body: BodyInit | null | undefined): Promise<string | null> {
  if (body == null) return null;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) {
    return new TextDecoder().decode(body);
  }
  if (ArrayBuffer.isView(body)) {
    return new TextDecoder().decode(body as ArrayBufferView);
  }
  // Blob / FormData / ReadableStream are unsupported over this IPC slice
  throw new Error('Unsupported request body type for Nym offscreen fetch IPC');
}

export type RuntimeMessenger = {
  sendMessage: (message: NymOffscreenRequest) => Promise<unknown>;
};

function defaultMessenger(): RuntimeMessenger {
  return {
    sendMessage: (message) => {
      if (typeof chrome === 'undefined' || !chrome?.runtime?.sendMessage) {
        return Promise.reject(new Error('chrome.runtime unavailable'));
      }
      return chrome.runtime.sendMessage(message);
    },
  };
}

export type OffscreenReadyWaitOptions = {
  attempts?: number;
  delayMs?: number;
};

export class OffscreenMixFetchBridge implements NymMixFetchBridge {
  private _setupComplete = false;

  constructor(
    private readonly _docs: OffscreenDocumentManager,
    private readonly _messenger: RuntimeMessenger = defaultMessenger(),
    private readonly _readyWait: OffscreenReadyWaitOptions = {},
  ) {}

  get setupComplete(): boolean {
    return this._setupComplete;
  }

  private async rpc(request: NymOffscreenRequest): Promise<NymOffscreenResponse> {
    let raw: unknown;
    try {
      raw = await this._messenger.sendMessage(request);
    } catch (cause) {
      throw new Error(
        cause instanceof Error
          ? `Nym offscreen IPC failed: ${cause.message}`
          : 'Nym offscreen IPC failed',
      );
    }

    if (!isNymOffscreenChannelMessage(raw) || !raw || typeof raw !== 'object') {
      throw new Error('Nym offscreen IPC returned malformed response');
    }
    const res = raw as NymOffscreenResponse;
    if (!('ok' in res)) {
      throw new Error('Nym offscreen IPC response missing ok flag');
    }
    return res;
  }

  /**
   * createDocument resolves before the offscreen module registers onMessage.
   * Retry ping until the runtime answers (document open ≠ MixFetch ready).
   */
  private async waitUntilRuntimeReady(options?: OffscreenReadyWaitOptions): Promise<void> {
    const attempts = options?.attempts ?? this._readyWait.attempts ?? 40;
    const delayMs = options?.delayMs ?? this._readyWait.delayMs ?? 50;
    let lastError: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        const ping = await this.rpc({
          channel: NYM_OFFSCREEN_CHANNEL,
          target: NYM_OFFSCREEN_TARGET,
          type: 'ping',
          id: newId(),
        });
        if (ping.ok) return;
        lastError = new Error(ping.error.message);
      } catch (cause) {
        lastError = cause;
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
    throw Object.assign(
      new Error(
        lastError instanceof Error
          ? `Offscreen Nym runtime not ready after createDocument: ${lastError.message}`
          : 'Offscreen Nym runtime not ready after createDocument',
      ),
      { code: 'RUNTIME_UNAVAILABLE', stage: 'ipc' },
    );
  }

  async setup(options?: NymMixFetchSetupOptions): Promise<void> {
    this._setupComplete = false;
    if (!this._docs.isApiAvailable()) {
      throw new Error('chrome.offscreen unavailable; cannot host Nym mix-fetch');
    }
    await this._docs.ensureDocument();
    await this.waitUntilRuntimeReady();

    const connectOptions: {
      disableCoverTraffic?: boolean;
      preferredGateway?: string;
      gatewayAllowlist?: string[];
      forceTls?: boolean;
    } = {
      // Official MixFetchOpts — browser clients use TLS/WSS to entry gateways.
      forceTls: true,
    };
    if (options?.disableCoverTraffic !== undefined) {
      connectOptions.disableCoverTraffic = Boolean(options.disableCoverTraffic);
    }
    if (typeof options?.preferredGateway === 'string' && options.preferredGateway) {
      connectOptions.preferredGateway = options.preferredGateway;
    }
    if (Array.isArray(options?.gatewayAllowlist)) {
      connectOptions.gatewayAllowlist = options.gatewayAllowlist.filter(
        (x): x is string => typeof x === 'string',
      );
    }
    if (options?.forceTls !== undefined) {
      connectOptions.forceTls = Boolean(options.forceTls);
    }
    const connectReq = {
      channel: NYM_OFFSCREEN_CHANNEL,
      target: NYM_OFFSCREEN_TARGET,
      type: 'connect' as const,
      id: newId(),
      options: connectOptions,
    };
    const connect = await this.rpc(connectReq);
    if (!connect.ok) {
      throw Object.assign(new Error(connect.error.message), {
        code: connect.error.code,
        stage: connect.error.stage,
      });
    }
    const status = connect.payload as NymOffscreenStatusPayload;
    if (!status.connected) {
      throw new Error(
        status.lastError ?? 'Offscreen connect returned without connected=true',
      );
    }
    this._setupComplete = true;
  }

  async mixFetch(url: string, init?: RequestInit): Promise<Response> {
    if (!this._setupComplete) {
      throw new Error('Nym offscreen bridge not set up');
    }
    const bodyText = await bodyToText(init?.body ?? null);
    const fetchInit: {
      method?: string;
      headers?: Record<string, string>;
      bodyText?: string | null;
      mode?: string;
    } = { bodyText };
    if (init?.method) fetchInit.method = init.method;
    const headers = headersFromInit(init);
    if (headers) fetchInit.headers = headers;
    // Forward mix-fetch@1.4.2 CORS opt-out (not a clearnet bypass).
    const initMode = (init as RequestInit & { mode?: string } | undefined)?.mode;
    if (typeof initMode === 'string' && initMode.length > 0) {
      fetchInit.mode = initMode;
    }
    const res = await this.rpc({
      channel: NYM_OFFSCREEN_CHANNEL,
      target: NYM_OFFSCREEN_TARGET,
      type: 'fetch',
      id: newId(),
      url,
      init: fetchInit,
    });
    if (!res.ok) {
      throw new Error(res.error.message);
    }
    const payload = res.payload as NymOffscreenFetchResult;
    const bytes = base64ToBytes(payload.bodyBase64);
    const body = new Uint8Array(bytes.byteLength);
    body.set(bytes);
    return new Response(body, {
      status: payload.status,
      statusText: payload.statusText,
      headers: payload.headers,
    });
  }

  async disconnect(): Promise<void> {
    this._setupComplete = false;
    try {
      if (this._docs.isApiAvailable()) {
        await this.rpc({
          channel: NYM_OFFSCREEN_CHANNEL,
          target: NYM_OFFSCREEN_TARGET,
          type: 'disconnect',
          id: newId(),
        });
      }
    } catch {
      /* IPC loss → still mark disconnected */
    }
    await this._docs.closeDocument();
  }

  async queryStatus(): Promise<NymOffscreenStatusPayload | null> {
    try {
      await this._docs.ensureDocument();
      // Same race as setup(): createDocument ≠ listener registered.
      await this.waitUntilRuntimeReady();
      const res = await this.rpc({
        channel: NYM_OFFSCREEN_CHANNEL,
        target: NYM_OFFSCREEN_TARGET,
        type: 'status',
        id: newId(),
      });
      if (!res.ok) return null;
      return res.payload as NymOffscreenStatusPayload;
    } catch {
      return null;
    }
  }
}
