/**
 * Nym mixnet transport contract for Solanym.
 *
 * HTTP(S) egress uses official `@nymproject/mix-fetch` via {@link MixFetchNymTransport}.
 * Peer messaging SDK (`@nymproject/sdk`) is out of scope for Horizon/Friendbot.
 *
 * Connected=true only after a successful bridge.setup(). Never fabricates Ready.
 * Metadata privacy ≠ Stellar ledger privacy.
 */

import type { NymMixFetchBridge, NymMixFetchSetupOptions } from './NymMixFetchBridge.js';
import { tryLoadOfficialMixFetchBridge } from './NymMixFetchBridge.js';
// NymMixFetchSetupOptions includes official MixFetchOpts + internal-only keys.

export type NymTransportState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'closed';

export type NymTransportConfig = {
  /**
   * MixFetchOpts.preferredGateway identity key (base58).
   * Legacy alias name `gatewayUrl` kept for call sites — value must NOT be a URL.
   */
  gatewayUrl?: string;
  /** Exact operator-configured WSS/HTTPS origins (fail-closed MV3 policy; not MixFetchOpts). */
  gatewayAllowlist?: string[];
  /** Soft deadline for connect(); implementations may ignore. */
  connectTimeoutMs?: number;
  /** Mapped to clientOverride.coverTraffic when supported. */
  disableCoverTraffic?: boolean;
};

export type NymTransportSnapshot = {
  state: NymTransportState;
  lastError: string | null;
  /** True only after a successful connect() on a real implementation. */
  connected: boolean;
  /** Implementation id for UI (e.g. unavailable | mix-fetch). */
  implementation: string;
  /** Self-reported mixnet address when the bridge exposes one (optional). */
  selfAddress?: string | null;
};

