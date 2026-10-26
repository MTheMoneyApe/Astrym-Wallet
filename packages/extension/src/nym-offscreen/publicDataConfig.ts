/**
 * Public (non-wallet) HTTPS data via the selected transport.
 *
 * Default: POST JSON to Postman Echo (same host that succeeded MixFetch HTTP smoke).
 *   https://postman-echo.com/post
 * Body: `{ "solanymProbeId": "<id>" }`
 * Success: response `json.solanymProbeId` (or data/top-level) matches.
 *
 * Why not GET: Mixnet GET to `postman-echo.com/get` hit MixFetch client timeouts /
 * SW IPC channel close (~5s then ~80s) in live CDP runs while POST returned HTTP 200
 * in ~2s. Documented choice — not a silent endpoint invent.
 *
 * Override: VITE_NYM_PUBLIC_DATA_URL or IPC url (https only).
 * Not Stellar Horizon / Solana RPC / credentialed APIs.
 */

import {
  NYM_HTTP_SMOKE_DEFAULT_URL,
  NYM_HTTP_SMOKE_PROBE_FIELD,
  extractEchoedProbeId,
  validateNymHttpSmokeUrl,
} from './httpSmokeConfig.js';

export const NYM_PUBLIC_DATA_PROBE_FIELD = NYM_HTTP_SMOKE_PROBE_FIELD;

/** Proven MixFetch-compatible echo (POST). */
export const NYM_PUBLIC_DATA_DEFAULT_URL = NYM_HTTP_SMOKE_DEFAULT_URL;

export const NYM_PUBLIC_DATA_DEFAULT_TIMEOUT_MS = 60_000;

export const NYM_PUBLIC_DATA_METHOD = 'POST' as const;

export function resolvePublicDataUrl(override?: string | null): string {
  const fromEnv =
    typeof import.meta !== 'undefined' &&
    import.meta.env &&
    typeof import.meta.env.VITE_NYM_PUBLIC_DATA_URL === 'string'
      ? import.meta.env.VITE_NYM_PUBLIC_DATA_URL.trim()
      : '';
  return (override?.trim() || fromEnv || NYM_PUBLIC_DATA_DEFAULT_URL).trim();
}

export function validatePublicDataUrl(raw: string): {
  ok: true;
  url: string;
} | {
  ok: false;
  message: string;
} {
  return validateNymHttpSmokeUrl(raw);
}

export function extractPublicDataProbeId(body: unknown): string | null {
  return extractEchoedProbeId(body);
}

/** Truncate JSON for UI — no secrets expected; still cap size. */
export function safeResponsePreview(text: string, maxLen = 280): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}…`;
}
