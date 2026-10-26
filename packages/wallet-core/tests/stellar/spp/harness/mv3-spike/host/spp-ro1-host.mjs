/**
 * Fase 2.36 — Dedicated MV3 extension-page RO-1 host (operator-driven).
 * SDK from ../vendor only. Loopback RPC. No vault/keys/signing.
 */

import { createHostContainment } from './containment.mjs';
import { BROKER_V, mintRequestId, validateBrokerRequest } from '../broker/envelope.mjs';
import {
  createChromeSessionStore,
  beginSession,
  persistSession,
} from '../evidence/sessionStore.mjs';
import { evaluateGates } from '../evidence/evaluateGates.mjs';
import {
  startPageOnlyNetworkWatch,
  buildDraftFromAssistForm,
} from './residualAssist.mjs';

const RPC_ORIGIN = 'http://127.0.0.1:8765';
const RPC_RO1 = `${RPC_ORIGIN}/rpc-ro1`;
const ARTIFACT_VERSION = '0.0.36';

const DENIED = Object.freeze([
  'sync',
  'backgroundSync',
  'deposit',
  'transfer',
  'withdraw',
  'signTransaction',
  'sendTransaction',
  'simulateTransaction',
  'prove',
  'ensure_synced',
]);

/** @type {any} */
let evidence = createEmptyEvidence(`boot-${Date.now()}`);
/** @type {ReturnType<typeof createHostContainment> | null} */
let host = null;
/** @type {chrome.runtime.Port | null} */
let port = null;
let t0 = performance.now();
const sessionStore = createChromeSessionStore(typeof chrome !== 'undefined' ? chrome : null);
/** @type {ReturnType<typeof startPageOnlyNetworkWatch> | null} */
let residualWatch = null;
/** @type {object | null} */
let lastPagePerf = null;

function relTs() {
  return Math.round(performance.now() - t0);
}

function createEmptyEvidence(sessionId) {
  return {
    phase: '2.36',
    artifactVersion: ARTIFACT_VERSION,
    sessionId: sessionId || `mv3-36-${Date.now()}`,
    previousSessionId: null,
    previousSessionRecoverable: false,
    previousSessionSummary: null,
    notWalletIntegration: true,
    chromeDesktopExecution: 'PENDING_OPERATOR',
    startedAt: new Date().toISOString(),
    context: {},
    chrome: { version: null, userAgent: navigator.userAgent },
    extension: { id: null, manifestVersion: null },
    csp: {
      manifestExtensionPages: null,
      note: 'MV3 effective page/worker CSP is the extension_pages string; meta CSP is ignored on extension pages',
      workerScriptHeaders: [],
      documentFetchInvalid: null,
    },
    sdk: { package: 'stellar-private-payments', expectedVersion: '0.2.1' },
    rpc: { endpoint: RPC_RO1, allowlist: ['getLedgerEntries'], observed: [], deniedProbes: [] },
    events: [],
    workers: { registered: [], terminated: [] },
    brokerTests: {},
    egressAttempts: [],
    postClose: { classification: 'NOT_TESTED', notes: null },
    lifecycle: {},
    vaultAccess: false,
    keysAccess: false,
    signingWired: false,
    gates: { G8: 'FAIL', G9: 'FAIL' },
    gateEvaluation: null,
    ok: false,
  };
}

function applyGateEvaluation() {
  const ev = evaluateGates(evidence);
  evidence.gates = { G8: ev.G8, G9: ev.G9 };
  evidence.gateEvaluation = {
    evaluatedAt: new Date().toISOString(),
    reasons: ev.reasons,
    checklist: ev.checklist,
    egressDedup: ev.egressDedup,
    note: ev.note,
  };
}

