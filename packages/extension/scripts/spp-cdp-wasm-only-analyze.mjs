#!/usr/bin/env node
/**
 * Solanym 5G.9 — offline NDJSON analyzer for a future WASM-only CDP observation.
 *
 * Reads harness NDJSON (or synthetic fixtures). Does NOT launch Chrome, CDP,
 * probe, initializeWasm, Storage, Client, or the SPP SDK. No network I/O.
 *
 * Usage:
 *   node packages/extension/scripts/spp-cdp-wasm-only-analyze.mjs <input.ndjson> \
 *     [--extension-id <id>] [--output <report.json>]
 *
 * Importing this module does not run analysis. Absence of events ≠ absence of activity.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SCHEMA_VERSION = 'spp-cdp-wasm-only-analyze/1';

export const ABSENCE_LIMIT =
  'Absence of events is not proof of absence of activity.';

const DEFAULT_LIMITS = Object.freeze([
  ABSENCE_LIMIT,
  'The harness does not demonstrate absence of OPFS access.',
  'Network coverage for dedicated workers may be incomplete.',
  'This analysis does not demonstrate absence of internal WASM side effects.',
  'This report does not demonstrate that Chrome fully terminated.',
  'Logs only support conclusions about captured events.',
]);

const SPP_PATHS = Object.freeze({
  facadeJs: 'spp/js/index.js',
  wasmGlueJs: 'spp/dist/stellar_private_payments_web.js',
  wasmMain: 'spp/dist/stellar_private_payments_web_bg.wasm',
  meta: 'spp/SPP_ASSET_META.json',
  storageWorker: 'spp/dist/workers/storage-worker.js',
  proverWorker: 'spp/dist/workers/prover-worker.js',
  circuitsPrefix: 'spp/dist/circuits/',
});

/** @param {string[]} argv */
export function parseAnalyzeArgs(argv) {
  const out = {
    input: null,
    extensionId: null,
    output: null,
    help: false,
  };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = args[i + 1];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--extension-id' && next) {
      out.extensionId = next;
      i++;
    } else if (a === '--output' && next) {
      out.output = resolve(next);
      i++;
    } else if (a.startsWith('-')) {
      throw new Error(`Unknown or incomplete argument: ${a}`);
    } else if (!out.input) {
      out.input = resolve(a);
    } else {
      throw new Error(`Unexpected argument: ${a}`);
    }
  }
  return out;
}

/**
 * @param {string} text
 * @returns {{ rows: object[], parseErrors: { line: number, reason: string, raw: string }[] }}
 */
export function parseNdjsonText(text) {
  const rows = [];
  const parseErrors = [];
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === '') continue;
    try {
      const value = JSON.parse(raw);
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        parseErrors.push({
          line: i + 1,
          reason: 'JSON value is not an object',
          raw: raw.slice(0, 200),
        });
        continue;
      }
      rows.push({ ...value, _line: i + 1 });
    } catch (e) {
      parseErrors.push({
        line: i + 1,
        reason: e instanceof Error ? e.message : String(e),
        raw: raw.slice(0, 200),
      });
    }
  }
  return { rows, parseErrors };
}

