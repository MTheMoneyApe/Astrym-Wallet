/**
 * SPP extension host controller (Fase 4B–5G.2 / session prep).
 * - probe(): import packaged facade + inspect exports (no init)
 * - initializeWasm(): call facade default({ module_or_path: wasmUrl }) only
 * - constructAndAttachUninitializedSession(): explicit SppSession construct + attach (no initialize)
 * - storageLabPrep: gated single Storage open when phase-authorized (default: blocked)
 * - optional bound SppSessionStatusHandle: hold + sync status publish only
 *
 * Never calls Client factory, prover spawn, session initialize, or RPC from these paths.
 * attachExistingSession does not construct or initialize a session.
 */

import {
  readSppSessionStatusHandle,
  type SppSessionStatusHandle,
} from '@solanym/wallet-core/src/stellar/spp/SppIntegrationStatus.js';
import type {
  SppSession,
  SppSessionConfig,
} from '@solanym/wallet-core/src/stellar/spp/SppSession.js';
import {
  assertExtensionOriginUrls,
  resolveSppAssetUrls,
  type ExtensionGetURL,
  type SppHostAssetUrls,
} from './paths.js';
import {
  assertFacadeReadyForFutureSession,
  loadSppSdkFacade,
  type DynamicImportFn,
  type SppSdkFacadeInspection,
} from './sdkLoad.js';
import {
  buildSppSdkRuntimeFromDeps,
  constructUninitializedSppSession,
  extractSppSdkRuntimeDepsFromLoadedFacade,
  validateSppSessionPrepInput,
  type SppSessionPrepInput,
} from './sessionConstruct.js';
import {
  SppStorageLabPrep,
  type StorageLabEvidence,
  type StorageLabGateInput,
  type StorageOpenFn,
  type SppStorageHandle,
  type SppStorageLabPhase,
} from './storageLabPrep.js';

export type SppHostPhase = 'uninitialized' | 'loading' | 'ready' | 'error';

/** WASM init lifecycle (separate from facade probe phase). */
export type SppWasmPhase = 'not-started' | 'initializing' | 'ready' | 'error';

/**
 * Verified against stellar-private-payments@0.2.1 glue:
 * `export { __wbg_init as default }` accepts `{ module_or_path }` then fetch+instantiate.
 */
export type SppWasmInitFn = (options: { module_or_path: string }) => Promise<unknown>;

export type SppHostSnapshot = {
  phase: SppHostPhase;
  errorMessage: string | null;
  assets: SppHostAssetUrls | null;
  inspection: SppSdkFacadeInspection | null;
  metaVersion: string | null;
  importedModuleUrl: string | null;
  wasmPhase: SppWasmPhase;
  wasmUrlUsed: string | null;
  wasmErrorMessage: string | null;
  /** True only after default({ module_or_path }) completed successfully. */
  wasmInitialized: boolean;
  /**
   * True only when a bound session handle reports `state === 'ready'`.
   * Binding alone (uninitialized) keeps this false. Not a payments signal.
   */
  sdkInitialized: boolean;
  /**
   * Product init path for SppSession — hard-off until an authorized later phase.
   * attachExistingSession does not flip this.
   */
  sessionInitializeEnabled: boolean;
  /** True when the controller holds a session reference (any lifecycle state). */
  sessionBound: boolean;
  /** Mirror of bound session.state, or null when unbound. */
  sessionState: SppSessionStatusHandle['state'] | null;
  /** Last construct/attach error (cleared on success). */
  sessionConstructError: string | null;
  /** Monotonic status publish generation for popup stale rejection. */
  sessionStatusGeneration: number;
  storageLabPhase: SppStorageLabPhase;
  storageLabErrorMessage: string | null;
  storageLabEvidence: StorageLabEvidence;
  storageLabExecutionAuthorized: boolean;
  storageLabRunEnabled: boolean;
  storageLabFreeEnabled: boolean;
};

export type SppBoundSessionChangeMeta = {
  generation: number;
};

export type SppHostControllerDeps = {
  getURL: ExtensionGetURL;
  importModule?: DynamicImportFn;
  /** Optional meta fetch (defaults to fetch). Inject mock in tests. */
  readText?: (url: string) => Promise<string>;
  /**
   * Override STORAGE_LAB_EXECUTION_AUTHORIZED for tests.
   * Production / Chrome builds omit this → constant default (false).
   */
  storageLabExecutionAuthorized?: boolean;
  /** Override open watchdog ms for tests (non-cancelling). */
  storageOpenWatchdogMs?: number;
  /**
   * Optional mirror for popup/settings (e.g. chrome.storage).
   * Called on attach/clear/publish with RO handle or null + generation.
   * Never initializes a session.
   */
  onBoundSessionChange?: (
    session: SppSessionStatusHandle | null,
    meta: SppBoundSessionChangeMeta,
  ) => void;
};