export interface NymTransport {
  readonly implementation: string;
  getSnapshot(): NymTransportSnapshot;
  connect(config?: NymTransportConfig): Promise<void>;
  /**
   * Send opaque bytes through the mixnet (messaging path).
   * Mix-fetch HTTP transports may reject this as unsupported.
   */
  send(payload: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

/** HTTP(S) over mixnet (mix-fetch). Fail-closed: never falls back to clearnet. */
export interface NymHttpTransport extends NymTransport {
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

export class NymTransportError extends Error {
  readonly code:
    | 'UNAVAILABLE'
    | 'NOT_CONNECTED'
    | 'CLOSED'
    | 'SEND_FAILED'
    | 'CONNECT_FAILED'
    | 'UNSUPPORTED'
    | 'REQUEST_FAILED';

  constructor(
    code: NymTransportError['code'],
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'NymTransportError';
    this.code = code;
  }
}

/**
 * Placeholder transport: connect/send/fetch always fail; never reports connected.
 */
export class UnavailableNymTransport implements NymHttpTransport {
  readonly implementation = 'unavailable';
  private _state: NymTransportState = 'disconnected';
  private _lastError: string | null =
    'Nym mix-fetch bridge is not available; install @nymproject/mix-fetch for Mixnet HTTP egress.';

  getSnapshot(): NymTransportSnapshot {
    return {
      state: this._state,
      lastError: this._lastError,
      connected: false,
      implementation: this.implementation,
      selfAddress: null,
    };
  }

  async connect(_config?: NymTransportConfig): Promise<void> {
    this._state = 'error';
    this._lastError =
      'NymTransport unavailable: @nymproject/mix-fetch bridge not loaded';
    throw new NymTransportError('UNAVAILABLE', this._lastError);
  }

  async send(_payload: Uint8Array): Promise<void> {
    throw new NymTransportError(
      'NOT_CONNECTED',
      'NymTransport unavailable: cannot send without a mixnet client',
    );
  }

  async fetch(_url: string, _init?: RequestInit): Promise<Response> {
    throw new NymTransportError(
      'NOT_CONNECTED',
      'NymTransport unavailable: refusing clearnet fallback',
    );
  }

  async close(): Promise<void> {
    this._state = 'closed';
  }
}

/**
 * Concrete adapter over an injected {@link NymMixFetchBridge}
 * (official mix-fetch or a test double).
 */
export class MixFetchNymTransport implements NymHttpTransport {
  readonly implementation = 'mix-fetch';
  private _state: NymTransportState = 'disconnected';
  private _lastError: string | null = null;
  private readonly _bridge: NymMixFetchBridge;

  constructor(bridge: NymMixFetchBridge) {
    if (!bridge || typeof bridge.setup !== 'function' || typeof bridge.mixFetch !== 'function') {
      throw new Error('MixFetchNymTransport requires a NymMixFetchBridge');
    }
    this._bridge = bridge;
  }

  getSnapshot(): NymTransportSnapshot {
    return {
      state: this._state,
      lastError: this._lastError,
      connected: this._state === 'connected',
      implementation: this.implementation,
      selfAddress: null,
    };
  }

  async connect(config?: NymTransportConfig): Promise<void> {
    if (this._state === 'connected') return;
    // Soft disconnect / prior failure must remain retryable. Never permanently
    // reject Connect after close() — the extension SW keeps one transport instance.
    if (this._state === 'closed') {
      this._state = 'disconnected';
      this._lastError = null;
    }
    this._state = 'connecting';
    this._lastError = null;
    const setupOpts: NymMixFetchSetupOptions = {};
    if (config?.disableCoverTraffic !== undefined) {
      setupOpts.disableCoverTraffic = config.disableCoverTraffic;
    }
    if (config?.gatewayUrl) {
      // Official MixFetchOpts.preferredGateway = identity key (mix-fetch-wasm@1.4.2).
      setupOpts.preferredGateway = config.gatewayUrl;
    }
    if (config?.gatewayAllowlist) {
      // Internal offscreen policy only — stripped before createMixFetch.
      setupOpts.gatewayAllowlist = config.gatewayAllowlist;
    }
    try {
      await this._bridge.setup(setupOpts);
      // connected only after successful setup/createMixFetch (bridge must not fake it).
      this._state = 'connected';
      this._lastError = null;
    } catch (cause) {
      this._state = 'error';
      this._lastError =
        cause instanceof Error
          ? cause.message
          : 'mix-fetch setup failed';
      throw new NymTransportError('CONNECT_FAILED', this._lastError, { cause });
    }
  }

  async send(_payload: Uint8Array): Promise<void> {
    throw new NymTransportError(
      'UNSUPPORTED',
      'MixFetchNymTransport uses HTTP mix-fetch; use fetch() for Stellar Horizon egress',
    );
  }

  async fetch(url: string, init?: RequestInit): Promise<Response> {
    if (this._state !== 'connected') {
      throw new NymTransportError(
        'NOT_CONNECTED',
        'Nym mode: mixnet not connected; refusing clearnet fallback',
      );
    }
    try {
      return await this._bridge.mixFetch(url, init);
    } catch (cause) {
      this._lastError =
        cause instanceof Error ? cause.message : 'mix-fetch request failed';
      throw new NymTransportError('REQUEST_FAILED', this._lastError, { cause });
    }
  }

  /**
   * Tear down MixFetch / offscreen session and return to a retryable
   * `disconnected` state. Historical snapshots may still show `closed` briefly
   * for callers that race; Connect always recovers.
   */
  async close(): Promise<void> {
    try {
      await this._bridge.disconnect();
    } catch {
      /* still mark disconnected */
    }
    this._state = 'disconnected';
    this._lastError = null;
  }
}

/** Sync factory: unavailable stub (no claim of mixnet connectivity). */
export function createNymTransport(): NymHttpTransport {
  return new UnavailableNymTransport();
}

/** Build a mix-fetch transport from an injected bridge (tests / explicit wiring). */
export function createMixFetchNymTransport(bridge: NymMixFetchBridge): MixFetchNymTransport {
  return new MixFetchNymTransport(bridge);
}

/**
 * Prefer official `@nymproject/mix-fetch` when present; otherwise unavailable stub.
 * Does not call setup/connect — caller must connect explicitly.
 */
export async function createNymTransportAsync(
  importer?: (specifier: string) => Promise<unknown>,
): Promise<NymHttpTransport> {
  const bridge = await tryLoadOfficialMixFetchBridge(importer);
  if (!bridge) return new UnavailableNymTransport();
  return new MixFetchNymTransport(bridge);
}
