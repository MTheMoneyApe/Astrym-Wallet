/**
 * Explicit Horizon endpoint policy for Nym / MixFetch mode.
 *
 * Logical URL = what StellarReadClient / the UI asked for (usually SDF Horizon).
 * Effective URL = what MixFetch actually fetches after a documented, validated remap.
 *
 * Why remap (live CDP evidence, Oct 2026):
 * - `horizon-testnet.stellar.org` via MixFetch returned HTTP 200 with empty HAL bodies
 *   and/or stalled ~90s on `/fee_stats`.
 * - Public Ankr Horizon (`ACAO: *`, `Content-Length`) completed MixFetch round-trips.
 *
 * Direct mode never remaps. Nym mode never falls back to clearnet/`fetch` on failure.
 */

import { STELLAR_TESTNET_HORIZON_URL } from '@solanym/wallet-core/src/stellar/read/StellarReadClient.js';

/** Logical SDF Horizon bases (what the product intends). */
export const STELLAR_LOGICAL_TESTNET_HORIZON_URL = STELLAR_TESTNET_HORIZON_URL;
export const STELLAR_LOGICAL_MAINNET_HORIZON_URL = 'https://horizon.stellar.org';

/**
 * Default MixFetch-effective bases (allowlist members).
 * Named constants so UI / errors cite them without stringly magic.
 */
export const STELLAR_NYM_EFFECTIVE_TESTNET_HORIZON_DEFAULT =
  'https://rpc.ankr.com/http/stellar_testnet_horizon';
export const STELLAR_NYM_EFFECTIVE_MAINNET_HORIZON_DEFAULT =
  'https://rpc.ankr.com/http/stellar_horizon';

export const SDF_HORIZON_MIXFETCH_REWRITE_REASON =
  'SDF Horizon via MixFetch returned empty HAL bodies or request stalls in live CDP; ' +
  'Ankr public Horizon is the documented MixFetch-compatible default (ACAO *, Content-Length).';

export type StellarNymHorizonConfig = {
  /** Effective HTTPS base used when logical host is horizon-testnet.stellar.org */
  testnetEffectiveBase: string;
  /** Effective HTTPS base used when logical host is horizon.stellar.org */
  mainnetEffectiveBase: string;
};

export const DEFAULT_STELLAR_NYM_HORIZON_CONFIG: StellarNymHorizonConfig = {
  testnetEffectiveBase: STELLAR_NYM_EFFECTIVE_TESTNET_HORIZON_DEFAULT,
  mainnetEffectiveBase: STELLAR_NYM_EFFECTIVE_MAINNET_HORIZON_DEFAULT,
};

/**
 * Bases allowed as MixFetch-effective Horizon endpoints.
 * Includes SDF so operators can opt back in explicitly (fail-closed if MixFetch fails).
 */
export const STELLAR_NYM_HORIZON_EFFECTIVE_ALLOWLIST: readonly string[] = [
  STELLAR_NYM_EFFECTIVE_TESTNET_HORIZON_DEFAULT,
  STELLAR_NYM_EFFECTIVE_MAINNET_HORIZON_DEFAULT,
  STELLAR_LOGICAL_TESTNET_HORIZON_URL,
  STELLAR_LOGICAL_MAINNET_HORIZON_URL,
];

export type HorizonUrlResolution = {
  logicalUrl: string;
  effectiveUrl: string;
  rewritten: boolean;
  /** Non-null when rewritten — human-readable policy reason. */
  reason: string | null;
};

export type HorizonBaseValidation =
  | { ok: true; base: string }
  | { ok: false; message: string };