async function saveEvidence(reason) {
  try {
    applyGateEvaluation();
    await persistSession(sessionStore, evidence);
    logEvent('session_persisted', { reason, sessionId: evidence.sessionId });
  } catch (e) {
    logEvent('session_persist_error', {
      reason,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

function logEvent(type, detail = {}) {
  evidence.events.push({ tRelMs: relTs(), at: new Date().toISOString(), type, ...detail });
}

function paint(status) {
  const el = document.getElementById('status');
  const pre = document.getElementById('report');
  if (el) {
    el.textContent = status;
    el.className = evidence.ok ? 'ok' : 'bad';
  }
  if (pre) pre.textContent = JSON.stringify(evidence, null, 2);
  window.__SPP_MV3_36_EVIDENCE__ = evidence;
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function vendorUrl(rel) {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(`vendor/${rel}`);
  }
  return new URL(`../vendor/${rel}`, import.meta.url).href;
}

async function probeDocumentInvalid() {
  const violations = [];
  const onViol = (e) => {
    violations.push({
      blockedURI: e.blockedURI,
      violatedDirective: e.violatedDirective,
      effectiveDirective: e.effectiveDirective,
    });
  };
  document.addEventListener('securitypolicyviolation', onViol);
  let fetchResult;
  try {
    await fetch('https://csp-probe.invalid/', { mode: 'cors' });
    fetchResult = { kind: 'completed' };
  } catch (e) {
    fetchResult = { kind: 'threw', message: e instanceof Error ? e.message : String(e) };
  }
  await new Promise((r) => setTimeout(r, 250));
  document.removeEventListener('securitypolicyviolation', onViol);
  const cspAttributed = violations.some(
    (v) => /connect/i.test(v.violatedDirective || '') || String(v.blockedURI || '').includes('.invalid'),
  );
  return {
    target: 'https://csp-probe.invalid/',
    fetchResult,
    violations,
    classification: cspAttributed ? 'PASS_CSP_CONFIRMED' : 'NOT_DEMONSTRATED',
  };
}

async function readWorkerCspViaFetch() {
  // For chrome-extension://, fetch may not expose CSP headers the same as HTTP harness.
  const paths = ['dist/workers/storage-worker.js', 'dist/workers/prover-worker.js'];
  const out = [];
  for (const p of paths) {
    try {
      const res = await fetch(vendorUrl(p));
      out.push({
        path: p,
        status: res.status,
        cspHeader: res.headers.get('content-security-policy'),
        note:
          res.headers.get('content-security-policy') == null
            ? 'No CSP response header (expected for chrome-extension://); effective policy = manifest extension_pages'
            : 'Header present',
      });
    } catch (e) {
      out.push({ path: p, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

function ensureHost() {
  if (!host || host.closed) {
    // Keep evidence.sessionId (persistence key); containment uses the same id.
    host = createHostContainment({ sessionId: evidence.sessionId });
  }
  return host;
}

async function runRo1() {
  const h = ensureHost();
  const gate = h.assertOpen('runRo1');
  if (!gate.ok) throw new Error(gate.message);

  logEvent('ro1_begin', { requestId: mintRequestId('ro1') });

  if (typeof navigator?.storage?.getDirectory !== 'function') {
    throw new Error('OPFS unavailable');
  }

  const meta = await fetch(vendorUrl('VENDOR_META.json')).then((r) => r.json());
  evidence.sdk.resolvedVersion = meta.version;
  evidence.sdk.vendor = { version: meta.version, copiedAt: meta.copiedAt };

  const wasmMod = await import(vendorUrl('dist/stellar_private_payments_web.js'));
  await wasmMod.default({
    module_or_path: vendorUrl('dist/stellar_private_payments_web_bg.wasm'),
  });
  logEvent('wasm_ok');

  const storage = await withTimeout(
    wasmMod.Storage.open({ workerUrl: vendorUrl('dist/workers/storage-worker.js') }),
    20000,
    'Storage.open',
  );
  evidence.workers.registered = h.snapshot();
  logEvent('storage_open', { workers: h.snapshot().map((w) => w.script.split('/').pop()) });

  const spp = await import(vendorUrl('js/index.js'));
  const contractConfig = await fetch(
    `${RPC_ORIGIN}/tests/stellar/spp/harness/browser/synthetic-contract-config.json`,
  ).then((r) => r.json());
  const circuitLock = await fetch(vendorUrl('dist/circuits/circuits.json')).then((r) => r.json());

  const client = await withTimeout(
    spp.Client.new({
      rpcUrl: RPC_RO1,
      storage,
      contractConfig,
      circuitsBaseUrl: vendorUrl('dist/circuits/'),
      circuitLock,
      proverWorkerUrl: vendorUrl('dist/workers/prover-worker.js'),
    }),
    60000,
    'Client.new',
  );
  evidence.workers.registered = h.snapshot();
  logEvent('client_new', { workers: h.snapshot().filter((w) => w.class === 'SDK_REAL') });

  await fetch(`${RPC_ORIGIN}/mock-rpc-log/clear`, { method: 'POST' });
  const asp = await withTimeout(client.aspState(), 30000, 'aspState');
  const all = await withTimeout(client.allContractsData(), 30000, 'allContractsData');
  const mockLog = await fetch(`${RPC_ORIGIN}/mock-rpc-log`).then((r) => r.json());
  const methods = (mockLog.log || []).map((e) => e.method);
  evidence.rpc.observed = mockLog.log || [];
  evidence.rpc.onlyGetLedgerEntries =
    methods.length > 0 && methods.every((m) => m === 'getLedgerEntries');

  // Denied surface (do not call SDK mutators)
  evidence.rpc.deniedProbes = DENIED.map((m) => ({ method: m, ok: false, reason: `RO-1 deny: ${m}` }));

  // Denied RPC methods against mock
  for (const bad of ['sendTransaction', 'simulateTransaction', 'getEvents', 'getHealth']) {
    const body = { jsonrpc: '2.0', id: 99, method: bad, params: [] };
    const res = await fetch(RPC_RO1, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => r.json());
    evidence.rpc.deniedProbes.push({
      rpcMethod: bad,
      responseError: res.error || null,
      rejected: Boolean(res.error),
    });
  }

  evidence.stages = {
    aspState: { ok: true, keys: Object.keys(asp || {}).slice(0, 12) },
    allContractsData: {
      ok: true,
      poolCount: Array.isArray(all?.pools) ? all.pools.length : null,
    },
  };

  window.__SPP_MV3_CLIENT_HOLD__ = { client, storage, disposeHint: 'held for close tests' };
  logEvent('ro1_complete', { onlyGetLedgerEntries: evidence.rpc.onlyGetLedgerEntries });
  evidence.ok = evidence.rpc.onlyGetLedgerEntries === true;
  await saveEvidence('ro1_complete');
  paint('RO-1 complete — record egress / close as needed');
  return { client, storage };
}

function emergencyClose(reason) {
  const h = host;
  if (!h) {
    evidence.lifecycle[reason] = { note: 'no host yet' };
    paint(`Close: ${reason} (no host)`);
    return;
  }
  // dispose first if client held (shows dispose ≠ terminate)
  const hold = window.__SPP_MV3_CLIENT_HOLD__;
  let afterDisposeLive = null;
  if (hold?.client) {
    try {
      hold.client.dispose();
    } catch {
      /* ignore */
    }
    afterDisposeLive = h.liveOwned().length;
  }
  const close = h.emergencyClose(reason);
  const close2 = h.emergencyClose(`${reason}-repeat`);
  evidence.workers.terminated = close.snapshot;
  evidence.lifecycle[reason] = {
    afterDisposeLive,
    close,
    idempotentRepeat: close2.idempotent === true,
    tRelMs: relTs(),
  };
  logEvent('emergency_close', { reason, terminatedNow: close.terminatedNow });
  delete window.__SPP_MV3_CLIENT_HOLD__;
  void saveEvidence(`emergency_close:${reason}`);
  paint(`Emergency close: ${reason}`);
}

async function runBrokerAdversarial() {
  const sessionId = evidence.sessionId || `adv-${Date.now()}`;
  const results = {};

  const send = (msg) =>
    new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, resolve);
    });

  results.malformedMissingFields = await send({ type: 'RO1_PING' });
  results.unknownType = await send({
    v: BROKER_V,
    kind: 'req',
    sessionId,
    requestId: mintRequestId('unk'),
    type: 'HACK_SYNC',
  });
  results.extraField = await send({
    v: BROKER_V,
    kind: 'req',
    sessionId,
    requestId: mintRequestId('xf'),
    type: 'RO1_PING',
    evil: true,
  });
  const dupId = mintRequestId('dup');
  results.dupFirst = await send({
    v: BROKER_V,
    kind: 'req',
    sessionId,
    requestId: dupId,
    type: 'RO1_PING',
  });
  results.dupSecond = await send({
    v: BROKER_V,
    kind: 'req',
    sessionId,
    requestId: dupId,
    type: 'RO1_PING',
  });
  results.unknownDispatch = await send({
    v: BROKER_V,
    kind: 'req',
    sessionId,
    requestId: mintRequestId('dm'),
    type: 'RO1_DISPATCH',
    method: 'Client.sync',
    args: {},
  });

  // Local schema check (same module SW uses)
  results.localSchemaUnknown = validateBrokerRequest({
    v: 1,
    kind: 'req',
    sessionId: 'x',
    requestId: 'y',
    type: 'NOPE',
  });

  evidence.brokerTests = results;
  logEvent('broker_adversarial_done');
  paint('Broker adversarial recorded');
}

async function downloadEvidence() {
  evidence.finishedAt = new Date().toISOString();
  evidence.chromeDesktopExecution =
    evidence.context.isExtensionPage === true ? 'OPERATOR_EXPORT' : 'NOT_EXTENSION_PAGE';
  applyGateEvaluation();
  await saveEvidence('export');
  const blob = new Blob([JSON.stringify(evidence, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `spp-2.36-evidence-${evidence.sessionId}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  logEvent('evidence_downloaded', { sessionId: evidence.sessionId });
  paint(
    `Evidence download session=${evidence.sessionId} G8=${evidence.gates.G8} G9=${evidence.gates.G9} — save under mv3-spike/evidence/runs/`,
  );
}

async function boot() {
  t0 = performance.now();
  // New page load = new session. Prior RO-1 lives in chrome.storage / prior exports only.
  const fresh = createEmptyEvidence(`mv3-36-${Date.now()}`);
  try {
    await beginSession(sessionStore, fresh);
  } catch (e) {
    fresh.sessionStoreError = e instanceof Error ? e.message : String(e);
  }
  evidence = fresh;
  evidence.context = {
    protocol: location.protocol,
    href: location.href,
    isExtensionPage: location.protocol === 'chrome-extension:',
  };
  const ctxEl = document.getElementById('context');
  if (ctxEl) {
    ctxEl.textContent = `${evidence.context.href} | extensionPage=${evidence.context.isExtensionPage} | session=${evidence.sessionId} | prev=${evidence.previousSessionId || 'none'} recoverable=${evidence.previousSessionRecoverable}`;
  }
  const sessEl = document.getElementById('session-line');
  if (sessEl) {
    sessEl.textContent = evidence.previousSessionSummary
      ? `New session ${evidence.sessionId}. Previous ${evidence.previousSessionId}: workers=${evidence.previousSessionSummary.workersRegisteredCount} rpc=${evidence.previousSessionSummary.rpcObservedCount} recoverable=${evidence.previousSessionRecoverable}`
      : `New session ${evidence.sessionId} (no previous session in store)`;
  }

  if (typeof chrome !== 'undefined' && chrome.runtime) {
    evidence.extension.id = chrome.runtime.id;
    const man = chrome.runtime.getManifest();
    evidence.csp.manifestExtensionPages =
      man.content_security_policy?.extension_pages ?? null;
    evidence.extension.manifestVersion = man.manifest_version;
    evidence.extension.name = man.name;
    evidence.extension.version = man.version;
  }

  evidence.csp.workerScriptHeaders = await readWorkerCspViaFetch();
  if (evidence.context.isExtensionPage) {
    evidence.csp.documentFetchInvalid = await probeDocumentInvalid();
  }

  if (typeof chrome !== 'undefined' && chrome.runtime?.connect) {
    port = chrome.runtime.connect({ name: 'spp-ro1-host' });
    port.postMessage({ type: 'HOST_STATUS', phase: 'boot', requestId: mintRequestId('boot') });
    port.onMessage.addListener((msg) => {
      logEvent('sw_message', { msg });
      if (msg && msg.type === 'EMERGENCY_CLOSE') {
        emergencyClose('sw_broker');
      }
      if (msg && msg.type === 'DISPATCH') {
        logEvent('dispatch_forwarded_to_host', {
          method: msg.method,
          requestId: msg.requestId,
          note: 'Host would execute; SW did not run SDK',
        });
      }
    });
  }

  applyGateEvaluation();
  await saveEvidence('boot');
  paint(
    evidence.context.isExtensionPage
      ? `Ready session=${evidence.sessionId}. Empty workers/rpc until Run RO-1 (reload starts a NEW session).`
      : 'Not chrome-extension:// — load unpacked spike in Chrome Desktop.',
  );
}

document.getElementById('btn-ro1').addEventListener('click', () => {
  runRo1().catch((e) => {
    evidence.fatalError = e instanceof Error ? e.message : String(e);
    evidence.ok = false;
    logEvent('ro1_fatal', { error: evidence.fatalError });
    try {
      emergencyClose('fatal');
    } catch {
      /* ignore */
    }
    paint(`BLOQUEADO: ${evidence.fatalError}`);
  });
});

document.getElementById('btn-close-init').addEventListener('click', () => {
  ensureHost();
  emergencyClose('before_workers');
  let constructDenied = false;
  try {
    new Worker(vendorUrl('dist/workers/storage-worker.js'), { type: 'module' });
  } catch (e) {
    constructDenied = /HOST_CLOSED/.test(e instanceof Error ? e.message : String(e));
  }
  evidence.lifecycle.before_workers = {
    ...(evidence.lifecycle.before_workers || {}),
    constructDenied,
  };
  paint('Close before workers done');
});

document.getElementById('btn-close-after').addEventListener('click', () => {
  emergencyClose('operator_close');
});

document.getElementById('btn-broker-tests').addEventListener('click', () => {
  runBrokerAdversarial().catch((e) => {
    evidence.brokerTests = { error: String(e) };
    paint('Broker tests error');
  });
});

document.getElementById('btn-export').addEventListener('click', () => {
  downloadEvidence().catch((e) => {
    paint(`Export error: ${e instanceof Error ? e.message : String(e)}`);
  });
});

document.getElementById('btn-egress-save').addEventListener('click', () => {
  evidence.egressAttempts.push({
    tRelMs: relTs(),
    at: new Date().toISOString(),
    worker: document.getElementById('egress-worker').value,
    classification: document.getElementById('egress-class').value,
    notes: document.getElementById('egress-notes').value || null,
    technique: 'devtools_worker_console_fetch_invalid_no_sdk_substitute',
  });
  logEvent('egress_recorded');
  void saveEvidence('egress');
  paint('Egress attempt recorded (duplicates kept; validator dedupes for gates)');
});

document.getElementById('btn-postclose-save').addEventListener('click', () => {
  evidence.postClose = {
    classification: document.getElementById('postclose-class').value,
    at: new Date().toISOString(),
    tRelMs: relTs(),
    note: 'Absence demonstrated only if classification is ABSENCE_DEMONSTRATED with proof; NO_ACTIVITY_OBSERVED ≠ proven absence',
  };
  logEvent('postclose_recorded');
  void saveEvidence('postclose');
  paint('Post-close observation recorded');
});

document.getElementById('btn-residual-watch')?.addEventListener('click', () => {
  if (residualWatch) {
    lastPagePerf = residualWatch.stop();
    residualWatch = null;
    paint(`Page-only watch stopped: ${lastPagePerf.pageResourceEntries} resource entries (not full network)`);
    return;
  }
  residualWatch = startPageOnlyNetworkWatch(8000);
  paint('Page-only PerformanceObserver running 8s — also watch DevTools Network/Threads; click again to stop');
  setTimeout(() => {
    if (!residualWatch) return;
    lastPagePerf = residualWatch.stop();
    residualWatch = null;
    paint(`Page-only watch auto-stopped: ${lastPagePerf.pageResourceEntries} entries (page scope only)`);
  }, 8000);
});

document.getElementById('btn-residual-draft')?.addEventListener('click', () => {
  const ended = new Date().toISOString();
  const result = buildDraftFromAssistForm({
    startedAt: lastPagePerf?.startedAt || new Date(Date.now() - 8000).toISOString(),
    endedAt: lastPagePerf?.endedAt || ended,
    observeWindowMs: lastPagePerf?.elapsedMs >= 5000 ? lastPagePerf.elapsedMs : 8000,
    networkVisibility: document.getElementById('res-net-vis').value,
    threadsVisibility: document.getElementById('res-thr-vis').value,
    networkRequestsObserved: document.getElementById('res-net-count').value,
    liveWorkerThreadsObserved: document.getElementById('res-thr-count').value,
    workersObservedText: document.getElementById('res-workers').value,
    detectionNetwork: document.getElementById('res-det-net').value,
    detectionThreads: document.getElementById('res-det-thr').value,
    pagePerf: lastPagePerf,
    intendAbsence: document.getElementById('res-intend-absence').checked,
    intendNested: document.getElementById('res-intend-nested').checked,
    wasmGlueRuledOut: document.getElementById('res-glue-ruled').checked,
    inferNoNestedFromHostWrapper: document.getElementById('res-infer-wrapper').checked,
  });
  const pre = document.getElementById('residual-draft');
  if (pre) pre.textContent = JSON.stringify(result, null, 2);
  if (!result.ok) {
    paint(`Residual draft REJECTED: ${result.code} — ${result.errors.join('; ')}`);
    logEvent('residual_draft_rejected', { code: result.code, errors: result.errors });
    return;
  }
  evidence.residualDraft = result.draft;
  logEvent('residual_draft_ok', { kind: result.draft.kind });
  const blob = new Blob([JSON.stringify(result.draft, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `spp-2.36-residual-draft-${evidence.sessionId}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  void saveEvidence('residual_draft');
  paint('Residual draft OK — downloaded (unique name). Merge into a NEW export only; do not overwrite canonical.');
});

boot();
