#!/usr/bin/env node
/**
 * Solanym 5E.8 — hardened CDP observation harness (Node 22 native only).
 *
 * Captures console / log / network / target events to NDJSON BEFORE opening
 * spp-host.html. Does NOT click Storage, WASM, probe, Client, or prover controls.
 *
 * Smoke launch uses --enable-unsafe-extension-debugging and CDP
 * Extensions.loadUnpacked (Chrome 156 ignores CLI --load-extension here).
 *
 * Hardening (5E.8):
 * - Top-level sessionId normalization + messageSessionId / attachedSessionId
 * - Awaitable setup queue (no fire-and-forget race; dispatcher stays non-blocking)
 * - Per-sessionId dedup of domain setup
 * - Audited CDP command request/result lines in NDJSON
 * - killProcessTree waits for taskkill when possible
 *
 * LIMITATION (documented, needs real Chrome to fully prove): Network coverage on
 * dedicated workers and absence-of-events ≠ zero traffic. Forced kill of this
 * Node process can skip finally and leave a lab Chrome/profile behind.
 *
 * Usage (smoke — launches disposable Chrome, then cleans up):
 *   node scripts/spp-cdp-harness.mjs --smoke
 *
 * Usage (wasm-only capture — separate path; emits explicit T0/T1/T2 phase-markers):
 *   node scripts/spp-cdp-harness.mjs --wasm-only
 *   Clicks only #spp-probe-btn then #spp-wasm-btn. Never Storage/Client/session init.
 *
 * Usage (attach only — Chrome already listening on --port):
 *   node scripts/spp-cdp-harness.mjs --port 9455 --extension-id <id>
 *
 * No new dependencies. Logs default to %TEMP%/solanym-spp-cdp-*.ndjson.
 * This harness does not demonstrate runtime isolation.
 */

import {
  writeFileSync,
  mkdirSync,
  existsSync,
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXTENSION_ROOT = path.resolve(__dirname, '..');
const DEFAULT_DIST = path.join(EXTENSION_ROOT, 'dist');
const DEFAULT_CHROME =
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const INTERESTING_METHODS = new Set([
  'Runtime.consoleAPICalled',
  'Runtime.exceptionThrown',
  'Log.entryAdded',
  'Network.requestWillBeSent',
  'Network.responseReceived',
  'Network.loadingFailed',
  'Target.targetCreated',
  'Target.targetDestroyed',
  'Target.targetInfoChanged',
  'Target.attachedToTarget',
  'Target.detachedFromTarget',
]);

/** Commands whose request/result are always written to NDJSON (no sensitive bodies). */
const AUDITED_COMMANDS = new Set([
  'Target.setDiscoverTargets',
  'Target.setAutoAttach',
  'Target.getTargets',
  'Target.attachToTarget',
  'Target.createTarget',
  'Extensions.loadUnpacked',
  'Runtime.enable',
  'Log.enable',
  'Network.enable',
  'Runtime.runIfWaitingForDebugger',
  'Runtime.evaluate',
]);

/** Actions the runner must never invoke (tests assert expressions avoid these). */
export const RUNNER_FORBIDDEN_ACTIONS = Object.freeze([
  'Storage.open',
  'Client.new',
  'initializeSession',
  'dispose',
  'spp-storage-run-btn',
  'spp-storage-eval-btn',
  'spp-storage-free-btn',
  'STORAGE_LAB_EXECUTION_AUTHORIZED=true',
]);

export const PHASE_LABELS = Object.freeze({
  T0: 'host-open-initial',
  T1: 'facade-probe-complete',
  T2: 'wasm-only-init-complete',
});

/**
 * Fresh host UI snapshot expression. Parsed booleans come from the live detail
 * text at evaluation time — callers must not merge prior phase snapshots.
 */
export const HOST_UI_SNAPSHOT_EXPRESSION = `(() => {
  const detail = (document.getElementById('spp-detail')?.textContent ?? '').slice(0, 4000);
  const boolFrom = (key) => {
    const m = detail.match(new RegExp(key + '\\\\s*=\\\\s*(true|false)'));
    return m ? m[1] === 'true' : null;
  };
  const runBtn = document.getElementById('spp-storage-run-btn');
  return {
    ready: document.readyState,
    phase: document.getElementById('spp-phase')?.textContent ?? null,
    wasm: document.getElementById('spp-wasm-phase')?.textContent ?? null,
    storage: document.getElementById('spp-storage-lab-phase')?.textContent ?? null,
    boot: document.getElementById('spp-boot')?.textContent ?? null,
    runDisabled: runBtn ? runBtn.disabled : null,
    executionAuthorized: boolFrom('executionAuthorized'),
    sdkInitialized: boolFrom('sdkInitialized'),
    sessionInitializeEnabled: boolFrom('sessionInitializeEnabled'),
    detail,
    hasRunBtn: !!runBtn,
    hasProbeBtn: !!document.getElementById('spp-probe-btn'),
    hasWasmBtn: !!document.getElementById('spp-wasm-btn'),
  };
})()`;

/** Click only the facade probe button (never Storage / Client). */
export const HOST_PROBE_CLICK_EXPRESSION =
  "(() => { const b = document.getElementById('spp-probe-btn'); if (!b) throw new Error('missing spp-probe-btn'); b.click(); return true; })()";

/** Click only the WASM init button (never Storage / Client / session). */
export const HOST_WASM_CLICK_EXPRESSION =
  "(() => { const b = document.getElementById('spp-wasm-btn'); if (!b) throw new Error('missing spp-wasm-btn'); b.click(); return true; })()";

export function parseArgs(argv) {
  const out = {
    smoke: false,
    wasmOnly: false,
    port: null,
    dist: DEFAULT_DIST,
    chrome: DEFAULT_CHROME,
    extensionId: null,
    logPath: null,
    settleMs: 4000,
    launchTimeoutMs: 25000,
    phaseTimeoutMs: 45000,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--smoke') out.smoke = true;
    else if (a === '--wasm-only') out.wasmOnly = true;
    else if (a === '--port' && next) {
      out.port = Number(next);
      i++;
    } else if (a === '--dist' && next) {
      out.dist = path.resolve(next);
      i++;
    } else if (a === '--chrome' && next) {
      out.chrome = next;
      i++;
    } else if (a === '--extension-id' && next) {
      out.extensionId = next;
      i++;
    } else if (a === '--log' && next) {
      out.logPath = path.resolve(next);
      i++;
    } else if (a === '--settle-ms' && next) {
      out.settleMs = Number(next);
      i++;
    } else if (a === '--phase-timeout-ms' && next) {
      out.phaseTimeoutMs = Number(next);
      i++;
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    } else {
      throw new Error(`Unknown or incomplete argument: ${a}`);
    }
  }
  if (out.smoke && out.wasmOnly) {
    throw new Error('Use either --smoke or --wasm-only, not both');
  }
  return out;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    p(d.getHours()) +
    p(d.getMinutes()) +
    p(d.getSeconds())
  );
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = createConnection({ host: '127.0.0.1', port }, () => {
      srv.end();
      resolve(false);
    });
    srv.on('error', () => resolve(true));
  });
}

async function pickFreePort(start = 9460, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    const port = start + i;
    if (await isPortFree(port)) return port;
  }
  throw new Error('No free CDP port found in range');
}

export function urlAllowed(url, extensionId) {
  if (!url || url === 'about:blank' || url === 'about:blank/') return true;
  if (url.startsWith('chrome://')) return true;
  if (url.startsWith('devtools://')) return true;
  if (extensionId && url.startsWith(`chrome-extension://${extensionId}/`)) return true;
  if (url.startsWith('chrome-extension://') && !extensionId) return true;
  if (url.startsWith('blob:chrome-extension://')) return true;
  return false;
}

