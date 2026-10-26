/**
 * Read-only SPP session lifecycle for Solanym (Fase 2).
 *
 * Wraps stellar-private-payments Client RO surface only:
 *   - aspState()
 *   - allContractsData()
 *   - dispose()
 *
 * Does NOT expose account(), PrivatePool, deposit/transfer/withdraw, sync,
 * signing, vault, or keys. Callers must inject {@link SppSessionRuntime}
 * (typically wired from a chrome-extension:// asset base after WASM init).
 */

import type {
  CircuitLockInput,
  Client,
  ClientNewOptions,
  ContractConfigInput,
  ContractsStateData,
  Storage,
  StorageOpenOptions,
} from 'stellar-private-payments';

/** Explicit session lifecycle states. */
export type SppSessionState =
  | 'uninitialized'
  | 'initializing'
  | 'ready'
  | 'disposed'
  | 'error';

export type SppSessionErrorCode =
  | 'INVALID_CONFIG'
  | 'INVALID_STATE'
  | 'INITIALIZE_FAILED'
  | 'READ_FAILED'
  | 'DISPOSED';

export class SppSessionError extends Error {
  readonly code: SppSessionErrorCode;

  constructor(code: SppSessionErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'SppSessionError';
    this.code = code;
  }
}

/**
 * Absolute URLs for packaged SDK assets (Fase 1 `dist/spp/…` via getURL).
 * Relative layout must keep js/ and dist/ siblings for import.meta.url.
 */
export type SppAssetUrls = {
  /** URL of `stellar_private_payments_web_bg.wasm` (passed to wasm-bindgen init). */
  wasmUrl: string;
  /** URL of `storage-worker.js`. */
  storageWorkerUrl: string;
  /** URL of `prover-worker.js`. */
  proverWorkerUrl: string;
  /** Base URL of `circuits/` directory (trailing slash recommended). */
  circuitsBaseUrl: string;
};

export type SppSessionConfig = {
  /** Injected RPC endpoint — never hard-coded to production/public networks here. */
  rpcUrl: string;
  contractConfig: ContractConfigInput;
  circuitLock: CircuitLockInput;
  assets: SppAssetUrls;
  /** Optional bootnode URL forwarded to Client.new when provided. */
  bootnodeUrl?: string;
  /** SDK wiring (inject mocks in unit tests; real bindings on extension host). */
  runtime: SppSessionRuntime;
};

/** Arguments passed to the runtime when creating the underlying RO client. */
export type SppCreateClientArgs = {
  rpcUrl: string;
  contractConfig: ContractConfigInput;
  circuitLock: CircuitLockInput;
  assets: SppAssetUrls;
  bootnodeUrl?: string;
};

/**
 * Minimal client handle retained by the session.
 * Matches the RO + dispose surface of the JS facade {@link Client}.
 */
export type SppReadOnlyClient = {
  aspState(): Promise<ContractsStateData>;
  allContractsData(): Promise<ContractsStateData>;
  dispose(): void;
};

/**
 * Injectable SDK boundary. Production host supplies a runtime that:
 * 1) inits WASM with `assets.wasmUrl`
 * 2) opens Storage with `assets.storageWorkerUrl`
 * 3) calls `Client.new` with circuits + prover worker URLs
 */
export type SppSessionRuntime = {
  createReadOnlyClient(args: SppCreateClientArgs): Promise<SppReadOnlyClient>;
};

/** Dependencies for {@link createSppSdkRuntime} (avoids static WASM load in Node). */
export type SppSdkRuntimeDeps = {
  /** Initialize wasm-bindgen (e.g. `await init({ module_or_path: wasmUrl })`). */
  initWasm: (wasmUrl: string) => Promise<void>;
  Storage: {
    open: (options?: StorageOpenOptions | null) => Promise<Storage>;
  };
  Client: {
    new: (options: ClientNewOptions) => Promise<Client>;
  };
};