function sanitizeError(cause: unknown): string {
  if (cause instanceof Error) {
    const msg = cause.message || cause.name || 'error';
    return msg.length > 240 ? `${msg.slice(0, 240)}…` : msg;
  }
  return 'Unexpected SPP host failure';
}

function isWasmInitFn(value: unknown): value is SppWasmInitFn {
  return typeof value === 'function';
}

function extractStorageOpenFn(module: Record<string, unknown>): StorageOpenFn | null {
  const storageNs = module['Storage'];
  if (!storageNs || typeof storageNs !== 'object') return null;
  const openCandidate = (storageNs as { open?: unknown }).open;
  if (typeof openCandidate !== 'function') return null;
  return (openCandidate as StorageOpenFn).bind(storageNs);
}

async function probeOpfsEntryNames(): Promise<{ accessible: boolean; names: string[] }> {
  const nav = globalThis.navigator as
    | { storage?: { getDirectory?: () => Promise<FileSystemDirectoryHandle> } }
    | undefined;
  const getDirectory = nav?.storage?.getDirectory;
  if (typeof getDirectory !== 'function') {
    return { accessible: false, names: [] };
  }
  const root = await getDirectory.call(nav!.storage);
  const names: string[] = [];
  // FileSystemDirectoryHandle async iterator — names only, never file contents.
  const iterable = root as unknown as AsyncIterable<[string, FileSystemHandle]>;
  if (typeof iterable[Symbol.asyncIterator] === 'function') {
    for await (const [name] of iterable) {
      names.push(name);
      if (names.length >= 32) break;
    }
  }
  return { accessible: true, names };
}

export class SppHostController {
  private _phase: SppHostPhase = 'uninitialized';
  private _errorMessage: string | null = null;
  private _assets: SppHostAssetUrls | null = null;
  private _inspection: SppSdkFacadeInspection | null = null;
  private _metaVersion: string | null = null;
  private _importedModuleUrl: string | null = null;
  private _wasmInit: SppWasmInitFn | null = null;
  private _storageOpenFn: StorageOpenFn | null = null;
  private _wasmPhase: SppWasmPhase = 'not-started';
  private _wasmUrlUsed: string | null = null;
  private _wasmErrorMessage: string | null = null;
  private _wasmInFlight: Promise<SppHostSnapshot> | null = null;
  /**
   * Optional already-existing session (5G.2). Null by default.
   * Construct path may bind an uninitialized SppSession; never auto-initialize.
   */
  private _boundSession: SppSessionStatusHandle | null = null;
  /** Facade module retained after successful probe (for explicit session construct). */
  private _facadeModule: Record<string, unknown> | null = null;
  private _sessionConstructError: string | null = null;
  private _sessionStatusGeneration = 0;
  private readonly _deps: SppHostControllerDeps;
  private readonly _storageLab: SppStorageLabPrep;

  constructor(deps: SppHostControllerDeps) {
    if (!deps?.getURL) {
      throw new Error('SppHostController requires getURL');
    }
    this._deps = deps;
    this._storageLab = new SppStorageLabPrep({
      ...(deps.storageLabExecutionAuthorized !== undefined
        ? { executionAuthorized: deps.storageLabExecutionAuthorized }
        : {}),
      ...(deps.storageOpenWatchdogMs !== undefined
        ? { openWatchdogMs: deps.storageOpenWatchdogMs }
        : {}),
    });
  }

  get phase(): SppHostPhase {
    return this._phase;
  }

  get wasmPhase(): SppWasmPhase {
    return this._wasmPhase;
  }

  get storageLabPhase(): SppStorageLabPhase {
    return this._storageLab.phase;
  }

  get hasBoundSession(): boolean {
    return this._boundSession !== null;
  }

  /**
   * Bind an already-existing session status handle.
   * Sync only: does not construct, initialize, dispose, open Storage, or touch WASM.
   * Rejects a second bind (including an incompatible replacement) so the host
   * cannot silently hold duplicate sessions.
   */
  attachExistingSession(session: SppSessionStatusHandle): void {
    if (!session || typeof session.state !== 'string') {
      throw new Error('attachExistingSession requires an existing SppSessionStatusHandle');
    }
    if (this._boundSession !== null) {
      if (this._boundSession === session) {
        this._emitBoundSessionChange();
        return;
      }
      throw new Error(
        'SppHostController already holds a bound session (clear before attaching another)',
      );
    }
    this._boundSession = session;
    this._sessionConstructError = null;
    this._emitBoundSessionChange();
  }

