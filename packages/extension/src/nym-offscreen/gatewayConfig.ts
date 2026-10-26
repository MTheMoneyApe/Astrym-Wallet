/**
 * Operator-supplied Nym gateway validation.
 *
 * Two distinct values are required for a real Mixnet session with mix-fetch@1.4.2:
 * 1. Identity key → MixFetchOpts.preferredGateway (base58 node id, NOT a URL)
 * 2. WSS origin → Chrome MV3 host permission / Solanym allowlist (`wss://host:port`)
 *
 * Evidence: @nymproject/mix-fetch-wasm@1.4.2 MixFetchOpts.preferredGateway is a
 * string passed to MixFetchClient as preferred_gateway; Nym docs migrate example
 * uses a base58 identity (`q2A2cbooyC16YJzvdYaSMH9X3cSiieZNtfBr8cE8Fi1`).
 */

export type GatewayValidationCode =
  | 'OK'
  | 'EMPTY'
  | 'MALFORMED'
  | 'WILDCARD'
  | 'BAD_SCHEME'
  | 'BAD_HOSTNAME'
  | 'BAD_PORT'
  | 'HAS_PATH'
  | 'HAS_USERINFO'
  | 'BAD_IDENTITY';

export type GatewayValidationResult =
  | {
      ok: true;
      /** Canonical origin: `wss://host:port` or `https://host:port` (default ports omitted). */
      origin: string;
      protocol: 'wss:' | 'https:';
      hostname: string;
      port: string;
      /**
       * Chrome MV3 host permission match pattern for this gateway.
       * WSS is covered by the https (or *://) host pattern for the same host:port.
       */
      hostPermissionPattern: string;
    }
  | { ok: false; code: GatewayValidationCode; message: string };

export type GatewayIdentityValidationResult =
  | { ok: true; identityKey: string }
  | { ok: false; code: GatewayValidationCode; message: string };

/** Bitcoin/Nym base58 alphabet (no 0 O I l). Ed25519 identities are typically ~43–44 chars. */
const NYM_IDENTITY_KEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,64}$/;

const BLOCKED_HOSTNAMES = new Set(['*', 'localhost', '0.0.0.0', '::', '[::]']);

/**
 * Validate a single operator-supplied gateway URL/origin.
 * Allowed schemes: wss (preferred), https (egress-style). No ws/http in production config.
 */
export function validateGatewayOrigin(raw: string): GatewayValidationResult {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) {
    return { ok: false, code: 'EMPTY', message: 'Gateway origin is empty' };
  }
  if (/[*\s]/.test(trimmed) || trimmed.includes('://*.') || trimmed.includes('*://')) {
    return {
      ok: false,
      code: 'WILDCARD',
      message: 'Wildcard gateway origins are not allowed',
    };
  }
  if (/<(all_urls|all_hosts)>/i.test(trimmed)) {
    return {
      ok: false,
      code: 'WILDCARD',
      message: 'Broad permission tokens are not allowed as gateway origins',
    };
  }

  let url: URL;
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
      ? trimmed
      : `wss://${trimmed}`;
    url = new URL(withScheme);
  } catch {
    return { ok: false, code: 'MALFORMED', message: 'Gateway origin is not a valid URL' };
  }

  if (url.protocol !== 'wss:' && url.protocol !== 'https:') {
    return {
      ok: false,
      code: 'BAD_SCHEME',
      message: `Gateway scheme must be wss: or https: (got ${url.protocol})`,
    };
  }
  if (url.username || url.password) {
    return {
      ok: false,
      code: 'HAS_USERINFO',
      message: 'Gateway origin must not include username/password',
    };
  }
  if (url.pathname && url.pathname !== '/' || url.search || url.hash) {
    return {
      ok: false,
      code: 'HAS_PATH',
      message: 'Gateway origin must not include path, query, or fragment',
    };
  }

  const hostname = url.hostname;
  if (!hostname || BLOCKED_HOSTNAMES.has(hostname.toLowerCase())) {
    return {
      ok: false,
      code: 'BAD_HOSTNAME',
      message: 'Gateway hostname is missing or not allowed',
    };
  }
  if (hostname.includes('*') || hostname.startsWith('.')) {
    return {
      ok: false,
      code: 'WILDCARD',
      message: 'Gateway hostname must be an exact host (no wildcards)',
    };
  }
  // Reject IP literals for now — operators supply named gateway hosts for smoke.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':')) {
    return {
      ok: false,
      code: 'BAD_HOSTNAME',
      message: 'Gateway hostname must be a DNS name (IP literals rejected)',
    };
  }

  if (url.port) {
    const portNum = Number(url.port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      return {
        ok: false,
        code: 'BAD_PORT',
        message: `Invalid gateway port: ${url.port}`,
      };
    }
  }

  const protocol = url.protocol as 'wss:' | 'https:';
  const origin = `${protocol}//${url.host}`;
  // Chrome match patterns use http(s); WSS shares the host permission.
  const hostPermissionPattern = `https://${url.host}/*`;

  return {
    ok: true,
    origin,
    protocol,
    hostname,
    port: url.port,
    hostPermissionPattern,
  };
}

/** Map validated gateway → optional_host_permissions / permissions.request origins entry. */
export function gatewayHostPermissionPattern(origin: string): string {
  const result = validateGatewayOrigin(origin);
  if (!result.ok) {
    throw Object.assign(new Error(result.message), { code: result.code });
  }
  return result.hostPermissionPattern;
}

/**
 * Validate MixFetchOpts.preferredGateway for mix-fetch@1.4.2: base58 identity key.
 * Rejects URLs and bootstrap API hosts — those are not gateway identities.
 */
export function validateGatewayIdentityKey(raw: string): GatewayIdentityValidationResult {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) {
    return { ok: false, code: 'EMPTY', message: 'Gateway identity key is empty' };
  }
  if (/[*\s]/.test(trimmed) || /<(all_urls|all_hosts)>/i.test(trimmed)) {
    return {
      ok: false,
      code: 'WILDCARD',
      message: 'Wildcard tokens are not allowed as gateway identity keys',
    };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.includes('/') || trimmed.includes('.')) {
    return {
      ok: false,
      code: 'BAD_IDENTITY',
      message:
        'preferredGateway must be a Nym gateway identity key (base58), not a URL or hostname — use WSS origin separately for host permissions',
    };
  }
  if (!NYM_IDENTITY_KEY_RE.test(trimmed)) {
    return {
      ok: false,
      code: 'BAD_IDENTITY',
      message:
        'Gateway identity key must be base58 (32–64 chars, no 0/O/I/l) matching MixFetchOpts.preferredGateway',
    };
  }
  return { ok: true, identityKey: trimmed };
}
