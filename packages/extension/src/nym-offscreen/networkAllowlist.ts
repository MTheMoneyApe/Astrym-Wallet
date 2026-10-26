/**
 * Explicit Nym network origin boundary.
 *
 * Verified from Nym browser-routing docs + mix-fetch bootstrap behavior:
 * mainnet topology is fetched from https://validator.nymtech.net before any
 * gateway WebSocket is opened. Gateway hostnames are dynamic — they are NOT
 * guessed here. Operators must add exact origins to the gateway allowlist
 * (and matching optional host_permissions) before a live Mixnet session.
 */

/** Sole verified default bootstrap API origin for mainnet Nym API. */
export const NYM_DEFAULT_BOOTSTRAP_ORIGINS = [
  'https://validator.nymtech.net',
] as const;

export type NymNetworkAllowlistConfig = {
  /** HTTPS origins used for nym-api topology bootstrap. */
  bootstrapApiOrigins: readonly string[];
  /**
   * Exact gateway origins allowed for WSS/HTTPS (e.g. `wss://gateway.example:9000`).
   * Empty = fail-closed until an operator configures gateways for a smoke test.
   */
  gatewayOrigins: readonly string[];
};

export const DEFAULT_NYM_NETWORK_ALLOWLIST: NymNetworkAllowlistConfig = {
  bootstrapApiOrigins: NYM_DEFAULT_BOOTSTRAP_ORIGINS,
  gatewayOrigins: [],
};

export function normalizeOrigin(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('Empty origin');
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const u = new URL(withScheme);
  if (u.protocol !== 'https:' && u.protocol !== 'wss:' && u.protocol !== 'http:' && u.protocol !== 'ws:') {
    throw new Error(`Unsupported origin scheme: ${u.protocol}`);
  }
  // Strip path/query/hash — host permissions match origin.
  return `${u.protocol}//${u.host}`;
}

export function isOriginAllowlisted(
  origin: string,
  allowlist: readonly string[],
): boolean {
  let normalized: string;
  try {
    normalized = normalizeOrigin(origin);
  } catch {
    return false;
  }
  return allowlist.some((entry) => {
    try {
      return normalizeOrigin(entry) === normalized;
    } catch {
      return false;
    }
  });
}

/**
 * Live Mixnet needs at least one gateway origin configured.
 * Bootstrap-only permissions are insufficient for gateway WebSockets.
 */
export function assertGatewayAllowlistReady(
  config: NymNetworkAllowlistConfig = DEFAULT_NYM_NETWORK_ALLOWLIST,
): void {
  if (!config.bootstrapApiOrigins.length) {
    throw Object.assign(
      new Error('Nym bootstrap API allowlist is empty'),
      { code: 'BOOTSTRAP_ALLOWLIST_EMPTY' as const },
    );
  }
  if (!config.gatewayOrigins.length) {
    throw Object.assign(
      new Error(
        'Nym gateway allowlist is empty: add exact wss/https gateway origins before live Mixnet connect (gateways are not guessed)',
      ),
      { code: 'GATEWAY_ALLOWLIST_EMPTY' as const },
    );
  }
}

/** Manifest host_permissions derived from verified bootstrap origins only. */
export function bootstrapHostPermissionPatterns(
  config: NymNetworkAllowlistConfig = DEFAULT_NYM_NETWORK_ALLOWLIST,
): string[] {
  return config.bootstrapApiOrigins.map((origin) => {
    const n = normalizeOrigin(origin);
    return n.endsWith('/') ? `${n}*` : `${n}/*`;
  });
}
