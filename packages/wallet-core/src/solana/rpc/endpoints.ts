/**
 * solana/rpc/endpoints.ts — Network policy for the Solana RPC layer.
 *
 * SECURITY INVARIANTS:
 *   INVARIANT 8 (plan):
 *     SupportedNetwork is the single-member union 'devnet'. The only accepted
 *     RPC endpoint is the exact URL listed in ALLOWED_DEVNET_RPC_URLS.
 *     Only an allowlist is used; no other cluster is named anywhere in src/.
 *
 *   - wallet-core does NOT read environment variables or import.meta.env.
 *     The RPC URL is passed in explicitly by the caller (the future extension
 *     layer reads VITE_DEVNET_RPC_URL and passes it here).
 *   - Error messages NEVER echo the supplied URL: a rejected URL might contain
 *     credentials (user:pass@host) or other private data.
 *   - No console.* calls in this module.
 *
 * Genesis hash provenance (DEVNET_GENESIS_HASH):
 *   Verified on 2026-10-03 against two independent sources:
 *     1. Anza official cluster documentation (docs.anza.xyz/clusters/available),
 *        Devnet section: --expected-genesis-hash EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG
 *     2. Live getGenesisHash JSON-RPC call against https://api.devnet.solana.com
 *   Devnet "may be subject to ledger resets" (Anza docs). If a reset changes the
 *   genesis hash, assertDevnetCluster() fails closed until this constant is
 *   deliberately updated after re-verification.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** The only network this wallet supports. Single-member union by design. */
export type SupportedNetwork = 'devnet';

/** A validated network configuration. Only produced by resolveNetworkConfig(). */
export interface NetworkConfig {
  readonly network: SupportedNetwork;
  /** Canonical RPC URL (always an exact member of ALLOWED_DEVNET_RPC_URLS). */
  readonly rpcUrl: AllowedDevnetRpcUrl;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Exact allowlist of accepted Devnet RPC URLs (MVP: the public Devnet endpoint only). */
export const ALLOWED_DEVNET_RPC_URLS = Object.freeze(['https://api.devnet.solana.com'] as const);

/** One member of ALLOWED_DEVNET_RPC_URLS. */
export type AllowedDevnetRpcUrl = (typeof ALLOWED_DEVNET_RPC_URLS)[number];

/** Verified Devnet genesis hash (see provenance note in the file header). */
export const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG' as const;

/** Hostnames derived from the allowlist, used for precise rejection reasons. */
const ALLOWED_HOSTNAMES: ReadonlySet<string> = new Set(
  ALLOWED_DEVNET_RPC_URLS.map((u) => new URL(u).hostname),
);

// ── Errors ────────────────────────────────────────────────────────────────────

/**
 * Thrown when a supplied RPC URL / network configuration is not permitted.
 *
 * SECURITY: the message describes the reason only — it never contains the
 * rejected URL, which may embed credentials.
 */
export class NetworkConfigError extends Error {
  constructor(reason: string) {
    super(`Invalid Devnet RPC configuration: ${reason}`);
    this.name = 'NetworkConfigError';
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isAllowedDevnetRpcUrl(value: string): value is AllowedDevnetRpcUrl {
  return (ALLOWED_DEVNET_RPC_URLS as readonly string[]).includes(value);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Validate an explicitly supplied RPC URL and return a frozen NetworkConfig.
 *
 * Accepted: exactly `https://api.devnet.solana.com` (a single trailing `/` is
 * tolerated and normalised away).
 *
 * Rejected: non-strings, empty/whitespace-padded input, non-https schemes,
 * credentials, explicit ports (including an explicit default port), paths,
 * query strings (including a bare `?`), fragments (including a bare `#`),
 * other hosts, subdomains, lookalike/IDN hosts, and any spelling that does
 * not exactly match the allowlist after URL parsing.
 *
 * @throws {NetworkConfigError} with a reason that never echoes the input.
 */
export function resolveNetworkConfig(rawUrl: unknown): NetworkConfig {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
    throw new NetworkConfigError('RPC URL must be a non-empty string');
  }
  if (rawUrl !== rawUrl.trim()) {
    throw new NetworkConfigError('RPC URL must not contain leading or trailing whitespace');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new NetworkConfigError('RPC URL is not a valid absolute URL');
  }

  if (parsed.protocol !== 'https:') {
    throw new NetworkConfigError('RPC URL must use https');
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new NetworkConfigError('RPC URL must not contain credentials');
  }
  if (parsed.port !== '') {
    throw new NetworkConfigError('RPC URL must not specify a port');
  }
  if (!ALLOWED_HOSTNAMES.has(parsed.hostname)) {
    throw new NetworkConfigError('RPC host is not an allowed Devnet RPC host');
  }
  if (parsed.pathname !== '/') {
    throw new NetworkConfigError('RPC URL must not contain a path');
  }
  if (parsed.search !== '' || rawUrl.includes('?')) {
    throw new NetworkConfigError('RPC URL must not contain a query string');
  }
  if (parsed.hash !== '' || rawUrl.includes('#')) {
    throw new NetworkConfigError('RPC URL must not contain a fragment');
  }

  // Final exact-match gate on the raw input. URL parsing normalises several
  // spellings (explicit :443, upper-case host, backslashes, dot segments);
  // the MVP accepts only the canonical spelling.
  const candidate = rawUrl.endsWith('/') ? rawUrl.slice(0, -1) : rawUrl;
  if (!isAllowedDevnetRpcUrl(candidate)) {
    throw new NetworkConfigError('RPC URL must exactly match an allowed Devnet RPC URL');
  }

  return Object.freeze({ network: 'devnet', rpcUrl: candidate });
}
