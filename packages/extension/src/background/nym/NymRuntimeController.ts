/**
 * SW orchestration for Nym Mixnet: offscreen host + MixFetchNymTransport +
 * FailClosedTransportRouter. Direct mode only via explicit setMode('direct').
 */

import type { NymMixFetchBridge } from '@solanym/wallet-core/src/nym/NymMixFetchBridge.js';
import {
  MixFetchNymTransport,
  NymTransportError,
  type NymHttpTransport,
  type NymTransportSnapshot,
} from '@solanym/wallet-core/src/nym/NymTransport.js';
import {
  FailClosedTransportRouter,
  type NymTransportMode,
} from '@solanym/wallet-core/src/nym/NymTransportPolicy.js';
import type { NymDiagnosticCode } from '../../nym-offscreen/diagnostics.js';
import { createOffscreenDocumentManager } from './OffscreenDocumentManager.js';
import { OffscreenMixFetchBridge } from './OffscreenMixFetchBridge.js';
import {
  NymGatewayConfigService,
  type NymGatewayConfigState,
} from './NymGatewayConfigService.js';
import { NymHostPermissionService } from './NymHostPermissionService.js';
import {
  runNymHttpSmoke,
  type NymHttpSmokeRequest,
  type NymHttpSmokeResult,
} from './NymHttpSmoke.js';
import {
  fetchPublicData,
  type PublicDataFetchRequest,
  type PublicDataFetchResult,
} from './PublicDataClient.js';
import { createStellarTransportFetch } from './stellarTransportFetch.js';
import {
  DEFAULT_STELLAR_NYM_HORIZON_CONFIG,
  validateStellarNymHorizonConfig,
  type StellarNymHorizonConfig,
} from './stellarHorizonNymConfig.js';
import {
  probeStellarHorizon,
  type StellarHorizonProbeResult,
} from './StellarHorizonProbe.js';
import type { StellarReadFetch } from '@solanym/wallet-core/src/stellar/read/StellarReadClient.js';
import type { NymOffscreenStatusPayload } from '../../nym-offscreen/protocol.js';

/** Offscreen IPC bridge or the in-page MixFetch bridge used by the Android webapp. */
export type NymSessionBridge = NymMixFetchBridge & {
  queryStatus(): Promise<NymOffscreenStatusPayload | null>;
};

export type NymRuntimeUiSnapshot = NymTransportSnapshot & {
  mode: NymTransportMode;
  documentReady: boolean;
  diagnosticCode?: NymDiagnosticCode | string;
  diagnosticStage?: string | null;
  assetsReady?: boolean;
  gatewayAllowlistConfigured?: boolean;
  selectedGateway?: string | null;
  /** MixFetchOpts.preferredGateway identity key when configured. */
  gatewayIdentityKey?: string | null;
  gatewayHostPermissionGranted?: boolean | null;
  gatewayHostPermissionPattern?: string | null;
  /** Validated MixFetch-effective Horizon bases (Nym remap targets). */
  stellarNymHorizon?: StellarNymHorizonConfig;
};

function clearnetFetchImpl(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const fn = globalThis.fetch.bind(globalThis);
  return fn(url, init);
}

function defaultLocalStorage(): {
  get: (keys?: string | string[] | null) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
} {
  if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
    return {
      get: (keys) =>
        new Promise((resolve, reject) => {
          chrome.storage.local.get(keys ?? null, (result) => {
            const err = chrome.runtime?.lastError;
            if (err) reject(new Error(err.message));
            else resolve(result as Record<string, unknown>);
          });
        }),
      set: (items) =>
        new Promise((resolve, reject) => {
          chrome.storage.local.set(items, () => {
            const err = chrome.runtime?.lastError;
            if (err) reject(new Error(err.message));
            else resolve();
          });
        }),
    };
  }
  const mem = new Map<string, unknown>();
  return {
    get: async (keys) => {
      if (keys == null) return Object.fromEntries(mem);
      const list = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const k of list) {
        if (mem.has(k)) out[k] = mem.get(k);
      }
      return out;
    },
    set: async (items) => {
      for (const [k, v] of Object.entries(items)) mem.set(k, v);
    },
  };
}

