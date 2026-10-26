/**
 * Nym mix-fetch runtime for the offscreen document.
 * Loads the packaged official client; never fabricates connected.
 */

import { toSetupMixFetchOps } from '@solanym/wallet-core/src/nym/MixFetchOpts.js';
import {
  NYM_MIXFETCH_DIR,
  NYM_MIXFETCH_REQUIRED_FILES,
} from './assetManifest.js';
import { classifyNymFailure, type NymDiagnosticCode } from './diagnostics.js';
import { validateGatewayIdentityKey } from './gatewayConfig.js';
import {
  DEFAULT_NYM_NETWORK_ALLOWLIST,
  type NymNetworkAllowlistConfig,
} from './networkAllowlist.js';
import type {
  NymOffscreenConnectOptions,
  NymOffscreenFetchInit,
  NymOffscreenFetchResult,
  NymOffscreenStatusPayload,
  NymOffscreenRuntimeState,
} from './protocol.js';

type MixFetchModule = {
  createMixFetch: (opts?: Record<string, unknown>) => Promise<{
    mixFetch: (url: string, init?: RequestInit) => Promise<Response>;
    disconnectMixFetch: () => Promise<void>;
  }>;
  disconnectMixFetch: () => Promise<void>;
};

/**
 * mix-fetch@1.4.2 ResponseBodyConfigMapDefaults:
 * - JSON patterns are `application/json*` only (NOT `application/hal+json`)
 * - string matches are exact (`===`), so charset suffixes need explicit entries
 * - unmatched Content-Types return `{}` (empty body) — fallback is used ONLY
 *   when Content-Type is missing
 *
 * Horizon replies with `application/hal+json; charset=utf-8` → empty MixFetch
 * body unless HAL (+ charset variants) is registered as uint8array.
 * Prefer plain strings (no RegExp) so Comlink/postMessage never drops the map.
 */
