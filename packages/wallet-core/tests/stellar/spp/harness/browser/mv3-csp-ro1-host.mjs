/**
 * Fase 2.35 — MV3-CSP-equivalent document host twin (HTTP harness).
 *
 * NOT chrome-extension://. Validates RO-1 + host containment under a CSP
 * string aligned with proposed MV3 extension_pages policy.
 * Service worker is not in this realm (SDK runs only in the document).
 */

import { createHostContainment } from './hostWorkerContainment.mjs';
import { Ro1BrokerStandalone, createFakeRo1Backend } from './ro1-broker.standalone.mjs';

function paint(status, report) {
  document.getElementById('status').textContent = status;
  document.getElementById('report').textContent = JSON.stringify(report, null, 2);
  window.__SPP_MV3_CSP_RO1__ = report;
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

async function initWasm() {
  const wasmMod = await import(
    '/node_modules/stellar-private-payments/dist/stellar_private_payments_web.js'
  );
  await wasmMod.default({
    module_or_path: new URL(
      '/node_modules/stellar-private-payments/dist/stellar_private_payments_web_bg.wasm',
      location.origin,
    ),
  });
  return wasmMod;
}

async function runRo1Full(host) {
  const storageWorkerUrl = new URL(
    '/node_modules/stellar-private-payments/dist/workers/storage-worker.js',
    location.origin,
  ).href;
  const proverWorkerUrl = new URL(
    '/node_modules/stellar-private-payments/dist/workers/prover-worker.js',
    location.origin,
  ).href;

  const wasmMod = await initWasm();
  const storage = await withTimeout(
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

  const client = await withTimeout(
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
  const asp = await withTimeout(client.aspState(), 30000, 'aspState');
  const all = await withTimeout(client.allContractsData(), 30000, 'allContractsData');
  const mockLog = await fetch('/mock-rpc-log').then((r) => r.json());
  const methods = (mockLog.log || []).map((e) => e.method);
  return { storage, client, asp, all, methods, mockLog };
}

async function probeDocumentCsp() {
  const violations = [];
  const onViol = (e) => {
    violations.push({
      blockedURI: e.blockedURI,
      violatedDirective: e.violatedDirective,
      effectiveDirective: e.effectiveDirective,
    });
  };
  document.addEventListener('securitypolicyviolation', onViol);

  let fetchResult = { kind: 'unknown' };
  try {
    await fetch('https://example.invalid/', { mode: 'no-cors' });
    fetchResult = { kind: 'completed_without_throw', note: 'no-cors may opaque; check CSP event' };
  } catch (e) {
    fetchResult = {
      kind: 'threw',
      message: e instanceof Error ? e.message : String(e),
    };
  }

  // Brief wait for CSP event
  await new Promise((r) => setTimeout(r, 200));
  document.removeEventListener('securitypolicyviolation', onViol);

  const cspAttributed = violations.some(
    (v) =>
      /connect/i.test(v.violatedDirective || '') ||
      /connect/i.test(v.effectiveDirective || '') ||
      String(v.blockedURI || '').includes('.invalid'),
  );

  return {
    target: 'https://example.invalid/',
    fetchResult,
    violations,
    documentCspBlock: cspAttributed ? 'PASS_CSP_CONFIRMED' : 'NOT DEMONSTRATED',
    note: 'DNS/timeout alone ≠ CSP. Only securitypolicyviolation / explicit CSP error counts.',
  };
}

async function fetchWorkerScriptCspHeaders() {
  const paths = [
    '/node_modules/stellar-private-payments/dist/workers/storage-worker.js',
    '/node_modules/stellar-private-payments/dist/workers/prover-worker.js',
  ];
  const out = [];
  for (const p of paths) {
    const res = await fetch(p, { method: 'GET' });
    out.push({
      path: p,
      status: res.status,
      csp: res.headers.get('content-security-policy'),
    });
  }
  return out;
}

async function run() {
  const report = {
    phase: '2.35',
    kind: 'mv3-csp-equivalent-ro1-document-host',
    notWalletIntegration: true,
    notChromeExtensionUnpack: true,
    architecture: {
      choice: 'dedicated_document_host',
      rejectedServiceWorkerRuntime: true,
      offscreen: 'NOT USED — production extension has no offscreen permission; spike uses dedicated page',
      sdkRealm: 'document',
      serviceWorkerRole: 'none_in_this_twin (extension spike SW is thin broker only)',
    },
    gates: { G8: 'FAIL', G9: 'FAIL' },
    startedAt: new Date().toISOString(),
    browser: { userAgent: navigator.userAgent },
    sdk: { package: 'stellar-private-payments', expectedVersion: '0.2.1' },
    vaultAccess: false,
    keysAccess: false,
    signingWired: false,
    scenarios: {},
    csp: {},
  };

  paint('Probing CSP…', report);

  report.csp.documentMeta =
    document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || null;
  report.csp.workerScriptHeaders = await fetchWorkerScriptCspHeaders();
  report.csp.documentNegative = await probeDocumentCsp();

  // Page fetch to .invalid under CSP — workers' in-realm egress remains separate
  report.csp.realWorkerInRealmEgress = {
    status: 'NOT DEMONSTRATED',
    note: 'Prior 2.33: CDP Target attach denied; cannot inject probe into SDK_REAL worker without replacing script',
  };

  paint('RO-1 + containment under MV3-like CSP…', report);

  // A: close before init
  {
    const broker = new Ro1BrokerStandalone(createFakeRo1Backend());
    const host = createHostContainment({ broker });
    const r = host.emergencyClose('before_init');
    let constructDenied = false;
    try {
      new Worker(
        new URL(
          '/node_modules/stellar-private-payments/dist/workers/storage-worker.js',
          location.origin,
        ).href,
        { type: 'module' },
      );
    } catch (e) {
      constructDenied = /HOST_CLOSED/.test(e instanceof Error ? e.message : String(e));
    }
    const late = await host.dispatch(
      broker.buildRequest(host.sessionId, 'Client.aspState', {}),
    );
    report.scenarios.closeBeforeInit = {
      closeOk: r.ok,
      constructDenied,
      lateCode: late.response?.error?.code,
      verdict:
        r.ok && constructDenied && late.response?.error?.code === 'HOST_CLOSED'
          ? 'PASS'
          : 'FAIL',
    };
    host.uninstall();
  }

  // B: full RO-1 then close
  {
    const broker = new Ro1BrokerStandalone(createFakeRo1Backend());
    const host = createHostContainment({ broker });
    report.realmCoverage = host.realmCoverage;
    try {
      const ro1 = await runRo1Full(host);
      const pkg = await fetch('/node_modules/stellar-private-payments/package.json').then((r) =>
        r.json(),
      );
      report.sdk.resolvedVersion = pkg.version;
      report.rpc = {
        methodsObserved: [...new Set(ro1.methods)],
        onlyGetLedgerEntries:
          ro1.methods.length > 0 && ro1.methods.every((m) => m === 'getLedgerEntries'),
        log: ro1.mockLog.log || [],
      };
      report.stages = {
        aspState: { ok: true, keys: Object.keys(ro1.asp || {}).slice(0, 12) },
        allContractsData: {
          ok: true,
          poolCount: Array.isArray(ro1.all?.pools) ? ro1.all.pools.length : null,
        },
      };

      const before = host.snapshot().filter((e) => e.class === 'SDK_REAL');
      try {
        ro1.client.dispose();
      } catch {
        /* ignore */
      }
      const afterDisposeLive = host
        .snapshot()
        .filter((e) => e.class === 'SDK_REAL' && !e.terminated);
      const close = host.emergencyClose('after_ro1');
      const close2 = host.emergencyClose('repeat');
      const reuse = await host.dispatch(
        broker.buildRequest(host.sessionId, 'Client.aspState', {}),
      );
      let lateConstruct = false;
      try {
        new Worker(
          new URL(
            '/node_modules/stellar-private-payments/dist/workers/storage-worker.js',
            location.origin,
          ).href,
          { type: 'module' },
        );
      } catch (e) {
        lateConstruct = /HOST_CLOSED/.test(e instanceof Error ? e.message : String(e));
      }

      report.scenarios.closeAfterRo1 = {
        sdkRealRegistered: before.length,
        sdkRealScripts: before.map((e) => e.script.split('/').pop()),
        stillLiveAfterDispose: afterDisposeLive.length,
        hostTerminatedNow: close.terminatedNow,
        allTerminated: close.snapshot
          .filter((e) => e.class === 'SDK_REAL')
          .every((e) => e.terminated && e.terminateCalls >= 1),
        idempotentRepeat: close2.idempotent === true,
        reuseCode: reuse.response?.error?.code,
        lateConstructDenied: lateConstruct,
        verdict:
          before.length >= 2 &&
          afterDisposeLive.length > 0 &&
          close.ok &&
          close2.idempotent &&
          reuse.response?.error?.code === 'HOST_CLOSED' &&
          lateConstruct &&
          report.rpc.onlyGetLedgerEntries
            ? 'PASS'
            : 'FAIL',
      };
    } catch (e) {
      report.scenarios.closeAfterRo1 = {
        verdict: 'FAIL',
        error: e instanceof Error ? e.message : String(e),
        snapshot: host.snapshot(),
      };
    }
    host.uninstall();
  }

  // C: close with pending RO-1 (during Client.new)
  {
    const broker = new Ro1BrokerStandalone(createFakeRo1Backend());
    const host = createHostContainment({ broker });
    try {
      const wasmMod = await initWasm();
      const storage = await wasmMod.Storage.open({
        workerUrl: new URL(
          '/node_modules/stellar-private-payments/dist/workers/storage-worker.js',
          location.origin,
        ).href,
      });
      const spp = await import('/node_modules/stellar-private-payments/js/index.js');
      const contractConfig = await fetch(
        '/tests/stellar/spp/harness/browser/synthetic-contract-config.json',
      ).then((r) => r.json());
      const circuitLock = await fetch(
        '/node_modules/stellar-private-payments/dist/circuits/circuits.json',
      ).then((r) => r.json());
      const clientP = spp.Client.new({
        rpcUrl: `${location.origin}/rpc-ro1`,
        storage,
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
      const mid = host.emergencyClose('pending_ro1');
      let clientErr = null;
      try {
        await clientP;
      } catch (e) {
        clientErr = e instanceof Error ? e.message : String(e);
      }
      const sdk = host.snapshot().filter((e) => e.class === 'SDK_REAL');
      report.scenarios.closePendingRo1 = {
        midOk: mid.ok,
        clientErr,
        sdkTerminated: sdk.every((e) => e.terminated),
        sdkCount: sdk.length,
        verdict: mid.ok && sdk.length >= 1 && sdk.every((e) => e.terminated) ? 'PASS' : 'FAIL',
      };
    } catch (e) {
      report.scenarios.closePendingRo1 = {
        verdict: 'FAIL',
        error: e instanceof Error ? e.message : String(e),
      };
    }
    host.uninstall();
  }

  // D: init failure path
  {
    const broker = new Ro1BrokerStandalone(createFakeRo1Backend());
    const host = createHostContainment({ broker });
    let initErr = null;
    try {
      const wasmMod = await initWasm();
      await wasmMod.Storage.open({
        workerUrl: new URL(
          '/node_modules/stellar-private-payments/dist/workers/storage-worker.js',
          location.origin,
        ).href,
      });
      const spp = await import('/node_modules/stellar-private-payments/js/index.js');
      await spp.Client.new({
        rpcUrl: `${location.origin}/rpc-DENIED-NOT-RO1`,
        storage: {},
        contractConfig: {},
        circuitsBaseUrl: location.origin + '/',
        circuitLock: {},
        proverWorkerUrl: new URL(
          '/node_modules/stellar-private-payments/dist/workers/prover-worker.js',
          location.origin,
        ).href,
      });
    } catch (e) {
      initErr = e instanceof Error ? e.message : String(e);
    }
    const close = host.emergencyClose('after_init_failure');
    report.scenarios.initFailure = {
      initErr: initErr ? initErr.slice(0, 200) : null,
      closeOk: close.ok,
      verdict: initErr && close.ok ? 'PASS' : 'FAIL',
    };
    host.uninstall();
  }

  // E: unregistered worker via OrigWorker
  {
    const host = createHostContainment({ sessionId: 'unreg' });
    const Orig = host.OrigWorker;
    const orphan = new Orig(
      new URL(
        '/node_modules/stellar-private-payments/dist/workers/storage-worker.js',
        location.origin,
      ).href,
      { type: 'module' },
    );
    const registered = host.snapshot().length;
    orphan.terminate();
    host.emergencyClose('cleanup');
    host.uninstall();
    report.scenarios.unregisteredOutsideHost = {
      registryCountWhileOrphanAlive: registered,
      hostDidNotSeeOrphan: registered === 0,
      verdict: registered === 0 ? 'PASS' : 'FAIL',
      note: 'Worker outside registry cannot be terminated by host emergencyClose',
    };
  }

  report.scenarios.nestedWorkersOutsideHostRegistry = {
    verdict: 'NOT DEMONSTRATED',
    note: 'Nested Worker inside DedicatedWorker realm not observable from window wrapper',
  };

  report.verdicts = {
    hostMv3RealChromeExtension: 'NOT DEMONSTRATED',
    sessionRo1OutsideServiceWorker: 'PASS',
    rpcAllowlistOnly: report.rpc?.onlyGetLedgerEntries ? 'PASS' : 'FAIL',
    workersRegisteredAndTerminable:
      report.scenarios.closeAfterRo1?.verdict === 'PASS' ? 'PASS' : 'FAIL',
    egressCspOnRealWorkers: 'NOT DEMONSTRATED',
    noActivityAfterClose: 'NOT DEMONSTRATED',
    noKeysOrSigning: 'PASS',
    G8: 'FAIL',
    G9: 'FAIL',
  };

  report.ok =
    report.scenarios.closeBeforeInit?.verdict === 'PASS' &&
    report.scenarios.closeAfterRo1?.verdict === 'PASS' &&
    report.scenarios.closePendingRo1?.verdict === 'PASS' &&
    report.scenarios.unregisteredOutsideHost?.verdict === 'PASS';

  report.finishedAt = new Date().toISOString();
  paint(
    report.ok
      ? '2.35 MV3-CSP twin: RO-1 + containment PASS. chrome-extension:// / worker CSP egress / post-close activity NOT DEMONSTRATED. G8/G9 FAIL.'
      : '2.35 MV3-CSP twin incomplete — see scenarios. G8/G9 FAIL.',
    report,
  );
}

run().catch((e) => {
  paint('Fatal: ' + (e && e.message ? e.message : String(e)), {
    ok: false,
    error: String(e),
    gates: { G8: 'FAIL', G9: 'FAIL' },
  });
});