  /**
   * Drop the host reference without disposing the underlying session.
   * Dispose / free remain explicit later-authorized steps owned outside this slot.
   */
  clearBoundSession(): void {
    this._boundSession = null;
    this._emitBoundSessionChange();
  }

  /**
   * Re-publish the current bound handle snapshot (e.g. after external state change).
   * Does not initialize or dispose.
   */
  publishBoundSessionStatus(): void {
    this._emitBoundSessionChange();
  }

  private _emitBoundSessionChange(): void {
    this._sessionStatusGeneration += 1;
    this._deps.onBoundSessionChange?.(this.readBoundSessionStatus(), {
      generation: this._sessionStatusGeneration,
    });
  }

  /**
   * Explicit operator action: validate prep → construct uninitialized SppSession →
   * attach + publish. Does NOT call initialize(), dispose(), WASM, Storage, Client, or RPC.
   */
  constructAndAttachUninitializedSession(prep: SppSessionPrepInput): SppHostSnapshot {
    this._sessionConstructError = null;
    try {
      if (this._boundSession !== null) {
        throw new Error(
          'SppHostController already holds a bound session (clear before constructing another)',
        );
      }
      if (this._phase !== 'ready' || !this._assets || !this._facadeModule) {
        throw new Error('Facade probe must succeed before session construction');
      }
      if (this._phase === 'loading' || this._wasmPhase === 'initializing') {
        throw new Error('Cannot construct session while another host operation is in progress');
      }

      const validated = validateSppSessionPrepInput(prep);
      const deps = extractSppSdkRuntimeDepsFromLoadedFacade(this._facadeModule);
      const runtime = buildSppSdkRuntimeFromDeps(deps);
      const config: SppSessionConfig = {
        rpcUrl: validated.rpcUrl,
        contractConfig: validated.contractConfig as SppSessionConfig['contractConfig'],
        circuitLock: validated.circuitLock as SppSessionConfig['circuitLock'],
        assets: {
          wasmUrl: this._assets.wasmUrl,
          storageWorkerUrl: this._assets.storageWorkerUrl,
          proverWorkerUrl: this._assets.proverWorkerUrl,
          circuitsBaseUrl: this._assets.circuitsBaseUrl,
        },
        runtime,
        ...(validated.bootnodeUrl !== undefined ? { bootnodeUrl: validated.bootnodeUrl } : {}),
      };
      const session: SppSession = constructUninitializedSppSession(config);

      if (session.state !== 'uninitialized') {
        throw new Error(`Expected uninitialized session, got ${session.state}`);
      }

      this.attachExistingSession(session);
      return this.snapshot();
    } catch (cause) {
      this._sessionConstructError = sanitizeError(cause);
      // Do not leave a partial bind; publish clear so popup drops stale handles.
      if (this._boundSession === null) {
        this._emitBoundSessionChange();
      }
      throw cause instanceof Error ? cause : new Error(this._sessionConstructError);
    }
  }

  /**
   * Synchronous RO mirror via {@link readSppSessionStatusHandle}.
   * Safe for probes; does not call initialize, RO reads, or dispose.
   */
  readBoundSessionStatus(): SppSessionStatusHandle | null {
    return readSppSessionStatusHandle(this._boundSession);
  }

  /**
   * Host-internal access to the bound reference (same object identity).
   * Not for `__SOLANYM_SPP_HOST__`, popup, provider, or IPC in this phase.
   */
  getBoundSessionForHost(): SppSessionStatusHandle | null {
    return this._boundSession;
  }

  private storageLabContext() {
    return {
      facadePhase: this._phase,
      wasmPhase: this._wasmPhase,
      wasmInitialized: this._wasmPhase === 'ready',
      metaVersion: this._metaVersion,
      importedModuleUrl: this._importedModuleUrl,
      wasmUrlUsed: this._wasmUrlUsed,
      assets: this._assets,
      inspection: this._inspection,
      facadeErrorMessage: this._errorMessage,
      wasmErrorMessage: this._wasmErrorMessage,
    };
  }

