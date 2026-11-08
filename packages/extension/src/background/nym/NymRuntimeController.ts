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

export type PrivacyStorageNotice = { newValue: unknown };

function subscribeChromePrivacyChanges(
  listener: (notice?: PrivacyStorageNotice) => void,
): () => void {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};
  const wrapped = (changes: Record<string, { newValue?: unknown } | undefined>, area: string) => {
    if (
      area !== 'local' ||
      !Object.prototype.hasOwnProperty.call(changes, NYM_PRIVACY_PREFERENCE_STORAGE_KEY)
    ) {
      return;
    }
    const change = changes[NYM_PRIVACY_PREFERENCE_STORAGE_KEY];
    listener({ newValue: change?.newValue });
  };
  chrome.storage.onChanged.addListener(wrapped);
  return () => {
    chrome.storage.onChanged.removeListener(wrapped);
  };
}

function defaultLocalStorage(): NymPrivacyPreferenceStore {
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
      remove: (keys: string | string[]) =>
        new Promise<void>((resolve, reject) => {
          chrome.storage.local.remove(keys, () => {
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
    remove: async (keys: string | string[]) => {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) mem.delete(key);
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
  /**
   * One generation for hydration, remote invalidation, and local choices.
   * A local write may start only while it still owns this generation.
   * Its own storage echo is not a new generation.
   */
  private _policyGeneration = 0;
  /** Latest explicit setMode. Newer than any queued choice it replaced. */
  private _localIntent: { generation: number; choice: NymPrivacyChoice } | null = null;
  /**
   * Local Nym was requested and is not the durable record yet.
   * A reread of the previous Direct must not clear it. A new controller
   * does not carry this flag, so reload still restores that Direct.
   * A later local Direct save, or a disk value that is actually Nym, clears it.
   */
  private _unpersistedNymRevocation = false;
  /** Write posted to storage and not yet settled. Its echo must not rearm policy. */
  private _inflightWrite: { generation: number; choice: NymPrivacyChoice } | null = null;
  /** Set while that write's synchronous self-echo is still being delivered. */
  private _echoSuppress: 'value' | 'clear' | null = null;
  /** Last foreign privacy notice. Undefined value means the key was cleared. */
  private _foreignGeneration = 0;
  private _foreignValueKnown = false;
  private _foreignValue: unknown = undefined;
  /** Set synchronously on invalidation, before any storage read. Blocks clearnet. */
  private _directSuspended = false;
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
     * Notified when storage reports a privacy-key change.
     * A notice carries the event's new value. Calling the listener with no
     * notice is an unspecified invalidation (tests and unknown adapters).
     * Defaults to chrome.storage.onChanged when the default store is used.
     * The writer's own echo is ignored inside the controller; it is not a new choice.
     */
    onPrivacyStoreChanged?: (listener: (notice?: PrivacyStorageNotice) => void) => () => void;
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
      subscribe((notice) => {
        this.onPrivacyNotice(notice);
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
    if (this._directSuspended || !this._preferenceHydrated) return true;
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
    if (mode !== 'direct' && mode !== 'nym') {
      throw new Error(`Invalid transport mode: ${String(mode)}`);
    }
    // Revoke Direct as soon as the choice is requested, before the write queue runs.
    const generation = ++this._policyGeneration;
    this._localIntent = { generation, choice: mode };
    this.suspendDirect();
    if (mode === 'nym') {
      // Not durable until the write succeeds. A stale Direct reread must not undo this.
      this._unpersistedNymRevocation = true;
      this.applyResolved('nym', 'nym', false);
    }
    const job = this._choiceQueue.then(() => this.commitMode(mode, generation));
    this._choiceQueue = job.then(
      () => undefined,
      () => undefined,
    );
    return job;
  }

  private async commitMode(mode: NymTransportMode, generation: number): Promise<void> {
    // Queued work that already lost to a newer choice or a foreign notice
    // must not touch storage. A skipped Nym save is still an unsaved revocation.
    if (this._policyGeneration !== generation) {
      if (mode === 'nym' && this._localIntent?.generation === generation) {
        this.notePersistFailed(generation, 'nym');
      }
      return;
    }
    switch (mode) {
      case 'nym':
        // Memory is already Nym and not durable. A failed write leaves the previous
        // stored value in place. Reload restores that value, which may be Direct.
        // This completion must not be described as a saved Nym choice.
        try {
          await this.writeChoice('nym', generation);
        } catch (err) {
          this.notePersistFailed(generation, 'nym');
          throw err;
        }
        if (this._policyGeneration !== generation) {
          await this.repairForeignClobber('nym');
          return;
        }
        this._unpersistedNymRevocation = false;
        this._preferenceDurable = true;
        this._directSuspended = false;
        this.publishRuntimeStatus();
        return;
      case 'direct':
        try {
          await this.writeChoice('direct', generation);
        } catch (err) {
          this.notePersistFailed(generation, 'direct');
          throw err;
        }
        if (this._policyGeneration !== generation) {
          await this.repairForeignClobber('direct');
          return;
        }
        this._unpersistedNymRevocation = false;
        this.applyResolved('direct', 'direct', true);
        this.publishRuntimeStatus();
        return;
      default: {
        const _never: never = mode;
        throw new Error(`Invalid transport mode: ${String(_never)}`);
      }
    }
  }

  /** Storage write whose own onChanged must not become a newer privacy generation. */
  private async writeChoice(choice: NymPrivacyChoice, generation: number): Promise<void> {
    if (this._policyGeneration !== generation) return;
    this._inflightWrite = { generation, choice };
    this._echoSuppress = 'value';
    try {
      await writeNymPrivacyPreference(this._privacyStore, choice);
    } finally {
      this._echoSuppress = null;
      if (
        this._inflightWrite?.generation === generation &&
        this._inflightWrite.choice === choice
      ) {
        this._inflightWrite = null;
      }
    }
  }

  /**
   * The latest local attempt failed. Keep its revocation even if an older
   * self-echo was in flight. A newer foreign notice or a newer setMode owns
   * the outcome instead, and this failure must not hide that.
   */
  private notePersistFailed(generation: number, choice: NymPrivacyChoice): void {
    if (this._localIntent?.generation !== generation) return;
    if (choice === 'nym') {
      // A foreign notice may already have moved the policy generation. The
      // failed Nym is still the latest local intent, so the failure stays.
      this.keepUnpersistedNymRevocation();
      return;
    }
    if (this._policyGeneration !== generation) return;
    this._preferenceDurable = false;
    this._diagnosticCode = 'PRIVACY_PREFERENCE_PERSIST_FAILED';
    this.suspendDirect();
    this.publishRuntimeStatus();
  }

  /** Failed local Nym stays blocked. Receiving an old Direct notice is not a new choice. */
  private keepUnpersistedNymRevocation(): void {
    this._unpersistedNymRevocation = true;
    this._mode = 'nym';
    this._privacyPreference = 'nym';
    this._preferenceDurable = false;
    this._diagnosticCode = 'PRIVACY_PREFERENCE_PERSIST_FAILED';
    this._directSuspended = true;
    if (this._router.mode === 'direct') this._router.setMode('nym');
    this.publishRuntimeStatus();
  }

  /**
   * A local write finished after a foreign invalidation. Apply the fresh read.
   * A Nym notice may revoke a Direct value this write just stored. A Direct
   * notice is never written back: it may be older than the Nym already on disk.
   */
  private async repairForeignClobber(written: NymPrivacyChoice): Promise<void> {
    if (this._localIntent && this._localIntent.generation === this._policyGeneration) return;
    const generation = this._policyGeneration;
    let record: NymPrivacyPreferenceRecord;
    try {
      record = await readNymPrivacyPreference(this._privacyStore);
    } catch {
      return;
    }
    if (this._policyGeneration !== generation) return;
    const foreign = this._foreignValueKnown ? this._foreignValue : undefined;
    if (
      record.kind === 'chosen' &&
      record.choice === written &&
      foreign === 'nym' &&
      written !== 'nym'
    ) {
      try {
        await this.writeChoice('nym', generation);
      } catch {
        if (this._policyGeneration === generation) {
          this._preferenceDurable = false;
          this._diagnosticCode = 'PRIVACY_PREFERENCE_PERSIST_FAILED';
          this.publishRuntimeStatus();
        }
        return;
      }
      if (this._policyGeneration !== generation) return;
      this._unpersistedNymRevocation = false;
      this.applyResolved('nym', 'nym', true);
      this.publishRuntimeStatus();
      return;
    }
    if (
      record.kind === 'chosen' &&
      record.choice === written &&
      this._foreignValueKnown &&
      foreign == null
    ) {
      const remove = this._privacyStore.remove;
      if (typeof remove !== 'function') {
        this.publishRuntimeStatus();
        return;
      }
      this._echoSuppress = 'clear';
      try {
        await remove.call(this._privacyStore, NYM_PRIVACY_PREFERENCE_STORAGE_KEY);
      } catch {
        if (this._policyGeneration === generation) {
          this._preferenceDurable = false;
          this._diagnosticCode = 'PRIVACY_PREFERENCE_PERSIST_FAILED';
          this.publishRuntimeStatus();
        }
        return;
      } finally {
        this._echoSuppress = null;
      }
      if (this._policyGeneration !== generation) return;
      this.applyResolved('nym', null, false);
      this._diagnosticCode = 'PRIVACY_CHOICE_REQUIRED';
      this.publishRuntimeStatus();
      return;
    }
    this.applyPrivacyRecord(record);
    this.publishRuntimeStatus();
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
    // A completed decision for this generation ends the revocation window.
    this._directSuspended = false;
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

  /** Drop Direct before any async reread. A stale read cannot undo this generation. */
  private suspendDirect(): void {
    this._directSuspended = true;
    if (this._mode === 'direct') this._mode = 'nym';
    if (this._router.mode === 'direct') this._router.setMode('nym');
  }

  /**
   * Storage notification. The echo of a write this controller just posted is
   * not a new choice. Every other notice only invalidates: Direct stays
   * suspended until a fresh read of the durable value. A Nym payload revokes
   * immediately, but it does not authorize clearnet and does not outrank the read.
   */
  private onPrivacyNotice(notice?: PrivacyStorageNotice): void {
    if (this.isOwnEcho(notice)) return;
    const generation = ++this._policyGeneration;
    this._foreignGeneration = generation;
    this._foreignValueKnown = notice !== undefined;
    this._foreignValue = notice?.newValue;
    this.suspendDirect();
    if (notice?.newValue === 'nym') {
      this._mode = 'nym';
      this._privacyPreference = 'nym';
      this._preferenceDurable = false;
      if (this._router.mode === 'direct') this._router.setMode('nym');
    }
    this.publishRuntimeStatus();
    this._privacyReload = this._privacyReload
      .catch(() => undefined)
      .then(() => this.reloadPrivacyFromStore(generation));
  }

  private isOwnEcho(notice?: PrivacyStorageNotice): boolean {
    if (!notice || this._echoSuppress == null) return false;
    if (this._echoSuppress === 'clear') return notice.newValue == null;
    return this._inflightWrite != null && Object.is(notice.newValue, this._inflightWrite.choice);
  }

  /** Apply a privacy value written by another instance. Does not invent Direct. */
  private async reloadPrivacyFromStore(generation: number): Promise<void> {
    let record: NymPrivacyPreferenceRecord;
    try {
      record = await readNymPrivacyPreference(this._privacyStore);
    } catch {
      if (this._policyGeneration !== generation) return;
      this.applyResolved('nym', null, false);
      this._diagnosticCode = 'PRIVACY_PREFERENCE_UNREADABLE';
      this.publishRuntimeStatus();
      return;
    }
    if (this._policyGeneration !== generation) return;
    if (this.pendingLocalWriteStillOnDisk(record)) {
      // The read saw this controller's own unsettled write, not a foreign decision.
      this.publishRuntimeStatus();
      return;
    }
    this.applyPrivacyRecord(record);
    this.publishRuntimeStatus();
  }

  /** True when the fresh read is still the local write that a notice invalidated. */
  private pendingLocalWriteStillOnDisk(record: NymPrivacyPreferenceRecord): boolean {
    if (!this._inflightWrite) return false;
    if (this._inflightWrite.generation === this._policyGeneration) return false;
    return record.kind === 'chosen' && record.choice === this._inflightWrite.choice;
  }

  private applyPrivacyRecord(record: NymPrivacyPreferenceRecord): void {
    switch (record.kind) {
      case 'unset':
        this.applyResolved('nym', null, false);
        this._diagnosticCode = 'PRIVACY_CHOICE_REQUIRED';
        return;
      case 'chosen':
        if (record.choice === 'direct' && this._unpersistedNymRevocation) {
          this.keepUnpersistedNymRevocation();
          return;
        }
        if (record.choice === 'nym') this._unpersistedNymRevocation = false;
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
    if (this._directSuspended || !this._preferenceHydrated) return false;
    return this._privacyPreference === 'direct' && this._mode === 'direct';
  }

  /** Last-moment Direct egress. Rechecks policy at the native fetch call. */
  private authorizedClearnetFetch(url: string, init?: RequestInit): Promise<Response> {
    if (!this.clearnetExplicitlyAuthorized()) {
      return Promise.reject(
        new NymTransportError(
          'NOT_CONNECTED',
          'Direct egress refused: persisted privacy choice does not allow clearnet',
        ),
      );
    }
    return clearnetFetchImpl(url, init);
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
    // Harness-only. Production never sets this. It pauses the first read so a
    // debugger can observe the fail-closed window. It does not choose Direct.
    const gate = (globalThis as { __ASTRYM_DEFER_PRIVACY_HYDRATE?: Promise<void> })
      .__ASTRYM_DEFER_PRIVACY_HYDRATE;
    if (gate && typeof gate.then === 'function') await gate;
    const generation = this._policyGeneration;
    try {
      const record = await readNymPrivacyPreference(this._privacyStore);
      if (this._policyGeneration !== generation) return;
      this.applyPrivacyRecord(record);
    } catch {
      if (this._policyGeneration !== generation) return;
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
    if (transport === 'refused' || (transport === 'direct' && !this.clearnetExplicitlyAuthorized())) {
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
      : (url: string, init?: RequestInit) => this.authorizedClearnetFetch(url, init);
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
    if (transport === 'refused' || (transport === 'direct' && !this.clearnetExplicitlyAuthorized())) {
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
          fetchViaRouter: (url, init) => this.authorizedClearnetFetch(url, init),
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
