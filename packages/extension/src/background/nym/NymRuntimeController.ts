/**
 * SW orchestration for Nym Mixnet: offscreen host + MixFetchNymTransport +
 * FailClosedTransportRouter.
 *
 * The privacy choice lives in chrome.storage.local (webapp shim: localStorage).
 * Until that read finishes, wallet HTTP does not use clearnet. A missing,
 * corrupt, or unreadable choice stays blocked. Direct is armed only when the
 * stored value is the explicit choice `'direct'`. Nym without MixFetch stays
 * blocked. Disconnect does not select Direct. The SPP broadcast gate is not
 * persisted.
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
  type PublicDataTransportFetch,
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
import { NYM_VERIFIED_GATEWAY } from '../../nym-offscreen/verifiedGateway.js';
import {
  NYM_PRIVACY_PREFERENCE_STORAGE_KEY,
  readNymPrivacyPreference,
  writeNymPrivacyPreference,
  type NymPrivacyChoice,
  type NymPrivacyPreferenceRecord,
  type NymPrivacyPreferenceStore,
} from '../../shared/nymPrivacyPreference.js';
import {
  NYM_RUNTIME_STATUS_CHANNEL,
  type NymRuntimeStatusSnapshot,
} from '../../shared/nymRuntimeStatus.js';

/** Offscreen IPC bridge or the in-page MixFetch bridge used by the Android webapp. */
export type NymSessionBridge = NymMixFetchBridge & {
  queryStatus(): Promise<NymOffscreenStatusPayload | null>;
  /** Optional. Called when the MixFetch host disappears without an explicit disconnect. */
  watchConnection?(onLost: () => void): () => void;
};