export class NymRuntimeController {
  private _mode: NymTransportMode = 'direct';
  private readonly _bridge: NymSessionBridge;
  private readonly _transport: MixFetchNymTransport;
  private readonly _router: FailClosedTransportRouter;
  /**
   * Android / standalone webapp has no MV3 optional host permissions.
   * WSS is a normal browser socket. Extension builds keep this false so a
   * missing permission still fail-closes Connect.
   */
  private readonly _allowConnectWithoutHostPermission: boolean;
  private readonly _gatewayConfig: NymGatewayConfigService;
  private readonly _hostPermissions: NymHostPermissionService;
  private _documentReady = false;
  private _diagnosticCode: NymDiagnosticCode | string = 'OK';
  private _diagnosticStage: string | null = null;
  private _assetsReady = false;
  private _gatewayAllowlistConfigured = false;
  private _selectedGateway: string | null = null;
  private _gatewayIdentityKey: string | null = null;
  private _gatewayHostPermissionGranted: boolean | null = null;
  private _gatewayHostPermissionPattern: string | null = null;
  /** Validated logical→effective Horizon remap for Nym mode (never clearnet fallback). */
  private _stellarNymHorizon: StellarNymHorizonConfig = {
    ...DEFAULT_STELLAR_NYM_HORIZON_CONFIG,
  };
  /** Serializes Connect so duplicate createMixFetch / offscreen races cannot overlap. */
  private _connectInFlight: Promise<NymRuntimeUiSnapshot> | null = null;

  constructor(options?: {
    bridge?: NymSessionBridge;
    gatewayConfig?: NymGatewayConfigService;
    hostPermissions?: NymHostPermissionService;
    allowConnectWithoutHostPermission?: boolean;
  }) {
    const docs = createOffscreenDocumentManager();
    this._allowConnectWithoutHostPermission = options?.allowConnectWithoutHostPermission === true;
    this._bridge = options?.bridge ?? new OffscreenMixFetchBridge(docs);
    this._transport = new MixFetchNymTransport(this._bridge);
    this._router = new FailClosedTransportRouter({
      mode: this._mode,
      nym: this._transport,
      directFetch: clearnetFetchImpl as typeof fetch,
    });
    this._gatewayConfig =
      options?.gatewayConfig ?? new NymGatewayConfigService(defaultLocalStorage());
    this._hostPermissions =
      options?.hostPermissions ?? new NymHostPermissionService();
  }

  get mode(): NymTransportMode {
    return this._mode;
  }

  get transport(): NymHttpTransport {
    return this._transport;
  }

  get gatewayConfig(): NymGatewayConfigService {
    return this._gatewayConfig;
  }

  get hostPermissions(): NymHostPermissionService {
    return this._hostPermissions;
  }

  get fetchImpl(): typeof fetch {
    return this._router.fetch as typeof fetch;
  }

  getRouter(): FailClosedTransportRouter {
    return this._router;
  }

  /**
   * Stellar-only fetch bound to this router (MixFetch-safe RequestInit when mode=nym).
   * Shared by StellarReadClient and Horizon probe — one MixFetch instance via bridge.
   */
  getStellarFetch(): StellarReadFetch {
    return createStellarTransportFetch({
      getMode: () => this._router.mode,
      fetchViaRouter: (url, init) => this._router.fetch(url, init),
      getNymHorizonConfig: () => this._stellarNymHorizon,
    });
  }

  getStellarNymHorizonConfig(): StellarNymHorizonConfig {
    return { ...this._stellarNymHorizon };
  }

  /**
   * Replace Nym Horizon effective bases after allowlist validation.
   * Does not touch DirectTransport / clearnet. Invalid input throws (visible error).
   */
  setStellarNymHorizonConfig(
    partial: Partial<StellarNymHorizonConfig>,
  ): StellarNymHorizonConfig {
    const validated = validateStellarNymHorizonConfig({
      ...this._stellarNymHorizon,
      ...partial,
    });
    if (!validated.ok) {
      throw Object.assign(new Error(validated.message), {
        code: 'STELLAR_NYM_HORIZON_CONFIG_INVALID',
      });
    }
    this._stellarNymHorizon = validated.config;
    return this.getStellarNymHorizonConfig();
  }

