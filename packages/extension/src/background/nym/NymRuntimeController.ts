/**
 * SW orchestration for the optional Nym/Direct transport and persisted user preference.
 */

import {
  MixFetchNymTransport,
  NymTransportError,
  type NymTransportSnapshot,
} from '@solanym/wallet-core/src/nym/NymTransport.js';
import {
  FailClosedTransportRouter,
  type NymTransportMode,
} from '@solanym/wallet-core/src/nym/NymTransportPolicy.js';
import type { NymDiagnosticCode } from '../../nym-offscreen/diagnostics.js';
import { OffscreenMixFetchBridge } from './OffscreenMixFetchBridge.js';
import {
  NymGatewayConfigService,
  type NymGatewayConfigState,
} from './NymGatewayConfigService.js';
import { NymHostPermissionService } from './NymHostPermissionService.js';
import {
  createStaleReadinessResult,
  runNymHttpSmoke,
  type NymHttpSmokeRequest,
  type NymHttpSmokeResult,
} from './NymHttpSmoke.js';
import type { NymReadinessToken } from '../../shared/ipcSchemas.js';
import {
  fetchPublicData,
  type PublicDataTransportFetch,
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
import type {
  NymTransportPreferenceError,
  NymTransportPreferenceService,
  NymTransportPreferenceSnapshot,
} from './NymTransportPreferenceService.js';
import {
  NymHttpSmokeOperationStore,
  type NymHttpSmokeOperationRecord,
} from './NymHttpSmokeOperationStore.js';

export type NymRuntimeUiSnapshot = NymTransportSnapshot & {
  mode: NymTransportMode;
  preferredMode: NymTransportMode | null;
  preferenceLoaded: boolean;
  preferenceError: NymTransportPreferenceError;
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
  readinessToken: NymReadinessToken;
  /** Validated MixFetch-effective Horizon bases (Nym remap targets). */
  stellarNymHorizon?: StellarNymHorizonConfig;
};

export type NymRuntimeHttpSmokeResult = NymHttpSmokeResult & {
  snapshot?: NymRuntimeUiSnapshot;
};

class NymPreferenceRequiredError extends Error {
  readonly code = 'NYM_PREFERENCE_REQUIRED';

  constructor() {
    super('HTTP Smoke requires a valid persisted Nym transport preference');
    this.name = 'NymPreferenceRequiredError';
  }
}

function createControllerEpoch(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

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
  /** Initial router mode is only a fail-closed placeholder until a preference is restored. */
  private _mode: NymTransportMode = 'nym';
  private readonly _bridge: OffscreenMixFetchBridge;
  private readonly _transport: MixFetchNymTransport;
  private readonly _router: FailClosedTransportRouter;
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
  /** Coalesces duplicate Connect calls until a later lifecycle operation is invoked. */
  private _connectInFlight: Promise<NymRuntimeUiSnapshot> | null = null;
  private _lifecycleOperationQueue: Promise<void> = Promise.resolve();
  private _preferenceSnapshot: NymTransportPreferenceSnapshot = {
    preferenceLoaded: false,
    preferredMode: null,
    preferenceError: null,
  };
  private _preferenceOperationQueue: Promise<void> = Promise.resolve();
  private readonly _preferenceService: NymTransportPreferenceService;
  private readonly _controllerEpoch = createControllerEpoch();
  private _readinessRevision = 0;
  private _readinessConfirmed = false;
  private readonly _httpSmokeOperationStore: NymHttpSmokeOperationStore;
  private _httpSmokeOperation: NymHttpSmokeOperationRecord | null = null;
  private _httpSmokeCallInFlight = false;
  private _httpSmokeTrackingUnavailable = false;

  constructor(options: {
    bridge?: OffscreenMixFetchBridge;
    gatewayConfig?: NymGatewayConfigService;
    hostPermissions?: NymHostPermissionService;
    preferenceService: NymTransportPreferenceService;
    httpSmokeOperationStore?: NymHttpSmokeOperationStore;
  }) {
    if (!options.preferenceService) {
      throw new Error('NymRuntimeController requires a persistent transport preference service');
    }
    this._preferenceService = options.preferenceService;
    this._bridge =
      options.bridge ??
      new OffscreenMixFetchBridge({
        onAuthenticated: (diagnostic) => {
          console.info('[Astrym][OffscreenBridge] authenticated', diagnostic);
        },
      });
    this._transport = new MixFetchNymTransport(this._bridge);
    this._router = new FailClosedTransportRouter({
      mode: this._mode,
      nym: this._transport,
      directFetch: clearnetFetchImpl as typeof fetch,
    });
    this._gatewayConfig =
      options.gatewayConfig ?? new NymGatewayConfigService(defaultLocalStorage());
    this._hostPermissions =
      options.hostPermissions ?? new NymHostPermissionService();
    this._httpSmokeOperationStore =
      options.httpSmokeOperationStore ??
      new NymHttpSmokeOperationStore(defaultLocalStorage());
  }

  get mode(): NymTransportMode {
    return this._mode;
  }

  get gatewayConfig(): NymGatewayConfigService {
    return this._gatewayConfig;
  }

  get hostPermissions(): NymHostPermissionService {
    return this._hostPermissions;
  }

  get fetchImpl(): typeof fetch {
    return ((url: string, init?: RequestInit) => {
      this.assertPreferenceSelected();
      return this._router.fetch(url, init);
    }) as typeof fetch;
  }

  /**
   * Stellar-only fetch bound to this router (MixFetch-safe RequestInit when mode=nym).
   * Shared by StellarReadClient and Horizon probe — one MixFetch instance via bridge.
   */
  getStellarFetch(): StellarReadFetch {
    return createStellarTransportFetch({
      getMode: () => this._router.mode,
      fetchViaRouter: (url, init) => {
        this.assertPreferenceSelected();
        return this._router.fetch(url, init);
      },
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

  private applyMode(mode: NymTransportMode): void {
    this._mode = mode;
    this._router.setMode(mode);
  }

  restorePreference(): Promise<NymRuntimeUiSnapshot> {
    return this.enqueuePreferenceOperation(async () => {
      let snapshot: NymTransportPreferenceSnapshot;
      try {
        snapshot = await this._preferenceService.load();
      } catch {
        snapshot = {
          preferenceLoaded: false,
          preferredMode: null,
          preferenceError: 'STORAGE_READ_FAILED',
        };
      }

      if (snapshot.preferenceLoaded && snapshot.preferredMode !== null) {
        this.applyMode(snapshot.preferredMode);
      } else {
        this.applyMode('nym');
      }
      this._preferenceSnapshot = { ...snapshot };
      return this.getSnapshot();
    });
  }

  setPreferredMode(mode: NymTransportMode): Promise<NymRuntimeUiSnapshot> {
    if (mode !== 'nym' && mode !== 'direct') {
      return Promise.reject(new Error('Invalid transport mode'));
    }

    return this.enqueuePreferenceOperation(async () => {
      let snapshot: NymTransportPreferenceSnapshot;
      try {
        snapshot = await this._preferenceService.setPreferredMode(mode);
      } catch {
        snapshot = {
          preferenceLoaded: this._preferenceSnapshot.preferenceLoaded,
          preferredMode: this._preferenceSnapshot.preferredMode,
          preferenceError: 'STORAGE_WRITE_FAILED',
        };
      }

      if (
        snapshot.preferenceError !== null ||
        !snapshot.preferenceLoaded ||
        snapshot.preferredMode !== mode
      ) {
        this._preferenceSnapshot = { ...snapshot };
        return this.getSnapshot();
      }

      this.applyMode(mode);
      this._preferenceSnapshot = { ...snapshot };
      return this.getSnapshot();
    });
  }

  private enqueuePreferenceOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this._preferenceOperationQueue.then(operation);
    this._preferenceOperationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private assertPreferenceSelected(): void {
    if (
      !this._preferenceSnapshot.preferenceLoaded ||
      this._preferenceSnapshot.preferredMode === null
    ) {
      throw Object.assign(new Error('Choose a transport preference before making network requests'), {
        code: 'TRANSPORT_PREFERENCE_REQUIRED',
      });
    }
  }

  private assertNymHttpSmokePreference(
    snapshot: NymTransportPreferenceSnapshot = this._preferenceSnapshot,
  ): void {
    if (
      !snapshot.preferenceLoaded ||
      snapshot.preferenceError !== null ||
      snapshot.preferredMode !== 'nym' ||
      this._mode !== 'nym' ||
      this._router.mode !== 'nym'
    ) {
      throw new NymPreferenceRequiredError();
    }
  }

  getSnapshot(): NymRuntimeUiSnapshot {
    const snap = this._transport.getSnapshot();
    const connected = this._readinessConfirmed && snap.connected;
    return {
      ...snap,
      state: connected
        ? 'connected'
        : snap.state === 'connecting'
          ? 'connecting'
          : snap.connected
            ? 'disconnected'
            : snap.state,
      connected,
      implementation:
        snap.implementation === 'mix-fetch'
          ? 'mix-fetch-offscreen'
          : snap.implementation,
      mode: this._mode,
      preferredMode: this._preferenceSnapshot.preferredMode,
      preferenceLoaded: this._preferenceSnapshot.preferenceLoaded,
      preferenceError: this._preferenceSnapshot.preferenceError,
      documentReady: this._documentReady,
      diagnosticCode: this._diagnosticCode,
      diagnosticStage: this._diagnosticStage,
      assetsReady: this._assetsReady,
      gatewayAllowlistConfigured: this._gatewayAllowlistConfigured,
      selectedGateway: this._selectedGateway,
      gatewayIdentityKey: this._gatewayIdentityKey,
      gatewayHostPermissionGranted: this._gatewayHostPermissionGranted,
      gatewayHostPermissionPattern: this._gatewayHostPermissionPattern,
      readinessToken: {
        controllerEpoch: this._controllerEpoch,
        readinessRevision: this._readinessRevision,
      },
      stellarNymHorizon: this.getStellarNymHorizonConfig(),
    };
  }

  private advanceReadinessRevision(): void {
    this._readinessRevision += 1;
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
    this._readinessConfirmed = false;
    this.advanceReadinessRevision();
    const connectPromise = this.enqueueLifecycleOperation(() => this.runConnect(options));
    this._connectInFlight = connectPromise;
    void connectPromise.then(
      () => this.clearConnectInFlight(connectPromise),
      () => this.clearConnectInFlight(connectPromise),
    );
    return connectPromise;
  }

  private clearConnectInFlight(connectPromise: Promise<NymRuntimeUiSnapshot>): void {
    if (this._connectInFlight === connectPromise) {
      this._connectInFlight = null;
    }
  }

  private enqueueLifecycleOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this._lifecycleOperationQueue.then(operation);
    this._lifecycleOperationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async runConnect(options?: {
    disableCoverTraffic?: boolean;
    preferredGateway?: string;
  }): Promise<NymRuntimeUiSnapshot> {
    this.assertPreferenceSelected();
    // Document open ≠ MixFetch ready — cleared until createMixFetch succeeds.
    this._documentReady = false;
    if (this._transport.getSnapshot().connected && !this._bridge.setupComplete) {
      await this._transport.close();
    }
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
      this._diagnosticCode = 'PERMISSION_DENIED';
      throw new NymTransportError(
        'CONNECT_FAILED',
        `Gateway host permission not granted for ${perm.hostPermissionPattern}. Use Grant permission (user gesture) first. Permission ≠ Mixnet Ready.`,
      );
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
      const remote = await this._bridge.queryStatus();
      if (remote) this.applyRemoteFields(remote);
      if (
        !this._transport.getSnapshot().connected ||
        !this._bridge.setupComplete ||
        remote?.connected !== true
      ) {
        this._documentReady = false;
        this._readinessConfirmed = false;
        this._diagnosticCode = 'CONNECT_FAILED';
        throw new NymTransportError(
          'CONNECT_FAILED',
          'Transport connect returned without verified MixFetch Ready',
        );
      }
      this._readinessConfirmed = true;
      return this.getSnapshot();
    } catch (cause) {
      this._documentReady = false;
      this._readinessConfirmed = false;
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
  async runHttpSmoke(
    request: NymHttpSmokeRequest | undefined,
    readinessToken: NymReadinessToken,
  ): Promise<NymRuntimeHttpSmokeResult> {
    this.assertNymHttpSmokePreference();
    if (this._httpSmokeCallInFlight) {
      throw Object.assign(new Error('A Nym HTTP Smoke operation is already in progress'), {
        code: 'HTTP_SMOKE_OPERATION_PENDING',
      });
    }
    if (this._httpSmokeTrackingUnavailable) {
      throw Object.assign(
        new Error('Nym HTTP Smoke tracking is unavailable; refusing another dispatch'),
        { code: 'HTTP_SMOKE_TRACKING_UNAVAILABLE' },
      );
    }
    this._httpSmokeCallInFlight = true;
    try {
      await this.reconcileHttpSmokeOperation();
      return await this.runHttpSmokeDispatch(request, readinessToken);
    } finally {
      this._httpSmokeCallInFlight = false;
    }
  }

  private async reconcileHttpSmokeOperation(): Promise<void> {
    let records: NymHttpSmokeOperationRecord[];
    try {
      records = await this._httpSmokeOperationStore.loadAll();
    } catch (cause) {
      this._httpSmokeTrackingUnavailable = true;
      throw new Error(
        `Unable to load or migrate Nym HTTP Smoke operation state: ${
          cause instanceof Error ? cause.message : 'unknown storage error'
        }`,
      );
    }

    for (const operation of records) {
      if (operation.state === 'completed' || operation.state === 'failed') continue;
      await this.reconcileHttpSmokeOperationRecord(
        operation,
        operation.callerTimedOut,
      );
    }

    const unresolved = (await this._httpSmokeOperationStore.loadAll()).filter(
      (operation) =>
        operation.state === 'pending' ||
        operation.state === 'timed_out_pending' ||
        operation.state === 'unknown',
    );
    this._httpSmokeOperation = unresolved.at(-1) ?? null;
    if (unresolved.length > 0) {
      throw Object.assign(
        new Error(
          unresolved.some((operation) => operation.state === 'unknown')
            ? 'Previous Nym HTTP Smoke operation cannot be resolved; refusing duplicate dispatch'
            : 'Previous Nym HTTP Smoke operation is still pending',
        ),
        { code: 'HTTP_SMOKE_OPERATION_PENDING' },
      );
    }
  }

  private async reconcileHttpSmokeOperationRecord(
    operation: NymHttpSmokeOperationRecord,
    callerTimedOut: boolean,
  ): Promise<NymHttpSmokeOperationRecord['state']> {
    let nextState: NymHttpSmokeOperationRecord['state'] = 'unknown';
    let authoritativeStatus: Awaited<
      ReturnType<OffscreenMixFetchBridge['queryHttpSmokeOperation']>
    > = null;
    try {
      const remoteStatus = await this._bridge.queryHttpSmokeOperation(
        operation.operationId,
        operation.runtimeGeneration,
      );
      if (
        remoteStatus?.operationId === operation.operationId &&
        remoteStatus.runtimeGeneration === operation.runtimeGeneration
      ) {
        authoritativeStatus = remoteStatus;
        if (remoteStatus.state === 'completed' || remoteStatus.state === 'failed') {
          nextState = remoteStatus.state;
        } else if (remoteStatus.state === 'pending') {
          nextState = callerTimedOut ? 'timed_out_pending' : 'pending';
        }
      }
    } catch {
      nextState = 'unknown';
    }

    const reconciled = {
      ...operation,
      state: nextState,
      callerTimedOut,
      updatedAt: Date.now(),
    };
    this._httpSmokeOperation = reconciled;
    try {
      if (nextState === 'completed' || nextState === 'failed') {
        if (!authoritativeStatus) {
          throw new Error('Authoritative Nym HTTP Smoke status is unavailable');
        }
        await this._httpSmokeOperationStore.saveVerifiedTerminal(
          reconciled,
          authoritativeStatus,
        );
      } else {
        await this._httpSmokeOperationStore.save(reconciled);
      }
    } catch (cause) {
      this._httpSmokeTrackingUnavailable = true;
      this._httpSmokeOperation = { ...reconciled, state: 'unknown' };
      throw new Error(
        `Unable to persist Nym HTTP Smoke operation state: ${
          cause instanceof Error ? cause.message : 'unknown storage error'
        }`,
      );
    }
    return nextState;
  }

  private async runHttpSmokeDispatch(
    request: NymHttpSmokeRequest | undefined,
    readinessToken: NymReadinessToken,
  ): Promise<NymRuntimeHttpSmokeResult> {
    const remote = await this._bridge.queryStatus();
    const localConnected =
      this._transport.getSnapshot().connected === true &&
      this._bridge.setupComplete;
    const remoteConnected = remote?.connected === true;
    if (!localConnected || !remoteConnected || !this._readinessConfirmed) {
      if (this._readinessConfirmed) {
        this._readinessConfirmed = false;
        this.advanceReadinessRevision();
      }
      if (remote) this.applyRemoteFields(remote);
      return {
        ...createStaleReadinessResult(request),
        snapshot: this.getSnapshot(),
      };
    }

    const dispatch = await this.enqueuePreferenceOperation(async () => {
      this.assertNymHttpSmokePreference();
      const persistedPreference = await this._preferenceService.load();
      this._preferenceSnapshot = { ...persistedPreference };
      this.assertNymHttpSmokePreference(persistedPreference);

      const currentToken = this.getSnapshot().readinessToken;
      if (
        readinessToken.controllerEpoch !== currentToken.controllerEpoch ||
        readinessToken.readinessRevision !== currentToken.readinessRevision
      ) {
        return {
          kind: 'stale' as const,
          result: {
            ...createStaleReadinessResult(request),
            snapshot: this.getSnapshot(),
          },
        };
      }

      // Recheck readiness after the preference read; start MixFetch before releasing
      // the preference queue, but do not hold it while pending. A later preference
      // change cannot cancel a MixFetch request that has already been dispatched.
      if (
        !this._readinessConfirmed ||
        !this._transport.getSnapshot().connected ||
        !this._bridge.setupComplete
      ) {
        if (this._readinessConfirmed) {
          this._readinessConfirmed = false;
          this.advanceReadinessRevision();
        }
        return {
          kind: 'stale' as const,
          result: {
            ...createStaleReadinessResult(request),
            snapshot: this.getSnapshot(),
          },
        };
      }

      const currentRemote = await this._bridge.queryStatus();
      if (
        !currentRemote?.connected ||
        !currentRemote.runtimeGeneration ||
        currentRemote.runtimeGeneration !== remote.runtimeGeneration
      ) {
        return {
          kind: 'stale' as const,
          result: {
            ...createStaleReadinessResult(request),
            snapshot: this.getSnapshot(),
          },
        };
      }

      const operationId = createControllerEpoch();
      const now = Date.now();
      const operation: NymHttpSmokeOperationRecord = {
        operationId,
        runtimeGeneration: currentRemote.runtimeGeneration,
        state: 'pending',
        createdAt: now,
        updatedAt: now,
        callerTimedOut: false,
      };
      this._httpSmokeOperation = operation;
      try {
        await this._httpSmokeOperationStore.save(operation);
      } catch (cause) {
        this._httpSmokeTrackingUnavailable = true;
        this._httpSmokeOperation = { ...operation, state: 'unknown' };
        throw new Error(
          `Unable to persist Nym HTTP Smoke operation before dispatch: ${
            cause instanceof Error ? cause.message : 'unknown storage error'
          }`,
        );
      }

      const smokeOptions: {
        connected: boolean;
        request?: NymHttpSmokeRequest;
        mixFetch: (
          url: string,
          init?: RequestInit & { httpSmokeOperationId?: string },
        ) => Promise<Response>;
        operationId: string;
      } = {
        connected: true,
        mixFetch: (url, init) => this._transport.fetch(url, init),
        operationId,
      };
      if (request !== undefined) smokeOptions.request = request;
      const smokePromise = runNymHttpSmoke(smokeOptions);
      return { kind: 'started' as const, smokePromise, operation };
    });

    if (dispatch.kind === 'stale') return dispatch.result;
    let result: NymHttpSmokeResult;
    try {
      result = await dispatch.smokePromise;
    } catch (cause) {
      await this.reconcileHttpSmokeOperationRecord(dispatch.operation, false);
      throw cause;
    }
    if (!result.mixFetchInvoked) {
      try {
        await this._httpSmokeOperationStore.removeUndispatched(dispatch.operation);
        this._httpSmokeOperation = null;
      } catch (cause) {
        this._httpSmokeTrackingUnavailable = true;
        this._httpSmokeOperation = {
          ...dispatch.operation,
          state: 'unknown',
          updatedAt: Date.now(),
        };
        throw new Error(
          `Unable to remove undispatched Nym HTTP Smoke operation marker: ${
            cause instanceof Error ? cause.message : 'unknown storage error'
          }`,
        );
      }
      return result;
    }

    const callerTimedOut = result.state === 'timeout';
    await this.reconcileHttpSmokeOperationRecord(
      dispatch.operation,
      callerTimedOut,
    );
    return result;
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
    this.assertPreferenceSelected();
    // Diagnostic isolation: the requested transport for a public-data fetch must NOT
    // mutate the shared wallet router mode. Derive a one-off fetch without setMode().
    const transport: NymTransportMode = (request?.transport === 'direct' || request?.transport === 'nym')
      ? request.transport
      : this._mode;
    // Diagnostic isolation: For an explicitly requested Nym diagnostic, use this._transport.fetch directly.
    // Do NOT call this._router.fetch() or getStellarFetch() or mutate router mode.
    // For Direct diagnostics, call isolated clearnetFetchImpl directly.
    const fetchViaTransport: PublicDataTransportFetch = transport === 'nym'
      ? (url: string, init?: RequestInit) => this._transport.fetch(url, init)
      : (url: string, init?: RequestInit) => clearnetFetchImpl(url, init);
    return fetchPublicData({
      transport,
      injectedTransport: transport,
      nymConnected: this._transport.getSnapshot().connected === true,
      fetchViaTransport,
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
    this.assertPreferenceSelected();
    // Diagnostic isolation: probe transport must NOT mutate the shared router mode.
    const transport: NymTransportMode = (options?.transport === 'direct' || options?.transport === 'nym')
      ? options.transport
      : this._mode;
    // For a direct diagnostic probe, use clearnet fetch directly rather than routing
    // through the shared router (which may be in nym mode for wallet operations).
    // For Nym diagnostic probe: use this._transport.fetch directly via createStellarTransportFetch.
    // Do NOT call this._router.fetch() or this.getStellarFetch().
    // For Direct diagnostic probe: use isolated clearnetFetchImpl.
    const fetchViaStellarTransport: StellarReadFetch = transport === 'nym'
      ? createStellarTransportFetch({
          getMode: () => 'nym' as NymTransportMode,
          fetchViaRouter: (url, init) => this._transport.fetch(url, init),
          getNymHorizonConfig: () => this._stellarNymHorizon,
        })
      : createStellarTransportFetch({
          getMode: () => 'direct' as NymTransportMode,
          fetchViaRouter: clearnetFetchImpl,
          getNymHorizonConfig: () => this._stellarNymHorizon,
        });
    const probeOpts: {
      fetchViaStellarTransport: StellarReadFetch;
      transport: NymTransportMode;
      injectedTransport: NymTransportMode;
      nymConnected: boolean;
      horizonUrl?: string;
      timeoutMs?: number;
      nymHorizonConfig: StellarNymHorizonConfig;
    } = {
      fetchViaStellarTransport,
      transport,
      injectedTransport: transport,
      nymConnected: this._transport.getSnapshot().connected === true,
      nymHorizonConfig: this._stellarNymHorizon,
    };
    if (options?.horizonUrl !== undefined) probeOpts.horizonUrl = options.horizonUrl;
    if (options?.timeoutMs !== undefined) probeOpts.timeoutMs = options.timeoutMs;
    return probeStellarHorizon(probeOpts);
  }

  async disconnect(): Promise<NymRuntimeUiSnapshot> {
    this._connectInFlight = null;
    this._readinessConfirmed = false;
    this.advanceReadinessRevision();
    return this.enqueueLifecycleOperation(async () => {
      await this._transport.close();
      this._documentReady = false;
      this._diagnosticCode = 'OK';
      this._diagnosticStage = null;
      return this.getSnapshot();
    });
  }

  async disconnectForLiveSmoke(): Promise<NymRuntimeUiSnapshot> {
    this._connectInFlight = null;
    this._readinessConfirmed = false;
    this.advanceReadinessRevision();
    return this.enqueueLifecycleOperation(async () => {
      await this._transport.close({ strict: true });
      this._documentReady = false;
      this._diagnosticCode = 'OK';
      this._diagnosticStage = null;
      return this.getSnapshot();
    });
  }

  async refreshStatus(): Promise<NymRuntimeUiSnapshot> {
    await this.syncGatewayConfigUi();
    const remote = await this._bridge.queryStatus();
    const localConnected =
      this._transport.getSnapshot().connected === true &&
      this._bridge.setupComplete;
    if (!remote) {
      this._documentReady = false;
      if (this._readinessConfirmed) {
        this._readinessConfirmed = false;
        this.advanceReadinessRevision();
      }
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
    if (!localConnected || remote.connected !== true) {
      if (this._readinessConfirmed) this.advanceReadinessRevision();
      this._readinessConfirmed = false;
    }
    return this.getSnapshot();
  }
}

let singleton: NymRuntimeController | null = null;

export function getNymRuntimeController(
  preferenceService?: NymTransportPreferenceService,
): NymRuntimeController {
  if (!singleton) {
    if (!preferenceService) {
      throw new Error('NymRuntimeController has not been initialized with persistent preferences');
    }
    singleton = new NymRuntimeController({ preferenceService });
  }
  return singleton;
}

export function resetNymRuntimeControllerForTests(
  controller?: NymRuntimeController | null,
): void {
  singleton = controller ?? null;
}
