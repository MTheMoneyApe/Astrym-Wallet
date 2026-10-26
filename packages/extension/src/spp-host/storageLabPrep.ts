/**
 * Fase 5D â€” Storage lab prep + optional single authorized Storage open.
 *
 * Phase execution stays blocked while STORAGE_LAB_EXECUTION_AUTHORIZED is false.
 * Lab gates (profile / OPFS / diff review) are separate and never open Storage alone.
 *
 * Calls the injected openFn only â€” never Client factory / prover spawn / RPC.
 */

import type { SppHostAssetUrls } from './paths.js';
import type { SppSdkFacadeInspection } from './sdkLoad.js';

/**
 * Hard phase gate. Remains false until an operator flips it after reviewing the 5D diff
 * and authorizing a disposable-lab Chrome run. Default false = zero real opens.
 */
export const STORAGE_LAB_EXECUTION_AUTHORIZED = false;

/**
 * SPP 0.2.1 Storage.open has no documented cancellation API.
 * A UI/watchdog timeout MUST NOT be implemented via Promise.race "cancel" â€” the
 * underlying open (and any worker/OPFS side effects) can keep running.
 * Once openFn is invoked, this instance permanently consumes its single open slot.
 */
export const STORAGE_OPEN_CANCELLATION_SUPPORTED = false;

/**
 * Soft watchdog threshold (ms). Used only to flag slow/hung opens after/during
 * await â€” never to cancel openFn or to unlock a second open.
 */
export const STORAGE_OPEN_WATCHDOG_MS = 60_000;

/** Open limit is per SppStorageLabPrep / host-controller instance (page lifetime). */
export const STORAGE_OPEN_LIMIT_SCOPE = 'per-controller-instance' as const;

export type SppStorageLabPhase =
  | 'not-run'
  | 'blocked'
  | 'ready-for-lab'
  | 'running'
  | 'success'
  | 'error';

export type StorageLabGateInput = {
  /** Operator confirms a dedicated Chrome profile (not daily Solanym). */
  dedicatedLabProfileConfirmed: boolean;
  /** Operator accepts that spp.db may persist in OPFS with no public wipe API. */
  opfsPersistenceRiskAccepted: boolean;
  /** Operator confirms they reviewed and accept this phase's execution diff. */
  phaseDiffReviewedAndAuthorized: boolean;
};

/** Minimal handle surface â€” free only; never exposed to UI. */
export type SppStorageHandle = {
  free?: () => void;
};

export type StorageOpenFn = (options: { workerUrl: string }) => Promise<SppStorageHandle>;

/** Host snapshot fields needed for evidence â€” kept local to avoid circular imports. */
export type StorageLabHostContext = {
  facadePhase: string;
  wasmPhase: string;
  wasmInitialized: boolean;
  metaVersion: string | null;
  importedModuleUrl: string | null;
  wasmUrlUsed: string | null;
  assets: SppHostAssetUrls | null;
  inspection: SppSdkFacadeInspection | null;
  facadeErrorMessage: string | null;
  wasmErrorMessage: string | null;
};

export type StorageLabRunArgs = {
  openFn: StorageOpenFn;
  workerUrl: string;
  /** Optional OPFS name probe after successful open (names only, no DB content). */
  probeOpfsNames?: () => Promise<{ accessible: boolean; names: string[] }>;
  /** Optional external http(s) observation during open (instrumentation). */
  observeExternalNetwork?: () => boolean | null;
};