export function summarizeParams(method, params) {
  if (!params) return null;
  try {
    if (method === 'Runtime.consoleAPICalled') {
      const text = (params.args || [])
        .map((a) => a.value ?? a.description ?? a.type)
        .join(' ')
        .slice(0, 500);
      return { type: params.type, text };
    }
    if (method === 'Runtime.exceptionThrown') {
      const d = params.exceptionDetails || {};
      return {
        text: d.text,
        description: d.exception?.description?.slice(0, 500),
        url: d.url,
      };
    }
    if (method === 'Log.entryAdded') {
      const e = params.entry || {};
      return { level: e.level, text: String(e.text || '').slice(0, 500), url: e.url };
    }
    if (method === 'Network.requestWillBeSent') {
      return {
        requestId: params.requestId,
        url: params.request?.url,
        method: params.request?.method,
        type: params.type,
        initiator: params.initiator?.type,
      };
    }
    if (method === 'Network.responseReceived') {
      return {
        requestId: params.requestId,
        url: params.response?.url,
        status: params.response?.status,
        mimeType: params.response?.mimeType,
        type: params.type,
      };
    }
    if (method === 'Network.loadingFailed') {
      return {
        requestId: params.requestId,
        errorText: params.errorText,
        type: params.type,
        canceled: params.canceled,
      };
    }
    if (method.startsWith('Target.')) {
      const info = params.targetInfo || params;
      return {
        targetId: info.targetId || params.targetId || null,
        type: info.type,
        url: info.url,
        title: info.title,
        sessionId: params.sessionId ?? null,
        waitingForDebugger: params.waitingForDebugger,
      };
    }
    return { keys: Object.keys(params).slice(0, 12) };
  } catch {
    return { summarizeError: true };
  }
}

/** Sanitize command params for NDJSON (never log evaluate expression bodies). */
export function sanitizeCommandParams(method, params) {
  if (!params) return null;
  if (method === 'Runtime.evaluate') {
    return {
      returnByValue: params.returnByValue,
      awaitPromise: params.awaitPromise,
      expressionChars: String(params.expression || '').length,
    };
  }
  if (method === 'Extensions.loadUnpacked') {
    return { path: params.path ?? null };
  }
  if (method === 'Target.createTarget') {
    return { url: params.url ?? null };
  }
  if (method === 'Target.setAutoAttach') {
    return {
      autoAttach: params.autoAttach,
      waitForDebuggerOnStart: params.waitForDebuggerOnStart,
      flatten: params.flatten,
    };
  }
  return { ...params };
}

/**
 * Resolve correlation fields for a CDP event message.
 * - messageSessionId: envelope session (often null on browser-level Target events)
 * - attachedSessionId: params.sessionId on Target.attachedToTarget (new child session)
 * - sessionId: best primary id for correlation (prefer attached, else message, else lookup)
 */
export function resolveEventSessionFields(msg, sessions) {
  const method = msg.method || '';
  const params = msg.params || {};
  const messageSessionId = msg.sessionId ?? null;
  const attachedSessionId =
    method === 'Target.attachedToTarget' ? (params.sessionId ?? null) : null;

  const primary =
    attachedSessionId ||
    messageSessionId ||
    null;

  const fromPrimary = primary && sessions ? sessions.get(primary) : null;
  const fromMessage =
    messageSessionId && sessions ? sessions.get(messageSessionId) : null;
  const sessionMeta = fromPrimary || fromMessage || null;

  const targetId =
    sessionMeta?.targetId ||
    params.targetInfo?.targetId ||
    params.targetId ||
    null;
  const targetType = sessionMeta?.type || params.targetInfo?.type || null;
  const targetUrl = sessionMeta?.url || params.targetInfo?.url || null;

  return {
    messageSessionId,
    attachedSessionId,
    sessionId: primary,
    targetId,
    targetType,
    targetUrl,
  };
}

export function isInstrumentableTarget(info) {
  const type = info?.type || '';
  const url = info?.url || '';
  return (
    type === 'page' ||
    type === 'worker' ||
    type === 'shared_worker' ||
    type === 'service_worker' ||
    type === 'webview' ||
    type === 'background_page' ||
    url.startsWith('chrome-extension://')
  );
}

/** Append-only NDJSON writer (file). */
export class NdjsonLog {
  constructor(filePath) {
    this.filePath = filePath;
    writeFileSync(filePath, '', 'utf8');
    this.fd = openSync(filePath, 'a');
    this.closed = false;
  }
  write(obj) {
    if (this.closed) return;
    const line = JSON.stringify(obj) + '\n';
    writeSync(this.fd, line);
    try {
      fsyncSync(this.fd);
    } catch {
      /* fsync may be unavailable; append still durable enough for smoke */
    }
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      fsyncSync(this.fd);
    } catch {
      /* ignore */
    }
    closeSync(this.fd);
  }
}

/** In-memory log for unit tests. */
export class MemoryLog {
  constructor() {
    this.lines = [];
    this.filePath = null;
  }
  write(obj) {
    this.lines.push({ ...obj });
  }
  close() {
    /* no-op */
  }
  entries() {
    return this.lines;
  }
  ofKind(kind) {
    return this.lines.filter((l) => l.kind === kind);
  }
}

/**
 * Write a phase-marker with a runner-generated timestamp and a fresh UI snapshot.
 * Does not invent phase observation: caller must supply the ui read at this moment.
 * ui is shallow-copied so later mutations cannot alias prior markers.
 *
 * @param {{ write: Function }} log
 * @param {{
 *   phase: 'T0'|'T1'|'T2',
 *   label?: string,
 *   targetId?: string|null,
 *   sessionId?: string|null,
 *   hostOpened?: boolean,
 *   ui?: object|null,
 *   outcome?: string|null,
 * }} fields
 * @param {() => string} [now]
 */
export function writePhaseMarker(log, fields, now = () => new Date().toISOString()) {
  const phase = fields.phase;
  if (!phase || !['T0', 'T1', 'T2'].includes(phase)) {
    throw new Error(`writePhaseMarker: invalid phase ${phase}`);
  }
  const ui =
    fields.ui && typeof fields.ui === 'object' ? { ...fields.ui } : null;
  const record = {
    t: now(),
    kind: 'phase-marker',
    phase,
    label: fields.label || PHASE_LABELS[phase],
    targetId: fields.targetId ?? null,
    sessionId: fields.sessionId ?? null,
    hostOpened: Boolean(fields.hostOpened),
    ui,
  };
  if (fields.outcome != null) record.outcome = fields.outcome;
  if (!ui) {
    record.uiMissing = true;
    record.note =
      'UI snapshot absent at this marker; prior-phase ui must not be substituted';
  }
  log.write(record);
  return record;
}

/**
 * Correlate audited cdp-command / cdp-result rows by commandId.
 * Results without a matching commandId are incomplete (never treated as success).
 *
 * @param {object[]} entries
 */
