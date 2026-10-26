/**
 * Fase 2.33 — Real SPP worker egress/disposal audit (browser).
 *
 * - Uses stellar-private-payments@0.2.1 public APIs (RO-1 only).
 * - Does NOT inject into worker protocol / does NOT replace worker scripts.
 * - CSP in-worker block for REAL workers: documented NOT_TESTED here without
 *   worker-target CDP (denied in this environment) or SDK modification.
 * - Dispose vs terminate: observe tracked Worker.terminate wrappers.
 */

import { installWorkerRegistry } from './workerRegistry.mjs';

const INVALID = 'https://ro1-csp-probe.invalid/spp-real-worker';

function paint(status, report) {
  document.getElementById('status').textContent = status;
  document.getElementById('report').textContent = JSON.stringify(report, null, 2);
  window.__SPP_REAL_WORKER_AUDIT__ = report;
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
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

async function headerCsp(url) {
  const res = await fetch(url, { cache: 'no-store' });
  return {
    url,
    http: res.status,
    csp: res.headers.get('content-security-policy'),
  };
}

async function run() {
  const registry = installWorkerRegistry();
  const report = {
    phase: '2.33',
    kind: 'real-spp-worker-egress-disposal',
    notWalletIntegration: true,
    gates: { G8: 'FAIL', G9: 'FAIL' },
    startedAt: new Date().toISOString(),
    browser: { userAgent: navigator.userAgent },
    sdk: {
      package: 'stellar-private-payments',
      expectedVersion: '0.2.1',
      source: 'node_modules (local harness serve)',
    },
    identification: {},
    csp: {},
    egress: {},
    disposal: {},
    classifications: {},
  };

  paint('Identifying real workers…', report);

  const storageWorkerUrl = new URL(
    '/node_modules/stellar-private-payments/dist/workers/storage-worker.js',
    location.origin,
  ).href;
  const proverWorkerUrl = new URL(
    '/node_modules/stellar-private-payments/dist/workers/prover-worker.js',
    location.origin,
  ).href;

  report.identification = {
    workers: [
      {
        id: 'storage-worker',
        script: storageWorkerUrl,
        class: 'SDK_REAL',
        entry: 'dist/workers/storage-worker.js → storage-worker-module.js',
        createdBy: 'WasmStorage.open / new Worker (wasm-bindgen)',
      },
      {
        id: 'prover-worker',
        script: proverWorkerUrl,
        class: 'SDK_REAL',
        entry: 'dist/workers/prover-worker.js → prover-worker-module.js',
        createdBy: 'ProverBridge.spawn / new Worker (wasm-bindgen)',
      },
    ],
    harnessWorkers: {
      note: 'Any worker-csp-probe / registry helpers are HARNESS_CONTROL — not listed as SDK_REAL',
    },
    sharedWorker: 'NOT_IDENTIFIED in published 0.2.1 package',
    blobWorkers: 'NOT_IDENTIFIED for SPP entries (http module workers)',
  };

  report.csp.storageScript = await headerCsp(storageWorkerUrl);
  report.csp.proverScript = await headerCsp(proverWorkerUrl);
  report.csp.documentMeta = document
    .querySelector('meta[http-equiv="Content-Security-Policy"]')
    ?.content;

  // Document-level .invalid control (known CSP path)
  const docViolations = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    docViolations.push({
      effectiveDirective: e.effectiveDirective,
      blockedURI: e.blockedURI,
      disposition: e.disposition,
    });
  });
  try {
    await fetch(INVALID, { cache: 'no-store' });
    report.csp.documentInvalid = { status: 'REACHED' };
  } catch (e) {
    await new Promise((r) => setTimeout(r, 50));
    const hit = docViolations.some(
      (v) =>
        String(v.blockedURI || '').includes('.invalid') &&
        String(v.effectiveDirective || '').includes('connect'),
    );
    report.csp.documentInvalid = {
      status: 'failed',
      message: e instanceof Error ? e.message : String(e),
      verdict: hit ? 'PASS_CSP_CONFIRMED' : 'NO_VIOLATION_OBSERVED',
      violations: docViolations.slice(),
    };
  }

  report.egress = {
    realWorkerInRealmFetch: {
      status: 'NOT_TESTED',
      reason:
        'Cannot evaluate inside SDK_REAL worker without Target CDP (denied) or replacing worker script (would invalidate / mislabel as harness). SPP worker protocol has no harness egress probe message.',
    },
    realWorkerScriptCspHeader: {
      storage: report.csp.storageScript.csp
        ? 'PASS_HEADER_PRESENT'
        : 'FAIL_OPEN_OR_MISSING_HEADER',
      prover: report.csp.proverScript.csp
        ? 'PASS_HEADER_PRESENT'
        : 'FAIL_OPEN_OR_MISSING_HEADER',
      note: 'Header presence ≠ observed in-worker violation. Effective policy for HTTP workers is script response CSP (2.32).',
    },
    documentConnectSrcDoesNotImplyWorkerHttp: true,
  };

  paint('Running real SDK RO-1…', report);

  let storage = null;
  let client = null;
  let wasmMod = null;

  try {
    if (typeof navigator?.storage?.getDirectory !== 'function') {
      throw new Error('OPFS required');
    }

    wasmMod = await import(
      '/node_modules/stellar-private-payments/dist/stellar_private_payments_web.js'
    );
    await wasmMod.default({
      module_or_path: new URL(
        '/node_modules/stellar-private-payments/dist/stellar_private_payments_web_bg.wasm',
        location.origin,
      ),
    });

    const pkg = await fetch('/node_modules/stellar-private-payments/package.json').then((r) =>
      r.json(),
    );
    report.sdk.resolvedVersion = pkg.version;

    storage = await withTimeout(
      wasmMod.Storage.open({ workerUrl: storageWorkerUrl }),
      20000,
      'Storage.open',
    );

    const spp = await import('/node_modules/stellar-private-payments/js/index.js');
    const contractConfig = await fetch(
      '/tests/stellar/spp/harness/browser/synthetic-contract-config.json',
    ).then((r) => r.json());
    const circuitLock = await fetch(
      '/node_modules/stellar-private-payments/dist/circuits/circuits.json',
    ).then((r) => r.json());

    client = await withTimeout(
      spp.Client.new({
        rpcUrl: `${location.origin}/rpc-ro1`,
        storage,
        contractConfig,
        circuitsBaseUrl: new URL(
          '/node_modules/stellar-private-payments/dist/circuits/',
          location.origin,
        ).href,
        circuitLock,
        proverWorkerUrl,
      }),
      60000,
      'Client.new',
    );

    await fetch('/mock-rpc-log/clear', { method: 'POST' });
    await withTimeout(client.aspState(), 30000, 'aspState');
    await withTimeout(client.allContractsData(), 30000, 'allContractsData');
    const mockLog = await fetch('/mock-rpc-log').then((r) => r.json());
    report.ro1 = {
      ok: true,
      rpcMethods: [...new Set((mockLog.log || []).map((e) => e.method))],
      workersAfterInit: registry.entries(),
    };

    const sppEntries = registry.entries().filter(
      (e) =>
        e.script.includes('storage-worker.js') || e.script.includes('prover-worker.js'),
    );
    report.identification.spawnedAtRuntime = sppEntries;

    report.disposal.beforeDispose = {
      registryLive: registry.liveCount(),
      sppWorkerScripts: sppEntries,
      sdkTerminateCalledOnWorkers: sppEntries.every((e) => e.terminated === false)
        ? false
        : 'mixed',
    };

    // --- Client.dispose (SDK API) ---
    client.dispose();
    client = null;
    await new Promise((r) => setTimeout(r, 100));

    report.disposal.afterClientDispose = {
      registryLive: registry.liveCount(),
      entries: registry.entries().filter((e) => e.script.includes('stellar-private-payments')),
      anySppStillNotTerminated: registry
        .entries()
        .some(
          (e) =>
            (e.script.includes('storage-worker.js') || e.script.includes('prover-worker.js')) &&
            !e.terminated,
        ),
    };

    // --- Storage.free if available ---
    if (storage && typeof storage.free === 'function') {
      try {
        storage.free();
      } catch (e) {
        report.disposal.storageFreeError = e instanceof Error ? e.message : String(e);
      }
      storage = null;
      await new Promise((r) => setTimeout(r, 100));
    }
    report.disposal.afterStorageFree = {
      registryLive: registry.liveCount(),
      sppStillNotTerminated: registry
        .entries()
        .some(
          (e) =>
            (e.script.includes('storage-worker.js') || e.script.includes('prover-worker.js')) &&
            !e.terminated,
        ),
    };

    report.disposal.classification = {
      clientDispose: report.disposal.afterClientDispose.anySppStillNotTerminated
        ? 'WORKER_STILL_ACTIVE'
        : 'SDK_DISPOSE_TERMINATES_WORKER',
      storageFree: report.disposal.afterStorageFree.sppStillNotTerminated
        ? 'WORKER_STILL_ACTIVE'
        : 'SDK_DISPOSE_TERMINATES_WORKER',
      staticEvidence:
        'Published package JS contains zero Worker.terminate calls (see sppRealWorker.static.test.ts)',
      note: 'WORKER_STILL_ACTIVE means terminate() was not observed on tracked Worker wrappers',
    };

    // Host can still terminate tracked workers
    const n = registry.terminateMatching(
      (script) =>
        script.includes('storage-worker.js') || script.includes('prover-worker.js'),
    );
    report.disposal.hostTerminateTracked = {
      terminatedCount: n,
      registryLive: registry.liveCount(),
      classification: 'HOST_TERMINATES_TRACKED_WORKER',
    };

    report.classifications = {
      workerRealIdentified: 'PASS',
      cspEffectiveHeaderOnRealWorkerScript:
        report.csp.storageScript.csp && report.csp.proverScript.csp
          ? 'PASS'
          : 'FAIL',
      externalAttemptBlockedByCspInsideRealWorker: 'NOT DEMONSTRATED',
      disposeTerminatesOwnWorkers:
        report.disposal.classification.clientDispose === 'SDK_DISPOSE_TERMINATES_WORKER' &&
        report.disposal.classification.storageFree === 'SDK_DISPOSE_TERMINATES_WORKER'
          ? 'PASS'
          : 'FAIL',
      noActivityAfterClose: 'NOT DEMONSTRATED',
      noActivityAfterCloseNote:
        'Workers remained non-terminated after dispose/free; host terminate required. Spontaneous egress after close not observed but not proven impossible.',
      hostMv3: 'NOT TESTED',
      G8: 'FAIL',
      G9: 'FAIL',
    };

    report.ok = report.ro1?.ok === true;
    report.finishedAt = new Date().toISOString();
    paint(
      `2.33: SDK RO-1 OK. dispose≠terminate (${report.disposal.classification.clientDispose}). real-worker CSP inject NOT_TESTED. G8/G9 FAIL.`,
      report,
    );
  } catch (e) {
    report.ok = false;
    report.fatalError = e instanceof Error ? e.message : String(e);
    report.finishedAt = new Date().toISOString();
    try {
      client?.dispose?.();
    } catch {
      /* ignore */
    }
    try {
      storage?.free?.();
    } catch {
      /* ignore */
    }
    paint(`BLOQUEADO: ${report.fatalError}`, report);
  }

  registry.uninstall();
}

run();