/** @param {unknown} iso */
export function parseTimestamp(iso) {
  if (typeof iso !== 'string' || !iso.trim()) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * @param {string|null|undefined} url
 * @param {string|null} extensionId
 */
export function classifyResourceUrl(url, extensionId) {
  const originalUrl = url == null ? null : String(url);
  if (!originalUrl || !originalUrl.trim()) {
    return {
      class: 'unknown-path',
      originalUrl,
      normalizedPath: null,
      extensionIdMatch: null,
    };
  }

  let parsed;
  try {
    parsed = new URL(originalUrl);
  } catch {
    return {
      class: 'unknown-scheme',
      originalUrl,
      normalizedPath: null,
      extensionIdMatch: null,
    };
  }

  const protocol = parsed.protocol.toLowerCase();
  if (
    protocol === 'http:' ||
    protocol === 'https:' ||
    protocol === 'ws:' ||
    protocol === 'wss:'
  ) {
    return {
      class: 'external',
      originalUrl,
      normalizedPath: null,
      extensionIdMatch: false,
    };
  }

  if (protocol === 'chrome-extension:') {
    const host = parsed.hostname;
    if (extensionId && host !== extensionId) {
      return {
        class: 'foreign-extension',
        originalUrl,
        normalizedPath: null,
        extensionIdMatch: false,
      };
    }
    if (!extensionId) {
      return {
        class: 'unknown-path',
        originalUrl,
        normalizedPath: parsed.pathname.replace(/^\/+/, ''),
        extensionIdMatch: null,
        note: 'extensionId missing; chrome-extension path not fully classified',
      };
    }

    let path = parsed.pathname.replace(/^\/+/, '');
    try {
      path = decodeURIComponent(path);
    } catch {
      /* keep raw path */
    }

    // Exact / suffix-with-slash matches only — avoid loose substring spoofing.
    if (path === SPP_PATHS.facadeJs || path.endsWith('/' + SPP_PATHS.facadeJs)) {
      return { class: 'facade-js', originalUrl, normalizedPath: path, extensionIdMatch: true };
    }
    if (
      path === SPP_PATHS.wasmGlueJs ||
      path.endsWith('/' + SPP_PATHS.wasmGlueJs)
    ) {
      return { class: 'wasm-glue-js', originalUrl, normalizedPath: path, extensionIdMatch: true };
    }
    if (
      path === SPP_PATHS.wasmMain ||
      path.endsWith('/' + SPP_PATHS.wasmMain)
    ) {
      return { class: 'wasm-main', originalUrl, normalizedPath: path, extensionIdMatch: true };
    }
    if (
      path === SPP_PATHS.meta ||
      path.endsWith('/' + SPP_PATHS.meta) ||
      path.endsWith('/SPP_ASSET_META.json')
    ) {
      return { class: 'meta', originalUrl, normalizedPath: path, extensionIdMatch: true };
    }
    if (
      path === SPP_PATHS.storageWorker ||
      path.endsWith('/' + SPP_PATHS.storageWorker) ||
      /\/spp\/dist\/workers\/storage-worker(?:-module)?(?:_bg\.wasm)?$/i.test('/' + path)
    ) {
      return {
        class: 'storage-worker',
        originalUrl,
        normalizedPath: path,
        extensionIdMatch: true,
      };
    }
    if (
      path === SPP_PATHS.proverWorker ||
      path.endsWith('/' + SPP_PATHS.proverWorker) ||
      /\/spp\/dist\/workers\/prover-worker(?:-module)?(?:_bg\.wasm)?$/i.test('/' + path)
    ) {
      return {
        class: 'prover-worker',
        originalUrl,
        normalizedPath: path,
        extensionIdMatch: true,
      };
    }
    // Any other path under packaged workers/ is not assumed safe.
    if (
      path.startsWith('spp/dist/workers/') ||
      path.includes('/spp/dist/workers/')
    ) {
      return {
        class: 'unrecognized-worker-path',
        originalUrl,
        normalizedPath: path,
        extensionIdMatch: true,
      };
    }
    if (
      path.startsWith(SPP_PATHS.circuitsPrefix) ||
      path.includes('/spp/dist/circuits/')
    ) {
      return { class: 'circuits', originalUrl, normalizedPath: path, extensionIdMatch: true };
    }
    if (
      /(?:^|\/)spp-host\.html$/i.test(path) ||
      /(?:^|\/)spp-host\.js$/i.test(path) ||
      /(^|\/)spp-host-chunk-/.test(path) ||
      /(^|\/)spp-host-asset-/.test(path)
    ) {
      return { class: 'host-ui', originalUrl, normalizedPath: path, extensionIdMatch: true };
    }
    return { class: 'ext-other', originalUrl, normalizedPath: path, extensionIdMatch: true };
  }

  if (
    protocol === 'chrome:' ||
    protocol === 'devtools:' ||
    protocol === 'about:' ||
    protocol === 'blob:'
  ) {
    return {
      class: 'ext-other',
      originalUrl,
      normalizedPath: null,
      extensionIdMatch: null,
      note: 'browser-noise',
    };
  }

  return {
    class: 'unknown-scheme',
    originalUrl,
    normalizedPath: null,
    extensionIdMatch: null,
  };
}

/**
 * @param {object} row
 */
function networkUrlFromRow(row) {
  return row?.summary?.url ?? null;
}

function networkRequestId(row) {
  return row?.summary?.requestId ?? null;
}

/**
 * @param {object[]} rows
 * @param {{ extensionId?: string|null }} opts
 */
export function correlateNetwork(rows, opts = {}) {
  const warnings = [];
  /** @type {Map<string, object>} */
  const byKey = new Map();
  const sequence = [];

  for (const row of rows) {
    if (row.kind !== 'event') continue;
    const method = row.method;
    if (
      method !== 'Network.requestWillBeSent' &&
      method !== 'Network.responseReceived' &&
      method !== 'Network.loadingFailed'
    ) {
      continue;
    }
    const requestId = networkRequestId(row);
    if (!requestId) {
      warnings.push({
        code: 'network-missing-requestId',
        line: row._line,
        method,
      });
      continue;
    }
    const sessionId = row.sessionId ?? null;
    const weak = sessionId == null;
    const key = weak ? `weak:${requestId}` : `${sessionId}\0${requestId}`;
    if (weak) {
      warnings.push({
        code: 'weak-network-key',
        line: row._line,
        requestId,
        detail: 'sessionId missing; correlation key is weak',
      });
    }

    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        key,
        requestId,
        sessionId,
        weakKey: weak,
        targetId: row.targetId ?? null,
        targetType: row.targetType ?? null,
        events: [],
        url: null,
        urls: [],
        status: null,
        failed: false,
        failure: null,
        incomplete: true,
        duplicates: [],
        conflicts: [],
        urlMutations: [],
        redirectAmbiguous: false,
      };
      byKey.set(key, entry);
      sequence.push(entry);
    }

    const url = networkUrlFromRow(row);
    const stamp = { t: row.t ?? null, method, line: row._line, url };

    const dup = entry.events.find(
      (e) => e.method === method && e.t === row.t && e.url === url,
    );
    if (dup) {
      entry.duplicates.push(stamp);
    } else {
      const sameMethod = entry.events.filter((e) => e.method === method);
      if (sameMethod.length > 0) {
        entry.conflicts.push({
          method,
          prior: sameMethod[sameMethod.length - 1],
          next: stamp,
        });
      }
      entry.events.push(stamp);
    }

    if (url) {
      if (entry.url && entry.url !== url) {
        entry.urlMutations.push({ from: entry.url, to: url, at: row.t });
        entry.redirectAmbiguous = true;
      }
      entry.url = url;
      if (!entry.urls.includes(url)) entry.urls.push(url);
    }
    if (row.targetId && !entry.targetId) entry.targetId = row.targetId;
    if (row.targetType && !entry.targetType) entry.targetType = row.targetType;

    if (method === 'Network.responseReceived') {
      entry.status = row.summary?.status ?? entry.status;
      entry.incomplete = false;
    }
    if (method === 'Network.loadingFailed') {
      entry.failed = true;
      entry.failure = {
        errorText: row.summary?.errorText ?? null,
        canceled: row.summary?.canceled ?? null,
      };
      entry.incomplete = false;
    }
  }

  // incomplete if never got response or failure
  for (const entry of sequence) {
    const hasTerminal = entry.events.some(
      (e) =>
        e.method === 'Network.responseReceived' ||
        e.method === 'Network.loadingFailed',
    );
    entry.incomplete = !hasTerminal;
  }

  return { requests: sequence, warnings };
}

/**
 * @param {object[]} rows
 */
export function extractPhaseMarkers(rows) {
  const markers = [];
  const warnings = [];
  for (const row of rows) {
    if (row.kind !== 'phase-marker') continue;
    const phase = row.phase;
    const ms = parseTimestamp(row.t);
    if (!phase || !['T0', 'T1', 'T2'].includes(phase)) {
      warnings.push({
        code: 'phase-marker-invalid-phase',
        line: row._line,
        phase,
      });
      continue;
    }
    if (ms == null) {
      warnings.push({
        code: 'phase-marker-unparseable-time',
        line: row._line,
        phase,
        t: row.t ?? null,
      });
      continue;
    }
    markers.push({
      phase,
      t: row.t,
      ms,
      targetId: row.targetId ?? null,
      sessionId: row.sessionId ?? null,
      outcome: row.outcome ?? null,
      ui: row.ui ?? null,
      line: row._line,
    });
  }
  return { markers, warnings };
}