/** Evidence payload â€” null = not observed yet (never pretend null means false). */
export type StorageLabEvidence = {
  phase: '5D-storage-lab';
  recordedAt: string;
  storageLabPhase: SppStorageLabPhase;
  executionAuthorized: boolean;
  storageRunEnabled: boolean;
  storageFreeEnabled: boolean;
  facadePhase: string;
  wasmPhase: string;
  wasmInitialized: boolean;
  metaVersion: string | null;
  importedModuleUrl: string | null;
  wasmUrlUsed: string | null;
  localAssetUrls: {
    facadeModuleUrl: string;
    wasmUrl: string;
    storageWorkerUrl: string;
    proverWorkerUrl: string;
    circuitsBaseUrl: string;
    metaUrl: string;
  } | null;
  facadeExportsPresent: {
    defaultInit: boolean;
    clientNew: boolean;
    storageOpen: boolean;
  } | null;
  blockReasons: string[];
  errors: string[];
  notes: string[];
  /** Instrumentation: whether openFn was invoked. null before any run decision. */
  storageOpenAttempted: boolean | null;
  storageOpenInvocationCount: number;
  storageOpenResolved: boolean | null;
  storageOpenRejected: boolean | null;
  storageOpenDurationMs: number | null;
  storageHandleObtained: boolean | null;
  storageFreeAttempted: boolean | null;
  storageFreeSucceeded: boolean | null;
  /** true if error text suggests worker load/CSP failure; null if not assessed. */
  workerLoadErrorSuspected: boolean | null;
  /**
   * true/false only means http(s) was / was not seen via the temporary fetch wrapper
   * during the open window. null = wrapper not active / not assessed.
   * false does NOT mean "no network occurred" (XHR/WS/Worker channels unobserved).
   */
  externalNetworkObserved: boolean | null;
  /** Shallow OPFS root listing after success; null if not probed. */
  opfsRootAccessible: boolean | null;
  opfsEntryNameHints: string[] | null;
  /**
   * Worker process liveness cannot be asserted from the page alone.
   * Always null here â€” use DevTools for observation.
   */
  workerProcessObserved: null;
  /**
   * OPFS file content / spp.db bytes are never read.
   * Persistence is not asserted as wiped after free.
   */
  opfsContentRead: false;
  opfsWipedAfterFree: null;
  /** Static design facts (not runtime telemetry). */
  storageOpenCancellationSupported: false;
  storageOpenLimitScope: typeof STORAGE_OPEN_LIMIT_SCOPE;
  profileScopedOpenLimitImplemented: false;
  storageOpenWatchdogMs: number;
  /** true if open still pending when watchdog fired; null if open never started. */
  storageOpenWatchdogFiredWhilePending: boolean | null;
  /** true if settled duration >= watchdog; null if duration not measured. */
  storageOpenExceededWatchdog: boolean | null;
};

export type SppStorageLabPrepOptions = {
  /** Override phase constant (tests only). Defaults to STORAGE_LAB_EXECUTION_AUTHORIZED. */
  executionAuthorized?: boolean;
  /** Override watchdog ms (tests). Defaults to STORAGE_OPEN_WATCHDOG_MS. */
  openWatchdogMs?: number;
};

function sanitize(message: string): string {
  const trimmed = message.trim();
  return trimmed.length > 240 ? `${trimmed.slice(0, 240)}â€¦` : trimmed;
}

function looksLikeWorkerLoadError(message: string): boolean {
  return /worker|Failed to fetch|CSP|Content Security Policy|importScripts|module scripts/i.test(
    message,
  );
}

export class SppStorageLabPrep {
  private _phase: SppStorageLabPhase = 'not-run';
  private _errorMessage: string | null = null;
  private _gates: StorageLabGateInput = {
    dedicatedLabProfileConfirmed: false,
    opfsPersistenceRiskAccepted: false,
    phaseDiffReviewedAndAuthorized: false,
  };
  private _busy = false;
  private readonly _executionAuthorized: boolean;
  private readonly _watchdogMs: number;
  private _openInvocationCount = 0;
  private _openAttempted: boolean | null = null;
  private _openResolved: boolean | null = null;
  private _openRejected: boolean | null = null;
  private _openDurationMs: number | null = null;
  private _handleObtained: boolean | null = null;
  private _freeAttempted: boolean | null = null;
  private _freeSucceeded: boolean | null = null;
  private _workerLoadErrorSuspected: boolean | null = null;
  private _externalNetworkObserved: boolean | null = null;
  private _opfsRootAccessible: boolean | null = null;
  private _opfsEntryNameHints: string[] | null = null;
  private _watchdogFiredWhilePending: boolean | null = null;
  private _openExceededWatchdog: boolean | null = null;
  private _watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  /** Private â€” never returned from buildEvidence / snapshot. */
  private _handle: SppStorageHandle | null = null;
  private _runInFlight: Promise<StorageLabEvidence> | null = null;

