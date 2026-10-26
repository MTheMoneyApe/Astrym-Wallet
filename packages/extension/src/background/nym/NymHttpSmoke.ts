/**
 * Explicit MixFetch HTTP round-trip smoke (no wallet material).
 *
 * Uses only the injected mixFetch (offscreen MixFetch instance).
 * Never calls global fetch / XHR / clearnet fallback.
 * createMixFetch Ready ≠ this smoke — requires a completed Mixnet HTTP exchange
 * with matching echoed probe id.
 */

import {
  NYM_HTTP_SMOKE_DEFAULT_TIMEOUT_MS,
  NYM_HTTP_SMOKE_PROBE_FIELD,
  extractEchoedProbeId,
  resolveNymHttpSmokeUrl,
  validateNymHttpSmokeUrl,
} from '../../nym-offscreen/httpSmokeConfig.js';

export type NymHttpSmokeState = 'idle' | 'running' | 'success' | 'error' | 'timeout';

export type NymHttpSmokeRequest = {
  /** Optional HTTPS echo URL override (validated). */
  url?: string;
  timeoutMs?: number;
};

export type NymHttpSmokeResult = {
  state: NymHttpSmokeState;
  /** Destination used for the MixFetch request. */
  url: string;
  probeId: string;
  durationMs: number;
  httpStatus: number | null;
  httpOk: boolean | null;
  /** True only when response body echoed the same probeId. */
  probeMatched: boolean;
  echoedProbeId: string | null;
  /** Human-readable outcome (no secrets). */
  message: string;
  /** True when mixFetch was invoked (vs refused before network). */
  mixFetchInvoked: boolean;
};

export type NymHttpSmokeMixFetch = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

function newProbeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `solanym-${crypto.randomUUID()}`;
  }
  return `solanym-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run one MixFetch POST echo round-trip.
 * `mixFetch` must be the live offscreen MixFetch binding (or a test double).
 */
export async function runNymHttpSmoke(deps: {
  mixFetch: NymHttpSmokeMixFetch;
  connected: boolean;
  request?: NymHttpSmokeRequest;
  now?: () => number;
  randomId?: () => string;
}): Promise<NymHttpSmokeResult> {
  const now = deps.now ?? (() => Date.now());
  const started = now();
  const probeId = (deps.randomId ?? newProbeId)();
  const timeoutMs =
    typeof deps.request?.timeoutMs === 'number' && deps.request.timeoutMs > 0
      ? deps.request.timeoutMs
      : NYM_HTTP_SMOKE_DEFAULT_TIMEOUT_MS;

  const resolved = resolveNymHttpSmokeUrl(deps.request?.url);
  const validated = validateNymHttpSmokeUrl(resolved);
  if (!validated.ok) {
    return {
      state: 'error',
      url: resolved,
      probeId,
      durationMs: Math.max(0, now() - started),
      httpStatus: null,
      httpOk: null,
      probeMatched: false,
      echoedProbeId: null,
      message: validated.message,
      mixFetchInvoked: false,
    };
  }

  if (!deps.connected) {
    return {
      state: 'error',
      url: validated.url,
      probeId,
      durationMs: Math.max(0, now() - started),
      httpStatus: null,
      httpOk: null,
      probeMatched: false,
      echoedProbeId: null,
      message:
        'MixFetch not Ready — Connect first. Offscreen open / createMixFetch in progress ≠ HTTP smoke complete.',
      mixFetchInvoked: false,
    };
  }

  const body = JSON.stringify({ [NYM_HTTP_SMOKE_PROBE_FIELD]: probeId });
  // mix-fetch@1.4.2 Go WASM enforces browser CORS on Mixnet responses by default.
  // Official v1 flag: mode 'unsafe-ignore-cors' (removed in v2 — no CORS checks).
  // Does NOT switch to clearnet; egress remains via MixFetch / Mixnet.
  const init: RequestInit & { mode?: string } = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body,
    mode: 'unsafe-ignore-cors',
  };

  type RaceOk = { kind: 'ok'; response: Response };
  type RaceTimeout = { kind: 'timeout' };
  type RaceErr = { kind: 'error'; error: unknown };

  let race: RaceOk | RaceTimeout | RaceErr;
  try {
    race = await Promise.race([
      deps
        .mixFetch(validated.url, init)
        .then((response): RaceOk => ({ kind: 'ok', response }))
        .catch((error): RaceErr => ({ kind: 'error', error })),
      sleep(timeoutMs).then((): RaceTimeout => ({ kind: 'timeout' })),
    ]);
  } catch (error) {
    race = { kind: 'error', error };
  }

  const durationMs = Math.max(0, now() - started);

  if (race.kind === 'timeout') {
    return {
      state: 'timeout',
      url: validated.url,
      probeId,
      durationMs,
      httpStatus: null,
      httpOk: null,
      probeMatched: false,
      echoedProbeId: null,
      message: `MixFetch HTTP smoke timed out after ${timeoutMs}ms (Mixnet path; not clearnet)`,
      mixFetchInvoked: true,
    };
  }

  if (race.kind === 'error') {
    const msg =
      race.error instanceof Error
        ? race.error.message
        : 'MixFetch HTTP smoke network error';
    return {
      state: 'error',
      url: validated.url,
      probeId,
      durationMs,
      httpStatus: null,
      httpOk: null,
      probeMatched: false,
      echoedProbeId: null,
      message: msg,
      mixFetchInvoked: true,
    };
  }

  const response = race.response;
  const httpStatus = response.status;
  const httpOk = response.ok;

  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    return {
      state: 'error',
      url: validated.url,
      probeId,
      durationMs: Math.max(0, now() - started),
      httpStatus,
      httpOk,
      probeMatched: false,
      echoedProbeId: null,
      message:
        error instanceof Error
          ? `Failed to read MixFetch response body: ${error.message}`
          : 'Failed to read MixFetch response body',
      mixFetchInvoked: true,
    };
  }

  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    return {
      state: 'error',
      url: validated.url,
      probeId,
      durationMs: Math.max(0, now() - started),
      httpStatus,
      httpOk,
      probeMatched: false,
      echoedProbeId: null,
      message:
        'Echo endpoint did not return JSON — cannot verify probe id (unsupported format)',
      mixFetchInvoked: true,
    };
  }

  const echoedProbeId = extractEchoedProbeId(parsed);
  const probeMatched = echoedProbeId === probeId;

  if (!httpOk) {
    return {
      state: 'error',
      url: validated.url,
      probeId,
      durationMs: Math.max(0, now() - started),
      httpStatus,
      httpOk,
      probeMatched,
      echoedProbeId,
      message: `HTTP ${httpStatus} from echo endpoint via MixFetch`,
      mixFetchInvoked: true,
    };
  }

  if (!probeMatched) {
    return {
      state: 'error',
      url: validated.url,
      probeId,
      durationMs: Math.max(0, now() - started),
      httpStatus,
      httpOk,
      probeMatched: false,
      echoedProbeId,
      message: echoedProbeId
        ? 'Echoed probe id did not match — endpoint format unexpected'
        : `Response JSON missing ${NYM_HTTP_SMOKE_PROBE_FIELD} echo — endpoint may not support required POST JSON format`,
      mixFetchInvoked: true,
    };
  }

  return {
    state: 'success',
    url: validated.url,
    probeId,
    durationMs: Math.max(0, now() - started),
    httpStatus,
    httpOk: true,
    probeMatched: true,
    echoedProbeId,
    message: 'MixFetch HTTP round-trip OK — probe id echoed via Mixnet',
    mixFetchInvoked: true,
  };
}
