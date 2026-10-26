/**
 * Public Stellar Horizon probe (no wallet address / no Friendbot / no signing).
 * Uses the same FailClosedTransportRouter path as StellarReadClient.
 *
 * Default logical URL: SDF testnet `/fee_stats`. In Nym mode the transport adapter
 * remaps to the configured effective MixFetch Horizon base; this probe records both.
 */

import type { StellarReadFetch } from '@solanym/wallet-core/src/stellar/read/StellarReadClient.js';
import type { NymTransportMode } from '@solanym/wallet-core/src/nym/NymTransportPolicy.js';
import {
  DEFAULT_STELLAR_NYM_HORIZON_CONFIG,
  STELLAR_LOGICAL_TESTNET_HORIZON_URL,
  resolveHorizonUrlForNym,
  type HorizonUrlResolution,
  type StellarNymHorizonConfig,
} from './stellarHorizonNymConfig.js';

export type StellarHorizonProbeState = 'idle' | 'running' | 'success' | 'error' | 'timeout';

export type StellarHorizonProbeResult = {
  state: StellarHorizonProbeState;
  transport: NymTransportMode;
  /** @deprecated Prefer logicalUrl — kept for IPC backward compatibility. */
  url: string;
  /** URL requested by the product / caller (usually SDF Horizon). */
  logicalUrl: string;
  /** URL actually fetched (after Nym remap when applicable). */
  effectiveUrl: string;
  urlRewritten: boolean;
  rewriteReason: string | null;
  durationMs: number;
  httpStatus: number | null;
  httpOk: boolean | null;
  contentType: string | null;
  /** Safe fields — root probe uses network_passphrase; fee_stats uses last_ledger. */
  horizonVersion: string | null;
  networkPassphrase: string | null;
  lastLedger: string | null;
  lastLedgerBaseFee: string | null;
  horizonErrorType: string | null;
  horizonErrorTitle: string | null;
  horizonErrorDetail: string | null;
  responsePreview: string | null;
  message: string;
  transportFetchInvoked: boolean;
};

/**
 * Public Horizon fee_stats — logical SDF testnet by default so Nym remap is visible.
 */
export function defaultStellarHorizonProbeUrl(horizonBase?: string): string {
  const base = (horizonBase ?? STELLAR_LOGICAL_TESTNET_HORIZON_URL).replace(/\/+$/, '');
  return `${base}/fee_stats`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function preview(text: string, max = 280): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

function urlPairMessage(resolution: HorizonUrlResolution): string {
  if (resolution.rewritten) {
    return `logical=${resolution.logicalUrl} effective=${resolution.effectiveUrl}`;
  }
  return `url=${resolution.effectiveUrl}`;
}

function isJsonLikeContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const ct = contentType.toLowerCase();
  return (
    ct.includes('application/hal+json') ||
    ct.includes('application/json') ||
    ct.includes('application/problem+json')
  );
}

export type HorizonHalParseResult =
  | {
      kind: 'ok';
      horizonVersion: string | null;
      networkPassphrase: string | null;
      lastLedger: string | null;
      lastLedgerBaseFee: string | null;
    }
  | {
      kind: 'horizon_error';
      httpStatusHint: number | null;
      type: string | null;
      title: string | null;
      detail: string | null;
    }
  | { kind: 'empty' }
  | { kind: 'not_json'; preview: string }
  | { kind: 'incomplete'; message: string; preview: string };

/**
 * Validate public Horizon HAL/JSON bodies (fee_stats or root). No account payloads.
 */
export function parseHorizonPublicHalBody(
  text: string,
  options?: { expectFeeStats?: boolean },
): HorizonHalParseResult {
  if (!text || text.trim().length === 0) {
    return { kind: 'empty' };
  }

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { kind: 'not_json', preview: preview(text) };
  }

  const type = typeof json.type === 'string' ? json.type : null;
  const title = typeof json.title === 'string' ? json.title : null;
  const detail = typeof json.detail === 'string' ? json.detail : null;
  const statusHint =
    typeof json.status === 'number'
      ? json.status
      : typeof json.status === 'string' && /^\d+$/.test(json.status)
        ? Number(json.status)
        : null;

  // Horizon problem+json style errors
  if (
    (type && type.includes('horizon-errors')) ||
    (title && !json.last_ledger && !json.network_passphrase)
  ) {
    if (type || title || detail) {
      return {
        kind: 'horizon_error',
        httpStatusHint: statusHint,
        type,
        title,
        detail,
      };
    }
  }

  const horizonVersion =
    typeof json.horizon_version === 'string' ? json.horizon_version : null;
  const networkPassphrase =
    typeof json.network_passphrase === 'string' ? json.network_passphrase : null;
  const lastLedger =
    typeof json.last_ledger === 'string' || typeof json.last_ledger === 'number'
      ? String(json.last_ledger)
      : null;
  const lastLedgerBaseFee =
    typeof json.last_ledger_base_fee === 'string' ||
    typeof json.last_ledger_base_fee === 'number'
      ? String(json.last_ledger_base_fee)
      : null;

  if (options?.expectFeeStats) {
    if (!lastLedger) {
      return {
        kind: 'incomplete',
        message: 'fee_stats HAL JSON missing last_ledger',
        preview: preview(text),
      };
    }
    return {
      kind: 'ok',
      horizonVersion,
      networkPassphrase,
      lastLedger,
      lastLedgerBaseFee,
    };
  }

  if (!lastLedger && !networkPassphrase) {
    return {
      kind: 'incomplete',
      message: 'Horizon JSON missing last_ledger and network_passphrase',
      preview: preview(text),
    };
  }

  return {
    kind: 'ok',
    horizonVersion,
    networkPassphrase,
    lastLedger,
    lastLedgerBaseFee,
  };
}

