/**
 * Stellar-only HTTP adapter over FailClosedTransportRouter.
 *
 * - mode=direct: pass through RequestInit unchanged (including AbortSignal).
 *   Logical URL === effective URL (no remap).
 * - mode=nym: MixFetch path — strip AbortSignal (unsupported by mix-fetch@1.4.2),
 *   set unsafe-ignore-cors (v1 Go WASM), resolve logical→effective via
 *   {@link resolveHorizonUrlForNym}, never clearnet fallback.
 *   Methods are GET, HEAD, or POST. GET/HEAD with a body are refused.
 *   POST is used for Soroban JSON-RPC, not forced onto Horizon lookups.
 *   Effective hosts must already be on the Horizon allowlist, the Testnet
 *   Soroban RPC origin, or Testnet Friendbot (GET only, no body, when network
 *   is Testnet). Mainnet Horizon and Ankr mainnet are refused.
 *   Unknown hosts fail closed.
 *
 * Does not create MixFetch instances. Does not touch Solana or non-Stellar traffic.
 */

import type { NymTransportMode } from '@solanym/wallet-core/src/nym/NymTransportPolicy.js';
import type { StellarReadFetch } from '@solanym/wallet-core/src/stellar/read/StellarReadClient.js';
import {
  DEFAULT_STELLAR_NYM_HORIZON_CONFIG,
  normalizeHorizonBase,
  resolveHorizonUrlForNym,
  STELLAR_LOGICAL_MAINNET_HORIZON_URL,
  STELLAR_NYM_EFFECTIVE_MAINNET_HORIZON_DEFAULT,
  STELLAR_NYM_HORIZON_EFFECTIVE_ALLOWLIST,
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

export type StellarTransportNetwork = 'testnet' | 'mainnet';

export type StellarTransportFetchDeps = {
  getMode: () => NymTransportMode;
  /** FailClosedTransportRouter.fetch — fail-closed in nym mode. */
  fetchViaRouter: (url: string, init?: RequestInit) => Promise<Response>;
  /** Configured Stellar network (defaults to 'testnet'). Friendbot is Testnet-only. */
  getNetwork?: () => StellarTransportNetwork;
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

const STELLAR_NYM_HEADER_ALLOWLIST = new Set(['accept', 'content-type']);
const STELLAR_NYM_METHOD_ALLOWLIST = new Set(['GET', 'HEAD', 'POST']);

/**
 * Same origin as `STELLAR_SOROBAN_TESTNET_RPC`. Not an additional host.
 * Kept here so this adapter does not import the SPP payment module.
 */
const STELLAR_NYM_SOROBAN_TESTNET_RPC = 'https://soroban-testnet.stellar.org';

/** Testnet Friendbot origin (`STELLAR_TESTNET_FRIENDBOT_URL`). GET only, no body, Testnet only. */
const STELLAR_NYM_TESTNET_FRIENDBOT_URL = 'https://friendbot.stellar.org';

function allowlistedStellarHeaders(headers: HeadersInit | undefined): Headers {
  const out = new Headers();
  if (headers === undefined) return out;
  new Headers(headers).forEach((value, key) => {
    if (STELLAR_NYM_HEADER_ALLOWLIST.has(key.toLowerCase())) out.set(key, value);
  });
  return out;
}

function isAllowlistedHorizonTarget(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
    return false;
  }
  const pathOnly = normalizeHorizonBase(`${parsed.origin}${parsed.pathname}`);
  if (isRefusedMainnetHorizonTarget(pathOnly)) return false;
  return STELLAR_NYM_HORIZON_EFFECTIVE_ALLOWLIST.some((base) => {
    const normalized = normalizeHorizonBase(base);
    return pathOnly === normalized || pathOnly.startsWith(`${normalized}/`);
  });
}

/** This wallet is Testnet-only. Mainnet Horizon and Ankr mainnet stay refused. */
function isRefusedMainnetHorizonTarget(pathOnly: string): boolean {
  const refused = [
    normalizeHorizonBase(STELLAR_LOGICAL_MAINNET_HORIZON_URL),
    normalizeHorizonBase(STELLAR_NYM_EFFECTIVE_MAINNET_HORIZON_DEFAULT),
  ];
  return refused.some((base) => pathOnly === base || pathOnly.startsWith(`${base}/`));
}

/** Exact Testnet Soroban RPC URL. Query, fragment, and credentials stay refused. */
function isSorobanTestnetRpcUrl(url: string): boolean {
  let given: URL;
  let trusted: URL;
  try {
    given = new URL(url);
    trusted = new URL(STELLAR_NYM_SOROBAN_TESTNET_RPC);
  } catch {
    return false;
  }
  return (
    given.protocol === 'https:' &&
    given.username === '' &&
    given.password === '' &&
    given.hash === '' &&
    given.origin === trusted.origin &&
    given.pathname === trusted.pathname &&
    given.search === ''
  );
}

/** Exact Testnet Friendbot origin and root path (`?addr=...` allowed; credentials/hash refused). */
function isFriendbotTestnetUrl(url: string): boolean {
  let given: URL;
  let trusted: URL;
  try {
    given = new URL(url);
    trusted = new URL(STELLAR_NYM_TESTNET_FRIENDBOT_URL);
  } catch {
    return false;
  }
  return (
    given.protocol === 'https:' &&
    given.username === '' &&
    given.password === '' &&
    given.hash === '' &&
    given.origin === trusted.origin &&
    given.pathname === trusted.pathname
  );
}

function assertAllowlistedStellarNymTarget(
  effectiveUrl: string,
  network: StellarTransportNetwork,
): void {
  if (
    isAllowlistedHorizonTarget(effectiveUrl) ||
    isSorobanTestnetRpcUrl(effectiveUrl) ||
    (network === 'testnet' && isFriendbotTestnetUrl(effectiveUrl))
  ) {
    return;
  }
  let host = 'invalid-url';
  try {
    host = new URL(effectiveUrl).host;
  } catch {
    host = 'invalid-url';
  }
  throw new Error(
    `Stellar Nym fetch refused non-allowlisted host: ${host} (no clearnet fallback)`,
  );
}

function isSorobanJsonRpcBody(body: BodyInit | null | undefined): boolean {
  if (typeof body !== 'string' || body.length === 0) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return false;
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  if (entries.length === 0) return false;
  return entries.every((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    return (entry as { jsonrpc?: unknown }).jsonrpc === '2.0';
  });
}

/**
 * Horizon lookups keep GET/HEAD (default GET).
 * POST is selected for Soroban JSON-RPC, including when the caller omitted a method.
 * Any other method is refused.
 */
function resolveStellarNymMethod(effectiveUrl: string, init: RequestInit | undefined): string {
  const caller = init?.method?.trim().toUpperCase() ?? '';
  if (caller !== '' && !STELLAR_NYM_METHOD_ALLOWLIST.has(caller)) {
    throw new Error(`Stellar Nym fetch refused method: ${caller}`);
  }
  if (isFriendbotTestnetUrl(effectiveUrl)) {
    if (caller !== '' && caller !== 'GET') {
      throw new Error(`Stellar Nym fetch refused method: ${caller}`);
    }
    return 'GET';
  }
  if (caller === 'GET' || caller === 'HEAD') return caller;
  if (
    (caller === '' || caller === 'POST') &&
    isSorobanTestnetRpcUrl(effectiveUrl) &&
    isSorobanJsonRpcBody(init?.body)
  ) {
    return 'POST';
  }
  return caller || 'GET';
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

    const network: StellarTransportNetwork = deps.getNetwork?.() ?? 'testnet';
    const config = deps.getNymHorizonConfig?.() ?? DEFAULT_STELLAR_NYM_HORIZON_CONFIG;
    const resolution = resolveHorizonUrlForNym(url, config);
    assertAllowlistedStellarNymTarget(url, network);
    assertAllowlistedStellarNymTarget(resolution.effectiveUrl, network);
    deps.onResolved?.(resolution);
    const effective = new URL(resolution.effectiveUrl);

    // Explicit nym: MixFetch only. Strip signal — AbortController unsupported in v1 mix-fetch.
    const method = resolveStellarNymMethod(effective.href, init);
    const headers = allowlistedStellarHeaders(init?.headers);
    if ((method === 'GET' || method === 'HEAD') && init?.body != null) {
      throw new Error(`Stellar Nym fetch refused body on ${method}`);
    }
    const nymInit: RequestInit & { mode?: string } = {
      method,
      redirect: 'error',
      mode: 'unsafe-ignore-cors',
      headers,
    };
    if (init?.body != null) nymInit.body = init.body;

    try {
      return await Promise.race([
        deps.fetchViaRouter(effective.href, nymInit),
        new Promise<Response>((_, reject) => {
          setTimeout(() => {
            const remap = resolution.rewritten
              ? ` logical=${resolution.logicalUrl} effective=${effective.href}`
              : ` url=${effective.href}`;
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