export const NYM_RESPONSE_BODY_CONFIG_FOR_STELLAR = {
  uint8array: [
    'application/octet-stream',
    'application/hal+json',
    'application/hal+json; charset=utf-8',
    'application/hal+json;charset=utf-8',
    'application/json',
    'application/json; charset=utf-8',
    'application/json;charset=utf-8',
  ],
  // Used only when Content-Type is absent; keep bytes-safe for that case.
  fallback: 'uint8array' as const,
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function extensionHttp(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const fn = globalThis.fetch.bind(globalThis);
  return fn(url, init);
}

/**
 * Official mix-fetch keeps a window.__mixFetchGlobal singleton and only runs
 * setupMixFetch on first createMixFetch(). Clearing it after disconnect/failure
 * is required so a later Connect can call createMixFetch + setupMixFetch again.
 */
function clearMixFetchGlobalSingleton(): void {
  if (typeof window === 'undefined') return;
  try {
    const w = window as Window & { __mixFetchGlobal?: unknown };
    w.__mixFetchGlobal = undefined;
    try {
      delete w.__mixFetchGlobal;
    } catch {
      /* ignore non-configurable */
    }
  } catch {
    /* ignore */
  }
}

export class NymOffscreenRuntime {
  private _state: NymOffscreenRuntimeState = 'disconnected';
  private _lastError: string | null = null;
  private _diagnosticCode: NymDiagnosticCode = 'OK';
  private _diagnosticStage: string | null = null;
  private _assetsReady = false;
  private _instance: Awaited<ReturnType<MixFetchModule['createMixFetch']>> | null =
    null;
  private _mod: MixFetchModule | null = null;
  private _allowlist: NymNetworkAllowlistConfig;

  constructor(allowlist: NymNetworkAllowlistConfig = DEFAULT_NYM_NETWORK_ALLOWLIST) {
    this._allowlist = allowlist;
  }

  getStatus(): NymOffscreenStatusPayload {
    return {
      state: this._state,
      connected: this._state === 'connected',
      lastError: this._lastError,
      diagnosticCode: this._diagnosticCode,
      diagnosticStage: this._diagnosticStage,
      implementation: this._mod ? 'mix-fetch-offscreen' : 'unavailable',
      documentReady: true,
      assetsReady: this._assetsReady,
      gatewayAllowlistConfigured: this._allowlist.gatewayOrigins.length > 0,
    };
  }

  private setDiagnostic(cause: unknown, fallback: NymDiagnosticCode): void {
    const d = classifyNymFailure(cause, fallback);
    this._diagnosticCode = d.code;
    this._diagnosticStage = d.stage ?? null;
    this._lastError = d.message;
  }

  /**
   * Verify official sibling assets resolve under nym-mixfetch/ (import.meta.url layout).
   */
  async probePackagedAssets(): Promise<boolean> {
    if (typeof chrome === 'undefined' || !chrome?.runtime?.getURL) {
      this._assetsReady = false;
      this.setDiagnostic(
        Object.assign(new Error('chrome.runtime.getURL unavailable for asset probe'), {
          code: 'ASSET_MISSING',
        }),
        'ASSET_MISSING',
      );
      return false;
    }

    const missing: string[] = [];
    for (const file of NYM_MIXFETCH_REQUIRED_FILES) {
      const url = chrome.runtime.getURL(`${NYM_MIXFETCH_DIR}/${file}`);
      try {
        const res = await extensionHttp(url, { method: 'GET', cache: 'no-store' });
        if (!res.ok) missing.push(file);
      } catch {
        missing.push(file);
      }
    }

    this._assetsReady = missing.length === 0;
    if (!this._assetsReady) {
      this.setDiagnostic(
        Object.assign(
          new Error(
            `Missing nym-mixfetch assets (must be siblings for import.meta.url): ${missing.join(', ')}`,
          ),
          { code: 'ASSET_MISSING' },
        ),
        'ASSET_MISSING',
      );
    }
    return this._assetsReady;
  }

  async ensureModule(): Promise<MixFetchModule> {
    if (this._mod) return this._mod;

    const assetsOk = await this.probePackagedAssets();
    if (!assetsOk) {
      throw Object.assign(new Error(this._lastError ?? 'Nym assets missing'), {
        code: 'ASSET_MISSING',
      });
    }

    const url = chrome.runtime.getURL(`${NYM_MIXFETCH_DIR}/index.js`);
    let mod: MixFetchModule;
    try {
      mod = (await import(/* @vite-ignore */ url)) as MixFetchModule;
    } catch (cause) {
      this._state = 'error';
      this.setDiagnostic(cause, 'MODULE_LOAD_FAILED');
      throw Object.assign(new Error(this._lastError!), { code: this._diagnosticCode });
    }
    if (typeof mod.createMixFetch !== 'function') {
      this._state = 'error';
      this.setDiagnostic(
        Object.assign(new Error('Packaged mix-fetch missing createMixFetch export'), {
          code: 'MODULE_LOAD_FAILED',
        }),
        'MODULE_LOAD_FAILED',
      );
      throw Object.assign(new Error(this._lastError!), { code: 'MODULE_LOAD_FAILED' });
    }
    this._mod = mod;
    this._diagnosticCode = 'OK';
    this._diagnosticStage = null;
    if (this._state !== 'connected') {
      this._lastError = null;
    }
    return mod;
  }

  private _connectInFlight: Promise<NymOffscreenStatusPayload> | null = null;

  async connect(options?: NymOffscreenConnectOptions): Promise<NymOffscreenStatusPayload> {
    if (this._state === 'connected' && this._instance) {
      return this.getStatus();
    }
    if (this._connectInFlight) {
      return this._connectInFlight;
    }
    this._connectInFlight = this.runConnect(options).finally(() => {
      this._connectInFlight = null;
    });
    return this._connectInFlight;
  }

  private async runConnect(
    options?: NymOffscreenConnectOptions,
  ): Promise<NymOffscreenStatusPayload> {
    if (this._state === 'connected' && this._instance) {
      return this.getStatus();
    }
    if (typeof window === 'undefined') {
      this._state = 'error';
      this.setDiagnostic(
        Object.assign(new Error('Nym offscreen runtime requires window'), {
          code: 'INIT_FAILED',
        }),
        'INIT_FAILED',
      );
      throw Object.assign(new Error(this._lastError!), { code: 'INIT_FAILED' });
    }

    if (options?.gatewayAllowlist) {
      this._allowlist = {
        ...this._allowlist,
        gatewayOrigins: [...options.gatewayAllowlist],
      };
    }

    // WSS allowlist is required for MV3 host-permission gating (separate from MixFetch identity).
    if (!this._allowlist.gatewayOrigins.length) {
      this._state = 'error';
      this.setDiagnostic(
        Object.assign(
          new Error(
            'Nym gateway allowlist is empty — configure an exact wss://host:port before connect',
          ),
          { code: 'GATEWAY_ALLOWLIST_EMPTY' },
        ),
        'GATEWAY_ALLOWLIST_EMPTY',
      );
      throw Object.assign(new Error(this._lastError!), {
        code: 'GATEWAY_ALLOWLIST_EMPTY',
      });
    }

    // preferredGateway for mix-fetch@1.4.2 is a base58 identity key, not a WSS URL.
    let preferredIdentity: string | undefined;
    if (options?.preferredGateway) {
      const idResult = validateGatewayIdentityKey(options.preferredGateway);
      if (!idResult.ok) {
        this._state = 'error';
        this.setDiagnostic(
          Object.assign(new Error(idResult.message), { code: idResult.code }),
          'INIT_FAILED',
        );
        throw Object.assign(new Error(this._lastError!), { code: idResult.code });
      }
      preferredIdentity = idResult.identityKey;
    } else {
      this._state = 'error';
      this.setDiagnostic(
        Object.assign(
          new Error(
            'MixFetch preferredGateway identity key is required (base58 node id) — WSS origin alone is not MixFetchOpts.preferredGateway',
          ),
          { code: 'GATEWAY_IDENTITY_REQUIRED' },
        ),
        'INIT_FAILED',
      );
      throw Object.assign(new Error(this._lastError!), {
        code: 'GATEWAY_IDENTITY_REQUIRED',
      });
    }

    this._state = 'connecting';
    this._lastError = null;
    this._diagnosticCode = 'OK';
    this._diagnosticStage = null;

    try {
      const mod = await this.ensureModule();
      // Official MixFetchOpts only — never forward gatewayAllowlist / raw disableCoverTraffic.
      const bridgeOpts: {
        preferredGateway?: string;
        disableCoverTraffic?: boolean;
        forceTls?: boolean;
        mixFetchOverride?: { requestTimeoutMs?: number };
        responseBodyConfigMap?: typeof NYM_RESPONSE_BODY_CONFIG_FOR_STELLAR;
      } = {
        preferredGateway: preferredIdentity,
        forceTls: options?.forceTls !== false,
        // Mixnet RTT often exceeds Go's short default (~5s); public GETs need headroom.
        mixFetchOverride: { requestTimeoutMs: 90_000 },
        // Horizon HAL+JSON must not use blob fallback (empty/hung bodies via MixFetch).
        responseBodyConfigMap: NYM_RESPONSE_BODY_CONFIG_FOR_STELLAR,
      };
      if (options?.disableCoverTraffic !== undefined) {
        bridgeOpts.disableCoverTraffic = options.disableCoverTraffic;
      }
      const setupOpts = toSetupMixFetchOps(bridgeOpts);
      // Stale singleton would skip setupMixFetch — clear before (re)init.
      clearMixFetchGlobalSingleton();
      this._instance = await mod.createMixFetch(setupOpts);
      // connected only after createMixFetch resolves (includes setupMixFetch inside).
      this._state = 'connected';
      this._lastError = null;
      this._diagnosticCode = 'OK';
      this._diagnosticStage = null;
      return this.getStatus();
    } catch (cause) {
      this._instance = null;
      clearMixFetchGlobalSingleton();
      this._state = 'error';
      if (
        cause &&
        typeof cause === 'object' &&
        'code' in cause &&
        typeof (cause as { code: unknown }).code === 'string'
      ) {
        this.setDiagnostic(cause, 'CONNECT_FAILED');
      } else {
        this.setDiagnostic(cause, 'CONNECT_FAILED');
      }
      throw Object.assign(new Error(this._lastError!), { code: this._diagnosticCode });
    }
  }

  async disconnect(): Promise<NymOffscreenStatusPayload> {
    if (this._connectInFlight) {
      try {
        await this._connectInFlight;
      } catch {
        /* still disconnect */
      }
    }
    try {
      if (this._instance && typeof this._instance.disconnectMixFetch === 'function') {
        await this._instance.disconnectMixFetch();
      } else if (this._mod && typeof this._mod.disconnectMixFetch === 'function') {
        await this._mod.disconnectMixFetch();
      }
    } catch (cause) {
      this.setDiagnostic(cause, 'RUNTIME_UNAVAILABLE');
    } finally {
      this._instance = null;
      clearMixFetchGlobalSingleton();
      // Retryable — a later connect() may call createMixFetch again.
      this._state = 'disconnected';
      this._lastError = null;
      this._diagnosticCode = 'OK';
      this._diagnosticStage = null;
    }
    return this.getStatus();
  }

  async performProtectedRequest(
    url: string,
    init?: NymOffscreenFetchInit,
  ): Promise<NymOffscreenFetchResult> {
    if (this._state !== 'connected' || !this._instance) {
      throw Object.assign(
        new Error('Nym mixnet not connected; refusing clearnet fallback'),
        { code: 'NOT_CONNECTED' as const },
      );
    }

    const requestInit: RequestInit & { mode?: string } = {};
    if (init?.method) requestInit.method = init.method;
    if (init?.headers) requestInit.headers = init.headers;
    if (init?.bodyText != null && init.bodyText !== '') {
      requestInit.body = init.bodyText;
    }
    // mix-fetch@1.4.2 Go client applies CORS to Mixnet responses unless opted out.
    if (init?.mode) requestInit.mode = init.mode;

    let response: Response;
    try {
      response = await this._instance.mixFetch(url, requestInit);
    } catch (cause) {
      this.setDiagnostic(cause, 'REQUEST_FAILED');
      throw Object.assign(new Error(this._lastError!), {
        code: this._diagnosticCode,
      });
    }

    const buf = new Uint8Array(await response.arrayBuffer());
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: headersToRecord(response.headers),
      bodyBase64: bytesToBase64(buf),
    };
  }
}