/**
 * @param {ReturnType<typeof extractPhaseMarkers>['markers']} markers
 */
export function resolvePhases(markers, rows, warnings) {
  const byPhase = { T0: [], T1: [], T2: [] };
  for (const m of markers) byPhase[m.phase].push(m);

  for (const p of ['T0', 'T1', 'T2']) {
    if (byPhase[p].length > 1) {
      warnings.push({
        code: 'phase-marker-duplicate',
        phase: p,
        count: byPhase[p].length,
      });
    }
  }

  const hasAll =
    byPhase.T0.length >= 1 && byPhase.T1.length >= 1 && byPhase.T2.length >= 1;
  const hasDup =
    byPhase.T0.length > 1 || byPhase.T1.length > 1 || byPhase.T2.length > 1;

  if (hasAll && hasDup) {
    // Do not silently pick earliest/latest — unique sequence required for ok.
    warnings.push({
      code: 'phase-marker-duplicates-block-resolution',
      detail: {
        T0: byPhase.T0.length,
        T1: byPhase.T1.length,
        T2: byPhase.T2.length,
      },
    });
    return {
      phaseSource: 'explicit',
      phaseConfidence: 'low',
      phases: null,
      contradiction: false,
      duplicateMarkers: true,
    };
  }

  if (hasAll && !hasDup) {
    const T0 = byPhase.T0[0];
    const T1 = byPhase.T1[0];
    const T2 = byPhase.T2[0];
    if (!(T0.ms < T1.ms && T1.ms < T2.ms)) {
      warnings.push({
        code: 'phase-marker-order-invalid',
        detail: { T0: T0.t, T1: T1.t, T2: T2.t },
      });
      return {
        phaseSource: 'explicit',
        phaseConfidence: 'low',
        phases: null,
        contradiction: true,
        duplicateMarkers: false,
      };
    }
    // Equal timestamps already fail strict < ; document boundary policy elsewhere.
    return {
      phaseSource: 'explicit',
      phaseConfidence: 'high',
      phases: {
        T0: { t: T0.t, ms: T0.ms, targetId: T0.targetId, sessionId: T0.sessionId, ui: T0.ui },
        T1: { t: T1.t, ms: T1.ms, targetId: T1.targetId, sessionId: T1.sessionId, ui: T1.ui },
        T2: {
          t: T2.t,
          ms: T2.ms,
          targetId: T2.targetId,
          sessionId: T2.sessionId,
          ui: T2.ui,
          outcome: T2.outcome,
        },
      },
      contradiction: false,
      duplicateMarkers: false,
    };
  }

  // Heuristic fallback: first facade-js request ≈ after probe start; wasm-main ≈ wasm window;
  // host-ui-snapshot with wasm ready/error as T2; first hostOpened event as soft T0.
  const net = rows.filter(
    (r) =>
      r.kind === 'event' &&
      r.method === 'Network.requestWillBeSent' &&
      parseTimestamp(r.t) != null,
  );
  const facade = net.find((r) => {
    const u = networkUrlFromRow(r);
    return typeof u === 'string' && u.includes('spp/js/index.js');
  });
  const wasm = net.find((r) => {
    const u = networkUrlFromRow(r);
    return typeof u === 'string' && u.includes('stellar_private_payments_web_bg.wasm');
  });
  const snaps = rows.filter(
    (r) =>
      (r.kind === 'host-ui-snapshot' || r.kind === 'phase-marker') &&
      parseTimestamp(r.t) != null,
  );
  const t2Snap = snaps.find((r) => {
    const wasmPhase = r.ui?.wasm ?? r.ui?.wasmPhase;
    return wasmPhase === 'ready' || wasmPhase === 'error';
  });

  if (facade && wasm && t2Snap) {
    const t0Row =
      rows.find(
        (r) =>
          r.hostOpened === true &&
          parseTimestamp(r.t) != null &&
          parseTimestamp(r.t) < parseTimestamp(facade.t),
      ) || facade;
    const T0ms = parseTimestamp(t0Row.t);
    const T1ms = parseTimestamp(facade.t);
    // T1 = probe complete ≈ after facade load; use facade time as end of probe window start boundary
    // Better: T1 just before wasm request
    const T1alt = parseTimestamp(wasm.t) - 1;
    const T2ms = parseTimestamp(t2Snap.t);
    if (T0ms != null && T1ms != null && T2ms != null && T0ms < T1alt && T1alt < T2ms) {
      warnings.push({
        code: 'phase-source-heuristic',
        detail: 'Derived T0/T1/T2 from facade fetch, wasm fetch, and UI snapshot',
      });
      return {
        phaseSource: 'heuristic',
        phaseConfidence: 'low',
        phases: {
          T0: { t: t0Row.t, ms: T0ms, targetId: t0Row.targetId ?? null, sessionId: t0Row.sessionId ?? null, ui: null },
          T1: {
            t: new Date(T1alt).toISOString(),
            ms: T1alt,
            targetId: facade.targetId ?? null,
            sessionId: facade.sessionId ?? null,
            ui: null,
          },
          T2: {
            t: t2Snap.t,
            ms: T2ms,
            targetId: t2Snap.targetId ?? null,
            sessionId: t2Snap.sessionId ?? null,
            ui: t2Snap.ui ?? null,
            outcome: t2Snap.ui?.wasm === 'error' ? 'error' : 'ready',
          },
        },
        contradiction: false,
        duplicateMarkers: false,
      };
    }
  }

  warnings.push({
    code: 'phase-markers-insufficient',
    detail: 'Cannot delimit WASM window with explicit markers or supported heuristic',
  });
  return {
    phaseSource: 'none',
    phaseConfidence: 'none',
    phases: null,
    contradiction: false,
    duplicateMarkers: false,
  };
}

