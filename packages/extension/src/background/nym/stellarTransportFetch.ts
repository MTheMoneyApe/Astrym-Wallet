/**
 * Stellar-only HTTP adapter over FailClosedTransportRouter.
 *
 * - mode=direct: pass through RequestInit unchanged (including AbortSignal).
 *   Logical URL === effective URL (no remap).
 * - mode=nym: MixFetch path — strip AbortSignal (unsupported by mix-fetch@1.4.2),
 *   set unsafe-ignore-cors (v1 Go WASM), resolve logical→effective via
 *   {@link resolveHorizonUrlForNym}, never clearnet fallback.
 *
 * Does not create MixFetch instances. Does not touch Solana or non-Stellar traffic.
 */

import type { NymTransportMode } from '@solanym/wallet-core/src/nym/NymTransportPolicy.js';
import type { StellarReadFetch } from '@solanym/wallet-core/src/stellar/read/StellarReadClient.js';
import {
  DEFAULT_STELLAR_NYM_HORIZON_CONFIG,
  resolveHorizonUrlForNym,
  type HorizonUrlResolution,
  type StellarNymHorizonConfig,
} from './stellarHorizonNymConfig.js';

export const STELLAR_NYM_FETCH_DEFAULT_TIMEOUT_MS = 90_000;

/** Re-exports for existing imports / harnesses. */
export {
  STELLAR_MIXFETCH_TESTNET_HORIZON_URL,
  STELLAR_MIXFETCH_MAINNET_HORIZON_URL,
  STELLAR_NYM_EFFECTIVE_TESTNET_HORIZON_DEFAULT,
  STELLAR_NYM_EFFECTIVE_MAINNET_HORIZON_DEFAULT,
  STELLAR_LOGICAL_TESTNET_HORIZON_URL,
  SDF_HORIZON_MIXFETCH_REWRITE_REASON,
  resolveHorizonUrlForNym,
  validateNymHorizonEffectiveBase,
  validateStellarNymHorizonConfig,
  DEFAULT_STELLAR_NYM_HORIZON_CONFIG,
} from './stellarHorizonNymConfig.js';
export type {
  HorizonUrlResolution,
  StellarNymHorizonConfig,
} from './stellarHorizonNymConfig.js';

export type StellarTransportFetchDeps = {
  getMode: () => NymTransportMode;
  /** FailClosedTransportRouter.fetch — fail-closed in nym mode. */
  fetchViaRouter: (url: string, init?: RequestInit) => Promise<Response>;
  /** Current validated Nym Horizon remap config (defaults to documented Ankr bases). */
  getNymHorizonConfig?: () => StellarNymHorizonConfig;
  nymTimeoutMs?: number;
  /** Optional hook for probes / diagnostics (never used to clearnet-fallback). */
  onResolved?: (resolution: HorizonUrlResolution) => void;
};

/**
 * @deprecated Use {@link resolveHorizonUrlForNym} with explicit config.
 * Kept for unit tests that assert the default remap.
 */
export function rewriteSdfHorizonUrlForMixFetch(url: string): string {
  return resolveHorizonUrlForNym(url, DEFAULT_STELLAR_NYM_HORIZON_CONFIG).effectiveUrl;
}

export function createStellarTransportFetch(
  deps: StellarTransportFetchDeps,
): StellarReadFetch {
  const nymTimeoutMs = deps.nymTimeoutMs ?? STELLAR_NYM_FETCH_DEFAULT_TIMEOUT_MS;

  return async (url, init) => {
    const mode = deps.getMode();
    if (mode === 'direct') {
      deps.onResolved?.({
        logicalUrl: url,
        effectiveUrl: url,
        rewritten: false,
        reason: null,
      });
      return deps.fetchViaRouter(url, init);
    }

    const config = deps.getNymHorizonConfig?.() ?? DEFAULT_STELLAR_NYM_HORIZON_CONFIG;
    const resolution = resolveHorizonUrlForNym(url, config);
    deps.onResolved?.(resolution);

    // Explicit nym: MixFetch only. Strip signal — AbortController unsupported in v1 mix-fetch.
    const headers = init?.headers;
    const nymInit: RequestInit & { mode?: string } = {
      method: init?.method ?? 'GET',
      mode: 'unsafe-ignore-cors',
    };
    if (headers !== undefined) nymInit.headers = headers;
    if (init?.body != null) nymInit.body = init.body;

    try {
      return await Promise.race([
        deps.fetchViaRouter(resolution.effectiveUrl, nymInit),
        new Promise<Response>((_, reject) => {
          setTimeout(() => {
            const remap = resolution.rewritten
              ? ` logical=${resolution.logicalUrl} effective=${resolution.effectiveUrl}`
              : ` url=${resolution.effectiveUrl}`;
            reject(
              new Error(
                `Stellar request via MixFetch timed out after ${nymTimeoutMs}ms` +
                  `${remap} (no clearnet fallback)`,
              ),
            );
          }, nymTimeoutMs);
        }),
      ]);
    } catch (cause) {
      if (cause instanceof Error && resolution.rewritten) {
        const annotated = new Error(
          `${cause.message} [logical=${resolution.logicalUrl}; effective=${resolution.effectiveUrl}]`,
        );
        annotated.cause = cause;
        throw annotated;
      }
      throw cause;
    }
  };
}