  setMode(mode: NymTransportMode): void {
    this._mode = mode;
    this._router.setMode(mode);
  }

  getSnapshot(): NymRuntimeUiSnapshot {
    const snap = this._transport.getSnapshot();
    return {
      ...snap,
      implementation:
        snap.implementation === 'mix-fetch'
          ? 'mix-fetch-offscreen'
          : snap.implementation,
      mode: this._mode,
      documentReady: this._documentReady,
      diagnosticCode: this._diagnosticCode,
      diagnosticStage: this._diagnosticStage,
      assetsReady: this._assetsReady,
      gatewayAllowlistConfigured: this._gatewayAllowlistConfigured,
      selectedGateway: this._selectedGateway,
      gatewayIdentityKey: this._gatewayIdentityKey,
      gatewayHostPermissionGranted: this._gatewayHostPermissionGranted,
      gatewayHostPermissionPattern: this._gatewayHostPermissionPattern,
      stellarNymHorizon: this.getStellarNymHorizonConfig(),
    };
  }

  private applyRemoteFields(remote: {
    documentReady?: boolean;
    diagnosticCode?: string;
    diagnosticStage?: string | null;
    assetsReady?: boolean;
    gatewayAllowlistConfigured?: boolean;
  }): void {
    if (typeof remote.documentReady === 'boolean') {
      this._documentReady = remote.documentReady;
    }
    if (typeof remote.diagnosticCode === 'string') {
      this._diagnosticCode = remote.diagnosticCode;
    }
    if (remote.diagnosticStage !== undefined) {
      this._diagnosticStage = remote.diagnosticStage ?? null;
    }
    if (typeof remote.assetsReady === 'boolean') {
      this._assetsReady = remote.assetsReady;
    }
    if (typeof remote.gatewayAllowlistConfigured === 'boolean') {
      this._gatewayAllowlistConfigured = remote.gatewayAllowlistConfigured;
    }
  }

  async syncGatewayConfigUi(): Promise<NymGatewayConfigState> {
    const config = await this._gatewayConfig.load();
    this._gatewayAllowlistConfigured = config.gatewayOrigins.length > 0;
    this._selectedGateway = config.selectedGateway;
    this._gatewayIdentityKey = config.identityKey;
    if (config.selectedGateway) {
      try {
        const perm = await this._hostPermissions.getStatus(config.selectedGateway);
        this._gatewayHostPermissionGranted = perm.granted;
        this._gatewayHostPermissionPattern = perm.hostPermissionPattern;
      } catch {
        this._gatewayHostPermissionGranted = false;
        this._gatewayHostPermissionPattern = null;
      }
    } else {
      this._gatewayHostPermissionGranted = null;
      this._gatewayHostPermissionPattern = null;
    }
    return config;
  }

  async connect(options?: {
    disableCoverTraffic?: boolean;
    /** MixFetch identity key override; defaults to persisted identityKey. */
    preferredGateway?: string;
  }): Promise<NymRuntimeUiSnapshot> {
    if (this._connectInFlight) {
      return this._connectInFlight;
    }
    this._connectInFlight = this.runConnect(options).finally(() => {
      this._connectInFlight = null;
    });
    return this._connectInFlight;
  }