function emptyResult(
  partial: Omit<StellarHorizonProbeResult, never> &
    Partial<StellarHorizonProbeResult>,
): StellarHorizonProbeResult {
  return {
    state: 'error',
    transport: 'nym',
    url: '',
    logicalUrl: '',
    effectiveUrl: '',
    urlRewritten: false,
    rewriteReason: null,
    durationMs: 0,
    httpStatus: null,
    httpOk: null,
    contentType: null,
    horizonVersion: null,
    networkPassphrase: null,
    lastLedger: null,
    lastLedgerBaseFee: null,
    horizonErrorType: null,
    horizonErrorTitle: null,
    horizonErrorDetail: null,
    responsePreview: null,
    message: '',
    transportFetchInvoked: false,
    ...partial,
  };
}

/**
 * GET Horizon public metadata via Stellar transport (fail-closed in nym mode).
 */
export async function probeStellarHorizon(deps: {
  fetchViaStellarTransport: StellarReadFetch;
  transport: NymTransportMode;
  nymConnected: boolean;
  /** Logical Horizon URL (defaults to SDF testnet /fee_stats). */
  horizonUrl?: string;
  timeoutMs?: number;
  nymHorizonConfig?: StellarNymHorizonConfig;
  now?: () => number;
}): Promise<StellarHorizonProbeResult> {
  const now = deps.now ?? (() => Date.now());
  const started = now();
  const logicalUrl = deps.horizonUrl?.trim() || defaultStellarHorizonProbeUrl();
  const config = deps.nymHorizonConfig ?? DEFAULT_STELLAR_NYM_HORIZON_CONFIG;
  const resolution =
    deps.transport === 'nym'
      ? resolveHorizonUrlForNym(logicalUrl, config)
      : {
          logicalUrl,
          effectiveUrl: logicalUrl,
          rewritten: false,
          reason: null,
        };
  const timeoutMs = deps.timeoutMs ?? 90_000;
  const expectFeeStats = /\/fee_stats\/?(\?|$)/i.test(logicalUrl);

  const baseFields = {
    transport: deps.transport,
    url: resolution.logicalUrl,
    logicalUrl: resolution.logicalUrl,
    effectiveUrl: resolution.effectiveUrl,
    urlRewritten: resolution.rewritten,
    rewriteReason: resolution.reason,
  };

  if (deps.transport === 'nym' && !deps.nymConnected) {
    return emptyResult({
      ...baseFields,
      state: 'error',
      message:
        'Nym selected but MixFetch not Ready — Connect first. Ready ≠ Horizon probe complete. ' +
        `(${urlPairMessage(resolution)})`,
      transportFetchInvoked: false,
    });
  }

  type Race =
    | { kind: 'ok'; response: Response }
    | { kind: 'timeout' }
    | { kind: 'error'; error: unknown };

  let race: Race;
  try {
    race = await Promise.race([
      deps
        .fetchViaStellarTransport(logicalUrl, {
          method: 'GET',
          headers: { Accept: 'application/hal+json, application/json' },
        })
        .then((response): Race => ({ kind: 'ok', response }))
        .catch((error): Race => ({ kind: 'error', error })),
      sleep(timeoutMs).then((): Race => ({ kind: 'timeout' })),
    ]);
  } catch (error) {
    race = { kind: 'error', error };
  }

  const durationMs = Math.max(0, now() - started);

  if (race.kind === 'timeout') {
    return emptyResult({
      ...baseFields,
      state: 'timeout',
      durationMs,
      message: `Horizon probe timed out after ${timeoutMs}ms via ${deps.transport} (${urlPairMessage(resolution)}; no clearnet fallback)`,
      transportFetchInvoked: true,
    });
  }

  if (race.kind === 'error') {
    const raw =
      race.error instanceof Error
        ? race.error.message
        : 'Horizon probe transport error';
    return emptyResult({
      ...baseFields,
      state: 'error',
      durationMs,
      message: `${raw} (${urlPairMessage(resolution)}; no clearnet fallback)`,
      transportFetchInvoked: true,
    });
  }

  const { response } = race;
  const httpStatus = response.status;
  const httpOk = response.ok;
  const contentType = response.headers.get('content-type');
  let text = '';
  try {
    text = await response.text();
  } catch (error) {
    return emptyResult({
      ...baseFields,
      state: 'error',
      durationMs: Math.max(0, now() - started),
      httpStatus,
      httpOk,
      contentType,
      message:
        error instanceof Error
          ? `Failed to read Horizon body: ${error.message} (${urlPairMessage(resolution)})`
          : `Failed to read Horizon body (${urlPairMessage(resolution)})`,
      transportFetchInvoked: true,
    });
  }

  if (!httpOk) {
    const parsedErr = parseHorizonPublicHalBody(text);
    const errFields =
      parsedErr.kind === 'horizon_error'
        ? {
            horizonErrorType: parsedErr.type,
            horizonErrorTitle: parsedErr.title,
            horizonErrorDetail: parsedErr.detail,
          }
        : {
            horizonErrorType: null,
            horizonErrorTitle: null,
            horizonErrorDetail: null,
          };
    const detail =
      parsedErr.kind === 'horizon_error'
        ? parsedErr.detail || parsedErr.title || parsedErr.type || `HTTP ${httpStatus}`
        : `HTTP ${httpStatus}`;
    return emptyResult({
      ...baseFields,
      state: 'error',
      durationMs: Math.max(0, now() - started),
      httpStatus,
      httpOk,
      contentType,
      ...errFields,
      responsePreview: preview(text),
      message: `Horizon ${detail} via ${deps.transport} (${urlPairMessage(resolution)}; no clearnet fallback)`,
      transportFetchInvoked: true,
    });
  }

  if (text.length === 0) {
    return emptyResult({
      ...baseFields,
      state: 'error',
      durationMs: Math.max(0, now() - started),
      httpStatus,
      httpOk,
      contentType,
      responsePreview: `(empty body, content-type=${contentType ?? 'n/a'})`,
      message:
        `Horizon HTTP ${httpStatus} with empty body via ${deps.transport} ` +
        `(${urlPairMessage(resolution)}). Often indicates MixFetch HAL decode miss — no clearnet fallback.`,
      transportFetchInvoked: true,
    });
  }

  if (contentType && !isJsonLikeContentType(contentType)) {
    return emptyResult({
      ...baseFields,
      state: 'error',
      durationMs: Math.max(0, now() - started),
      httpStatus,
      httpOk,
      contentType,
      responsePreview: preview(text),
      message:
        `Horizon unexpected Content-Type "${contentType}" via ${deps.transport} ` +
        `(${urlPairMessage(resolution)}); expected application/hal+json or application/json`,
      transportFetchInvoked: true,
    });
  }

  const parsed = parseHorizonPublicHalBody(text, { expectFeeStats });

  if (parsed.kind === 'empty') {
    return emptyResult({
      ...baseFields,
      state: 'error',
      durationMs: Math.max(0, now() - started),
      httpStatus,
      httpOk,
      contentType,
      message: `Horizon empty body after read (${urlPairMessage(resolution)})`,
      transportFetchInvoked: true,
    });
  }

  if (parsed.kind === 'not_json') {
    return emptyResult({
      ...baseFields,
      state: 'error',
      durationMs: Math.max(0, now() - started),
      httpStatus,
      httpOk,
      contentType,
      responsePreview: parsed.preview,
      message: `Horizon response was not JSON (bodyLength=${text.length}; ${urlPairMessage(resolution)})`,
      transportFetchInvoked: true,
    });
  }

  if (parsed.kind === 'horizon_error') {
    return emptyResult({
      ...baseFields,
      state: 'error',
      durationMs: Math.max(0, now() - started),
      httpStatus,
      httpOk,
      contentType,
      horizonErrorType: parsed.type,
      horizonErrorTitle: parsed.title,
      horizonErrorDetail: parsed.detail,
      responsePreview: preview(text),
      message: `Horizon error document via ${deps.transport}: ${
        parsed.detail || parsed.title || parsed.type || 'unknown'
      } (${urlPairMessage(resolution)})`,
      transportFetchInvoked: true,
    });
  }

  if (parsed.kind === 'incomplete') {
    return emptyResult({
      ...baseFields,
      state: 'error',
      durationMs: Math.max(0, now() - started),
      httpStatus,
      httpOk,
      contentType,
      responsePreview: parsed.preview,
      message: `${parsed.message} (${urlPairMessage(resolution)})`,
      transportFetchInvoked: true,
    });
  }

  const feeNote =
    expectFeeStats && !parsed.lastLedgerBaseFee
      ? ' (last_ledger_base_fee absent)'
      : '';

  return {
    state: 'success',
    ...baseFields,
    durationMs: Math.max(0, now() - started),
    httpStatus,
    httpOk: true,
    contentType,
    horizonVersion: parsed.horizonVersion,
    networkPassphrase: parsed.networkPassphrase,
    lastLedger: parsed.lastLedger,
    lastLedgerBaseFee: parsed.lastLedgerBaseFee,
    horizonErrorType: null,
    horizonErrorTitle: null,
    horizonErrorDetail: null,
    responsePreview: preview(text),
    message: parsed.lastLedger
      ? `Horizon fee_stats OK via ${deps.transport} — ledger ${parsed.lastLedger}${feeNote} (${urlPairMessage(resolution)})`
      : `Horizon OK via ${deps.transport} — ${parsed.networkPassphrase} (${urlPairMessage(resolution)})`,
    transportFetchInvoked: true,
  };
}
