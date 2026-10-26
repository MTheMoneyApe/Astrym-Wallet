/**
 * Fase 2.31 — Real SDK RO-1 under enforced CSP (connect-src 'self').
 *
 * Policy enforcement = browser CSP (not page fetch patch).
 * Negative probes use *.invalid only — no public services.
 * G8/G9 remain FAIL unless evidence warrants (this phase does not auto-approve).
 */

const INVALID_URL = 'https://ro1-csp-probe.invalid/isolation';

const DENIED = Object.freeze([
  'sync',
  'backgroundSync',
  'deposit',
  'signTransaction',
  'sendTransaction',
]);

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

function cspFromMeta() {
  const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
  return meta ? meta.getAttribute('content') : null;
}

function classifyInvalidAttempt(fetchOutcome, violations, sinceIndex) {
  const related = violations.slice(sinceIndex).filter((v) => {
    const uri = String(v.blockedURI || '');
    const dir = String(v.effectiveDirective || v.violatedDirective || '');
    return (
      uri.includes('ro1-csp-probe.invalid') ||
      uri.includes('.invalid') ||
      (dir.includes('connect') && fetchOutcome.status === 'failed')
    );
  });
  if (fetchOutcome.status === 'REACHED') return { verdict: 'FAIL', related };
  if (related.length > 0) return { verdict: 'PASS_CSP_CONFIRMED', related };
  if (fetchOutcome.status === 'failed') {
    return {
      verdict: 'NO DEMOSTRADO_CSP',
      related,
      note: 'Failure without attributed CSP violation (DNS/other possible)',
    };
  }
  return { verdict: 'NO DEMOSTRADO', related };
}

async function probeInvalidFetch(label, violations) {
  const since = violations.length;
  let fetchOutcome;
  try {
    const res = await fetch(INVALID_URL, { cache: 'no-store', mode: 'cors' });
    fetchOutcome = { status: 'REACHED', http: res.status };
  } catch (e) {
    fetchOutcome = {
      status: 'failed',
      message: e instanceof Error ? e.message : String(e),
      name: e instanceof Error ? e.name : undefined,
    };
  }
  await new Promise((r) => setTimeout(r, 50));
  const classification = classifyInvalidAttempt(fetchOutcome, violations, since);
  return { label, target: INVALID_URL, fetchOutcome, ...classification };
}

function createRo1Session() {
  let storage = null;
  let client = null;
  let closed = false;
  const steps = [];
  const record = (step, data) => steps.push({ step, at: new Date().toISOString(), ...data });

  return {
    get closed() {
      return closed;
    },
    getSteps() {
      return steps.slice();
    },
    tryInvoke(method) {
      if (closed) return { ok: false, reason: 'session closed' };
      record('tryInvoke', { method, denied: true });
      return { ok: false, reason: `RO-1 deny: ${method}` };
    },
    async openStorage(wasmMod, workerUrl) {
      if (closed) throw new Error('session closed');
      storage = await withTimeout(wasmMod.Storage.open({ workerUrl }), 20000, 'Storage.open');
      record('Storage.open', { realSdk: true, result: 'ok' });
      return { ok: true };
    },
    async createClient(opts) {
      if (closed) throw new Error('session closed');
      if (!storage) throw new Error('openStorage required');
      if (!String(opts.rpcUrl).includes('/rpc-ro1')) {
        closed = true;
        throw new Error('requires /rpc-ro1');
      }
      client = await withTimeout(
        opts.sppFacade.Client.new({
          rpcUrl: opts.rpcUrl,
          storage,
          contractConfig: opts.contractConfig,
          circuitsBaseUrl: opts.circuitsBaseUrl,
          circuitLock: opts.circuitLock,
          proverWorkerUrl: opts.proverWorkerUrl,
        }),
        60000,
        'Client.new',
      );
      record('Client.new', {
        realSdk: true,
        result: 'ok',
        rpcUrl: opts.rpcUrl,
        backgroundSyncCalled: false,
      });
      return { ok: true };
    },
    async aspState() {
      if (closed) throw new Error('session closed');
      const data = await withTimeout(client.aspState(), 30000, 'aspState');
      record('aspState', { realSdk: true, result: 'ok' });
      return {
        ok: true,
        summary: {
          keys: data && typeof data === 'object' ? Object.keys(data).slice(0, 20) : [],
          poolsLen: Array.isArray(data?.pools) ? data.pools.length : undefined,
        },
      };
    },
    async allContractsData() {
      if (closed) throw new Error('session closed');
      const data = await withTimeout(client.allContractsData(), 30000, 'allContractsData');
      record('allContractsData', { realSdk: true, result: 'ok' });
      return {
        ok: true,
        summary: {
          keys: data && typeof data === 'object' ? Object.keys(data).slice(0, 20) : [],
          poolsLen: Array.isArray(data?.pools) ? data.pools.length : undefined,
        },
      };
    },
    close() {
      closed = true;
      try {
        if (client && typeof client.dispose === 'function') client.dispose();
      } catch {
        /* ignore */
      }
      client = null;
      storage = null;
      record('close', { result: 'ok' });
    },
  };
}