  snapshot(): SppHostSnapshot {
    const storageLabEvidence = this._storageLab.buildEvidence(this.storageLabContext());
    return {
      phase: this._phase,
      errorMessage: this._errorMessage,
      assets: this._assets,
      inspection: this._inspection,
      metaVersion: this._metaVersion,
      importedModuleUrl: this._importedModuleUrl,
      wasmPhase: this._wasmPhase,
      wasmUrlUsed: this._wasmUrlUsed,
      wasmErrorMessage: this._wasmErrorMessage,
      wasmInitialized: this._wasmPhase === 'ready',
      sdkInitialized: this._boundSession?.state === 'ready',
      sessionInitializeEnabled: false,
      sessionBound: this._boundSession !== null,
      sessionState: this._boundSession?.state ?? null,
      sessionConstructError: this._sessionConstructError,
      sessionStatusGeneration: this._sessionStatusGeneration,
      storageLabPhase: this._storageLab.phase,
      storageLabErrorMessage: this._storageLab.errorMessage,
      storageLabEvidence,
      storageLabExecutionAuthorized: this._storageLab.executionAuthorized,
      storageLabRunEnabled: this._storageLab.storageRunEnabled,
      storageLabFreeEnabled: this._storageLab.storageFreeEnabled,
    };
  }

  /**
   * Explicit operator action: resolve packaged URLs, read asset meta, dynamically
   * import the facade from chrome-extension://…/spp/js/index.js, inspect exports.
   * Does not call WASM init or Storage open.
   */
  async probe(): Promise<SppHostSnapshot> {
    if (this._phase === 'loading' || this._wasmPhase === 'initializing') {
      throw new Error('SPP host operation already in progress');
    }

    this._phase = 'loading';
    this._errorMessage = null;
    this._assets = null;
    this._inspection = null;
    this._metaVersion = null;
      this._importedModuleUrl = null;
      this._wasmInit = null;
      this._storageOpenFn = null;
      this._facadeModule = null;
      this._sessionConstructError = null;
      // Facade re-probe does not unload a globally initialized wasm-bindgen module.
      if (this._wasmPhase !== 'ready') {
        this._wasmPhase = 'not-started';
        this._wasmUrlUsed = null;
        this._wasmErrorMessage = null;
      }

    try {
      const assets = resolveSppAssetUrls(this._deps.getURL);
      assertExtensionOriginUrls(assets);
      this._assets = assets;
      this._importedModuleUrl = assets.facadeModuleUrl;

      const readText =
        this._deps.readText ??
        (async (url: string) => {
          const res = await fetch(url, { method: 'GET', cache: 'no-store' });
          if (!res.ok) {
            throw new Error(`Failed to read ${url}: HTTP ${res.status}`);
          }
          return res.text();
        });

      try {
        const metaRaw = await readText(assets.metaUrl);
        const meta = JSON.parse(metaRaw) as { version?: string; name?: string };
        if (meta.version !== '0.2.1') {
          throw new Error(`Unexpected SPP asset version: ${String(meta.version)}`);
        }
        this._metaVersion = meta.version;
      } catch (metaErr) {
        throw new Error(`SPP_ASSET_META.json: ${sanitizeError(metaErr)}`);
      }

      const loaded = await loadSppSdkFacade({
        moduleUrl: assets.facadeModuleUrl,
        ...(this._deps.importModule ? { importModule: this._deps.importModule } : {}),
      });
      this._importedModuleUrl = loaded.moduleUrl;
      this._inspection = loaded.inspection;
      assertFacadeReadyForFutureSession(loaded.inspection);

      const initCandidate = loaded.module['default'];
      if (!isWasmInitFn(initCandidate)) {
        throw new Error('Facade default export is not a function (expected __wbg_init)');
      }
      this._wasmInit = initCandidate;
      this._storageOpenFn = extractStorageOpenFn(loaded.module);
      this._facadeModule = loaded.module as Record<string, unknown>;

      this._phase = 'ready';
      return this.snapshot();
    } catch (cause) {
      this._phase = 'error';
      this._errorMessage = sanitizeError(cause);
      this._wasmInit = null;
      this._storageOpenFn = null;
      this._facadeModule = null;
      return this.snapshot();
    }
  }

