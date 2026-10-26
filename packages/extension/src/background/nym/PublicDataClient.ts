/**
 * Small public-data client over the fail-closed transport router.
 *
 * Explicit transport selection: uses injected `fetchViaTransport` only
 * (FailClosedTransportRouter.fetch → Nym mixFetch or direct when mode=direct).
 * Never silently falls back to clearnet when Nym fails.
 */

import type { NymTransportMode } from '@solanym/wallet-core/src/nym/NymTransportPolicy.js';
import {
  NYM_PUBLIC_DATA_DEFAULT_TIMEOUT_MS,
  NYM_PUBLIC_DATA_METHOD,
  NYM_PUBLIC_DATA_PROBE_FIELD,
  extractPublicDataProbeId,
  resolvePublicDataUrl,
  safeResponsePreview,
  validatePublicDataUrl,
} from '../../nym-offscreen/publicDataConfig.js';

export type PublicDataFetchState = 'idle' | 'running' | 'success' | 'error' | 'timeout';

export type PublicDataFetchRequest = {
  /** Explicit transport the caller believes is selected (must match router). */
  transport: NymTransportMode;
  url?: string;
  timeoutMs?: number;
};

export type PublicDataFetchResult = {
  state: PublicDataFetchState;
  transport: NymTransportMode;
  url: string;
  probeId: string;
  durationMs: number;
  httpStatus: number | null;
  httpOk: boolean | null;
  probeMatched: boolean;
  echoedProbeId: string | null;
  /** Small safe snippet of response body for UI proof. */
  responsePreview: string | null;
  message: string;
  /** True when the injected transport fetch was invoked. */
  transportFetchInvoked: boolean;
};

export type PublicDataTransportFetch = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

function newProbeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `solanym-pub-${crypto.randomUUID()}`;
  }
  return `solanym-pub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class PublicDataClientError extends Error {
  readonly code:
    | 'INVALID_URL'
    | 'NOT_CONNECTED'
    | 'TRANSPORT_MISMATCH'
    | 'REQUEST_FAILED'
    | 'TIMEOUT'
    | 'ECHO_MISMATCH'
    | 'HTTP_ERROR';

  constructor(
    code: PublicDataClientError['code'],
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'PublicDataClientError';
    this.code = code;
  }
}

/**
 * Fetch public HTTPS data through the selected transport abstraction.
 */
export async function fetchPublicData(deps: {
  /** Must be FailClosedTransportRouter.fetch (or test double) — never raw clearnet when mode=nym. */
  fetchViaTransport: PublicDataTransportFetch;
  transport: NymTransportMode;
  /** When transport=nym, MixFetch must already be connected. */
  nymConnected: boolean;
  /** Router mode must equal request.transport (explicit selection). */
  routerMode: NymTransportMode;
  request?: Omit<PublicDataFetchRequest, 'transport'> & { transport?: NymTransportMode };
  now?: () => number;
  randomId?: () => string;
}): Promise<PublicDataFetchResult> {
  const now = deps.now ?? (() => Date.now());
  const started = now();
  const transport = deps.request?.transport ?? deps.transport;
  const probeId = (deps.randomId ?? newProbeId)();
  const timeoutMs =
    typeof deps.request?.timeoutMs === 'number' && deps.request.timeoutMs > 0
      ? deps.request.timeoutMs
      : NYM_PUBLIC_DATA_DEFAULT_TIMEOUT_MS;

  const resolved = resolvePublicDataUrl(deps.request?.url);
  const validated = validatePublicDataUrl(resolved);
  if (!validated.ok) {
    return {
      state: 'error',
      transport,
      url: resolved,
      probeId,
      durationMs: Math.max(0, now() - started),
      httpStatus: null,
      httpOk: null,
      probeMatched: false,
      echoedProbeId: null,
      responsePreview: null,
      message: validated.message,
      transportFetchInvoked: false,
    };
  }

  if (transport !== deps.routerMode) {
    return {
      state: 'error',
      transport,
      url: validated.url,
      probeId,
      durationMs: Math.max(0, now() - started),
      httpStatus: null,
      httpOk: null,
      probeMatched: false,
      echoedProbeId: null,
      responsePreview: null,
      message: `Transport mismatch: request=${transport} router=${deps.routerMode}`,
      transportFetchInvoked: false,
    };
  }

  if (transport === 'nym' && !deps.nymConnected) {
    return {
      state: 'error',
      transport,
      url: validated.url,
      probeId,
      durationMs: Math.max(0, now() - started),
      httpStatus: null,
      httpOk: null,
      probeMatched: false,
      echoedProbeId: null,
      responsePreview: null,
      message:
        'Nym selected but MixFetch not Ready — Connect first. Ready ≠ completed public-data request.',
      transportFetchInvoked: false,
    };
  }

  const requestUrl = validated.url;
  const init: RequestInit & { mode?: string } = {
    method: NYM_PUBLIC_DATA_METHOD,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ [NYM_PUBLIC_DATA_PROBE_FIELD]: probeId }),
  };
  // MixFetch v1 Go WASM CORS check on Mixnet responses — not a clearnet bypass.
  if (transport === 'nym') {
    init.mode = 'unsafe-ignore-cors';
  }

  type RaceOk = { kind: 'ok'; response: Response };
  type RaceTimeout = { kind: 'timeout' };
  type RaceErr = { kind: 'error'; error: unknown };

  let race: RaceOk | RaceTimeout | RaceErr;
  try {
    race = await Promise.race([
      deps
        .fetchViaTransport(requestUrl, init)
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
      transport,
      url: requestUrl,
      probeId,
      durationMs,
      httpStatus: null,
      httpOk: null,
      probeMatched: false,
      echoedProbeId: null,
      responsePreview: null,
      message: `Public data request timed out after ${timeoutMs}ms via ${transport}`,
      transportFetchInvoked: true,
    };
  }

  if (race.kind === 'error') {
    const msg =
      race.error instanceof Error
        ? race.error.message
        : 'Public data transport request failed';
    return {
      state: 'error',
      transport,
      url: requestUrl,
      probeId,
      durationMs,
      httpStatus: null,
      httpOk: null,
      probeMatched: false,
      echoedProbeId: null,
      responsePreview: null,
      message: msg,
      transportFetchInvoked: true,
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
      transport,
      url: requestUrl,
      probeId,
      durationMs: Math.max(0, now() - started),
      httpStatus,
      httpOk,
      probeMatched: false,
      echoedProbeId: null,
      responsePreview: null,
      message:
        error instanceof Error
          ? `Failed to read response body: ${error.message}`
          : 'Failed to read response body',
      transportFetchInvoked: true,
    };
  }

  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    return {
      state: 'error',
      transport,
      url: requestUrl,
      probeId,
      durationMs: Math.max(0, now() - started),
      httpStatus,
      httpOk,
      probeMatched: false,
      echoedProbeId: null,
      responsePreview: safeResponsePreview(text),
      message: 'Response was not JSON — cannot verify public probe id',
      transportFetchInvoked: true,
    };
  }

  const echoedProbeId = extractPublicDataProbeId(parsed);
  const probeMatched = echoedProbeId === probeId;
  const preview = safeResponsePreview(text);

  if (!httpOk) {
    return {
      state: 'error',
      transport,
      url: requestUrl,
      probeId,
      durationMs: Math.max(0, now() - started),
      httpStatus,
      httpOk,
      probeMatched,
      echoedProbeId,
      responsePreview: preview,
      message: `HTTP ${httpStatus} via ${transport}`,
      transportFetchInvoked: true,
    };
  }

  if (!probeMatched) {
    return {
      state: 'error',
      transport,
      url: requestUrl,
      probeId,
      durationMs: Math.max(0, now() - started),
      httpStatus,
      httpOk,
      probeMatched: false,
      echoedProbeId,
      responsePreview: preview,
      message: echoedProbeId
        ? 'Echoed probe id did not match'
        : `Response missing ${NYM_PUBLIC_DATA_PROBE_FIELD} echo (unsupported GET format)`,
      transportFetchInvoked: true,
    };
  }

  return {
    state: 'success',
    transport,
    url: requestUrl,
    probeId,
    durationMs: Math.max(0, now() - started),
    httpStatus,
    httpOk: true,
    probeMatched: true,
    echoedProbeId,
    responsePreview: preview,
    message: `Public data OK via ${transport} — probe echoed`,
    transportFetchInvoked: true,
  };
}