/**
 * Build a runtime that calls the real SDK facade methods.
 * Intended for a browser extension page after dynamic-importing the packaged
 * `js/index.js` + wasm glue — not for Node unit tests.
 */
export function createSppSdkRuntime(deps: SppSdkRuntimeDeps): SppSessionRuntime {
  return {
    async createReadOnlyClient(args: SppCreateClientArgs): Promise<SppReadOnlyClient> {
      await deps.initWasm(args.assets.wasmUrl);
      const storage = await deps.Storage.open({
        workerUrl: args.assets.storageWorkerUrl,
      });
      const options: ClientNewOptions = {
        rpcUrl: args.rpcUrl,
        contractConfig: args.contractConfig,
        circuitLock: args.circuitLock,
        circuitsBaseUrl: args.assets.circuitsBaseUrl,
        storage,
        proverWorkerUrl: args.assets.proverWorkerUrl,
      };
      if (args.bootnodeUrl !== undefined) {
        options.bootnodeUrl = args.bootnodeUrl;
      }
      const client = await deps.Client.new(options);
      return {
        aspState: () => client.aspState(),
        allContractsData: () => client.allContractsData(),
        dispose: () => client.dispose(),
      };
    },
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertConfig(config: SppSessionConfig): void {
  if (!config || typeof config !== 'object') {
    throw new SppSessionError('INVALID_CONFIG', 'SppSession config is required');
  }
  if (!isNonEmptyString(config.rpcUrl)) {
    throw new SppSessionError('INVALID_CONFIG', 'rpcUrl must be a non-empty string');
  }
  if (
    config.contractConfig === null ||
    typeof config.contractConfig !== 'object' ||
    Array.isArray(config.contractConfig)
  ) {
    throw new SppSessionError('INVALID_CONFIG', 'contractConfig must be an object');
  }
  if (
    config.circuitLock === null ||
    typeof config.circuitLock !== 'object' ||
    Array.isArray(config.circuitLock)
  ) {
    throw new SppSessionError('INVALID_CONFIG', 'circuitLock must be an object');
  }
  if (!config.assets || typeof config.assets !== 'object') {
    throw new SppSessionError('INVALID_CONFIG', 'assets must be provided');
  }
  for (const key of [
    'wasmUrl',
    'storageWorkerUrl',
    'proverWorkerUrl',
    'circuitsBaseUrl',
  ] as const) {
    if (!isNonEmptyString(config.assets[key])) {
      throw new SppSessionError('INVALID_CONFIG', `assets.${key} must be a non-empty string`);
    }
  }
  if (!config.runtime || typeof config.runtime.createReadOnlyClient !== 'function') {
    throw new SppSessionError('INVALID_CONFIG', 'runtime.createReadOnlyClient is required');
  }
  if (config.bootnodeUrl !== undefined && !isNonEmptyString(config.bootnodeUrl)) {
    throw new SppSessionError('INVALID_CONFIG', 'bootnodeUrl must be a non-empty string when set');
  }
}

function sanitizeFailure(prefix: string, cause: unknown): string {
  if (cause instanceof SppSessionError) return cause.message;
  if (cause instanceof Error) {
    const raw = cause.message || cause.name || 'error';
    // Avoid echoing long payloads / URLs with credentials; keep short.
    const trimmed = raw.length > 180 ? `${raw.slice(0, 180)}…` : raw;
    return `${prefix}: ${trimmed}`;
  }
  return `${prefix}: unexpected failure`;
}

/**
 * Controlled read-only SPP session.
 *
 * Public surface intentionally omits mutators and signer wiring.
 */
export class SppSession {
  private _state: SppSessionState = 'uninitialized';
  private _client: SppReadOnlyClient | null = null;
  private _initPromise: Promise<void> | null = null;
  private _lastErrorMessage: string | null = null;
  private readonly _config: SppSessionConfig;

  constructor(config: SppSessionConfig) {
    assertConfig(config);
    this._config = config;
  }

  get state(): SppSessionState {
    return this._state;
  }

  /** Last error message after a failed initialize (no secrets by construction). */
  get lastErrorMessage(): string | null {
    return this._lastErrorMessage;
  }

  /**
   * Initialize WASM/storage/client via the injected runtime.
   * Concurrent callers share one in-flight promise. Re-init after ready/disposed fails.
   */
  async initialize(): Promise<void> {
    if (this._state === 'ready') {
      throw new SppSessionError('INVALID_STATE', 'SppSession is already initialized');
    }
    if (this._state === 'disposed') {
      throw new SppSessionError('DISPOSED', 'Cannot initialize a disposed SppSession');
    }
    if (this._state === 'initializing' && this._initPromise) {
      return this._initPromise;
    }

    this._state = 'initializing';
    this._lastErrorMessage = null;
    this._initPromise = this._doInitialize();
    try {
      await this._initPromise;
    } finally {
      this._initPromise = null;
    }
  }

  private async _doInitialize(): Promise<void> {
    try {
      const args: SppCreateClientArgs = {
        rpcUrl: this._config.rpcUrl,
        contractConfig: this._config.contractConfig,
        circuitLock: this._config.circuitLock,
        assets: { ...this._config.assets },
      };
      if (this._config.bootnodeUrl !== undefined) {
        args.bootnodeUrl = this._config.bootnodeUrl;
      }

      const client = await this._config.runtime.createReadOnlyClient(args);
      if (this._state === 'disposed') {
        // Race: dispose during init — release client and stay disposed.
        try {
          client.dispose();
        } catch {
          /* ignore dispose errors after cancel */
        }
        throw new SppSessionError('DISPOSED', 'SppSession was disposed during initialize');
      }
      this._client = client;
      this._state = 'ready';
    } catch (cause) {
      if (this._state === 'disposed') {
        throw cause instanceof SppSessionError
          ? cause
          : new SppSessionError('DISPOSED', 'SppSession was disposed during initialize', { cause });
      }
      this._client = null;
      this._state = 'error';
      const message = sanitizeFailure('SPP initialize failed', cause);
      this._lastErrorMessage = message;
      if (cause instanceof SppSessionError) throw cause;
      throw new SppSessionError('INITIALIZE_FAILED', message, { cause });
    }
  }

  async aspState(): Promise<ContractsStateData> {
    return this._read('aspState', (c) => c.aspState());
  }

  async allContractsData(): Promise<ContractsStateData> {
    return this._read('allContractsData', (c) => c.allContractsData());
  }

  private async _read(
    label: 'aspState' | 'allContractsData',
    fn: (client: SppReadOnlyClient) => Promise<ContractsStateData>,
  ): Promise<ContractsStateData> {
    if (this._state === 'disposed') {
      throw new SppSessionError('DISPOSED', `Cannot call ${label} on a disposed SppSession`);
    }
    if (this._state !== 'ready' || !this._client) {
      throw new SppSessionError(
        'INVALID_STATE',
        `Cannot call ${label} while SppSession state is ${this._state}`,
      );
    }
    try {
      return await fn(this._client);
    } catch (cause) {
      if (cause instanceof SppSessionError) throw cause;
      throw new SppSessionError(
        'READ_FAILED',
        sanitizeFailure(`SPP ${label} failed`, cause),
        { cause },
      );
    }
  }

  /**
   * Release the underlying SDK client. Idempotent.
   * Safe to call from any state; clears client handle.
   */
  dispose(): void {
    if (this._state === 'disposed') {
      return;
    }
    const client = this._client;
    this._client = null;
    this._state = 'disposed';
    this._initPromise = null;
    if (client) {
      try {
        client.dispose();
      } catch (cause) {
        // Idempotent dispose: do not reopen; surface only as lastErrorMessage.
        this._lastErrorMessage = sanitizeFailure('SPP dispose reported an error', cause);
      }
    }
  }
}