  constructor(options?: SppStorageLabPrepOptions) {
    this._executionAuthorized =
      options?.executionAuthorized ?? STORAGE_LAB_EXECUTION_AUTHORIZED;
    this._watchdogMs = options?.openWatchdogMs ?? STORAGE_OPEN_WATCHDOG_MS;
  }

  get phase(): SppStorageLabPhase {
    return this._phase;
  }

  get errorMessage(): string | null {
    return this._errorMessage;
  }

  get gates(): Readonly<StorageLabGateInput> {
    return { ...this._gates };
  }

  get executionAuthorized(): boolean {
    return this._executionAuthorized;
  }

  get storageRunEnabled(): boolean {
    return (
      this._executionAuthorized &&
      this._phase === 'ready-for-lab' &&
      this._openInvocationCount === 0 &&
      !this._busy &&
      this._openAttempted !== true
    );
  }

  /**
   * free() may be retried while a private handle remains and free has not succeeded.
   * free() failure never re-enables Storage open on this instance.
   */
  get storageFreeEnabled(): boolean {
    return this._handle !== null && !this._busy && this._freeSucceeded !== true;
  }

  /** Compatibility checklist â€” does NOT authorize execution by itself. */
  compatibilityBlockReasons(ctx: StorageLabHostContext): string[] {
    const reasons: string[] = [];
    if (ctx.facadePhase !== 'ready') {
      reasons.push('Facade probe is not ready');
    }
    if (!ctx.wasmInitialized || ctx.wasmPhase !== 'ready') {
      reasons.push('WASM is not initialized');
    }
    if (!ctx.assets?.storageWorkerUrl) {
      reasons.push('Packaged storage worker URL is missing');
    }
    if (ctx.inspection && !ctx.inspection.hasStorageOpen) {
      reasons.push('Facade Storage.open export is missing');
    }
    if (!this._gates.dedicatedLabProfileConfirmed) {
      reasons.push('Dedicated lab Chrome profile not confirmed');
    }
    if (!this._gates.opfsPersistenceRiskAccepted) {
      reasons.push('OPFS spp.db persistence risk not accepted');
    }
    if (!this._gates.phaseDiffReviewedAndAuthorized) {
      reasons.push('Fase 5D diff not reviewed/authorized by operator');
    }
    if (!this._executionAuthorized) {
      reasons.push(
        'STORAGE_LAB_EXECUTION_AUTHORIZED is false (phase gate â€” flip only after diff review)',
      );
    }
    if (this._openInvocationCount >= 1) {
      reasons.push('Storage open already attempted once on this host instance');
    }
    return reasons;
  }

  setLabGates(input: StorageLabGateInput): void {
    if (this._busy) {
      throw new Error('Storage lab prep is busy');
    }
    this._gates = {
      dedicatedLabProfileConfirmed: Boolean(input.dedicatedLabProfileConfirmed),
      opfsPersistenceRiskAccepted: Boolean(input.opfsPersistenceRiskAccepted),
      phaseDiffReviewedAndAuthorized: Boolean(input.phaseDiffReviewedAndAuthorized),
    };
    // Gates alone never open Storage; demote to blocked until evaluatePrep.
    if (this._openAttempted !== true && this._phase !== 'running' && this._phase !== 'success') {
      this._phase = 'blocked';
      this._errorMessage = null;
    }
  }