function paint(status, report) {
  const statusEl = document.getElementById('status');
  const reportEl = document.getElementById('report');
  if (statusEl) statusEl.textContent = status;
  if (reportEl) reportEl.textContent = JSON.stringify(report, null, 2);
  window.__SPP_ISOLATION_RESULT__ = report;
}

async function runWorkerNegative(violations) {
  const localUrl = new URL('/mock-rpc-log', location.origin).href;
  const workerUrl = new URL('./csp-negative-probe.worker.js', import.meta.url).href;
  return new Promise((resolve) => {
    let worker;
    try {
      worker = new Worker(workerUrl);
    } catch (e) {
      resolve({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        classification: { invalid: 'FAIL_OR_CSP_WORKER' },
      });
      return;
    }
    const timer = setTimeout(() => {
      try {
        worker.terminate();
      } catch {
        /* ignore */
      }
      resolve({ timeout: true, classification: { invalid: 'NO DEMOSTRADO' } });
    }, 10000);
    worker.onmessage = (ev) => {
      clearTimeout(timer);
      try {
        worker.terminate();
      } catch {
        /* ignore */
      }
      // Merge worker-reported violations into page log for visibility
      if (Array.isArray(ev.data?.violations)) {
        for (const v of ev.data.violations) violations.push({ ...v, realm: 'worker' });
      }
      resolve(ev.data);
    };
    worker.onerror = (err) => {
      clearTimeout(timer);
      resolve({
        error: true,
        message: err?.message || 'worker error',
        classification: { invalid: 'NO DEMOSTRADO' },
      });
    };
    worker.postMessage({ localUrl });
  });
}

/** Observe-only fetch log (not enforcement). */
function installObserveFetch(report) {
  const original = globalThis.fetch.bind(globalThis);
  const observed = [];
  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input && typeof input.url === 'string'
            ? input.url
            : String(input);
    observed.push({ at: new Date().toISOString(), url });
    return original(input, init);
  };
  report.observeFetch = observed;
  report.restoreObserve = () => {
    globalThis.fetch = original;
  };
}