  /**
   * Explicit operator action: initialize packaged WASM only.
   * Does not open Storage, create Client, or start prover workers by itself.
   */
  async initializeWasm(): Promise<SppHostSnapshot> {
    if (this._wasmInFlight) {
      return this._wasmInFlight;
    }
    if (this._phase === 'loading') {
      throw new Error('Cannot initialize WASM while facade probe is in progress');
    }
    if (this._phase !== 'ready' || !this._assets || !this._wasmInit) {
      this._wasmPhase = 'error';
      this._wasmErrorMessage =
        'Facade probe must succeed before WASM init (phase must be ready with default export)';
      return this.snapshot();
    }
    if (this._wasmPhase === 'ready') {
      return this.snapshot();
    }
    if (this._wasmPhase === 'initializing') {
      throw new Error('WASM initialization already in progress');
    }

    const wasmUrl = this._assets.wasmUrl;
    if (wasmUrl.startsWith('http://') || wasmUrl.startsWith('https://')) {
      this._wasmPhase = 'error';
      this._wasmErrorMessage = 'Refusing WASM URL with http(s) scheme';
      return this.snapshot();
    }

    this._wasmPhase = 'initializing';
    this._wasmErrorMessage = null;
    this._wasmUrlUsed = wasmUrl;

    const initFn = this._wasmInit;
    this._wasmInFlight = (async () => {
      try {
        await initFn({ module_or_path: wasmUrl });
        this._wasmPhase = 'ready';
        this._wasmErrorMessage = null;
        return this.snapshot();
      } catch (cause) {
        this._wasmPhase = 'error';
        this._wasmErrorMessage = sanitizeError(cause);
        return this.snapshot();
      } finally {
        this._wasmInFlight = null;
      }
    })();

    return this._wasmInFlight;
  }

  /**
   * Full SPP session remains disabled (no Client / Prover / RPC).
   */
  async initializeSession(): Promise<never> {
    throw new Error(
      'SppSession initialize is disabled in Fase 5D (Storage-lab only; no Client.new / Prover / RPC)',
    );
  }

  setStorageLabGates(input: StorageLabGateInput): SppHostSnapshot {
    if (this._phase === 'loading' || this._wasmPhase === 'initializing') {
      throw new Error('SPP host operation already in progress');
    }
    this._storageLab.setLabGates(input);
    return this.snapshot();
  }

  evaluateStorageLabPrep(): SppHostSnapshot {
    if (this._phase === 'loading' || this._wasmPhase === 'initializing') {
      throw new Error('SPP host operation already in progress');
    }
    this._storageLab.evaluatePrep(this.storageLabContext());
    return this.snapshot();
  }

  /**
   * Single authorized Storage open (max one per instance). No-op refuse when unauthorized.
   * Does not run on load or as a side effect of evaluateStorageLabPrep.
   */
  async requestStorageLabRun(): Promise<SppHostSnapshot> {
    if (this._phase === 'loading' || this._wasmPhase === 'initializing') {
      throw new Error('SPP host operation already in progress');
    }

    const openFn = this._storageOpenFn;
    const workerUrl = this._assets?.storageWorkerUrl;
    if (!openFn || !workerUrl) {
      // Still go through prep refuse path with a dummy that must never be called.
      await this._storageLab.requestRealStorageOpen(this.storageLabContext(), {
        openFn: async () => {
          throw new Error('Storage open function unavailable');
        },
        workerUrl: workerUrl ?? '',
      });
      return this.snapshot();
    }

    // Instrumentation only: temporary wrap of globalThis.fetch during open.
    // Does NOT observe XHR, WebSocket, sendBeacon, chrome.* APIs, or Worker-internal fetches.
    // false ⇒ no http(s) via this wrap in the window — not "no network occurred".
    let sawExternalHttpFetch = false;
    const fetchInstrumented = typeof globalThis.fetch === 'function';
    const previousFetch = globalThis.fetch;
    if (fetchInstrumented) {
      const original = previousFetch.bind(globalThis);
      globalThis.fetch = (async (input, init) => {
        const url = String(typeof input === 'string' ? input : (input as Request).url);
        if (url.startsWith('http://') || url.startsWith('https://')) {
          sawExternalHttpFetch = true;
        }
        return original(input, init);
      }) as typeof fetch;
    }

    try {
      await this._storageLab.requestRealStorageOpen(this.storageLabContext(), {
        openFn: async (opts) => {
          const handle = (await openFn(opts)) as SppStorageHandle;
          return handle;
        },
        workerUrl,
        probeOpfsNames: probeOpfsEntryNames,
        observeExternalNetwork: () => (fetchInstrumented ? sawExternalHttpFetch : null),
      });
    } finally {
      if (fetchInstrumented) {
        globalThis.fetch = previousFetch;
      }
    }

    return this.snapshot();
  }

  /** Explicit free() of the private handle — never claims worker/OPFS wipe. */
  async requestStorageLabFree(): Promise<SppHostSnapshot> {
    if (this._phase === 'loading' || this._wasmPhase === 'initializing') {
      throw new Error('SPP host operation already in progress');
    }
    await this._storageLab.requestStorageFree(this.storageLabContext());
    return this.snapshot();
  }
}