  private async runConnect(options?: {
    disableCoverTraffic?: boolean;
    preferredGateway?: string;
  }): Promise<NymRuntimeUiSnapshot> {
    // Document open ≠ MixFetch ready — cleared until createMixFetch succeeds.
    this._documentReady = false;
    await this._gatewayConfig.ensureVerifiedDefault();
    const config = await this.syncGatewayConfigUi();
    const wssOrigin = config.selectedGateway || config.gatewayOrigins[0] || null;
    if (!wssOrigin) {
      this._diagnosticCode = 'GATEWAY_ALLOWLIST_EMPTY';
      throw new NymTransportError(
        'CONNECT_FAILED',
        'Configure an exact Nym gateway WSS origin before connect (no silent default)',
      );
    }
    if (!config.gatewayOrigins.includes(wssOrigin)) {
      this._diagnosticCode = 'GATEWAY_NOT_ALLOWLISTED';
      throw new NymTransportError(
        'CONNECT_FAILED',
        'Selected WSS gateway is not on the configured allowlist',
      );
    }
    const identityKey =
      options?.preferredGateway?.trim() || config.identityKey || null;
    if (!identityKey) {
      this._diagnosticCode = 'GATEWAY_IDENTITY_REQUIRED';
      throw new NymTransportError(
        'CONNECT_FAILED',
        'Configure MixFetch preferredGateway identity key (base58) separately from the WSS origin',
      );
    }
    const perm = await this._hostPermissions.getStatus(wssOrigin);
    this._gatewayHostPermissionGranted = perm.granted;
    this._gatewayHostPermissionPattern = perm.hostPermissionPattern;
    if (!perm.granted) {
      const browserSocket =
        this._allowConnectWithoutHostPermission && !this._hostPermissions.isApiAvailable();
      if (!browserSocket) {
        this._diagnosticCode = 'PERMISSION_DENIED';
        throw new NymTransportError(
          'CONNECT_FAILED',
          `Gateway host permission not granted for ${perm.hostPermissionPattern}. Use Grant permission (user gesture) first. Permission ≠ Mixnet Ready.`,
        );
      }
      this._gatewayHostPermissionGranted = true;
    }

    try {
      const transportConfig: {
        gatewayUrl: string;
        gatewayAllowlist: string[];
        disableCoverTraffic?: boolean;
      } = {
        // gatewayUrl carries MixFetch identity key into preferredGateway.
        gatewayUrl: identityKey,
        gatewayAllowlist: config.gatewayOrigins,
      };
      if (options?.disableCoverTraffic !== undefined) {
        transportConfig.disableCoverTraffic = options.disableCoverTraffic;
      }
      // Ensures offscreen document + createMixFetch via bridge.setup (serialized).
      await this._transport.connect(transportConfig);
      this._documentReady = true;
      this._diagnosticCode = 'OK';
      this._diagnosticStage = null;
      this._selectedGateway = wssOrigin;
      this._gatewayIdentityKey = identityKey;
      this.setMode('nym');
      const remote = await this._bridge.queryStatus();
      if (remote) this.applyRemoteFields(remote);
      // Only report MixFetch ready when transport + remote agree connected.
      if (!this._transport.getSnapshot().connected) {
        this._documentReady = false;
        this._diagnosticCode = 'CONNECT_FAILED';
        throw new NymTransportError(
          'CONNECT_FAILED',
          'Transport connect returned without MixFetch Ready',
        );
      }
      return this.getSnapshot();
    } catch (cause) {
      this._documentReady = false;
      this._diagnosticCode =
        cause && typeof cause === 'object' && 'code' in cause
          ? String((cause as { code: string }).code)
          : 'CONNECT_FAILED';
      // Offscreen classifyNymFailure (e.g. CLOCK_SKEWED) is more specific than
      // MixFetchNymTransport's generic CONNECT_FAILED wrapper.
      try {
        const remote = await this._bridge.queryStatus();
        if (remote) {
          this.applyRemoteFields(remote);
          if (
            remote.diagnosticCode &&
            remote.diagnosticCode !== 'OK' &&
            (this._diagnosticCode === 'CONNECT_FAILED' || this._diagnosticCode === 'OK')
          ) {
            this._diagnosticCode = remote.diagnosticCode;
          }
        }
      } catch {
        /* ignore status probe after connect failure */
      }
      if (cause instanceof NymTransportError) throw cause;
      throw new NymTransportError(
        'CONNECT_FAILED',
        cause instanceof Error ? cause.message : 'Nym connect failed',
        { cause },
      );
    }
  }

  /**
   * HTTP round-trip via the existing MixFetch instance only.
   * Requires connected transport; never clearnet fallback.
   */
  async runHttpSmoke(request?: NymHttpSmokeRequest): Promise<NymHttpSmokeResult> {
    const connected = this._transport.getSnapshot().connected === true;
    return runNymHttpSmoke({
      connected,
      request,
      mixFetch: (url, init) => this._transport.fetch(url, init),
    });
  }