export function collectAuditedCommandEvidence(entries) {
  const commands = entries.filter((e) => e.kind === 'cdp-command');
  const results = entries.filter((e) => e.kind === 'cdp-result');
  const orphanResults = [];
  const byCommandId = new Map();
  for (const r of results) {
    if (r.commandId == null) {
      orphanResults.push({
        ...r,
        correlation: 'incomplete',
        reason: 'cdp-result missing commandId',
      });
      continue;
    }
    if (byCommandId.has(r.commandId)) {
      orphanResults.push({
        ...r,
        correlation: 'incomplete',
        reason: 'duplicate commandId on cdp-result',
      });
      continue;
    }
    byCommandId.set(r.commandId, r);
  }

  const correlated = commands.map((c) => {
    if (c.commandId == null) {
      return {
        command: c,
        result: null,
        correlation: 'incomplete',
        ok: false,
        reason: 'cdp-command missing commandId',
      };
    }
    const result = byCommandId.get(c.commandId) || null;
    if (!result) {
      return {
        command: c,
        result: null,
        correlation: 'incomplete',
        ok: false,
        reason: 'no cdp-result for commandId',
      };
    }
    byCommandId.delete(c.commandId);
    return {
      command: c,
      result,
      correlation: 'correlated',
      ok: result.ok === true,
      reason: result.ok === true ? null : result.error || 'cdp-result ok=false',
    };
  });

  for (const leftover of byCommandId.values()) {
    orphanResults.push({
      ...leftover,
      correlation: 'incomplete',
      reason: 'cdp-result without matching cdp-command',
    });
  }

  const networkEnable = correlated.filter((c) => c.command.method === 'Network.enable');
  const networkEnableSuccess = networkEnable.filter((c) => c.correlation === 'correlated' && c.ok);

  return {
    correlated,
    orphanResults,
    networkEnable,
    networkEnableSuccess,
    hasPositiveNetworkEnable: networkEnableSuccess.length > 0,
  };
}

/**
 * Smoke-mode host gates: abort if WASM already started (smoke must not init WASM).
 * @param {object} ui
 */
export function assertSmokeHostUiGates(ui) {
  if (!ui || typeof ui !== 'object' || !('runDisabled' in ui)) {
    throw new Error('ABORT: host UI snapshot missing — wrong page or host failed to load');
  }
  if (ui.runDisabled !== true) {
    throw new Error(
      `ABORT: Storage run control not disabled (runDisabled=${String(ui.runDisabled)}) — refusing smoke`,
    );
  }
  if (ui.storage === 'running' || ui.storage === 'success') {
    throw new Error(`ABORT: unexpected storage phase ${ui.storage}`);
  }
  if (ui.wasm === 'ready' || ui.wasm === 'initializing') {
    throw new Error(`ABORT: unexpected wasm phase ${ui.wasm} (WASM init not authorized)`);
  }
  if (String(ui.detail || '').includes('executionAuthorized=true')) {
    throw new Error('ABORT: host UI reports executionAuthorized=true');
  }
  if (!ui.phase || ui.phase === '') {
    throw new Error('ABORT: spp-phase missing — not spp-host.html');
  }
}

/**
 * Shared safety gates before / during wasm-only capture (never enable Storage lab).
 * @param {object} ui
 * @param {{ allowWasmReady?: boolean }} [opts]
 */
export function assertWasmOnlySafetyGates(ui, opts = {}) {
  if (!ui || typeof ui !== 'object') {
    throw new Error('ABORT: host UI snapshot missing for wasm-only capture');
  }
  // Explicit enablement always aborts. Missing runDisabled at T2 is left as-is
  // for the analyzer (never backfilled from T0/T1).
  if (ui.runDisabled === false) {
    throw new Error(
      `ABORT: Storage run must stay disabled during wasm-only (runDisabled=${String(ui.runDisabled)})`,
    );
  }
  if (!opts.allowWasmReady && ui.runDisabled !== true) {
    throw new Error(
      `ABORT: Storage run must stay disabled during wasm-only (runDisabled=${String(ui.runDisabled)})`,
    );
  }
  if (ui.executionAuthorized === true) {
    throw new Error('ABORT: executionAuthorized=true — refusing wasm-only capture');
  }
  if (String(ui.detail || '').includes('executionAuthorized=true')) {
    throw new Error('ABORT: host UI reports executionAuthorized=true');
  }
  if (ui.storage === 'running' || ui.storage === 'success') {
    throw new Error(`ABORT: unexpected storage phase ${ui.storage}`);
  }
  if (!opts.allowWasmReady) {
    if (ui.wasm === 'ready' || ui.wasm === 'initializing') {
      throw new Error(
        `ABORT: wasm already ${ui.wasm} before wasm-only init step — refusing unexpected state`,
      );
    }
  }
}

/**
 * Orchestrate T0 → probe → T1 → wasm-init → T2 with fresh UI per marker.
 * Injectable for unit tests (no Chrome). Does not click Storage or call Client.
 *
 * @param {{
 *   log: { write: Function },
 *   readUi: () => Promise<object|null>,
 *   resolveHostMeta: () => { targetId: string|null, sessionId: string|null, hostOpened: boolean },
 *   runProbe: () => Promise<void>,
 *   runWasmInit: () => Promise<void>,
 *   afterT2?: () => Promise<void>,
 *   now?: () => string,
 * }} deps
 */
export async function runWasmOnlyPhaseSequence(deps) {
  const now = deps.now || (() => new Date().toISOString());
  const markers = [];

  const meta0 = deps.resolveHostMeta();
  const ui0 = await deps.readUi();
  assertWasmOnlySafetyGates(ui0, { allowWasmReady: false });
  markers.push(
    writePhaseMarker(
      deps.log,
      {
        phase: 'T0',
        label: PHASE_LABELS.T0,
        targetId: meta0.targetId,
        sessionId: meta0.sessionId,
        hostOpened: meta0.hostOpened,
        ui: ui0,
      },
      now,
    ),
  );

  await deps.runProbe();
  const meta1 = deps.resolveHostMeta();
  const ui1 = await deps.readUi();
  // Fresh read only — never merge T0 fields into missing T1 keys.
  assertWasmOnlySafetyGates(ui1, { allowWasmReady: false });
  if (ui1?.phase !== 'ready' && ui1?.phase !== 'error') {
    throw new Error(
      `ABORT: probe did not reach terminal facade phase (phase=${String(ui1?.phase)})`,
    );
  }
  markers.push(
    writePhaseMarker(
      deps.log,
      {
        phase: 'T1',
        label: PHASE_LABELS.T1,
        targetId: meta1.targetId,
        sessionId: meta1.sessionId,
        hostOpened: meta1.hostOpened,
        ui: ui1,
      },
      now,
    ),
  );

  if (ui1.phase === 'error') {
    throw new Error('ABORT: facade probe ended in error — refusing WASM init');
  }

  await deps.runWasmInit();
  const meta2 = deps.resolveHostMeta();
  const ui2 = await deps.readUi();
  assertWasmOnlySafetyGates(ui2, { allowWasmReady: true });
  const outcome =
    ui2?.wasm === 'ready' ? 'ready' : ui2?.wasm === 'error' ? 'error' : null;
  if (!outcome) {
    throw new Error(
      `ABORT: WASM-only init did not reach ready|error (wasm=${String(ui2?.wasm)})`,
    );
  }
  markers.push(
    writePhaseMarker(
      deps.log,
      {
        phase: 'T2',
        label: PHASE_LABELS.T2,
        targetId: meta2.targetId,
        sessionId: meta2.sessionId,
        hostOpened: meta2.hostOpened,
        ui: ui2,
        outcome,
      },
      now,
    ),
  );

  if (deps.afterT2) await deps.afterT2();

  return {
    markers,
    phases: markers.map((m) => m.phase),
    t2Outcome: outcome,
    wasmInitExecuted: true,
    storageOpenExecuted: false,
    clientNewExecuted: false,
  };
}

