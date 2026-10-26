/**
 * Fase 5G.3 — explicit SppSession construction (no initialize, no auto attach).
 *
 * ## What actually runs at each stage
 *
 * 1) **Importing this module / wallet-core SppSession**
 *    - Loads Solanym session wrapper only.
 *    - `SppSession.ts` uses `import type` from `stellar-private-payments` (erased at
 *      compile time). It does not value-import or execute the SDK package.
 *    - Does NOT dynamically import `spp/js/index.js`.
 *
 * 2) **Importing the packaged facade** (`loadSppSdkFacade` / `import(url)`)
 *    - Executes the facade JS module graph (wasm-bindgen glue + re-exports).
 *    - Host probe already does this on explicit button click.
 *    - Top-level facade side effects are NOT fully characterized here; treat
 *      dynamic import as an authorized operator step, not part of construction.
 *    - This module never calls `loadSppSdkFacade`.
 *
 * 3) **`buildSppSdkRuntimeFromDeps` / `extractSppSdkRuntimeDepsFromLoadedFacade`**
 *    - Sync: captures function references / builds a runtime closure.
 *    - Does NOT call initWasm, Storage open, or Client factory.
 *
 * 4) **`constructUninitializedSppSession`**
 *    - `new SppSession(config)` + config asserts only.
 *    - State remains `uninitialized`. Never invokes session initialize.
 *
 * 5) **session initialize** (NOT offered here)
 *    - Via `createSppSdkRuntime`: initWasm → Storage open → Client factory,
 *      with rpcUrl, contracts, circuits, storage handle, prover worker URL, …
 *    - Network / workers / WASM / prover are possible from that point.
 *
 * 6) **`dispose()`** (NOT called here)
 *    - Releases the underlying client if present.
 *
 * Construction and `SppHostController.attachExistingSession` are separate steps.
 * `sessionInitializeEnabled` stays false on the controller; this module does not flip it.
 */

import {
  SppSession,
  createSppSdkRuntime,
  type SppSdkRuntimeDeps,
  type SppSessionConfig,
  type SppSessionRuntime,
} from '@solanym/wallet-core/src/stellar/spp/SppSession.js';
import {
  assertFacadeReadyForFutureSession,
  inspectSppSdkFacade,
} from './sdkLoad.js';

export type { SppSdkRuntimeDeps, SppSessionConfig, SppSessionRuntime };

/**
 * Capture SDK entry points from an *already loaded* facade module object.
 * Does not import modules; does not call default init, Storage open, or Client factory.
 */
export function extractSppSdkRuntimeDepsFromLoadedFacade(
  facadeModule: Record<string, unknown>,
): SppSdkRuntimeDeps {
  if (!facadeModule || typeof facadeModule !== 'object') {
    throw new Error('extractSppSdkRuntimeDepsFromLoadedFacade requires a loaded facade module');
  }
  const inspection = inspectSppSdkFacade(facadeModule);
  assertFacadeReadyForFutureSession(inspection);

  const initFn = facadeModule['default'] as (opts: {
    module_or_path: string;
  }) => Promise<unknown>;
  const StorageNs = facadeModule['Storage'] as {
    open: SppSdkRuntimeDeps['Storage']['open'];
  };
  const ClientNs = facadeModule['Client'] as {
    new: SppSdkRuntimeDeps['Client']['new'];
  };

  return {
    initWasm: async (wasmUrl: string) => {
      await initFn({ module_or_path: wasmUrl });
    },
    Storage: {
      open: (options) => StorageNs.open(options),
    },
    Client: {
      new: (options) => ClientNs.new(options),
    },
  };
}

/**
 * Wrap injected deps into {@link SppSessionRuntime}.
 * Sync and side-effect free until `createReadOnlyClient` runs (initialize path).
 */
export function buildSppSdkRuntimeFromDeps(deps: SppSdkRuntimeDeps): SppSessionRuntime {
  if (!deps || typeof deps.initWasm !== 'function') {
    throw new Error('buildSppSdkRuntimeFromDeps requires deps.initWasm');
  }
  if (!deps.Storage || typeof deps.Storage.open !== 'function') {
    throw new Error('buildSppSdkRuntimeFromDeps requires deps.Storage.open');
  }
  if (!deps.Client || typeof deps.Client.new !== 'function') {
    throw new Error('buildSppSdkRuntimeFromDeps requires deps.Client.new');
  }
  return createSppSdkRuntime(deps);
}

/**
 * Construct an uninitialized {@link SppSession}.
 *
 * Requires a fully explicit {@link SppSessionConfig} (rpcUrl, contractConfig,
 * circuitLock, assets, runtime). No default network endpoints or contracts.
 *
 * Does not invoke session initialize, does not attach to a host controller, and
 * does not import the packaged facade.
 */
export function constructUninitializedSppSession(config: SppSessionConfig): SppSession {
  const session = new SppSession(config);
  if (session.state !== 'uninitialized') {
    // Defensive: constructor must not advance lifecycle.
    throw new Error(`constructUninitializedSppSession expected uninitialized, got ${session.state}`);
  }
  return session;
}

/** Operator-supplied fields required before host construction (no invented endpoints). */
export type SppSessionPrepInput = {
  rpcUrl: string;
  contractConfig: unknown;
  circuitLock: unknown;
  bootnodeUrl?: string;
};

export type ValidatedSppSessionPrep = {
  rpcUrl: string;
  contractConfig: object;
  circuitLock: object;
  bootnodeUrl?: string;
};

/**
 * Validate prep fields before construction. Does not invent RPC URLs or contracts.
 * Rejects empty rpcUrl and non-object contract/circuit payloads.
 */
export function validateSppSessionPrepInput(input: SppSessionPrepInput): ValidatedSppSessionPrep {
  if (!input || typeof input !== 'object') {
    throw new Error('Session prep config is required');
  }
  const rpcUrl = typeof input.rpcUrl === 'string' ? input.rpcUrl.trim() : '';
  if (!rpcUrl) {
    throw new Error('rpcUrl must be a non-empty string (no default endpoint)');
  }
  if (
    input.contractConfig === null ||
    typeof input.contractConfig !== 'object' ||
    Array.isArray(input.contractConfig)
  ) {
    throw new Error('contractConfig must be a non-null object');
  }
  if (
    input.circuitLock === null ||
    typeof input.circuitLock !== 'object' ||
    Array.isArray(input.circuitLock)
  ) {
    throw new Error('circuitLock must be a non-null object');
  }
  const out: ValidatedSppSessionPrep = {
    rpcUrl,
    contractConfig: input.contractConfig,
    circuitLock: input.circuitLock,
  };
  if (input.bootnodeUrl !== undefined) {
    const boot = typeof input.bootnodeUrl === 'string' ? input.bootnodeUrl.trim() : '';
    if (!boot) {
      throw new Error('bootnodeUrl must be a non-empty string when provided');
    }
    out.bootnodeUrl = boot;
  }
  return out;
}
