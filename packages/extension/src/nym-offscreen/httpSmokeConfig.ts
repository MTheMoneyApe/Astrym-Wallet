/**
 * MixFetch HTTP round-trip smoke — public benign echo endpoint.
 *
 * Default: Postman Echo POST JSON
 *   https://postman-echo.com/post
 * Request body: `{ "solanymProbeId": "<random>" }`
 * Success only when response JSON contains the same id under
 * `json.solanymProbeId` (or `data.solanymProbeId` when object).
 *
 * Overrides are accepted only when they resolve to the approved endpoint.
 *
 * Chrome host permission for the echo origin is NOT required when traffic
 * exits via Mixnet (gateway WSS already permitted). Clearnet probe of this
 * URL is never used to claim Mixnet success.
 *
 * mix-fetch@1.4.2 applies a client-side CORS check on Mixnet responses; smoke
 * requests set RequestInit.mode = 'unsafe-ignore-cors' (official v1 flag) so
 * destinations that omit ACAO for chrome-extension:// still work over Mixnet.
 *
 * mix-fetch@1.4.2 does not expose a documented redirect policy through this
 * bridge. This allowlist validates the initial URL; redirects are not
 * guaranteed to be blocked or revalidated.
 */

export const NYM_HTTP_SMOKE_PROBE_FIELD = 'solanymProbeId' as const;

/** Documented default — verified POST JSON echo (not Solana/Stellar). */
export const NYM_HTTP_SMOKE_DEFAULT_URL = 'https://postman-echo.com/post';

/** Only explicitly approved HTTP Smoke destination. */
export const NYM_HTTP_SMOKE_ALLOWED_URLS = [NYM_HTTP_SMOKE_DEFAULT_URL] as const;

export const NYM_HTTP_SMOKE_DEFAULT_TIMEOUT_MS = 60_000;

export function resolveNymHttpSmokeUrl(override?: string | null): string {
  const fromEnv =
    typeof import.meta !== 'undefined' &&
    import.meta.env &&
    typeof import.meta.env.VITE_NYM_HTTP_SMOKE_URL === 'string'
      ? import.meta.env.VITE_NYM_HTTP_SMOKE_URL.trim()
      : '';
  const raw = (override?.trim() || fromEnv || NYM_HTTP_SMOKE_DEFAULT_URL).trim();
  return raw;
}

export function validateNymHttpSmokeUrl(raw: string): {
  ok: true;
  url: string;
} | {
  ok: false;
  message: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, message: 'HTTP smoke URL is not a valid absolute URL' };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, message: 'HTTP smoke URL must use https:' };
  }
  if (parsed.username || parsed.password) {
    return {
      ok: false,
      message: 'HTTP smoke URL must not contain embedded credentials',
    };
  }
  if (!NYM_HTTP_SMOKE_ALLOWED_URLS.some((approvedUrl) => parsed.href === approvedUrl)) {
    return {
      ok: false,
      message: 'HTTP smoke URL is not an approved destination',
    };
  }
  return { ok: true, url: parsed.href };
}

/**
 * Extract echoed probe id from a parsed JSON body.
 * Supports Postman Echo / httpbin-style wrappers and a top-level field.
 */
export function extractEchoedProbeId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const o = body as Record<string, unknown>;
  const top = o[NYM_HTTP_SMOKE_PROBE_FIELD];
  if (typeof top === 'string' && top.length > 0) return top;

  const json = o['json'];
  if (json && typeof json === 'object') {
    const v = (json as Record<string, unknown>)[NYM_HTTP_SMOKE_PROBE_FIELD];
    if (typeof v === 'string' && v.length > 0) return v;
  }

  const data = o['data'];
  if (data && typeof data === 'object') {
    const v = (data as Record<string, unknown>)[NYM_HTTP_SMOKE_PROBE_FIELD];
    if (typeof v === 'string' && v.length > 0) return v;
  }

  return null;
}