export class CdpConnection {
  /**
   * @param {string|null} wsUrl
   * @param {{ write: Function, close?: Function }} log
   * @param {{ extensionId?: string|null }} [meta]
   */
  constructor(wsUrl, log, meta = {}) {
    this.wsUrl = wsUrl;
    this.log = log;
    this.meta = meta;
    this.ws = null;
    this.nextId = 0;
    this.pending = new Map();
    /** @type {Map<string, { targetId: string|null, type: string|null, url: string|null, configured: boolean }>} */
    this.sessions = new Map();
    this.targets = new Map();
    this.domainStatus = [];
    this.abortReason = null;
    this.extensionId = meta.extensionId || null;
    this.hostTargetId = null;
    this.captureBeforeHost = true;
    this.eventCounts = Object.create(null);
    /** sessionIds that completed (or skipped) setup */
    this.configuredSessions = new Set();
    /** sessionId -> in-flight setup Promise */
    this._setupPending = new Map();
    /** Chains setups without blocking the message dispatcher */
    this._setupChain = Promise.resolve();
    /** Optional fake transport for tests: { send(string), close() } */
    this._fakeTransport = null;
  }

  /** Inject a fake transport (unit tests). Does not open a real WebSocket. */
  useFakeTransport(transport) {
    this._fakeTransport = transport;
    this.ws = {
      send: (data) => transport.send(data),
      close: () => transport.close?.(),
      addEventListener: () => {},
    };
  }

  async connect() {
    if (this._fakeTransport) return;
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('WebSocket connect timeout')), 15000);
      this.ws.addEventListener('open', () => {
        clearTimeout(t);
        resolve();
      });
      this.ws.addEventListener('error', (e) => {
        clearTimeout(t);
        reject(e.error || new Error('WebSocket error'));
      });
    });
    this.ws.addEventListener('message', (ev) => this.onMessage(String(ev.data)));
  }

  onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      this.log.write({
        t: new Date().toISOString(),
        kind: 'parse-error',
        raw: String(raw).slice(0, 200),
      });
      return;
    }

    if (msg.id != null) {
      const key = `${msg.sessionId || ''}#${msg.id}`;
      const pending = this.pending.get(key) || this.pending.get(`#${msg.id}`);
      if (pending) {
        this.pending.delete(pending.key);
        if (msg.error) {
          pending.reject(
            Object.assign(new Error(msg.error.message || 'CDP error'), { cdp: msg.error }),
          );
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    if (msg.method) {
      this.handleEvent(msg);
    }
  }

  handleEvent(msg) {
    const { method, params } = msg;
    const fields = resolveEventSessionFields(msg, this.sessions);

    if (method === 'Target.targetCreated' || method === 'Target.targetInfoChanged') {
      const info = params?.targetInfo;
      if (info?.targetId) this.targets.set(info.targetId, info);
      this.checkUrlPolicy(info?.url, info);
    }

    if (method === 'Target.attachedToTarget') {
      const info = params?.targetInfo || {};
      const attachedSid = params?.sessionId ?? null;
      if (attachedSid) {
        const prev = this.sessions.get(attachedSid);
        this.sessions.set(attachedSid, {
          targetId: info.targetId ?? prev?.targetId ?? null,
          type: info.type ?? prev?.type ?? null,
          url: info.url ?? prev?.url ?? null,
          configured: prev?.configured === true,
        });
      }
      if (info.targetId) this.targets.set(info.targetId, info);
      this.checkUrlPolicy(info.url, info);

      // CRITICAL: schedule setup asynchronously — never await inside the dispatcher.
      // waitForPendingSetups() is used by the main flow before createTarget.
      this.enqueueAttachedSetup(params || {});
    }

    if (method === 'Target.detachedFromTarget') {
      const sid = params?.sessionId;
      if (sid) {
        this.sessions.delete(sid);
        this.configuredSessions.delete(sid);
        this._setupPending.delete(sid);
      }
    }

    const lookupSid = fields.sessionId;
    const session = lookupSid ? this.sessions.get(lookupSid) : null;

    if (method === 'Network.requestWillBeSent') {
      this.checkUrlPolicy(params?.request?.url, session);
    }
    if (method === 'Network.responseReceived') {
      this.checkUrlPolicy(params?.response?.url, session);
    }

    if (!INTERESTING_METHODS.has(method) && !method.startsWith('Target.')) return;

    this.eventCounts[method] = (this.eventCounts[method] || 0) + 1;

    // Re-resolve after sessions map update for attachedToTarget
    const resolved = resolveEventSessionFields(msg, this.sessions);

    this.log.write({
      t: new Date().toISOString(),
      kind: 'event',
      method,
      sessionId: resolved.sessionId,
      messageSessionId: resolved.messageSessionId,
      attachedSessionId: resolved.attachedSessionId,
      targetId:
        resolved.targetId ||
        session?.targetId ||
        params?.targetInfo?.targetId ||
        params?.targetId ||
        null,
      targetType:
        resolved.targetType || session?.type || params?.targetInfo?.type || null,
      targetUrl: resolved.targetUrl || session?.url || params?.targetInfo?.url || null,
      hostOpened: Boolean(this.hostTargetId),
      summary: summarizeParams(method, params),
    });
  }

  /**
   * Queue domain setup for an attached session without blocking onMessage.
   * Dedupes by sessionId (not targetId): distinct sessions on same target are kept.
   */
  enqueueAttachedSetup(attachParams) {
    const sessionId = attachParams.sessionId;
    if (!sessionId) {
      this.log.write({
        t: new Date().toISOString(),
        kind: 'attach-skip',
        reason: 'missing-sessionId',
        targetId: attachParams.targetInfo?.targetId ?? null,
      });
      return Promise.resolve();
    }

    if (this.configuredSessions.has(sessionId)) {
      this.log.write({
        t: new Date().toISOString(),
        kind: 'attach-skip',
        reason: 'session-already-configured',
        sessionId,
        targetId: attachParams.targetInfo?.targetId ?? null,
      });
      return Promise.resolve();
    }

    if (this._setupPending.has(sessionId)) {
      this.log.write({
        t: new Date().toISOString(),
        kind: 'attach-skip',
        reason: 'session-setup-in-flight',
        sessionId,
        targetId: attachParams.targetInfo?.targetId ?? null,
      });
      return this._setupPending.get(sessionId);
    }

    const job = (async () => {
      try {
        await this.setupAttachedTarget(attachParams);
        this.configuredSessions.add(sessionId);
        const s = this.sessions.get(sessionId);
        if (s) s.configured = true;
      } catch (e) {
        this.log.write({
          t: new Date().toISOString(),
          kind: 'attach-setup-error',
          sessionId,
          targetId: attachParams.targetInfo?.targetId ?? null,
          error: String(e.message || e),
        });
      } finally {
        this._setupPending.delete(sessionId);
      }
    })();

    this._setupPending.set(sessionId, job);
    this._setupChain = this._setupChain.then(() => job, () => job);
    return job;
  }

  /** Wait until all queued attach setups finish (call before createTarget / evaluate). */
  async waitForPendingSetups() {
    await this._setupChain;
    const pending = [...this._setupPending.values()];
    if (pending.length) await Promise.allSettled(pending);
  }

  /** Observable pending setup session ids (tests / diagnostics). */
  get pendingSetupSessionIds() {
    return [...this._setupPending.keys()];
  }

  get hasPendingSetups() {
    return this._setupPending.size > 0;
  }

  checkUrlPolicy(url, ctx) {
    if (!url) return;
    if (urlAllowed(url, this.extensionId)) return;
    if (url === '' || url === 'chrome://new-tab-page/' || url.startsWith('chrome://newtab')) {
      return;
    }
    this.abortReason =
      this.abortReason ||
      `Unexpected URL outside allowlist: ${url}` +
        (ctx?.type ? ` (targetType=${ctx.type})` : '');
  }

  /**
   * Send a CDP command. Always schedules the write of audited command lines.
   * Must not be awaited from inside onMessage for the same connection without
   * yielding — responses arrive via onMessage.
   */
  send(method, params = {}, sessionId = null) {
    const id = ++this.nextId;
    const key = `${sessionId || ''}#${id}`;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;

    const audited = AUDITED_COMMANDS.has(method);
    if (audited) {
      this.log.write({
        t: new Date().toISOString(),
        kind: 'cdp-command',
        commandId: id,
        method,
        sessionId: sessionId || null,
        params: sanitizeCommandParams(method, params),
      });
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        const err = new Error(`CDP timeout ${method}`);
        if (audited) {
          this.log.write({
            t: new Date().toISOString(),
            kind: 'cdp-result',
            commandId: id,
            method,
            sessionId: sessionId || null,
            ok: false,
            error: err.message,
          });
        }
        reject(err);
      }, 20000);

      this.pending.set(key, {
        key,
        resolve: (v) => {
          clearTimeout(timer);
          if (audited) {
            this.log.write({
              t: new Date().toISOString(),
              kind: 'cdp-result',
              commandId: id,
              method,
              sessionId: sessionId || null,
              ok: true,
              // Avoid dumping large Target.getTargets payloads
              resultKeys:
                v && typeof v === 'object' ? Object.keys(v).slice(0, 12) : null,
            });
          }
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          if (audited) {
            this.log.write({
              t: new Date().toISOString(),
              kind: 'cdp-result',
              commandId: id,
              method,
              sessionId: sessionId || null,
              ok: false,
              error: e.cdp ? JSON.stringify(e.cdp) : String(e.message || e),
            });
          }
          reject(e);
        },
      });

      this.ws.send(JSON.stringify(payload));
    });
  }

  async tryDomain(sessionId, targetMeta, domainMethod) {
    const rec = {
      targetId: targetMeta.targetId || null,
      sessionId: sessionId || null,
      type: targetMeta.type || null,
      url: targetMeta.url || null,
      domain: domainMethod,
      ok: false,
      error: null,
    };
    try {
      await this.send(domainMethod, {}, sessionId);
      rec.ok = true;
    } catch (e) {
      rec.error = e.cdp ? JSON.stringify(e.cdp) : String(e.message || e);
    }
    this.domainStatus.push(rec);
    this.log.write({
      t: new Date().toISOString(),
      kind: 'domain-setup',
      ...rec,
    });
    return rec;
  }

  /**
   * Configure capture domains then resume if waiting.
   * Order is intentional: domains BEFORE Runtime.runIfWaitingForDebugger.
   */
  async setupAttachedTarget(attachParams) {
    const info = attachParams.targetInfo || {};
    const sessionId = attachParams.sessionId;
    const waiting = Boolean(attachParams.waitingForDebugger);
    const meta = {
      targetId: info.targetId,
      type: info.type,
      url: info.url,
    };

    const interesting = isInstrumentableTarget(info);

    // browser_ui / non-instrumentable: still resume if paused so Chrome does not stick
    if (!interesting || !sessionId) {
      if (waiting && sessionId) {
        try {
          await this.send('Runtime.runIfWaitingForDebugger', {}, sessionId);
          this.log.write({
            t: new Date().toISOString(),
            kind: 'resumed',
            reason: 'non-instrumentable-or-missing-meta',
            sessionId,
            targetId: meta.targetId,
            targetType: meta.type,
            targetUrl: meta.url,
          });
        } catch (e) {
          this.log.write({
            t: new Date().toISOString(),
            kind: 'resume-skip-error',
            sessionId,
            error: String(e.message || e),
          });
        }
      }
      return;
    }

    await this.tryDomain(sessionId, meta, 'Runtime.enable');
    await this.tryDomain(sessionId, meta, 'Log.enable');
    await this.tryDomain(sessionId, meta, 'Network.enable');

    if (waiting) {
      try {
        await this.send('Runtime.runIfWaitingForDebugger', {}, sessionId);
        this.log.write({
          t: new Date().toISOString(),
          kind: 'resumed',
          sessionId,
          targetId: meta.targetId,
          targetType: meta.type,
          targetUrl: meta.url,
        });
      } catch (e) {
        this.log.write({
          t: new Date().toISOString(),
          kind: 'resume-error',
          sessionId,
          targetId: meta.targetId,
          error: String(e.message || e),
        });
      }
    }
  }

  /** Resolve spp-host page session metadata for phase markers. */
  resolveHostSessionMeta() {
    for (const [sid, s] of this.sessions) {
      if (s.type === 'page' && (s.url || '').includes('spp-host.html')) {
        return {
          sessionId: sid,
          targetId: s.targetId ?? this.hostTargetId ?? null,
          hostOpened: Boolean(this.hostTargetId),
          url: s.url ?? null,
        };
      }
    }
    return {
      sessionId: null,
      targetId: this.hostTargetId ?? null,
      hostOpened: Boolean(this.hostTargetId),
      url: null,
    };
  }

  /**
   * @param {string} expression
   * @param {{ awaitPromise?: boolean }} [opts]
   */
  async evaluateOnHost(expression, opts = {}) {
    for (const [sid, s] of this.sessions) {
      if (s.type === 'page' && (s.url || '').includes('spp-host.html')) {
        const r = await this.send(
          'Runtime.evaluate',
          {
            expression,
            returnByValue: true,
            awaitPromise: Boolean(opts.awaitPromise),
          },
          sid,
        );
        if (r.exceptionDetails) {
          throw new Error('evaluate failed: ' + JSON.stringify(r.exceptionDetails));
        }
        return r.result?.value;
      }
    }
    throw new Error('No spp-host page session for evaluate');
  }

  async readHostUiSnapshot() {
    return this.evaluateOnHost(HOST_UI_SNAPSHOT_EXPRESSION);
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}