async function run() {
  const violations = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    violations.push({
      at: new Date().toISOString(),
      realm: 'document',
      effectiveDirective: e.effectiveDirective,
      violatedDirective: e.violatedDirective,
      blockedURI: e.blockedURI,
      disposition: e.disposition,
      originalPolicy: e.originalPolicy,
    });
  });

  const report = {
    phase: '2.31',
    kind: 'real-sdk-isolation-probe',
    notWalletIntegration: true,
    gates: { G8: 'FAIL', G9: 'FAIL', note: 'Document host ≠ MV3 extension; see report' },
    startedAt: new Date().toISOString(),
    browser: { userAgent: navigator.userAgent },
    csp: {
      meta: cspFromMeta(),
      headerNote: 'serve.mjs may also emit Content-Security-Policy for this path',
      includesWasmUnsafeEval: Boolean(cspFromMeta()?.includes('wasm-unsafe-eval')),
    },
    wasmTransportStatic: {
      binding: '__wbg_fetch → global fetch / WindowOrWorkerGlobalScope.fetch',
      evidence: 'stellar_private_payments_web.js + *-worker-module.js',
      subjectToConnectSrc: 'YES if fetch used in that realm (CSP applies to fetch)',
    },
    negative: {},
    stages: {},
    workersSpawned: [],
    rpcLog: [],
    adversarial: {},
    violations,
  };

  // Patch Worker to record SDK spawns
  const OrigWorker = globalThis.Worker;
  globalThis.Worker = function PatchedWorker(scriptURL, options) {
    const target = typeof scriptURL === 'string' ? scriptURL : scriptURL.href;
    report.workersSpawned.push({ at: new Date().toISOString(), script: target });
    return new OrigWorker(scriptURL, options);
  };
  Object.assign(globalThis.Worker, OrigWorker);
  globalThis.Worker.prototype = OrigWorker.prototype;

  paint('Negative probes…', report);

  // 1) Page negative (.invalid)
  report.negative.page = await probeInvalidFetch('document', violations);

  // 2) Worker negative
  report.negative.worker = await runWorkerNegative(violations);

  // Local control (must work under connect-src 'self')
  try {
    const res = await fetch('/mock-rpc-log', { cache: 'no-store' });
    report.negative.localControl = { status: 'observed_local', http: res.status };
  } catch (e) {
    report.negative.localControl = {
      status: 'failed',
      message: e instanceof Error ? e.message : String(e),
    };
  }

  installObserveFetch(report);
  const session = createRo1Session();
  window.__SPP_ISOLATION_SESSION__ = {
    tryInvoke: (m) => session.tryInvoke(m),
    get closed() {
      return session.closed;
    },
  };

  paint('Running real SDK RO-1…', report);

  try {
    if (typeof navigator?.storage?.getDirectory !== 'function') {
      throw new Error('OPFS required');
    }
    await navigator.storage.getDirectory();
    report.stages.opfs = { status: 'INICIALIZADO' };

    const wasmMod = await import(
      '/node_modules/stellar-private-payments/dist/stellar_private_payments_web.js'
    );
    const wasmUrl = new URL(
      '/node_modules/stellar-private-payments/dist/stellar_private_payments_web_bg.wasm',
      location.origin,
    );
    await wasmMod.default({ module_or_path: wasmUrl });
    report.stages.wasm = { status: 'INICIALIZADO', realSdk: true };

    const pkg = await fetch('/node_modules/stellar-private-payments/package.json').then((r) =>
      r.json(),
    );
    report.sdk = {
      package: 'stellar-private-payments',
      resolvedVersion: pkg.version,
      realSdk: true,
      publicMethodsNotFaked: true,
    };

    const workerUrl = new URL(
      '/node_modules/stellar-private-payments/dist/workers/storage-worker.js',
      location.origin,
    ).href;
    await session.openStorage(wasmMod, workerUrl);
    report.stages.storage = { status: 'INICIALIZADO', realSdk: true };

    const sppFacade = await import('/node_modules/stellar-private-payments/js/index.js');
    const contractConfig = await fetch(
      '/tests/stellar/spp/harness/browser/synthetic-contract-config.json',
    ).then((r) => r.json());
    const circuitLock = await fetch(
      '/node_modules/stellar-private-payments/dist/circuits/circuits.json',
    ).then((r) => r.json());

    await session.createClient({
      sppFacade,
      rpcUrl: `${location.origin}/rpc-ro1`,
      contractConfig,
      circuitsBaseUrl: new URL(
        '/node_modules/stellar-private-payments/dist/circuits/',
        location.origin,
      ).href,
      circuitLock,
      proverWorkerUrl: new URL(
        '/node_modules/stellar-private-payments/dist/workers/prover-worker.js',
        location.origin,
      ).href,
    });
    report.stages.clientNew = { status: 'INICIALIZADO', realSdk: true };

    await fetch('/mock-rpc-log/clear', { method: 'POST' });
    const asp = await session.aspState();
    report.stages.aspState = {
      status: asp.ok ? 'OBSERVADO' : 'BLOQUEADO',
      realSdk: true,
      summary: asp.summary,
    };
    const all = await session.allContractsData();
    report.stages.allContractsData = {
      status: all.ok ? 'OBSERVADO' : 'BLOQUEADO',
      realSdk: true,
      summary: all.summary,
    };

    const mockLog = await fetch('/mock-rpc-log').then((r) => r.json());
    report.rpcLog = mockLog.log || [];
    report.rpcMethodsObserved = [...new Set(report.rpcLog.map((e) => e.method))];
    report.rpcOnlyGetLedgerEntries =
      report.rpcLog.length > 0 &&
      report.rpcLog.every((e) => e.method === 'getLedgerEntries');

    // Page observe: any non-same-origin URL?
    const externalObserved = (report.observeFetch || []).filter((e) => {
      try {
        return new URL(e.url, location.href).origin !== location.origin;
      } catch {
        return true;
      }
    });
    report.pageFetchExternalObserved = externalObserved;

    // Negative again after SDK (policy still enforced by CSP)
    report.negative.pageAfterSdk = await probeInvalidFetch('document-after-sdk', violations);

    // Adversarial surface
    report.adversarial.deniedInvokes = {};
    for (const m of DENIED) {
      report.adversarial.deniedInvokes[m] = session.tryInvoke(m);
    }

    // RPC deny via mock
    const denyRpc = await fetch('/rpc-ro1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sendTransaction',
        params: [],
      }),
    }).then((r) => r.json());
    report.adversarial.rpcSendRejected = {
      hasError: Boolean(denyRpc.error),
      message: denyRpc.error?.message || null,
    };

    session.close();
    report.stages.sessionClose = { status: 'OK', closed: session.closed };
    report.adversarial.invokeAfterClose = session.tryInvoke('aspState');
    report.adversarial.workersAfterClose = {
      spawnedCount: report.workersSpawned.length,
      note: 'Workers may still exist in runtime after session.close — termination not proven',
      verdict: 'NO DEMOSTRADO',
    };

    report.sessionSteps = session.getSteps();

    const pageCspOk = report.negative.page?.verdict === 'PASS_CSP_CONFIRMED';
    const workerCspOk =
      report.negative.worker?.classification?.invalid === 'PASS_CSP_CONFIRMED';
    const sdkOk =
      report.stages.aspState?.status === 'OBSERVADO' &&
      report.stages.allContractsData?.status === 'OBSERVADO' &&
      report.rpcOnlyGetLedgerEntries === true;

    report.verdicts = {
      sdkRo1Real: sdkOk ? 'PASS' : 'FAIL',
      pageInvalidCsp: report.negative.page?.verdict || 'NO DEMOSTRADO',
      workerInvalidCsp: report.negative.worker?.classification?.invalid || 'NO DEMOSTRADO',
      pageAfterSdkCsp: report.negative.pageAfterSdk?.verdict || 'NO DEMOSTRADO',
      sdkWorkerInvalidInjected: 'NO DEMOSTRADO',
      wasmFetchSubjectToCsp: pageCspOk
        ? 'PASS (WASM uses __wbg_fetch → realm fetch; connect-src confirmed on document fetch)'
        : 'NO DEMOSTRADO (CSP confirm failed on document; cannot claim WASM covered)',
      G8: 'FAIL',
      G9: 'FAIL',
    };

    report.ok = sdkOk === true;
    report.finishedAt = new Date().toISOString();
    paint(
      sdkOk
        ? `Isolation probe: SDK RO-1 OK. pageCSP=${report.verdicts.pageInvalidCsp} workerCSP=${report.verdicts.workerInvalidCsp}. G8/G9 FAIL.`
        : 'Isolation probe incomplete — see report. G8/G9 FAIL.',
      report,
    );
  } catch (e) {
    report.ok = false;
    report.fatalError = e instanceof Error ? e.message : String(e);
    report.cspWasmHint = report.fatalError.toLowerCase().includes('csp')
      || report.fatalError.toLowerCase().includes('unsafe')
      || violations.some((v) => String(v.effectiveDirective).includes('script'))
      ? 'Possible CSP/wasm issue — see violations'
      : null;
    report.finishedAt = new Date().toISOString();
    try {
      session.close();
    } catch {
      /* ignore */
    }
    paint(`BLOQUEADO: ${report.fatalError}`, report);
  }

  try {
    report.restoreObserve?.();
    delete report.restoreObserve;
  } catch {
    /* ignore */
  }
  globalThis.Worker = OrigWorker;
}

run();