export function normalizeHorizonBase(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * Validate an HTTPS Horizon API base for Nym effective use.
 * Rejects credentials, non-https, query/fragment, and hosts outside the allowlist.
 */
export function validateNymHorizonEffectiveBase(raw: string): HorizonBaseValidation {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, message: 'Horizon effective base is empty' };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, message: `Horizon effective base is not a valid URL: ${trimmed}` };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, message: 'Horizon effective base must use https' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, message: 'Horizon effective base must not include credentials' };
  }
  if (parsed.hash) {
    return { ok: false, message: 'Horizon effective base must not include a fragment' };
  }
  if (parsed.search) {
    return { ok: false, message: 'Horizon effective base must not include a query string' };
  }
  const base = normalizeHorizonBase(`${parsed.origin}${parsed.pathname}`);
  const allowed = STELLAR_NYM_HORIZON_EFFECTIVE_ALLOWLIST.map(normalizeHorizonBase);
  if (!allowed.includes(base)) {
    return {
      ok: false,
      message:
        `Horizon effective base not in allowlist: ${base}. ` +
        `Allowed: ${allowed.join(', ')}`,
    };
  }
  return { ok: true, base };
}

export function validateStellarNymHorizonConfig(
  partial: Partial<StellarNymHorizonConfig>,
): { ok: true; config: StellarNymHorizonConfig } | { ok: false; message: string } {
  const testnetRaw =
    partial.testnetEffectiveBase ?? DEFAULT_STELLAR_NYM_HORIZON_CONFIG.testnetEffectiveBase;
  const mainnetRaw =
    partial.mainnetEffectiveBase ?? DEFAULT_STELLAR_NYM_HORIZON_CONFIG.mainnetEffectiveBase;
  const testnet = validateNymHorizonEffectiveBase(testnetRaw);
  if (!testnet.ok) return testnet;
  const mainnet = validateNymHorizonEffectiveBase(mainnetRaw);
  if (!mainnet.ok) return mainnet;
  return {
    ok: true,
    config: {
      testnetEffectiveBase: testnet.base,
      mainnetEffectiveBase: mainnet.base,
    },
  };
}

/**
 * Resolve logical → effective Horizon URL for Nym mode using validated config.
 * Non-SDF hosts pass through unchanged (still MixFetch-only; no clearnet).
 */
export function resolveHorizonUrlForNym(
  logicalUrl: string,
  config: StellarNymHorizonConfig = DEFAULT_STELLAR_NYM_HORIZON_CONFIG,
): HorizonUrlResolution {
  let parsed: URL;
  try {
    parsed = new URL(logicalUrl);
  } catch {
    return {
      logicalUrl,
      effectiveUrl: logicalUrl,
      rewritten: false,
      reason: null,
    };
  }

  const host = parsed.hostname.toLowerCase();
  let effectiveBase: string | null = null;
  if (host === 'horizon-testnet.stellar.org') {
    effectiveBase = config.testnetEffectiveBase;
  } else if (host === 'horizon.stellar.org') {
    effectiveBase = config.mainnetEffectiveBase;
  }

  if (!effectiveBase) {
    return {
      logicalUrl,
      effectiveUrl: logicalUrl,
      rewritten: false,
      reason: null,
    };
  }

  const root = normalizeHorizonBase(effectiveBase);
  const effectiveUrl = `${root}${parsed.pathname}${parsed.search}`;
  const effectiveHost = new URL(effectiveUrl).hostname.toLowerCase();
  const rewritten = effectiveHost !== host;

  if (!rewritten) {
    return {
      logicalUrl,
      effectiveUrl: logicalUrl,
      rewritten: false,
      reason: null,
    };
  }

  return {
    logicalUrl,
    effectiveUrl,
    rewritten: true,
    reason: SDF_HORIZON_MIXFETCH_REWRITE_REASON,
  };
}

/** Alias kept for existing imports. */
export const STELLAR_MIXFETCH_TESTNET_HORIZON_URL =
  STELLAR_NYM_EFFECTIVE_TESTNET_HORIZON_DEFAULT;
/** Alias kept for existing imports. */
export const STELLAR_MIXFETCH_MAINNET_HORIZON_URL =
  STELLAR_NYM_EFFECTIVE_MAINNET_HORIZON_DEFAULT;