export type NymRuntimeUiSnapshot = NymTransportSnapshot & {
  mode: NymTransportMode;
  /**
   * False only while the persisted choice is still being read.
   * Callers must not treat mode as a user choice until this is true.
   */
  preferenceHydrated: boolean;
  /** True when wallet HTTP must not touch clearnet. */
  egressBlocked: boolean;
  /** Null when unset, corrupt, or not yet read. `'direct'` only after an explicit save. */
  privacyPreference: NymPrivacyChoice | null;
  /**
   * True only when privacyPreference was loaded from storage or last written
   * successfully. False after a failed save: memory may show Nym, but reload
   * restores the previous durable value and must not be described as a saved Nym choice.
   */
  preferenceDurable: boolean;
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

const DIRECT_DIAGNOSTIC_REFUSAL =
  'Direct diagnostics refused: privacy policy does not allow clearnet';

function clearnetFetchImpl(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const fn = globalThis.fetch.bind(globalThis);
  return fn(url, init);
}

function subscribeChromePrivacyChanges(listener: () => void): () => void {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};
  const wrapped = (changes: Record<string, unknown>, area: string) => {
    if (
      area !== 'local' ||
      !Object.prototype.hasOwnProperty.call(changes, NYM_PRIVACY_PREFERENCE_STORAGE_KEY)
    ) {
      return;
    }
    listener();
  };
  chrome.storage.onChanged.addListener(wrapped);
  return () => {
    chrome.storage.onChanged.removeListener(wrapped);
  };
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
  /**
   * Starts as Nym so a restart cannot emit clearnet before storage is read.
   * Diagnostic requests (fetchPublicData, probeStellarHorizon) must not mutate this field.
   * Bridge is OffscreenMixFetchBridge by default; Android webapp injects NymSessionBridge.
   */
  private _mode: NymTransportMode = 'nym';
  private _preferenceHydrated = false;
  private _privacyPreference: NymPrivacyChoice | null = null;
  private _preferenceDurable = false;
  private readonly _statusListeners = new Set<(snapshot: NymRuntimeUiSnapshot) => void>();
  /** Bumped by an explicit setMode so a late storage read cannot overwrite it. */
  private _explicitEpoch = 0;
  /** Serializes explicit choices so a late Direct write cannot be overwritten by Nym. */
  private _choiceQueue: Promise<void> = Promise.resolve();
  private readonly _privacyStore: NymPrivacyPreferenceStore;
  private readonly _hydratePromise: Promise<void>;
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
  private _privacyReload: Promise<void> = Promise.resolve();

  constructor(options?: {
    bridge?: NymSessionBridge;
    gatewayConfig?: NymGatewayConfigService;
    hostPermissions?: NymHostPermissionService;
    allowConnectWithoutHostPermission?: boolean;
    /** Privacy choice store. Defaults to chrome.storage.local (in-memory if absent). */
    privacyPreferenceStore?: NymPrivacyPreferenceStore;
    /**
     * Notified when another instance writes the privacy key.
     * Defaults to chrome.storage.onChanged when the default store is used.
     */
    onPrivacyStoreChanged?: (listener: () => void) => () => void;
  }) {
    const docs = createOffscreenDocumentManager();
    this._allowConnectWithoutHostPermission = options?.allowConnectWithoutHostPermission === true;
    this._bridge = options?.bridge ?? new OffscreenMixFetchBridge(docs);
    this._transport = new MixFetchNymTransport(this._bridge);
    this._router = new FailClosedTransportRouter({
      mode: this._mode,
      nym: this._transport,
      directFetch: clearnetFetchImpl as typeof fetch,
      directAuthorized: () => this.clearnetExplicitlyAuthorized(),
    });
    const allowRouterMode = this._router.setMode.bind(this._router);
    this._router.setMode = (mode: NymTransportMode) => {
      if (mode === 'direct' && !this.clearnetExplicitlyAuthorized()) {
        throw new Error(
          'Direct requires an explicit persisted privacy choice; router setMode cannot grant clearnet',
        );
      }
      allowRouterMode(mode);
    };
    this._gatewayConfig =
      options?.gatewayConfig ?? new NymGatewayConfigService(defaultLocalStorage());
    this._hostPermissions =
      options?.hostPermissions ?? new NymHostPermissionService();
    const usingDefaultStore = options?.privacyPreferenceStore == null;
    this._privacyStore = options?.privacyPreferenceStore ?? defaultLocalStorage();
    this._hydratePromise = this.hydratePrivacyPreference();
    const subscribe =
      options?.onPrivacyStoreChanged ??
      (usingDefaultStore ? subscribeChromePrivacyChanges : undefined);
    if (subscribe) {
      subscribe(() => {
        this.schedulePrivacyReload();
      });
    }
    if (typeof this._bridge.watchConnection === 'function') {
      this._bridge.watchConnection(() => {
        void this.noteMixFetchLost();
      });
    }
  }

  /** Same-realm listeners. Extension pages also receive {@link publishRuntimeStatus}. */
  subscribeRuntimeStatus(listener: (snapshot: NymRuntimeUiSnapshot) => void): () => void {
    this._statusListeners.add(listener);
    return () => {
      this._statusListeners.delete(listener);
    };
  }

  /**
   * MixFetch host disappeared. Closes the transport and tells open views.
   * Does not select Direct and does not write storage.
   */
  async noteMixFetchLost(): Promise<NymRuntimeUiSnapshot> {
    if (this._transport.getSnapshot().connected === true) {
      try {
        await this._transport.close();
      } catch {
        /* still publish the loss */
      }
    }
    this._documentReady = false;
    const snapshot = this.getSnapshot();
    this.publishRuntimeStatus(snapshot);
    return snapshot;
  }

  private publishRuntimeStatus(snapshot: NymRuntimeUiSnapshot = this.getSnapshot()): void {
    for (const listener of this._statusListeners) {
      try {
        listener(snapshot);
      } catch {
        /* one view must not block the others */
      }
    }
    if (typeof chrome === 'undefined' || typeof chrome.runtime?.sendMessage !== 'function') return;
    try {
      const pending = chrome.runtime.sendMessage({
        channel: NYM_RUNTIME_STATUS_CHANNEL,
        snapshot: snapshot as NymRuntimeStatusSnapshot,
      });
      if (pending && typeof (pending as Promise<unknown>).then === 'function') {
        void (pending as Promise<unknown>).then(
          () => undefined,
          () => undefined,
        );
      }
    } catch {
      /* no listener in this realm */
    }
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
    return this.getStellarFetch() as typeof fetch;
  }

  getRouter(): FailClosedTransportRouter {
    return this._router;
  }

  /**
   * Stellar-only fetch bound to this router (MixFetch-safe RequestInit when mode=nym).
   * Shared by StellarReadClient and Horizon probe — one MixFetch instance via bridge.
   */
  getStellarFetch(): StellarReadFetch {
    const inner = createStellarTransportFetch({
      getMode: () => this._router.mode,
      fetchViaRouter: (url, init) => this._router.fetch(url, init),
      getNymHorizonConfig: () => this._stellarNymHorizon,
    });
    return async (url, init) => {
      await this.whenPrivacyReady();
      if (this.isEgressBlocked()) {
        throw new NymTransportError(
          'NOT_CONNECTED',
          'Nym mode enabled but mixnet is not connected; refusing clearnet fallback',
        );
      }
      return inner(url, init);
    };
  }

  /** Resolves when the persisted choice has been applied. Does not open clearnet by itself. */
  whenPrivacyReady(): Promise<void> {
    return this._hydratePromise;
  }

  private isEgressBlocked(): boolean {
    if (!this._preferenceHydrated) return true;
    // Clearnet requires a stored explicit Direct choice. Null is not Direct.
    if (this._privacyPreference !== 'direct' && this._privacyPreference !== 'nym') {
      return true;
    }
    switch (this._mode) {
      case 'nym':
        return this._transport.getSnapshot().connected !== true;
      case 'direct':
        return this._privacyPreference !== 'direct';
      default: {
        const _never: never = this._mode;
        return _never;
      }
    }
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

  /**
   * Explicit user choice. `'direct'` is applied only after it is stored.
   * `'nym'` is applied immediately so a failed write cannot leave clearnet on.
   * Choices run one at a time.
   */
  async setMode(mode: NymTransportMode): Promise<void> {
    const job = this._choiceQueue.then(() => this.commitMode(mode));
    this._choiceQueue = job.then(
      () => undefined,
      () => undefined,
    );
    return job;
  }

  private async commitMode(mode: NymTransportMode): Promise<void> {
    const epoch = ++this._explicitEpoch;
    switch (mode) {
      case 'nym':
        // Memory switches to Nym before the write so a failed save cannot leave Direct.
        // preferenceDurable stays false until the write resolves. A later controller
        // reads storage and restores the previous successful value; that reload is
        // not a saved Nym choice.
        this.applyResolved('nym', 'nym', false);
        try {
          await writeNymPrivacyPreference(this._privacyStore, 'nym');
        } catch (err) {
          if (this._explicitEpoch === epoch) {
            this._preferenceDurable = false;
            this._diagnosticCode = 'PRIVACY_PREFERENCE_PERSIST_FAILED';
            this.publishRuntimeStatus();
          }
          throw err;
        }
        if (this._explicitEpoch !== epoch) return;
        this._preferenceDurable = true;
        this.publishRuntimeStatus();
        return;
      case 'direct':
        try {
          await writeNymPrivacyPreference(this._privacyStore, 'direct');
        } catch (err) {
          if (this._explicitEpoch === epoch) {
            this._diagnosticCode = 'PRIVACY_PREFERENCE_PERSIST_FAILED';
            if (!this._preferenceHydrated) {
              this._mode = 'nym';
              this._preferenceHydrated = true;
              this._preferenceDurable = false;
              this._router.setMode('nym');
            }
            this.publishRuntimeStatus();
          }
          throw err;
        }
        if (this._explicitEpoch !== epoch) return;
        this.applyResolved('direct', 'direct', true);
        this.publishRuntimeStatus();
        return;
      default: {
        const _never: never = mode;
        throw new Error(`Invalid transport mode: ${String(_never)}`);
      }
    }
  }

  private applyResolved(
    mode: NymTransportMode,
    preference: NymPrivacyChoice | null,
    durable: boolean,
  ): void {
    this._mode = mode;
    this._privacyPreference = preference;
    this._preferenceHydrated = true;
    this._preferenceDurable = durable && (preference === 'direct' || preference === 'nym');
    if (
      this._diagnosticCode === 'PRIVACY_PREFERENCE_CORRUPT' ||
      this._diagnosticCode === 'PRIVACY_PREFERENCE_UNREADABLE' ||
      this._diagnosticCode === 'PRIVACY_PREFERENCE_PERSIST_FAILED' ||
      this._diagnosticCode === 'PRIVACY_CHOICE_REQUIRED'
    ) {
      this._diagnosticCode = 'OK';
    }
    this._router.setMode(mode);
  }

  private schedulePrivacyReload(): void {
    this._privacyReload = this._privacyReload
      .catch(() => undefined)
      .then(() => this.reloadPrivacyFromStore());
  }

  /** Apply a privacy value written by another instance. Does not invent Direct. */
  private async reloadPrivacyFromStore(): Promise<void> {
    const epoch = this._explicitEpoch;
    let record: NymPrivacyPreferenceRecord;
    try {
      record = await readNymPrivacyPreference(this._privacyStore);
    } catch {
      if (this._explicitEpoch !== epoch) return;
      this.applyResolved('nym', null, false);
      this._diagnosticCode = 'PRIVACY_PREFERENCE_UNREADABLE';
      this.publishRuntimeStatus();
      return;
    }
    if (this._explicitEpoch !== epoch) return;
    this.applyPrivacyRecord(record);
    this.publishRuntimeStatus();
  }

  private applyPrivacyRecord(record: NymPrivacyPreferenceRecord): void {
    switch (record.kind) {
      case 'unset':
        this.applyResolved('nym', null, false);
        this._diagnosticCode = 'PRIVACY_CHOICE_REQUIRED';
        return;
      case 'chosen':
        this.applyResolved(record.choice, record.choice, true);
        return;
      case 'corrupt':
        this.applyResolved('nym', null, false);
        this._diagnosticCode = 'PRIVACY_PREFERENCE_CORRUPT';
        return;
      default: {
        const _never: never = record;
        throw new Error(`Unhandled privacy preference ${JSON.stringify(_never)}`);
      }
    }
  }

  private clearnetExplicitlyAuthorized(): boolean {
    return (
      this._preferenceHydrated &&
      this._privacyPreference === 'direct' &&
      this._mode === 'direct' &&
      !this.isEgressBlocked()
    );
  }

  /**
   * Diagnostics use the same clearnet rule as wallet fetch.
   * A requested transport does not change the saved choice.
   */
  private async diagnosticTransport(
    requested: NymTransportMode | undefined,
  ): Promise<'direct' | 'nym' | 'refused'> {
    await this.whenPrivacyReady();
    await this._privacyReload;
    const transport: NymTransportMode =
      requested === 'direct' || requested === 'nym'
        ? requested
        : this._mode === 'direct'
          ? 'direct'
          : 'nym';
    if (transport === 'direct' && !this.clearnetExplicitlyAuthorized()) return 'refused';
    return transport;
  }

  private async hydratePrivacyPreference(): Promise<void> {
    const epoch = this._explicitEpoch;
    try {
      const record = await readNymPrivacyPreference(this._privacyStore);
      if (this._explicitEpoch !== epoch) return;
      this.applyPrivacyRecord(record);
    } catch {
      if (this._explicitEpoch !== epoch) return;
      // Storage failures stay fail-closed. Do not select Direct.
      this.applyResolved('nym', null, false);
      this._diagnosticCode = 'PRIVACY_PREFERENCE_UNREADABLE';
    }
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
      preferenceHydrated: this._preferenceHydrated,
      egressBlocked: this.isEgressBlocked(),
      privacyPreference: this._privacyPreference,
      preferenceDurable: this._preferenceDurable,
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
    // Connect is an explicit Nym choice. Persist it before any gateway I/O so a
    // failed connect or a worker restart cannot fall through to clearnet.
    await this.setMode('nym');
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
        preferredNetworkRequester?: string;
        disableCoverTraffic?: boolean;
      } = {
        // gatewayUrl carries MixFetch identity key into preferredGateway.
        gatewayUrl: identityKey,
        gatewayAllowlist: config.gatewayOrigins,
      };
      // Pin NR when using the verified entry gateway — random NR selection hangs
      // at SOCKS CONNECT even after createMixFetch reports Ready.
      if (identityKey === NYM_VERIFIED_GATEWAY.identityKey) {
        transportConfig.preferredNetworkRequester =
          NYM_VERIFIED_GATEWAY.networkRequesterAddress;
      }
      if (options?.disableCoverTraffic !== undefined) {
        transportConfig.disableCoverTraffic = options.disableCoverTraffic;
      } else {
        // Cover traffic is valuable in production but slows first HTTP smoke /
        // Horizon probes on constrained Android WebViews. Default off for Connect;
        // operators can re-enable later via explicit option if needed.
        transportConfig.disableCoverTraffic = true;
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
      // Only report MixFetch ready when transport + remote agree connected.
      if (!this._transport.getSnapshot().connected) {
        this._documentReady = false;
        this._diagnosticCode = 'CONNECT_FAILED';
        throw new NymTransportError(
          'CONNECT_FAILED',
          'Transport connect returned without MixFetch Ready',
        );
      }
      const snapshot = this.getSnapshot();
      this.publishRuntimeStatus(snapshot);
      return snapshot;
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
   * Public (non-wallet) GET.
   * Direct is allowed only when clearnet is explicitly authorized.
   * The request does not change the saved privacy choice.
   */
  async fetchPublicData(
    request?: Omit<PublicDataFetchRequest, 'transport'> & {
      transport?: NymTransportMode;
    },
  ): Promise<PublicDataFetchResult> {
    const transport = await this.diagnosticTransport(request?.transport);
    if (transport === 'refused') {
      return {
        state: 'error',
        transport: 'direct',
        url: request?.url ?? '',
        probeId: '',
        durationMs: 0,
        httpStatus: null,
        httpOk: null,
        probeMatched: false,
        echoedProbeId: null,
        responsePreview: null,
        message: DIRECT_DIAGNOSTIC_REFUSAL,
        transportFetchInvoked: false,
      };
    }
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
    const transport = await this.diagnosticTransport(options?.transport);
    if (transport === 'refused') {
      const logical = options?.horizonUrl ?? '';
      return {
        state: 'error',
        transport: 'direct',
        url: logical,
        logicalUrl: logical,
        effectiveUrl: logical,
        urlRewritten: false,
        rewriteReason: null,
        durationMs: 0,
        httpStatus: null,
        httpOk: null,
        contentType: null,
        horizonVersion: null,
        networkPassphrase: null,
        lastLedger: null,
        lastLedgerBaseFee: null,
        horizonErrorType: null,
        horizonErrorTitle: null,
        horizonErrorDetail: null,
        responsePreview: null,
        message: DIRECT_DIAGNOSTIC_REFUSAL,
        transportFetchInvoked: false,
      };
    }
    // Probe result must not call setMode. Direct uses clearnet only after authorization above.
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
    if (this._connectInFlight) {
      try {
        await this._connectInFlight;
      } catch {
        /* still disconnect */
      }
    }
    await this._transport.close();
    this._documentReady = false;
    if (
      this._diagnosticCode !== 'PRIVACY_PREFERENCE_CORRUPT' &&
      this._diagnosticCode !== 'PRIVACY_PREFERENCE_UNREADABLE' &&
      this._diagnosticCode !== 'PRIVACY_PREFERENCE_PERSIST_FAILED' &&
      this._diagnosticCode !== 'PRIVACY_CHOICE_REQUIRED'
    ) {
      this._diagnosticCode = 'OK';
    }
    this._diagnosticStage = null;
    // Disconnect closes MixFetch only. The persisted choice stays. Clearnet
    // requires setMode('direct') from the user.
    const snapshot = this.getSnapshot();
    this.publishRuntimeStatus(snapshot);
    return snapshot;
  }

  async refreshStatus(): Promise<NymRuntimeUiSnapshot> {
    const connectedBefore = this._transport.getSnapshot().connected === true;
    await this.syncGatewayConfigUi();
    // Avoid opening offscreen solely for idle status when MixFetch is down —
    // queryStatus ensures the document; that is OK but must not mark Ready.
    const remote = await this._bridge.queryStatus();
    if (!remote) {
      if (connectedBefore && !this._connectInFlight) {
        return this.noteMixFetchLost();
      }
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
    if (!remote.connected && connectedBefore && !this._connectInFlight) {
      return this.noteMixFetchLost();
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