  /**
   * Recompute prep status. ready-for-lab needs host + all three operator gates.
   * Phase constant does NOT auto-run and does not alone set ready-for-lab.
   */
  evaluatePrep(ctx: StorageLabHostContext): StorageLabEvidence {
    if (this._busy) {
      throw new Error('Storage lab prep is busy');
    }
    if (this._openAttempted === true || this._phase === 'running' || this._phase === 'success') {
      return this.buildEvidence(ctx);
    }

    const softReady =
      this._gates.dedicatedLabProfileConfirmed &&
      this._gates.opfsPersistenceRiskAccepted &&
      this._gates.phaseDiffReviewedAndAuthorized &&
      ctx.facadePhase === 'ready' &&
      ctx.wasmInitialized &&
      ctx.wasmPhase === 'ready' &&
      Boolean(ctx.assets?.storageWorkerUrl) &&
      Boolean(ctx.inspection?.hasStorageOpen);

    if (softReady) {
      this._phase = 'ready-for-lab';
      this._errorMessage = null;
    } else if (this._phase === 'not-run') {
      this._phase = 'blocked';
    } else {
      this._phase = 'blocked';
    }

    return this.buildEvidence(ctx);
  }

  /**
   * At most one openFn invocation per instance. Requires phase auth + ready-for-lab.
   */
  async requestRealStorageOpen(
    ctx: StorageLabHostContext,
    args: StorageLabRunArgs,
  ): Promise<StorageLabEvidence> {
    if (this._runInFlight) {
      return this._runInFlight;
    }
    if (this._busy) {
      throw new Error('Storage lab prep already in progress');
    }

    if (!this._executionAuthorized) {
      this._phase = 'error';
      this._openAttempted = false;
      this._errorMessage = sanitize(
        'Fase 5D refuses Storage open: STORAGE_LAB_EXECUTION_AUTHORIZED is false. Review diff, then authorize phase.',
      );
      return this.buildEvidence(ctx);
    }

    if (this._phase !== 'ready-for-lab') {
      this._phase = 'error';
      this._openAttempted = false;
      this._errorMessage = sanitize(
        'Fase 5D refuses Storage open: storage lab phase must be ready-for-lab (gates + host).',
      );
      return this.buildEvidence(ctx);
    }

    if (this._openInvocationCount >= 1 || this._openAttempted === true) {
      this._phase = 'error';
      this._errorMessage = sanitize(
        'Fase 5D refuses Storage open: at most one open per host instance (no automatic retry).',
      );
      return this.buildEvidence(ctx);
    }

    const workerUrl = args.workerUrl;
    if (!workerUrl || workerUrl.startsWith('http://') || workerUrl.startsWith('https://')) {
      this._phase = 'error';
      this._openAttempted = false;
      this._errorMessage = sanitize('Refusing Storage open: worker URL must be extension-origin');
      return this.buildEvidence(ctx);
    }

    this._busy = true;
    this._phase = 'running';
    this._errorMessage = null;
    // Slot consumed BEFORE awaiting openFn â€” hung/late opens cannot unlock a second call.
    this._openAttempted = true;
    this._openInvocationCount = 1;
    this._openResolved = null;
    this._openRejected = null;
    this._handleObtained = null;
    this._watchdogFiredWhilePending = false;
    this._openExceededWatchdog = null;

    this._runInFlight = (async () => {
      const started = Date.now();
      // Non-cancelling watchdog: flags only. openFn keeps running; no Promise.race abort.
      this._watchdogTimer = setTimeout(() => {
        if (this._phase === 'running') {
          this._watchdogFiredWhilePending = true;
          this._errorMessage = sanitize(
            `Storage open still pending after ${this._watchdogMs}ms watchdog. ` +
              'SDK open is NOT cancelled; this instance will not start a second open. Close the lab tab if stuck.',
          );
        }
      }, this._watchdogMs);

      try {
        const handle = await args.openFn({ workerUrl });
        this._openDurationMs = Date.now() - started;
        this._openExceededWatchdog = this._openDurationMs >= this._watchdogMs;
        this._openResolved = true;
        this._openRejected = false;
        this._handle = handle ?? null;
        this._handleObtained = this._handle !== null && this._handle !== undefined;
        this._externalNetworkObserved =
          typeof args.observeExternalNetwork === 'function'
            ? args.observeExternalNetwork()
            : null;
        if (this._externalNetworkObserved === true) {
          this._phase = 'error';
          this._errorMessage = sanitize(
            'Storage open resolved but external http(s) via fetch-wrapper was observed â€” stop; do not continue to Client. ' +
              'Other channels (XHR/WS/Worker) were not instrumented.',
          );
          return this.buildEvidence(ctx);
        }
        if (typeof args.probeOpfsNames === 'function') {
          try {
            const opfs = await args.probeOpfsNames();
            this._opfsRootAccessible = opfs.accessible;
            this._opfsEntryNameHints = opfs.names.slice(0, 32);
          } catch {
            this._opfsRootAccessible = false;
            this._opfsEntryNameHints = [];
          }
        }
        this._phase = 'success';
        if (this._watchdogFiredWhilePending) {
          this._errorMessage = sanitize(
            'Storage open resolved after watchdog; cancellation is unsupported â€” treat as late success, still one-open slot used.',
          );
        } else {
          this._errorMessage = null;
        }
        return this.buildEvidence(ctx);
      } catch (cause) {
        this._openDurationMs = Date.now() - started;
        this._openExceededWatchdog = this._openDurationMs >= this._watchdogMs;
        this._openResolved = false;
        this._openRejected = true;
        this._handleObtained = false;
        this._handle = null;
        const msg = sanitize(
          cause instanceof Error ? cause.message || cause.name || 'Storage open failed' : 'Storage open failed',
        );
        this._errorMessage = msg;
        this._workerLoadErrorSuspected = looksLikeWorkerLoadError(msg);
        this._externalNetworkObserved =
          typeof args.observeExternalNetwork === 'function'
            ? args.observeExternalNetwork()
            : null;
        this._phase = 'error';
        return this.buildEvidence(ctx);
      } finally {
        if (this._watchdogTimer) {
          clearTimeout(this._watchdogTimer);
          this._watchdogTimer = null;
        }
        this._busy = false;
        this._runInFlight = null;
      }
    })();

    return this._runInFlight;
  }

