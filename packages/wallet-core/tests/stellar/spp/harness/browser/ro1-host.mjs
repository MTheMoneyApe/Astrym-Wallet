/**
 * Fase 2.27 — Browser document host spike for RO-1 with REAL SPP 0.2.1.
 *
 * Narrow session API only. Raw Client is module-private (not on window).
 * Uses same-origin /rpc-ro1 (getLedgerEntries only).
 *
 * NOT a security sandbox against hostile same-realm code.
 * NOT production wallet integration. G8/G9 remain FAIL.
 */

const DENIED = Object.freeze([
  'sync',
  'backgroundSync',
  'operationalFeed',
  'recipientLookup',
  'account',
  'verifySelectiveDisclosure',
  'deposit',
  'transfer',
  'withdraw',
  'signTransaction',
  'signAuthEntry',
  'signMessage',
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

/**
 * Page-level network instrumentation. Does NOT patch inside workers or WASM-native
 * sockets — those are recorded as notInstrumentable.
 */
function installPageNetworkInstrumentation(report) {
  const originalFetch = globalThis.fetch.bind(globalThis);
  const blocked = [];
  const allowed = [];
  const workerSpawns = [];

  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input && typeof input.url === 'string'
            ? input.url
            : String(input);
    const resolved = new URL(url, location.href);
    if (resolved.origin !== location.origin) {
      blocked.push(resolved.href);
      throw new Error(`RO-1 spike: blocked external fetch ${resolved.href}`);
    }
    allowed.push(resolved.href);
    return originalFetch(input, init);
  };

  const XHR = globalThis.XMLHttpRequest;
  let xhrPatched = false;
  if (XHR) {
    const open = XHR.prototype.open;
    XHR.prototype.open = function (method, url, ...rest) {
      const resolved = new URL(String(url), location.href);
      if (resolved.origin !== location.origin) {
        blocked.push(resolved.href);
        throw new Error(`RO-1 spike: blocked external XHR ${resolved.href}`);
      }
      return open.call(this, method, url, ...rest);
    };
    xhrPatched = true;
  }

  const OrigWorker = globalThis.Worker;
  let workerPatched = false;
  if (typeof OrigWorker === 'function') {
    globalThis.Worker = function Ro1GuardedWorker(scriptURL, options) {
      const target = typeof scriptURL === 'string' ? scriptURL : scriptURL.href;
      workerSpawns.push({ at: new Date().toISOString(), script: target });
      return new OrigWorker(scriptURL, options);
    };
    Object.assign(globalThis.Worker, OrigWorker);
    globalThis.Worker.prototype = OrigWorker.prototype;
    workerPatched = true;
  }

  report.network = {
    pageFetchInstrumented: true,
    xhrInstrumented: xhrPatched,
    workerConstructorInstrumented: workerPatched,
    blocked,
    allowed,
    workerSpawns,
    /** Mechanisms we cannot prove from the page alone */
    notInstrumentable: [
      'fetch/XHR inside DedicatedWorker (storage/prover) — separate realm',
      'WASM/reqwest internal HTTP if not routed through page fetch',
      'WebSocket/EventSource inside workers',
      'Native/extension sockets (N/A)',
    ],
    observedWithoutExternalAttempt: [],
    restore() {
      globalThis.fetch = originalFetch;
      if (workerPatched) globalThis.Worker = OrigWorker;
    },
  };
}

/**
 * Narrow RO-1 session — real SDK behind private fields.
 */
function createRo1BrowserSession() {
  /** @type {any} */
  let storage = null;
  /** @type {any} */
  let client = null;
  /** @type {any} */
  let sppFacade = null;
  let closed = false;
  const steps = [];

  const record = (step, data) => {
    steps.push({ step, at: new Date().toISOString(), ...data });
  };

  return {
    get closed() {
      return closed;
    },
    getSteps() {
      return steps.slice();
    },
    /** Deny-by-default probe — never forwards to SDK mutators. */
    tryInvoke(method) {
      if (closed) return { ok: false, reason: 'session closed' };
      record('tryInvoke', { method, denied: true });
      return { ok: false, reason: `RO-1 deny: ${method}` };
    },
    listDenied() {
      return DENIED;
    },
    async openStorage(wasmMod, workerUrl) {
      if (closed) throw new Error('session closed');
      storage = await withTimeout(wasmMod.Storage.open({ workerUrl }), 20000, 'Storage.open');
      record('Storage.open', {
        realSdk: true,
        result: 'ok',
        dependencies: ['OPFS', 'storage-worker'],
      });
      return { ok: true };
    },
    async createClient(opts) {
      if (closed) throw new Error('session closed');
      if (!storage) throw new Error('openStorage required');
      sppFacade = opts.sppFacade;
      const rpcUrl = opts.rpcUrl;
      if (!rpcUrl.includes('/rpc-ro1')) {
        closed = true;
        throw new Error('RO-1 session requires rpcUrl ending with /rpc-ro1');
      }
      client = await withTimeout(
        sppFacade.Client.new({
          rpcUrl,
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
        rpcUrl,
        note: 'prover worker loaded for init; prove APIs not called; backgroundSync not called',
        dependencies: ['prover-worker', 'circuits', 'RpcClient handle'],
      });
      return { ok: true, bound: true };
      // raw client intentionally not returned
    },
    async aspState() {
      if (closed) throw new Error('session closed');
      if (!client) throw new Error('createClient required');
      const data = await withTimeout(client.aspState(), 30000, 'aspState');
      record('aspState', {
        realSdk: true,
        result: 'ok',
        hasAspMembership: data?.aspMembership != null || data?.asp_membership != null || !!data,
      });
      return { ok: true, dataSummary: summarizeState(data) };
    },
    async allContractsData() {
      if (closed) throw new Error('session closed');
      if (!client) throw new Error('createClient required');
      const data = await withTimeout(client.allContractsData(), 30000, 'allContractsData');
      record('allContractsData', {
        realSdk: true,
        result: 'ok',
        poolCount: Array.isArray(data?.pools) ? data.pools.length : null,
      });
      return { ok: true, dataSummary: summarizeState(data) };
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

function summarizeState(data) {
  if (!data || typeof data !== 'object') return { type: typeof data };
  const keys = Object.keys(data);
  return {
    keys: keys.slice(0, 20),
    poolsLen: Array.isArray(data.pools) ? data.pools.length : undefined,
  };
}

async function run() {
  const report = {
    phase: '2.27',
    kind: 'RO-1 browser document host spike',
    notWalletIntegration: true,
    startedAt: new Date().toISOString(),
    sdk: {
      package: 'stellar-private-payments',
      expectedVersion: '0.2.1',
      importPath: '/node_modules/stellar-private-payments/js/index.js',
    },
    gates: { G8: 'FAIL', G9: 'FAIL', note: 'Spike ≠ extension integration / full host isolation' },
    stages: {},
    rpc: { endpoint: `${location.origin}/rpc-ro1`, allowlist: ['getLedgerEntries'] },
    sessionSteps: [],
    adversarial: {},
  };

  const statusEl = document.getElementById('status');
  const reportEl = document.getElementById('report');
  const paint = () => {
    reportEl.textContent = JSON.stringify(report, null, 2);
    window.__SPP_RO1_RESULT__ = report;
    // Never attach raw client
    delete window.__SPP_RAW_CLIENT__;
  };

  installPageNetworkInstrumentation(report);
  try {
    await fetch('/mock-rpc-log/clear', { method: 'POST' });
  } catch {
    /* ignore */
  }

  const session = createRo1BrowserSession();
  // Expose ONLY narrow API for manual/devtools checks — no Client
  window.__SPP_RO1_SESSION__ = {
    tryInvoke: (m) => session.tryInvoke(m),
    listDenied: () => session.listDenied(),
    get closed() {
      return session.closed;
    },
  };

  let wasmMod = null;

  try {
    // --- OPFS probe ---
    report.stages.opfs = { status: 'BLOQUEADO' };
    if (typeof navigator?.storage?.getDirectory === 'function') {
      const root = await navigator.storage.getDirectory();
      const name = `ro1-spike-${Date.now()}`;
      await root.getDirectoryHandle(name, { create: true });
      await root.removeEntry(name, { recursive: true });
      report.stages.opfs = { status: 'INICIALIZADO' };
    } else {
      report.stages.opfs = { status: 'BLOQUEADO', error: 'OPFS unavailable' };
      throw new Error('OPFS required for Storage.open');
    }

    // --- WASM ---
    wasmMod = await import(
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
    report.sdk.resolvedVersion = pkg.version;

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
    const circuitsBaseUrl = new URL(
      '/node_modules/stellar-private-payments/dist/circuits/',
      location.origin,
    ).href;
    const proverWorkerUrl = new URL(
      '/node_modules/stellar-private-payments/dist/workers/prover-worker.js',
      location.origin,
    ).href;

    const rpcUrl = `${location.origin}/rpc-ro1`;
    await session.createClient({
      sppFacade,
      rpcUrl,
      contractConfig,
      circuitsBaseUrl,
      circuitLock,
      proverWorkerUrl,
    });
    report.stages.clientNew = {
      status: 'INICIALIZADO',
      realSdk: true,
      rpcUrl,
      backgroundSyncCalled: false,
    };

    await fetch('/mock-rpc-log/clear', { method: 'POST' });
    const asp = await session.aspState();
    report.stages.aspState = {
      status: asp.ok ? 'OBSERVADO' : 'BLOQUEADO',
      realSdk: true,
      transportMock: 'synthetic getLedgerEntries fixture via /rpc-ro1',
      summary: asp.dataSummary,
    };

    const all = await session.allContractsData();
    report.stages.allContractsData = {
      status: all.ok ? 'OBSERVADO' : 'BLOQUEADO',
      realSdk: true,
      transportMock: 'synthetic getLedgerEntries fixture via /rpc-ro1',
      summary: all.dataSummary,
    };

    const mockLog = await fetch('/mock-rpc-log').then((r) => r.json());
    const rpcMethods = (mockLog.log || []).map((e) => e.method);
    report.rpcLog = mockLog.log || [];
    report.rpcMethodsObserved = [...new Set(rpcMethods)];
    report.rpcOnlyGetLedgerEntries =
      rpcMethods.length > 0 && rpcMethods.every((m) => m === 'getLedgerEntries');

    // Adversarial denials (do not call real mutators)
    report.adversarial.deniedInvokes = {};
    for (const m of ['sync', 'backgroundSync', 'deposit', 'signTransaction', 'sendTransaction']) {
      report.adversarial.deniedInvokes[m] = session.tryInvoke(m);
    }

    session.close();
    report.stages.sessionClose = { status: 'OK', closed: session.closed };
    report.adversarial.invokeAfterClose = session.tryInvoke('aspState');

    report.sessionSteps = session.getSteps();
    report.networkSummary = {
      blockedExternal: report.network.blocked.slice(),
      externalBlockedCount: report.network.blocked.length,
      allowedSameOriginCount: report.network.allowed.length,
      workerSpawns: report.network.workerSpawns.length,
      notInstrumentable: report.network.notInstrumentable.slice(),
    };

    const ok =
      report.stages.aspState.status === 'OBSERVADO' &&
      report.stages.allContractsData.status === 'OBSERVADO' &&
      report.network.blocked.length === 0 &&
      report.rpcOnlyGetLedgerEntries === true;

    report.ok = ok;
    report.finishedAt = new Date().toISOString();
    statusEl.textContent = ok
      ? 'RO-1 spike OBSERVADO (SDK real + mock fixture). G8/G9 FAIL.'
      : 'RO-1 spike incomplete — see report. G8/G9 FAIL.';
    statusEl.className = ok ? 'ok' : 'bad';
  } catch (e) {
    report.ok = false;
    report.fatalError = e instanceof Error ? e.message : String(e);
    report.sessionSteps = session.getSteps();
    report.finishedAt = new Date().toISOString();
    try {
      session.close();
    } catch {
      /* ignore */
    }
    statusEl.textContent = `BLOQUEADO: ${report.fatalError}`;
    statusEl.className = 'bad';
  }

  paint();
  try {
    report.network.restore();
  } catch {
    /* ignore */
  }
}

run();