  /**
   * Public (non-wallet) GET via FailClosedTransportRouter.
   * mode=nym → mixFetch path; mode=direct → explicit clearnet only.
   * No silent fallback between modes.
   */
  async fetchPublicData(
    request?: Omit<PublicDataFetchRequest, 'transport'> & {
      transport?: NymTransportMode;
    },
  ): Promise<PublicDataFetchResult> {
    // Explicit selection wins — aligns router without silent clearnet fallback.
    if (request?.transport === 'direct' || request?.transport === 'nym') {
      this.setMode(request.transport);
    }
    const transport = this._mode;
    return fetchPublicData({
      transport,
      routerMode: this._router.mode,
      nymConnected: this._transport.getSnapshot().connected === true,
      fetchViaTransport: (url, init) => this._router.fetch(url, init),
      request: { ...request, transport },
    });
  }

  /**
   * Public Horizon fee_stats/root via Stellar transport adapter (no account / no Friendbot).
   * Records logical vs effective URLs; fail-closed when mode=nym.
   */
  async probeStellarHorizon(options?: {
    transport?: NymTransportMode;
    horizonUrl?: string;
    timeoutMs?: number;
  }): Promise<StellarHorizonProbeResult> {
    if (options?.transport === 'direct' || options?.transport === 'nym') {
      this.setMode(options.transport);
    }
    const transport = this._mode;
    const probeOpts: {
      fetchViaStellarTransport: StellarReadFetch;
      transport: NymTransportMode;
      nymConnected: boolean;
      horizonUrl?: string;
      timeoutMs?: number;
      nymHorizonConfig: StellarNymHorizonConfig;
    } = {
      fetchViaStellarTransport: this.getStellarFetch(),
      transport,
      nymConnected: this._transport.getSnapshot().connected === true,
      nymHorizonConfig: this._stellarNymHorizon,
    };
    if (options?.horizonUrl !== undefined) probeOpts.horizonUrl = options.horizonUrl;
    if (options?.timeoutMs !== undefined) probeOpts.timeoutMs = options.timeoutMs;
    return probeStellarHorizon(probeOpts);
  }

  async disconnect(): Promise<NymRuntimeUiSnapshot> {
    if (this._connectInFlight) {
      try {
        await this._connectInFlight;
      } catch {
        /* still disconnect */
      }
    }
    await this._transport.close();
    this._documentReady = false;
    this._diagnosticCode = 'OK';
    this._diagnosticStage = null;
    // Disconnect is an explicit exit from Nym. While mode stays `nym`, fetch
    // still fail-closes with no clearnet retry. Returning to `direct` here is
    // the visible way back to Horizon reads after the user disconnects.
    this.setMode('direct');
    return this.getSnapshot();
  }

  async refreshStatus(): Promise<NymRuntimeUiSnapshot> {
    await this.syncGatewayConfigUi();
    // Avoid opening offscreen solely for idle status when MixFetch is down —
    // queryStatus ensures the document; that is OK but must not mark Ready.
    const remote = await this._bridge.queryStatus();
    if (!remote) {
      this._documentReady = false;
      if (this._diagnosticCode === 'OK' && !this._transport.getSnapshot().connected) {
        // Idle / no offscreen: not an error; document simply not open.
        this._diagnosticCode = 'OK';
        this._diagnosticStage = null;
      } else if (this._diagnosticCode === 'OK') {
        this._diagnosticCode = 'RUNTIME_UNAVAILABLE';
        this._diagnosticStage = 'ipc';
      }
      return this.getSnapshot();
    }
    this.applyRemoteFields(remote);
    // Soft teardown if SW thought connected but offscreen MixFetch is gone.
    if (
      !remote.connected &&
      this._transport.getSnapshot().connected &&
      !this._connectInFlight
    ) {
      try {
        await this._transport.close();
      } catch {
        /* ignore */
      }
      this._documentReady = false;
    }
    return this.getSnapshot();
  }
}

let singleton: NymRuntimeController | null = null;

export function getNymRuntimeController(): NymRuntimeController {
  if (!singleton) singleton = new NymRuntimeController();
  return singleton;
}

export function resetNymRuntimeControllerForTests(
  controller?: NymRuntimeController | null,
): void {
  singleton = controller ?? null;
}