async function waitForCdp(port, timeoutMs) {
  const start = Date.now();
  let lastErr;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return await res.json();
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`CDP not ready on ${port}: ${lastErr?.message || lastErr}`);
}

const CHROME_COMPONENT_IDS = new Set([
  'nkeimhogjdpnpccoofpliimaahmaaome',
  'mhjfbmdgcfjbbpaeojofohoefgiehjai',
  'fignfifoniblkonapihmkfakmlgkbkcf',
]);

export function resolveExtensionIdFromTargets(targets) {
  const scored = [];
  for (const t of targets) {
    const url = t.url || '';
    const title = t.title || '';
    const m = url.match(/^chrome-extension:\/\/([a-p]{32})\//);
    if (!m) continue;
    const id = m[1];
    if (CHROME_COMPONENT_IDS.has(id)) continue;
    if (/\/resources\//i.test(url)) continue;
    let score = 0;
    if (url.includes('spp-host.html')) score += 100;
    if (url.includes('/spp/')) score += 80;
    if (title.includes('Solanym')) score += 70;
    if (url.endsWith('/popup.html') && title.includes('Solanym')) score += 60;
    if (url.endsWith('/background.js') || url.includes('/background.js')) score += 40;
    if (url.includes('service_worker')) score += 20;
    if (score > 0) scored.push({ id, score, url, title });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.id || null;
}

function resolveExtensionIdFromProfile(labProfile, distAbs) {
  if (!labProfile) return null;
  const norm = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();
  const want = norm(distAbs).replace(/\/$/, '');
  const wantTail = 'packages/extension/dist';
  const candidates = [
    path.join(labProfile, 'Default', 'Secure Preferences'),
    path.join(labProfile, 'Default', 'Preferences'),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      const json = JSON.parse(readFileSync(file, 'utf8'));
      const settings = json?.extensions?.settings;
      if (!settings || typeof settings !== 'object') continue;
      for (const [id, meta] of Object.entries(settings)) {
        if (!/^[a-p]{32}$/.test(id)) continue;
        if (CHROME_COMPONENT_IDS.has(id)) continue;
        const p = norm(meta?.path).replace(/\/$/, '');
        if (!p) continue;
        const pathHit =
          p === want ||
          p.endsWith(wantTail) ||
          p.includes(wantTail) ||
          want.endsWith(p) ||
          p.includes('stellar privacy project/packages/extension/dist');
        if (pathHit) return id;
        if (meta?.location === 4 && (p.includes('extension/dist') || p.endsWith('/dist'))) {
          return id;
        }
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function listTargets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!res.ok) throw new Error(`json/list ${res.status}`);
  return res.json();
}

export function verifyAuthStatic(dist) {
  const srcPath = path.join(EXTENSION_ROOT, 'src/spp-host/storageLabPrep.ts');
  const bundlePath = path.join(dist, 'spp-host.js');
  if (!existsSync(srcPath) || !existsSync(bundlePath)) {
    throw new Error('Missing storageLabPrep.ts or dist/spp-host.js');
  }
  const src = readFileSync(srcPath, 'utf8');
  const bundle = readFileSync(bundlePath, 'utf8');
  const m = src.match(/export const STORAGE_LAB_EXECUTION_AUTHORIZED = (true|false);/);
  if (!m || m[1] !== 'false') {
    throw new Error(`SOURCE auth must be false, got ${m && m[1]}`);
  }
  if (!bundle.includes('executionAuthorized=e?.executionAuthorized??!1')) {
    throw new Error('BUNDLE does not show compiled auth false (??!1)');
  }
  if (bundle.includes('executionAuthorized=e?.executionAuthorized??!0')) {
    throw new Error('BUNDLE unexpectedly contains auth true (??!0)');
  }
  return { sourceAuth: false, bundleAuthFalse: true };
}

/**
 * @param {() => Promise<object|null>} readUi
 * @param {(ui: object) => boolean} predicate
 * @param {{ timeoutMs?: number, intervalMs?: number, label?: string, abortCheck?: () => string|null }} [opts]
 */
export async function pollHostUi(readUi, predicate, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 30000;
  const intervalMs = opts.intervalMs ?? 250;
  const label = opts.label || 'host UI condition';
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    if (opts.abortCheck) {
      const reason = opts.abortCheck();
      if (reason) throw new Error(reason);
    }
    last = await readUi();
    if (last && predicate(last)) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `ABORT: timed out waiting for ${label} (last=${JSON.stringify({
      phase: last?.phase ?? null,
      wasm: last?.wasm ?? null,
    })})`,
  );
}

/**
 * Drive wasm-only capture on a live/fake CdpConnection: probe click → WASM click,
 * emitting T0/T1/T2 markers. Never touches Storage/Client controls.
 *
 * @param {CdpConnection} cdp
 * @param {{ write: Function }} log
 * @param {{ phaseTimeoutMs?: number, settleMs?: number, now?: () => string }} [options]
 */
export async function executeWasmOnlyCaptureOnCdp(cdp, log, options = {}) {
  const phaseTimeoutMs = options.phaseTimeoutMs ?? 45000;
  const settleMs = options.settleMs ?? 2000;
  const abortCheck = () => cdp.abortReason || null;

  const readUi = async () => cdp.readHostUiSnapshot();

  return runWasmOnlyPhaseSequence({
    log,
    now: options.now,
    resolveHostMeta: () => cdp.resolveHostSessionMeta(),
    readUi,
    runProbe: async () => {
      await cdp.evaluateOnHost(HOST_PROBE_CLICK_EXPRESSION);
      await pollHostUi(
        readUi,
        (ui) => ui.phase === 'ready' || ui.phase === 'error',
        { timeoutMs: phaseTimeoutMs, label: 'facade probe terminal phase', abortCheck },
      );
    },
    runWasmInit: async () => {
      await cdp.evaluateOnHost(HOST_WASM_CLICK_EXPRESSION);
      await pollHostUi(
        readUi,
        (ui) => ui.wasm === 'ready' || ui.wasm === 'error',
        { timeoutMs: phaseTimeoutMs, label: 'wasm-only terminal phase', abortCheck },
      );
    },
    afterT2: async () => {
      // Post-T2 settle: keep capturing boundary/post events; do not classify them as benign.
      log.write({
        t: new Date().toISOString(),
        kind: 'post-t2-settle-start',
        settleMs,
        note: 'Events during settle remain subject to analyzer risk perimeter; not auto-benign',
      });
      await new Promise((r) => setTimeout(r, settleMs));
      log.write({
        t: new Date().toISOString(),
        kind: 'post-t2-settle-end',
        settleMs,
      });
    },
  });
}

/**
 * Kill only the process tree rooted at `child.pid` (lab Chrome).
 * Waits for taskkill/exit when the platform allows.
 *
 * Contract: always resolves (does not reject) for skipped/missing pid and for
 * win32 taskkill exit/error/timeout. `ok: true` means the helper finished its
 * wait — NOT that Chrome is proven dead (`chromeDeathVerified` is always false
 * without an independent PID probe).
 *
 * LIMITATION: if this Node process is SIGKILL'd, finally never runs and lab
 * Chrome/profile may remain — not solved by this helper.
 *
 * @param {{ pid?: number }|null|undefined} child
 * @param {{
 *   platform?: string,
 *   spawnFn?: typeof spawn,
 *   setTimeoutFn?: typeof setTimeout,
 *   clearTimeoutFn?: typeof clearTimeout,
 *   timeoutMs?: number,
 *   killPgFn?: (pid: number, signal: string) => void,
 *   postKillDelayMs?: number,
 * }} [deps]
 */
export async function killProcessTree(child, deps = {}) {
  const platform = deps.platform ?? process.platform;
  const spawnFn = deps.spawnFn ?? spawn;
  const setTimeoutFn = deps.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = deps.clearTimeoutFn ?? clearTimeout;
  const timeoutMs = deps.timeoutMs ?? 8000;
  const killPgFn =
    deps.killPgFn ?? ((pid, signal) => process.kill(-pid, signal));
  const postKillDelayMs = deps.postKillDelayMs ?? 200;

  if (!child?.pid) return { ok: true, skipped: true, chromeDeathVerified: false };
  const pid = child.pid;

  if (platform === 'win32') {
    let taskkillVia = null;
    let taskkillExitCode = null;
    await new Promise((resolve) => {
      let settled = false;
      /** @type {ReturnType<typeof setTimeout>|null} */
      let timer = null;
      /** @type {{ on: Function, removeListener?: Function, off?: Function }|null} */
      let proc = null;

      const cleanupListeners = () => {
        if (!proc) return;
        try {
          if (typeof proc.removeListener === 'function') {
            proc.removeListener('exit', onExit);
            proc.removeListener('error', onError);
          } else if (typeof proc.off === 'function') {
            proc.off('exit', onExit);
            proc.off('error', onError);
          }
        } catch {
          /* ignore */
        }
      };

      const done = (via, code = null) => {
        if (settled) return;
        settled = true;
        taskkillVia = via;
        taskkillExitCode = code;
        if (timer != null) clearTimeoutFn(timer);
        cleanupListeners();
        resolve();
      };

      const onExit = (code) => done('exit', code);
      const onError = () => done('error', null);

      try {
        proc = spawnFn('taskkill', ['/PID', String(pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
        proc.on('exit', onExit);
        proc.on('error', onError);
      } catch {
        done('spawn-throw', null);
        return;
      }
      timer = setTimeoutFn(() => done('timeout', null), timeoutMs);
    });

    return {
      ok: true,
      pid,
      taskkillVia,
      taskkillExitCode,
      // Independent verification is out of scope for this helper.
      chromeDeathVerified: false,
    };
  }

  try {
    killPgFn(pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }
  await new Promise((r) => setTimeoutFn(r, postKillDelayMs));
  return { ok: true, pid, chromeDeathVerified: false };
}

/**
 * Deterministic lab cleanup sequence used by smoke `finally`.
 * Order: close CDP → await killProcessTree → remove lab profile.
 *
 * Inject doubles via `deps` in tests. Production uses real fs/spawn.
 *
 * @param {{
 *   cdp?: { domainStatus?: unknown, eventCounts?: unknown, close?: () => void }|null,
 *   chromeChild?: { pid?: number }|null,
 *   labProfile?: string|null,
 *   report: Record<string, unknown>,
 * }} ctx
 * @param {{
 *   killProcessTreeFn?: typeof killProcessTree,
 *   rmSyncFn?: typeof rmSync,
 *   delayFn?: (ms: number) => Promise<void>,
 *   postKillDelayMs?: number,
 *   killDeps?: Parameters<typeof killProcessTree>[1],
 * }} [deps]
 */
export async function runSmokeCleanup(ctx, deps = {}) {
  const killProcessTreeFn = deps.killProcessTreeFn ?? killProcessTree;
  const rmSyncFn = deps.rmSyncFn ?? rmSync;
  const postKillDelayMs = deps.postKillDelayMs ?? 500;
  const delayFn =
    deps.delayFn ??
    ((ms) => new Promise((r) => setTimeout(r, ms)));

  const sequence = [];
  const result = {
    cdpClosed: false,
    killAwaited: false,
    killResult: null,
    profileDiscarded: false,
    profileError: null,
    sequence,
  };

  try {
    if (ctx.cdp) {
      ctx.report.domainStatus = ctx.cdp.domainStatus;
      ctx.report.eventCounts = ctx.cdp.eventCounts;
    }
    ctx.cdp?.close?.();
    result.cdpClosed = true;
    sequence.push('cdp-close');
  } catch {
    sequence.push('cdp-close-error');
  }

  if (ctx.chromeChild) {
    result.killResult = await killProcessTreeFn(ctx.chromeChild, deps.killDeps);
    result.killAwaited = true;
    sequence.push('kill-awaited');
    if (postKillDelayMs > 0) {
      await delayFn(postKillDelayMs);
      sequence.push('post-kill-delay');
    }
  }

  if (ctx.labProfile && String(ctx.labProfile).includes('solanym-spp-cdp-lab-')) {
    try {
      rmSyncFn(ctx.labProfile, { recursive: true, force: true });
      result.profileDiscarded = true;
      ctx.report.labProfileDiscarded = true;
      sequence.push('profile-removed');
    } catch (e) {
      result.profileDiscarded = false;
      result.profileError = String(e.message || e);
      ctx.report.labProfileDiscarded = false;
      ctx.report.labProfileError = result.profileError;
      sequence.push('profile-remove-error');
    }
  }

  return result;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`Usage: node scripts/spp-cdp-harness.mjs --smoke [--settle-ms 4000]
       node scripts/spp-cdp-harness.mjs --wasm-only [--settle-ms 4000] [--phase-timeout-ms 45000]
       node scripts/spp-cdp-harness.mjs --port N --extension-id ID`);
    process.exit(0);
  }

  const auth = verifyAuthStatic(args.dist);
  console.log('AUTH_STATIC', JSON.stringify(auth));

  if (!existsSync(path.join(args.dist, 'spp-host.html'))) {
    throw new Error(`spp-host.html missing under ${args.dist}`);
  }
  if (!existsSync(path.join(args.dist, 'manifest.json'))) {
    throw new Error(`manifest.json missing under ${args.dist}`);
  }

  const runMode = args.wasmOnly ? 'wasm-only' : args.smoke ? 'smoke' : 'attach';
  const runId = stamp();
  const logPath =
    args.logPath || path.join(tmpdir(), `solanym-spp-cdp-${runId}.ndjson`);
  const summaryPath = path.join(tmpdir(), `solanym-spp-cdp-${runId}-summary.json`);
  const log = new NdjsonLog(logPath);
  log.write({
    t: new Date().toISOString(),
    kind: 'meta',
    phase: args.wasmOnly ? '5G.14' : '5E.8',
    auth,
    dist: args.dist,
    smoke: args.smoke,
    wasmOnly: args.wasmOnly,
    runMode,
    note: 'Absence of network events is not proof of zero traffic. Node SIGKILL skips finally. Capture does not demonstrate runtime isolation.',
  });

  let chromeChild = null;
  let labProfile = null;
  let port = args.port;
  let cdp = null;
  const report = {
    phase: args.wasmOnly ? '5G.14' : '5E.8',
    runMode,
    ok: false,
    logPath,
    summaryPath,
    auth,
    depsInstalled: false,
    captureBeforeHost: null,
    extensionId: null,
    targets: [],
    domainStatus: [],
    eventCounts: {},
    abortReason: null,
    storageOpenExecuted: false,
    clientNewExecuted: false,
    wasmInitExecuted: false,
    proverExecuted: false,
    hostUi: null,
    phaseMarkers: null,
  };

  try {
    const launchLabChrome = args.smoke || args.wasmOnly;
    if (launchLabChrome) {
      if (!existsSync(args.chrome)) throw new Error(`Chrome not found: ${args.chrome}`);
      port = await pickFreePort(9460);
      labProfile = path.join(tmpdir(), `solanym-spp-cdp-lab-${runId}`);
      mkdirSync(labProfile, { recursive: true });
      console.log('LAB_PROFILE', labProfile);
      console.log('CDP_PORT', port);
      console.log('RUN_MODE', runMode);

      const chromeArgs = [
        `--user-data-dir=${labProfile}`,
        `--remote-debugging-port=${port}`,
        '--remote-allow-origins=*',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-sync',
        '--disable-background-networking',
        '--enable-unsafe-extension-debugging',
        'about:blank',
      ];
      chromeChild = spawn(args.chrome, chromeArgs, {
        stdio: 'ignore',
        windowsHide: false,
        detached: false,
      });
      chromeChild.on('exit', (code) => {
        log.write({ t: new Date().toISOString(), kind: 'chrome-exit', code });
      });
    } else if (!port) {
      throw new Error('--port required unless --smoke or --wasm-only');
    }

    const version = await waitForCdp(port, args.launchTimeoutMs);
    log.write({
      t: new Date().toISOString(),
      kind: 'cdp-version',
      browser: version.Browser,
      webSocketDebuggerUrl: version.webSocketDebuggerUrl,
    });
    console.log('CDP_BROWSER', version.Browser);

    cdp = new CdpConnection(version.webSocketDebuggerUrl, log, {
      extensionId: args.extensionId,
    });
    await cdp.connect();

    await cdp.send('Target.setDiscoverTargets', { discover: true });
    await cdp.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
    });

    try {
      const existing = await cdp.send('Target.getTargets');
      for (const info of existing.targetInfos || []) {
        if (!isInstrumentableTarget(info) || !info.targetId) continue;
        // Skip pure browser_ui — attach would add noise; autoAttach may still notify.
        if (info.type === 'browser_ui') continue;
        try {
          const attached = await cdp.send('Target.attachToTarget', {
            targetId: info.targetId,
            flatten: true,
          });
          if (attached?.sessionId && !cdp.sessions.has(attached.sessionId)) {
            cdp.enqueueAttachedSetup({
              sessionId: attached.sessionId,
              targetInfo: info,
              waitingForDebugger: false,
            });
          }
        } catch (e) {
          log.write({
            t: new Date().toISOString(),
            kind: 'attach-existing-error',
            targetId: info.targetId,
            url: info.url,
            error: String(e.message || e),
          });
        }
      }
    } catch (e) {
      log.write({
        t: new Date().toISOString(),
        kind: 'getTargets-error',
        error: String(e.message || e),
      });
    }

    await cdp.waitForPendingSetups();

    log.write({
      t: new Date().toISOString(),
      kind: 'browser-capture-armed',
      discover: true,
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
      pendingSetupsDrained: true,
    });
    report.captureBeforeHost = true;

    let extensionId = args.extensionId || null;
    if (!extensionId) {
      try {
        const loaded = await cdp.send('Extensions.loadUnpacked', { path: args.dist });
        extensionId = loaded?.id || null;
        log.write({
          t: new Date().toISOString(),
          kind: 'extensions-loadUnpacked',
          id: extensionId,
          path: args.dist,
        });
      } catch (e) {
        log.write({
          t: new Date().toISOString(),
          kind: 'extensions-loadUnpacked-error',
          error: String(e.message || e),
          cdp: e.cdp || null,
        });
      }
    }

    await cdp.waitForPendingSetups();
    await new Promise((r) => setTimeout(r, 400));
    await cdp.waitForPendingSetups();

    let targets = await listTargets(port);
    if (!extensionId) {
      extensionId =
        resolveExtensionIdFromProfile(labProfile, args.dist) ||
        resolveExtensionIdFromTargets(targets);
    }
    if (!extensionId) {
      throw new Error(
        'Could not load/resolve Solanym extension id via Extensions.loadUnpacked / targets.',
      );
    }
    if (CHROME_COMPONENT_IDS.has(extensionId)) {
      throw new Error(`Refusing Chrome component id ${extensionId}`);
    }
    cdp.extensionId = extensionId;
    report.extensionId = extensionId;
    console.log('EXTENSION_ID', extensionId);
    log.write({
      t: new Date().toISOString(),
      kind: 'extension-id',
      extensionId,
      targetsPreview: targets.map((t) => ({ type: t.type, url: t.url, title: t.title })),
    });

    const hostUrl = `chrome-extension://${extensionId}/spp-host.html`;
    if (!urlAllowed(hostUrl, extensionId)) {
      throw new Error('Host URL failed allowlist unexpectedly');
    }

    // Determinism: all prior attach setups drained before host creation
    await cdp.waitForPendingSetups();

    const created = await cdp.send('Target.createTarget', { url: hostUrl });
    cdp.hostTargetId = created.targetId;
    log.write({
      t: new Date().toISOString(),
      kind: 'host-target-created',
      targetId: created.targetId,
      url: hostUrl,
      captureWasArmedBeforeCreate: true,
      setupsDrainedBeforeCreate: true,
    });
    console.log('HOST_TARGET', created.targetId);

    await cdp.waitForPendingSetups();

    const deadline = Date.now() + Math.max(args.settleMs, 8000);
    let ui = null;
    while (Date.now() < deadline) {
      if (cdp.abortReason) break;
      try {
        await cdp.waitForPendingSetups();
        ui = await cdp.readHostUiSnapshot();
        if (ui?.hasRunBtn && ui?.phase) break;
      } catch {
        /* session not ready yet */
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    if (cdp.abortReason) {
      report.abortReason = cdp.abortReason;
      throw new Error(cdp.abortReason);
    }
    if (!ui) {
      throw new Error('ABORT: timed out waiting for spp-host page session');
    }
    report.hostUi = ui;
    log.write({ t: new Date().toISOString(), kind: 'host-ui-snapshot', ui });

    if (args.wasmOnly) {
      // Separate path: emit T0/T1/T2; click probe + wasm only. Smoke gates intentionally not used.
      assertWasmOnlySafetyGates(ui, { allowWasmReady: false });
      const capture = await executeWasmOnlyCaptureOnCdp(cdp, log, {
        phaseTimeoutMs: args.phaseTimeoutMs,
        settleMs: Math.min(args.settleMs, 5000),
      });
      report.phaseMarkers = capture.phases;
      report.wasmInitExecuted = capture.wasmInitExecuted;
      report.storageOpenExecuted = capture.storageOpenExecuted;
      report.clientNewExecuted = capture.clientNewExecuted;
      report.hostUi = capture.markers[capture.markers.length - 1]?.ui ?? ui;
      report.t2Outcome = capture.t2Outcome;

      const evidence = collectAuditedCommandEvidence(log.entries ? log.entries() : []);
      // File log has no entries(); re-scan domainStatus for Network.enable positives.
      const netOk = cdp.domainStatus.some(
        (d) =>
          d.domain === 'Network.enable' &&
          d.ok === true &&
          (d.type === 'page' || (d.url || '').includes('spp-host.html')),
      );
      report.networkEnablePositive = netOk || evidence.hasPositiveNetworkEnable;
      if (!report.networkEnablePositive) {
        throw new Error(
          'ABORT: no positive host Network.enable evidence (domain-setup ok or commandId-correlated)',
        );
      }
      console.log('WASM_ONLY_OK', capture.t2Outcome);
    } else {
      // Smoke (or attach): preserve historical abort-on-WASM-ready behavior.
      assertSmokeHostUiGates(ui);
      console.log('SMOKE_OK');
    }

    const finalTargets = await listTargets(port);
    report.targets = finalTargets.map((t) => ({
      type: t.type,
      url: t.url,
      title: t.title,
    }));
    report.domainStatus = cdp.domainStatus;
    report.eventCounts = cdp.eventCounts;
    report.ok = true;
  } catch (e) {
    report.ok = false;
    report.abortReason = report.abortReason || String(e.message || e);
    log.write({
      t: new Date().toISOString(),
      kind: 'fatal',
      error: String(e.message || e),
    });
    console.error(args.wasmOnly ? 'WASM_ONLY_FAIL' : 'SMOKE_FAIL', report.abortReason);
  } finally {
    const cleanup = await runSmokeCleanup(
      { cdp, chromeChild, labProfile, report },
      {},
    );
    report.cleanupSequence = cleanup.sequence;
    try {
      report.authAfter = verifyAuthStatic(args.dist);
    } catch (e) {
      report.authAfterError = String(e.message || e);
    }
    log.write({ t: new Date().toISOString(), kind: 'summary', report });
    log.close();
    writeFileSync(summaryPath, JSON.stringify(report, null, 2), 'utf8');
    console.log('LOG', logPath);
    console.log('SUMMARY', summaryPath);
    console.log('REPORT_OK', report.ok);
  }

  if (!report.ok) process.exitCode = 1;
}

const isDirectRun =
  process.argv[1] && path.resolve(__filename) === path.resolve(process.argv[1]);

if (isDirectRun) {
  main().catch((e) => {
    console.error('FATAL', e);
    // Note: if chrome was spawned inside main's try, finally should have run.
    // A throw before entering main's try cannot leave Chrome running.
    process.exit(1);
  });
}