  /**
   * Explicit free() attempt. Does not claim worker termination or OPFS wipe.
   * On failure, handle stays private and free may be retried; open stays consumed.
   */
  async requestStorageFree(ctx: StorageLabHostContext): Promise<StorageLabEvidence> {
    if (this._busy) {
      throw new Error('Storage lab prep already in progress');
    }
    if (!this._handle) {
      this._errorMessage = sanitize('No private Storage handle to free');
      return this.buildEvidence(ctx);
    }
    if (this._freeSucceeded === true) {
      this._errorMessage = sanitize('Storage free already succeeded on this host instance');
      return this.buildEvidence(ctx);
    }

    this._busy = true;
    this._freeAttempted = true;
    try {
      const freeFn = this._handle.free;
      if (typeof freeFn !== 'function') {
        this._freeSucceeded = false;
        this._errorMessage = sanitize(
          'Storage handle has no free() method â€” handle kept; open slot remains consumed; free() â‰  worker/OPFS wipe',
        );
        return this.buildEvidence(ctx);
      }
      freeFn.call(this._handle);
      this._freeSucceeded = true;
      this._handle = null;
      this._errorMessage = null;
      // opfsWipedAfterFree / workerProcessObserved stay null â€” not observed.
      return this.buildEvidence(ctx);
    } catch (cause) {
      this._freeSucceeded = false;
      // Keep _handle for retry; never re-enable open.
      this._errorMessage = sanitize(
        cause instanceof Error
          ? `${cause.message || 'Storage free failed'} (handle kept; free â‰  worker terminate / OPFS wipe)`
          : 'Storage free failed (handle kept; free â‰  worker terminate / OPFS wipe)',
      );
      return this.buildEvidence(ctx);
    } finally {
      this._busy = false;
    }
  }