/**
 * @param {string|null} type
 * @param {string|null} url
 * @param {string|null} extensionId
 */
export function classifyTarget(type, url, extensionId) {
  const t = type || '';
  const u = url || '';
  if (t === 'page' && /spp-host\.html/i.test(u)) return 'host-page';
  if (/\/spp\/dist\/workers\/storage-worker/i.test(u) || /(?:^|\/)storage-worker(?:\.js)?$/i.test(u)) {
    return 'storage-worker';
  }
  if (/\/spp\/dist\/workers\/prover-worker/i.test(u) || /(?:^|\/)prover-worker(?:\.js)?$/i.test(u)) {
    return 'prover-worker';
  }
  if (/\/spp\/dist\/workers\//i.test(u)) return 'unrecognized-worker-path';
  if (t === 'service_worker') return 'ext-sw';
  if (t === 'worker' || t === 'shared_worker') return 'unknown-worker';
  if (u.includes('spp-host.html')) return 'host-page';
  // Missing type/url or unclassified → opaque (not assumed safe).
  if (!t && !u) return 'opaque';
  return 'other';
}

/**
 * @param {object[]} rows
 * @param {{ T1: { ms: number } } | null} phases
 * @param {string|null} extensionId
 */
export function analyzeTargets(rows, phases, extensionId) {
  /** @type {Map<string, { targetId: string, types: Set<string>, urls: Set<string>, firstMs: number, lastMs: number, class: string }>} */
  const byId = new Map();
  const attaches = [];

  for (const row of rows) {
    if (row.kind !== 'event') continue;
    if (!String(row.method || '').startsWith('Target.')) continue;
    const ms = parseTimestamp(row.t);
    if (ms == null) continue;
    const targetId =
      row.targetId || row.summary?.targetId || null;
    const type = row.targetType || row.summary?.type || null;
    const url = row.targetUrl || row.summary?.url || null;

    if (row.method === 'Target.attachedToTarget') {
      attaches.push({
        t: row.t,
        ms,
        sessionId: row.attachedSessionId || row.sessionId || row.summary?.sessionId || null,
        targetId,
        type,
        url,
        class: classifyTarget(type, url, extensionId),
      });
    }

    if (!targetId) continue;
    let rec = byId.get(targetId);
    if (!rec) {
      rec = {
        targetId,
        types: new Set(),
        urls: new Set(),
        firstMs: ms,
        lastMs: ms,
        class: classifyTarget(type, url, extensionId),
      };
      byId.set(targetId, rec);
    }
    rec.firstMs = Math.min(rec.firstMs, ms);
    rec.lastMs = Math.max(rec.lastMs, ms);
    if (type) rec.types.add(type);
    if (url) rec.urls.add(url);
    // Prefer more specific class if later URL reveals worker
    const nextClass = classifyTarget(type, url, extensionId);
    if (
      nextClass === 'storage-worker' ||
      nextClass === 'prover-worker' ||
      nextClass === 'unknown-worker' ||
      nextClass === 'unrecognized-worker-path' ||
      nextClass === 'opaque'
    ) {
      rec.class = nextClass;
    }
  }

  const t1ms = phases?.T1?.ms ?? null;
  const pre = [];
  const postNew = [];
  for (const rec of byId.values()) {
    const summary = {
      targetId: rec.targetId,
      class: rec.class,
      types: [...rec.types],
      urls: [...rec.urls],
      firstMs: rec.firstMs,
      lastMs: rec.lastMs,
    };
    if (t1ms == null) {
      pre.push(summary);
      continue;
    }
    if (rec.firstMs <= t1ms) pre.push(summary);
    else postNew.push(summary);
  }

  const newAttachesPostT1 =
    t1ms == null
      ? []
      : attaches.filter((a) => a.ms > t1ms).map((a) => ({
          ...a,
          // attach to known targetId is not a new target
          knownTarget: byId.has(a.targetId) && (byId.get(a.targetId)?.firstMs ?? Infinity) <= t1ms,
        }));

  return {
    preT1: pre,
    newTargetIdsPostT1: postNew,
    attachesPostT1: newAttachesPostT1,
  };
}

/**
 * Label windows (reporting).
 * Boundary policy: events with ms === T1 are labeled `probe` for (T0,T1] but are
 * also inside the risk perimeter [T1, +∞) used for security decisions.
 */
function windowForMs(ms, phases) {
  if (!phases || ms == null) return 'unknown';
  const { T0, T1, T2 } = phases;
  if (ms <= T0.ms) return 'baseline';
  if (ms > T0.ms && ms <= T1.ms) return 'probe';
  if (ms > T1.ms && ms <= T2.ms) return 'wasm';
  if (ms > T2.ms) return 'post';
  return 'unknown';
}

/** Conservative security perimeter: from T1 inclusive through all later activity. */
function inRiskPerimeter(ms, phases) {
  if (!phases || ms == null) return false;
  return ms >= phases.T1.ms;
}

function escalateVerdict(current, next) {
  if (current === 'abort' || next === 'abort') return 'abort';
  if (current === 'inconclusive' || next === 'inconclusive') return 'inconclusive';
  return 'ok';
}

const FORBIDDEN_RESOURCE_CLASSES = new Set([
  'external',
  'foreign-extension',
  'storage-worker',
  'prover-worker',
  'circuits',
]);

const UNSAFE_UNKNOWN_RESOURCE_CLASSES = new Set([
  'unknown-path',
  'unknown-scheme',
  'unrecognized-worker-path',
  'ext-other',
]);

function requestEventTimestamps(req) {
  const out = [];
  for (const e of req.events || []) {
    const ms = parseTimestamp(e.t);
    if (ms != null) out.push(ms);
  }
  if (out.length === 0 && req.firstEventMs != null) out.push(req.firstEventMs);
  return out;
}

function isHostPageNetworkSession(row, phases, extensionId) {
  const type = row.type || row.targetType || null;
  const url = row.url || row.targetUrl || null;
  if (type === 'page' && typeof url === 'string' && /spp-host\.html/i.test(url)) {
    return true;
  }
  const sid = row.sessionId ?? null;
  if (sid && phases) {
    for (const p of [phases.T0, phases.T1, phases.T2]) {
      if (p?.sessionId && p.sessionId === sid) return true;
    }
  }
  if (
    extensionId &&
    typeof url === 'string' &&
    url.startsWith(`chrome-extension://${extensionId}/`) &&
    type === 'page'
  ) {
    return true;
  }
  return false;
}

/**
 * Positive Network.enable evidence for the host page session.
 * Prefers harness `domain-setup` records. Falls back to commandId-correlated
 * cdp-command / cdp-result pairs when domain-setup is absent.
 *
 * @returns {{
 *   status: 'ok'|'failed'|'missing'|'uncorrelated',
 *   successes: object[],
 *   failures: object[],
 *   notes: object[],
 * }}
 */
export function evaluateNetworkEnableEvidence(rows, phases, extensionId) {
  const notes = [];
  const setups = rows.filter(
    (r) => r.kind === 'domain-setup' && r.domain === 'Network.enable',
  );
  const failures = setups.filter((s) => s.ok === false);
  const successes = setups.filter(
    (s) => s.ok === true && isHostPageNetworkSession(s, phases, extensionId),
  );

  if (failures.some((f) => isHostPageNetworkSession(f, phases, extensionId) || !f.type)) {
    return { status: 'failed', successes, failures, notes };
  }
  if (successes.length > 0) {
    return { status: 'ok', successes, failures, notes };
  }

  // commandId correlation (harness audited Network.enable)
  const commands = rows.filter(
    (r) => r.kind === 'cdp-command' && r.method === 'Network.enable',
  );
  const results = rows.filter(
    (r) => r.kind === 'cdp-result' && r.method === 'Network.enable',
  );
  if (commands.length === 0 && setups.length === 0) {
    notes.push({
      code: 'network-enable-evidence-absent',
      detail: 'No domain-setup or cdp-command Network.enable records',
    });
    return { status: 'missing', successes: [], failures: [], notes };
  }

  const resultById = new Map();
  for (const r of results) {
    if (r.commandId == null) {
      notes.push({
        code: 'network-enable-result-missing-commandId',
        line: r._line ?? null,
      });
      continue;
    }
    if (resultById.has(r.commandId)) {
      notes.push({
        code: 'network-enable-duplicate-commandId',
        commandId: r.commandId,
      });
      return { status: 'uncorrelated', successes: [], failures, notes };
    }
    resultById.set(r.commandId, r);
  }

  const correlatedOk = [];
  for (const cmd of commands) {
    if (cmd.commandId == null) {
      notes.push({
        code: 'network-enable-command-missing-commandId',
        line: cmd._line ?? null,
      });
      return { status: 'uncorrelated', successes: [], failures, notes };
    }
    const res = resultById.get(cmd.commandId);
    if (!res) {
      notes.push({
        code: 'network-enable-command-without-result',
        commandId: cmd.commandId,
      });
      return { status: 'uncorrelated', successes: [], failures, notes };
    }
    if (res.ok === false) {
      return {
        status: 'failed',
        successes: [],
        failures: [{ ...res, sessionId: cmd.sessionId ?? res.sessionId }],
        notes,
      };
    }
    if (res.ok === true) {
      // Accept correlated ok only when session matches phase host sessionIds.
      const sid = cmd.sessionId ?? res.sessionId ?? null;
      const sessionMatches =
        sid &&
        phases &&
        [phases.T0?.sessionId, phases.T1?.sessionId, phases.T2?.sessionId].includes(sid);
      if (sessionMatches) {
        correlatedOk.push({ commandId: cmd.commandId, sessionId: sid });
      } else {
        notes.push({
          code: 'network-enable-result-session-not-host',
          commandId: cmd.commandId,
          sessionId: sid,
        });
      }
    } else {
      notes.push({
        code: 'network-enable-result-ok-field-absent',
        commandId: cmd.commandId,
      });
      return { status: 'uncorrelated', successes: [], failures, notes };
    }
  }

  if (correlatedOk.length > 0) {
    return { status: 'ok', successes: correlatedOk, failures, notes };
  }

  if (commands.length > 0 || setups.length > 0) {
    notes.push({
      code: 'network-enable-not-proven-for-host',
      detail: 'Records present but host-page success not established',
    });
    return { status: 'uncorrelated', successes: [], failures, notes };
  }

  return { status: 'missing', successes: [], failures, notes };
}

/**
 * Terminal security UI: T2 marker ui only, or a single host-ui-snapshot sharing T2's timestamp.
 * Does NOT merge T0/T1 or older snapshots into missing T2 fields.
 *
 * @param {object[]} rows
 * @param {object|null} phases
 */
export function collectTerminalUiEvidence(rows, phases) {
  const empty = {
    runDisabled: null,
    executionAuthorized: null,
    sdkInitialized: null,
    sessionInitializeEnabled: null,
    wasm: null,
    source: 'missing',
    note: 'No terminal T2 ui; T0/T1 ui are not used for ok gates',
  };

  const fromUi = (ui, source) => {
    const evidence = {
      runDisabled: null,
      executionAuthorized: null,
      sdkInitialized: null,
      sessionInitializeEnabled: null,
      wasm: null,
      source,
      note: null,
    };
    if (!ui || typeof ui !== 'object') return { ...empty, source };
    if ('runDisabled' in ui) evidence.runDisabled = ui.runDisabled;
    if ('executionAuthorized' in ui) evidence.executionAuthorized = ui.executionAuthorized;
    if ('sdkInitialized' in ui) evidence.sdkInitialized = ui.sdkInitialized;
    if ('sessionInitializeEnabled' in ui) {
      evidence.sessionInitializeEnabled = ui.sessionInitializeEnabled;
    }
    if (ui.wasm != null) evidence.wasm = ui.wasm;
    if (ui.wasmPhase != null) evidence.wasm = ui.wasmPhase;
    if (typeof ui.detail === 'string' && /executionAuthorized\s*=\s*true/.test(ui.detail)) {
      evidence.executionAuthorized = true;
    }
    return evidence;
  };

  if (!phases?.T2) return empty;

  if (phases.T2.ui && typeof phases.T2.ui === 'object') {
    return fromUi(phases.T2.ui, 't2-marker-ui');
  }

  const t2t = phases.T2.t;
  const snaps = rows.filter(
    (r) =>
      r.kind === 'host-ui-snapshot' &&
      r.ui &&
      typeof r.ui === 'object' &&
      r.t === t2t,
  );
  if (snaps.length === 1) {
    return fromUi(snaps[0].ui, 'host-ui-snapshot-matching-t2-timestamp');
  }
  if (snaps.length > 1) {
    return {
      ...empty,
      source: 'ambiguous',
      note: 'Multiple host-ui-snapshot rows share T2 timestamp; refusing merge',
    };
  }
  return empty;
}

/**
 * Resolve extension id: CLI wins; else meta.extensionId / report.extensionId only.
 * @param {object[]} rows
 * @param {string|null} cliId
 */
export function resolveExtensionId(rows, cliId) {
  if (cliId && typeof cliId === 'string' && cliId.trim()) return cliId.trim();
  for (const row of rows) {
    if (row.kind === 'meta' && typeof row.extensionId === 'string') return row.extensionId;
    if (row.kind === 'extension-id' && typeof row.extensionId === 'string') {
      return row.extensionId;
    }
    if (row.kind === 'summary' && typeof row.report?.extensionId === 'string') {
      return row.report.extensionId;
    }
  }
  return null;
}

/**
 * @param {string} text
 * @param {{ extensionId?: string|null, inputLabel?: string }} [options]
 */
export function analyzeNdjsonText(text, options = {}) {
  const warnings = [];
  const violations = [];
  const { rows, parseErrors } = parseNdjsonText(text);
  for (const err of parseErrors) {
    warnings.push({
      code: 'ndjson-parse-error',
      line: err.line,
      reason: err.reason,
      raw: err.raw,
    });
  }

  const extensionId = resolveExtensionId(rows, options.extensionId ?? null);
  if (!extensionId) {
    warnings.push({
      code: 'extension-id-missing',
      detail: 'No --extension-id and no trusted meta.extensionId in input',
    });
  }

  const markerExtract = extractPhaseMarkers(rows);
  warnings.push(...markerExtract.warnings);
  const phaseResolved = resolvePhases(markerExtract.markers, rows, warnings);
  const phases = phaseResolved.phases;

  const net = correlateNetwork(rows, { extensionId });
  warnings.push(...net.warnings);

  const classifiedRequests = net.requests.map((req) => {
    const classification = classifyResourceUrl(req.url, extensionId);
    const ms = parseTimestamp(req.events[0]?.t);
    const window = windowForMs(ms, phases);
    return {
      ...req,
      classification,
      window,
      firstEventMs: ms,
    };
  });

  const resourceClassification = {
    byClass: {},
    requests: classifiedRequests.map((r) => ({
      key: r.key,
      requestId: r.requestId,
      sessionId: r.sessionId,
      weakKey: r.weakKey,
      url: r.url,
      class: r.classification.class,
      window: r.window,
      incomplete: r.incomplete,
      failed: r.failed,
      status: r.status,
      redirectAmbiguous: r.redirectAmbiguous,
      urlMutations: r.urlMutations,
      conflicts: r.conflicts,
      duplicates: r.duplicates,
    })),
  };
  for (const r of classifiedRequests) {
    const c = r.classification.class;
    resourceClassification.byClass[c] = (resourceClassification.byClass[c] || 0) + 1;
  }

  const targetDiff = analyzeTargets(rows, phases, extensionId);

  const ui = collectTerminalUiEvidence(rows, phases);
  const netEnable = evaluateNetworkEnableEvidence(rows, phases, extensionId);
  warnings.push(...netEnable.notes);

  // --- verdict ---
  let verdict = 'ok';

  if (phaseResolved.contradiction) {
    violations.push({
      code: 'phase-marker-contradiction',
      detail: 'T0/T1/T2 markers are contradictory or out of order',
    });
    verdict = 'abort';
  } else if (phaseResolved.duplicateMarkers) {
    violations.push({
      code: 'phase-marker-duplicates',
      detail: 'Duplicate T0/T1/T2 markers prevent a unique phase sequence',
    });
    verdict = escalateVerdict(verdict, 'inconclusive');
  } else if (!phases) {
    violations.push({
      code: 'wasm-window-undefined',
      detail: 'Cannot delimit WASM observation window',
    });
    verdict = escalateVerdict(verdict, 'inconclusive');
  } else if (
    phaseResolved.phaseConfidence !== 'high' ||
    phaseResolved.phaseSource !== 'explicit'
  ) {
    verdict = escalateVerdict(verdict, 'inconclusive');
    warnings.push({
      code: 'phase-confidence-insufficient-for-ok',
      phaseSource: phaseResolved.phaseSource,
      phaseConfidence: phaseResolved.phaseConfidence,
    });
  }

  if (!extensionId) {
    verdict = escalateVerdict(verdict, 'inconclusive');
  }

  const wasmWindowReqs = classifiedRequests.filter((r) => r.window === 'wasm');
  const postWindowReqs = classifiedRequests.filter((r) => r.window === 'post');

  // Risk perimeter: any timestamp >= T1 (includes T1 boundary, wasm, and post).
  // Untimestamped events: never invent a window; forbidden → abort; unknown/opaque → inconclusive.
  for (const r of classifiedRequests) {
    const stamps = requestEventTimestamps({ ...r, firstEventMs: r.firstEventMs });
    const c = r.classification.class;
    const hasStamp = stamps.length > 0;

    if (!hasStamp) {
      const reason = {
        code: 'network-event-untimestamped',
        class: c,
        url: r.url,
        requestId: r.requestId,
        incomplete: r.incomplete,
        failed: r.failed,
        observed: 'network-url',
        note: 'No parseable timestamp; window not invented',
      };
      if (FORBIDDEN_RESOURCE_CLASSES.has(c)) {
        violations.push({
          ...reason,
          code: 'forbidden-resource-untimestamped',
          scope: 'untimestamped',
        });
        verdict = 'abort';
      } else if (
        UNSAFE_UNKNOWN_RESOURCE_CLASSES.has(c) ||
        c === 'facade-js' ||
        c === 'wasm-main' ||
        c === 'wasm-worker' ||
        r.incomplete ||
        r.conflicts.length ||
        r.redirectAmbiguous
      ) {
        violations.push({
          ...reason,
          code: 'untimestamped-or-orphan-network-event',
          scope: 'untimestamped',
        });
        verdict = escalateVerdict(verdict, 'inconclusive');
      } else {
        warnings.push(reason);
        verdict = escalateVerdict(verdict, 'inconclusive');
      }
      continue;
    }

    const inRisk = phases ? stamps.some((ms) => inRiskPerimeter(ms, phases)) : false;
    if (!inRisk) continue;

    const atBoundaryT1 = phases && stamps.some((ms) => ms === phases.T1.ms);
    const inPost = stamps.some((ms) => phases && ms > phases.T2.ms);
    const scope = inPost ? 'post' : atBoundaryT1 ? 't1-boundary' : r.window;

    if (FORBIDDEN_RESOURCE_CLASSES.has(c)) {
      violations.push({
        code: 'forbidden-resource-in-risk-perimeter',
        class: c,
        url: r.url,
        requestId: r.requestId,
        window: r.window,
        scope,
        observed: 'network-url',
        note: 'Observed resource path; does not by itself prove a specific JS API call',
      });
      verdict = 'abort';
    } else if (UNSAFE_UNKNOWN_RESOURCE_CLASSES.has(c)) {
      violations.push({
        code: 'unclassified-or-opaque-resource-in-risk-perimeter',
        class: c,
        url: r.url,
        requestId: r.requestId,
        window: r.window,
        scope,
        observed: 'network-url',
      });
      verdict = escalateVerdict(verdict, 'inconclusive');
    }

    // Material conflicts / redirects in the risk perimeter block ok (incl. probe-labeled).
    if (r.conflicts.length || r.redirectAmbiguous) {
      violations.push({
        code: 'ambiguous-network-in-risk-perimeter',
        requestId: r.requestId,
        url: r.url,
        class: c,
        window: r.window,
        scope,
        conflicts: r.conflicts,
        redirectAmbiguous: r.redirectAmbiguous,
        observed: 'network-correlation',
      });
      verdict = escalateVerdict(verdict, 'inconclusive');
    }
  }

  for (const t of targetDiff.newTargetIdsPostT1) {
    if (
      t.class === 'storage-worker' ||
      t.class === 'prover-worker' ||
      t.class === 'unknown-worker'
    ) {
      violations.push({
        code: 'new-worker-target-post-t1',
        targetId: t.targetId,
        class: t.class,
        urls: t.urls,
        observed: 'target-lifecycle',
        note: 'Does not prove OPFS access',
      });
      verdict = 'abort';
    } else if (
      t.class === 'opaque' ||
      t.class === 'other' ||
      t.class === 'unrecognized-worker-path'
    ) {
      violations.push({
        code: 'new-opaque-or-unclassified-target-post-t1',
        targetId: t.targetId,
        class: t.class,
        urls: t.urls,
        types: t.types,
        observed: 'target-lifecycle',
      });
      verdict = escalateVerdict(verdict, 'inconclusive');
    }
    // host-page / ext-sw new after T1: unusual — inconclusive
    else if (t.class === 'host-page' || t.class === 'ext-sw') {
      warnings.push({
        code: 'unexpected-new-known-target-post-t1',
        targetId: t.targetId,
        class: t.class,
      });
      verdict = escalateVerdict(verdict, 'inconclusive');
    }
  }

  // Terminal T2 UI only — never merge T0/T1 into security gates.
  if (ui.runDisabled === false) {
    violations.push({
      code: 'storage-run-enabled',
      observed: 'terminal-ui',
      uiSource: ui.source,
    });
    verdict = 'abort';
  }
  if (ui.executionAuthorized === true) {
    violations.push({
      code: 'execution-authorized-true',
      observed: 'terminal-ui',
      uiSource: ui.source,
    });
    verdict = 'abort';
  }
  if (ui.sdkInitialized === true) {
    violations.push({
      code: 'sdk-initialized-true',
      observed: 'terminal-ui',
      uiSource: ui.source,
    });
    verdict = 'abort';
  }

  if (netEnable.status === 'failed') {
    violations.push({
      code: 'network-enable-failed',
      detail: netEnable.failures,
      observed: 'domain-setup-or-cdp-result',
    });
    verdict = escalateVerdict(verdict, 'inconclusive');
  } else if (netEnable.status === 'missing' || netEnable.status === 'uncorrelated') {
    violations.push({
      code:
        netEnable.status === 'missing'
          ? 'network-enable-success-not-observed'
          : 'network-enable-success-uncorrelated',
      detail: netEnable.notes,
      observed: 'domain-setup-or-cdp-result',
      missingField:
        netEnable.status === 'missing'
          ? 'domain-setup.Network.enable.ok=true (host page)'
          : 'commandId-correlated Network.enable success for host session',
    });
    verdict = escalateVerdict(verdict, 'inconclusive');
  }

  // ok requirements — only when still ok; never grant ok under material uncertainty
  if (verdict === 'ok') {
    if (phaseResolved.phaseSource !== 'explicit' || phaseResolved.phaseConfidence !== 'high') {
      verdict = 'inconclusive';
      warnings.push({ code: 'ok-blocked-phase-not-explicit-high' });
    }
    if (ui.source === 'missing' || ui.source === 'ambiguous') {
      verdict = 'inconclusive';
      violations.push({
        code: 'terminal-ui-missing-at-t2',
        observed: 'terminal-ui',
        uiSource: ui.source,
        detail: ui.note || 'ok requires terminal T2 ui fields',
      });
    }
    if (ui.runDisabled !== true) {
      verdict = 'inconclusive';
      violations.push({
        code: 'run-disabled-not-confirmed',
        observed: 'terminal-ui',
        uiSource: ui.source,
        detail: 'ok requires terminal runDisabled === true at T2',
      });
    }
    if (ui.executionAuthorized !== false) {
      verdict = 'inconclusive';
      violations.push({
        code: 'execution-authorized-not-confirmed-false',
        observed: 'terminal-ui',
        uiSource: ui.source,
        detail: 'ok requires terminal executionAuthorized === false at T2',
      });
    }
    if (ui.sdkInitialized !== false) {
      verdict = 'inconclusive';
      violations.push({
        code: 'sdk-initialized-not-confirmed-false',
        observed: 'terminal-ui',
        uiSource: ui.source,
        detail: 'ok requires terminal sdkInitialized === false at T2',
      });
    }

    if (netEnable.status !== 'ok') {
      verdict = 'inconclusive';
      violations.push({
        code: 'network-enable-success-required-for-ok',
        observed: 'domain-setup-or-cdp-result',
      });
    }

    const wasmMain = wasmWindowReqs.filter((r) => r.classification.class === 'wasm-main');
    if (phases?.T2?.outcome === 'ready' || ui.wasm === 'ready') {
      if (wasmMain.length === 0) {
        verdict = 'inconclusive';
        warnings.push({
          code: 'ok-blocked-missing-wasm-main-fetch',
          detail: 'T2 ready but no wasm-main request observed in WASM window',
        });
      } else {
        // Incomplete (no response and no loadingFailed) is never treated as success.
        const terminalOk = wasmMain.some(
          (r) =>
            !r.incomplete &&
            !r.failed &&
            r.status != null &&
            Number(r.status) >= 200 &&
            Number(r.status) < 400,
        );
        if (!terminalOk) {
          verdict = 'inconclusive';
          violations.push({
            code: 'wasm-main-incomplete-or-failed',
            detail: 'outcome ready requires a completed successful wasm-main fetch',
          });
        }
      }
    }
    // Ambiguous network anywhere in risk perimeter (incl. T1 boundary / probe-labeled).
    for (const r of classifiedRequests) {
      const stamps = requestEventTimestamps({ ...r, firstEventMs: r.firstEventMs });
      const inRisk = phases ? stamps.some((ms) => inRiskPerimeter(ms, phases)) : false;
      if (!inRisk && stamps.length > 0) continue;
      if (r.conflicts.length || r.redirectAmbiguous) {
        verdict = 'inconclusive';
        warnings.push({
          code: 'ok-blocked-ambiguous-network',
          requestId: r.requestId,
          window: r.window,
        });
      }
    }
    if (parseErrors.length) {
      verdict = 'inconclusive';
      warnings.push({ code: 'ok-blocked-parse-errors' });
    }
  }

  const report = {
    schemaVersion: SCHEMA_VERSION,
    input: options.inputLabel ?? null,
    extensionId,
    verdict,
    phaseSource: phaseResolved.phaseSource,
    phaseConfidence: phaseResolved.phaseConfidence,
    phases: phases
      ? {
          T0: { t: phases.T0.t, targetId: phases.T0.targetId, sessionId: phases.T0.sessionId },
          T1: { t: phases.T1.t, targetId: phases.T1.targetId, sessionId: phases.T1.sessionId },
          T2: {
            t: phases.T2.t,
            targetId: phases.T2.targetId,
            sessionId: phases.T2.sessionId,
            outcome: phases.T2.outcome ?? null,
          },
          windows: {
            baseline: '<= T0',
            probe: '(T0, T1]',
            wasm: '(T1, T2]',
            post: '> T2',
            riskPerimeter:
              '[T1, +∞) inclusive — forbidden/unknown resources at T1 boundary, wasm, and post',
          },
        }
      : null,
    networkRequests: classifiedRequests.map((r) => ({
      key: r.key,
      requestId: r.requestId,
      sessionId: r.sessionId,
      weakKey: r.weakKey,
      targetId: r.targetId,
      targetType: r.targetType,
      url: r.url,
      urls: r.urls,
      window: r.window,
      class: r.classification.class,
      status: r.status,
      failed: r.failed,
      failure: r.failure,
      incomplete: r.incomplete,
      redirectAmbiguous: r.redirectAmbiguous,
      urlMutations: r.urlMutations,
      conflicts: r.conflicts,
      duplicates: r.duplicates,
      events: r.events,
    })),
    resourceClassification,
    targetDiff,
    uiEvidence: ui,
    networkEnable: {
      status: netEnable.status,
      successCount: netEnable.successes.length,
      failureCount: netEnable.failures.length,
    },
    parseErrors,
    violations,
    warnings,
    limits: [
      ...DEFAULT_LIMITS,
      'ok requires positive host-page Network.enable success evidence; absence of errors is insufficient.',
      'Terminal security UI is taken only from T2 (marker ui or unique host-ui-snapshot at T2 timestamp); T0/T1 are not merged.',
      'This analyzer does not demonstrate runtime isolation, worker coverage completeness, or absence of OPFS access.',
    ],
  };

  return report;
}

/**
 * @param {string} filePath
 * @param {{ extensionId?: string|null }} [options]
 */
export function analyzeNdjsonFile(filePath, options = {}) {
  const text = readFileSync(filePath, 'utf8');
  return analyzeNdjsonText(text, {
    ...options,
    inputLabel: filePath,
  });
}

function printHelp() {
  console.log(`Usage:
  node packages/extension/scripts/spp-cdp-wasm-only-analyze.mjs <input.ndjson> \\
    [--extension-id <id>] [--output <report.json>]

Offline only. Does not launch Chrome or contact the network.
Absence of events is not proof of absence of activity.`);
}

/** @param {string[]} argv */
export function runCli(argv) {
  const args = parseAnalyzeArgs(argv);
  if (args.help) {
    printHelp();
    return { exitCode: 0, report: null };
  }
  if (!args.input) {
    throw new Error('Missing <input.ndjson>');
  }
  const report = analyzeNdjsonFile(args.input, {
    extensionId: args.extensionId,
  });
  const json = JSON.stringify(report, null, 2);
  if (args.output) {
    writeFileSync(args.output, json, 'utf8');
  } else {
    console.log(json);
  }
  return { exitCode: 0, report };
}

function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href;
  } catch {
    return false;
  }
}

if (isMain()) {
  try {
    const { exitCode } = runCli(process.argv);
    process.exitCode = exitCode;
  } catch (e) {
    console.error(String(e instanceof Error ? e.message : e));
    process.exitCode = 1;
  }
}