  buildEvidence(ctx: StorageLabHostContext): StorageLabEvidence {
    const errors = [this._errorMessage, ctx.facadeErrorMessage, ctx.wasmErrorMessage]
      .filter((x): x is string => Boolean(x))
      .map(sanitize);

    const notes = [
      'Open limit: one openFn call per controller instance (page lifetime). Reload = new instance = new slot. No profile-scoped limit implemented.',
      'STORAGE_OPEN_CANCELLATION_SUPPORTED=false: watchdog never cancels openFn; hung opens still consume the slot.',
      'externalNetworkObserved false = no http(s) via temporary fetch wrap during open only â€” not proof of zero network.',
      'workerProcessObserved / opfsWipedAfterFree always null. opfsContentRead always false. free() â‰  wipe.',
      'ready-for-lab = operator gates + host readiness; phase constant is a separate gate.',
    ];

    return {
      phase: '5D-storage-lab',
      recordedAt: new Date().toISOString(),
      storageLabPhase: this._phase,
      executionAuthorized: this._executionAuthorized,
      storageRunEnabled: this.storageRunEnabled,
      storageFreeEnabled: this.storageFreeEnabled,
      facadePhase: ctx.facadePhase,
      wasmPhase: ctx.wasmPhase,
      wasmInitialized: ctx.wasmInitialized,
      metaVersion: ctx.metaVersion,
      importedModuleUrl: ctx.importedModuleUrl,
      wasmUrlUsed: ctx.wasmUrlUsed,
      localAssetUrls: ctx.assets
        ? {
            facadeModuleUrl: ctx.assets.facadeModuleUrl,
            wasmUrl: ctx.assets.wasmUrl,
            storageWorkerUrl: ctx.assets.storageWorkerUrl,
            proverWorkerUrl: ctx.assets.proverWorkerUrl,
            circuitsBaseUrl: ctx.assets.circuitsBaseUrl,
            metaUrl: ctx.assets.metaUrl,
          }
        : null,
      facadeExportsPresent: ctx.inspection
        ? {
            defaultInit: ctx.inspection.hasDefaultInit,
            clientNew: ctx.inspection.hasClientNew,
            storageOpen: ctx.inspection.hasStorageOpen,
          }
        : null,
      blockReasons: this.compatibilityBlockReasons(ctx),
      errors,
      notes,
      storageOpenAttempted: this._openAttempted,
      storageOpenInvocationCount: this._openInvocationCount,
      storageOpenResolved: this._openResolved,
      storageOpenRejected: this._openRejected,
      storageOpenDurationMs: this._openDurationMs,
      storageHandleObtained: this._handleObtained,
      storageFreeAttempted: this._freeAttempted,
      storageFreeSucceeded: this._freeSucceeded,
      workerLoadErrorSuspected: this._workerLoadErrorSuspected,
      externalNetworkObserved: this._externalNetworkObserved,
      opfsRootAccessible: this._opfsRootAccessible,
      opfsEntryNameHints: this._opfsEntryNameHints,
      workerProcessObserved: null,
      opfsContentRead: false,
      opfsWipedAfterFree: null,
      storageOpenCancellationSupported: false,
      storageOpenLimitScope: STORAGE_OPEN_LIMIT_SCOPE,
      profileScopedOpenLimitImplemented: false,
      storageOpenWatchdogMs: this._watchdogMs,
      storageOpenWatchdogFiredWhilePending: this._watchdogFiredWhilePending,
      storageOpenExceededWatchdog: this._openExceededWatchdog,
    };
  }
}
