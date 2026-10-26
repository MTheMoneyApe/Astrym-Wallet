/**
 * Fase 2.34 — Browser scenarios: host containment of real SPP workers.
 * RO-1 only. No Testnet. CSP egress remains NOT DEMONSTRATED (separate control).
 */

import { createHostContainment } from './hostWorkerContainment.mjs';
import { Ro1BrokerStandalone, createFakeRo1Backend } from './ro1-broker.standalone.mjs';

function paint(status, report) {
  document.getElementById('status').textContent = status;
  document.getElementById('report').textContent = JSON.stringify(report, null, 2);
  window.__SPP_HOST_CONTAINMENT__ = report;
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

async function runRo1(host, { pendingGate } = {}) {
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

  if (pendingGate) {
    // Signal that workers exist; caller may emergencyClose while we continue
    pendingGate.workersSpawned?.(host.snapshot());
  }

  const spp = await import('/node_modules/stellar-private-payments/js/index.js');
  const contractConfig = await fetch(
    '/tests/stellar/spp/harness/browser/synthetic-contract-config.json',
  ).then((r) => r.json());
  const circuitLock = await fetch(
    '/node_modules/stellar-private-payments/dist/circuits/circuits.json',
  ).then((r) => r.json());

  const clientPromise = spp.Client.new({
    rpcUrl: `${location.origin}/rpc-ro1`,
    storage,
    contractConfig,
    circuitsBaseUrl: new URL(
      '/node_modules/stellar-private-payments/dist/circuits/',
      location.origin,
    ).href,
    circuitLock,
    proverWorkerUrl,
  });

  if (pendingGate?.closeDuringClientNew) {
    pendingGate.closeDuringClientNew();
  }

  const client = await withTimeout(clientPromise, 60000, 'Client.new');

  if (pendingGate?.closeBeforeRo1Ops) {
    pendingGate.closeBeforeRo1Ops();
  }

  await fetch('/mock-rpc-log/clear', { method: 'POST' });
  const asp = await withTimeout(client.aspState(), 30000, 'aspState');
  const all = await withTimeout(client.allContractsData(), 30000, 'allContractsData');
  return { storage, client, asp, all };
}

async function run() {
  const report = {
    phase: '2.34',
    kind: 'host-worker-containment',
    notWalletIntegration: true,
    gates: { G8: 'FAIL', G9: 'FAIL' },
    startedAt: new Date().toISOString(),
    browser: { userAgent: navigator.userAgent },
    sdk: { package: 'stellar-private-payments', expectedVersion: '0.2.1' },
    cspEgress: {
      status: 'NOT DEMONSTRATED',
      note: 'Lifecycle containment ≠ CSP egress (2.33). No public network probes.',
    },
    scenarios: {},
    realmCoverage: null,
  };

  paint('Scenario A: close before workers…', report);

  // --- A: close before creating workers ---
  {
    const broker = new Ro1BrokerStandalone(createFakeRo1Backend());
    const host = createHostContainment({ broker });
    report.realmCoverage = host.realmCoverage;
    const r = host.emergencyClose('before_workers');
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
      broker.buildRequest(host.sessionId, 'Storage.open', {}),
    );
    report.scenarios.closeBeforeWorkers = {
      closeOk: r.ok,
      terminatedNow: r.terminatedNow,
      constructDenied,
      lateDispatchCode: late.response?.error?.code,
      verdict:
        r.ok && constructDenied && late.response?.error?.code === 'HOST_CLOSED'
          ? 'PASS'
          : 'FAIL',
    };
    host.uninstall();
  }

  paint('Scenario B: close after SDK init (real workers)…', report);

  // --- B: close after SDK init ---
  {
    const broker = new Ro1BrokerStandalone(createFakeRo1Backend());
    const host = createHostContainment({ broker });
    let client;
    let storage;
    try {
      const ro1 = await runRo1(host);
      client = ro1.client;
      storage = ro1.storage;
      const pkg = await fetch('/node_modules/stellar-private-payments/package.json').then((r) =>
        r.json(),
      );
      report.sdk.resolvedVersion = pkg.version;

      const before = host.snapshot().filter((e) => e.class === 'SDK_REAL');
      // dispose first (2.33: leaves workers alive) then host emergencyClose
      try {
        client.dispose();
      } catch {
        /* ignore */
      }
      try {
        storage.free();
      } catch {
        /* ignore */
      }
      const afterDispose = host.snapshot().filter((e) => e.class === 'SDK_REAL');
      const stillLiveAfterDispose = afterDispose.some((e) => !e.terminated);

      const close = host.emergencyClose('after_init_and_dispose');
      const afterClose = host.snapshot().filter((e) => e.class === 'SDK_REAL');
      const allTerminated = afterClose.every((e) => e.terminated && e.terminateCalls >= 1);

      const reuse = await host.dispatch(
        broker.buildRequest(host.sessionId, 'Client.aspState', {}),
      );

      report.scenarios.closeAfterInit = {
        sdkRealBefore: before,
        stillLiveAfterDispose,
        close,
        afterClose,
        allSdkRealTerminated: allTerminated,
        reuseCode: reuse.response?.error?.code,
        verdict:
          before.length >= 2 &&
          stillLiveAfterDispose &&
          close.ok &&
          allTerminated &&
          reuse.response?.error?.code === 'HOST_CLOSED'
            ? 'PASS'
            : 'FAIL',
      };
    } catch (e) {
      report.scenarios.closeAfterInit = {
        verdict: 'FAIL',
        error: e instanceof Error ? e.message : String(e),
        snapshot: host.snapshot(),
      };
    }
    host.uninstall();
  }

  paint('Scenario C: close during Client.new…', report);

  // --- C: close while Client.new pending (after Storage.open spawned storage worker) ---
  {
    const broker = new Ro1BrokerStandalone(createFakeRo1Backend());
    const host = createHostContainment({ broker });
    try {
      const storageWorkerUrl = new URL(
        '/node_modules/stellar-private-payments/dist/workers/storage-worker.js',
        location.origin,
      ).href;
      const proverWorkerUrl = new URL(
        '/node_modules/stellar-private-payments/dist/workers/prover-worker.js',
        location.origin,
      ).href;
      const wasmMod = await initWasm();
      const storage = await wasmMod.Storage.open({ workerUrl: storageWorkerUrl });
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
        proverWorkerUrl,
      });

      // Close as soon as storage worker exists; Client.new may still be spawning prover
      const mid = host.emergencyClose('during_client_new');
      let clientErr = null;
      try {
        await clientP;
      } catch (e) {
        clientErr = e instanceof Error ? e.message : String(e);
      }

      const sdkEntries = host.snapshot().filter((e) => e.class === 'SDK_REAL');
      report.scenarios.closeDuringClientNew = {
        midClose: mid,
        clientErr,
        sdkEntries,
        allTerminated: sdkEntries.every((e) => e.terminated),
        verdict: mid.ok && sdkEntries.length >= 1 && sdkEntries.every((e) => e.terminated)
          ? 'PASS'
          : 'FAIL',
      };
    } catch (e) {
      report.scenarios.closeDuringClientNew = {
        verdict: 'FAIL',
        error: e instanceof Error ? e.message : String(e),
      };
    }
    host.uninstall();
  }

  paint('Scenario D: late messages + repeat close…', report);

  // --- D: late dispatch + repeat close (fake broker path after B-style session) ---
  {
    const broker = new Ro1BrokerStandalone(createFakeRo1Backend());
    const host = createHostContainment({ broker });
    // spawn one real storage worker only
    try {
      const wasmMod = await initWasm();
      await wasmMod.Storage.open({
        workerUrl: new URL(
          '/node_modules/stellar-private-payments/dist/workers/storage-worker.js',
          location.origin,
        ).href,
      });
    } catch (e) {
      report.scenarios.lateAndRepeat = {
        verdict: 'FAIL',
        error: e instanceof Error ? e.message : String(e),
      };
      host.uninstall();
      // continue to final paint
    }

    if (!report.scenarios.lateAndRepeat) {
      const c1 = host.emergencyClose('late_test');
      const c2 = host.emergencyClose('late_test_repeat');
      const late1 = await host.dispatch(
        broker.buildRequest(host.sessionId, 'Storage.open', {}),
      );
      const late2 = await host.dispatch(
        broker.buildRequest(host.sessionId, 'Client.aspState', {}),
      );
      report.scenarios.lateAndRepeat = {
        firstClose: { ok: c1.ok, terminatedNow: c1.terminatedNow },
        secondCloseIdempotent: c2.idempotent === true,
        lateCodes: [late1.response?.error?.code, late2.response?.error?.code],
        snapshot: host.snapshot().filter((e) => e.class === 'SDK_REAL'),
        verdict:
          c1.ok &&
          c2.idempotent &&
          late1.response?.error?.code === 'HOST_CLOSED' &&
          late2.response?.error?.code === 'HOST_CLOSED'
            ? 'PASS'
            : 'FAIL',
      };
      host.uninstall();
    }
  }

  // --- E: unregistered worker limitation (document nested realm) ---
  report.scenarios.unregisteredNestedWorkers = {
    verdict: 'NOT DEMONSTRATED',
    note: 'If storage/prover modules spawn nested Workers, window.Worker wrapper cannot see them. SPP 0.2.1 entries use top-level Worker from page realm for storage/prover scripts (observed). Nested = out of scope.',
  };

  report.verdicts = {
    registerRelevantSdkWorkers:
      report.scenarios.closeAfterInit?.sdkRealBefore?.length >= 2 ? 'PASS' : 'FAIL',
    hostTerminatesRealWorkersOwned:
      report.scenarios.closeAfterInit?.verdict === 'PASS' ? 'PASS' : 'FAIL',
    noOpsAfterClose:
      report.scenarios.lateAndRepeat?.verdict === 'PASS' &&
      report.scenarios.closeBeforeWorkers?.verdict === 'PASS'
        ? 'PASS'
        : 'FAIL',
    noActivityAfterClose: 'NOT DEMONSTRATED',
    noActivityAfterCloseNote:
      'terminate() observed on tracked SDK_REAL workers; spontaneous post-close egress / nested activity not proven absent',
    cspBlocksRealWorkerEgress: 'NOT DEMONSTRATED',
    hostMv3: 'NOT TESTED',
    G8: 'FAIL',
    G9: 'FAIL',
  };

  report.ok =
    report.scenarios.closeBeforeWorkers?.verdict === 'PASS' &&
    report.scenarios.closeAfterInit?.verdict === 'PASS' &&
    report.scenarios.closeDuringClientNew?.verdict === 'PASS' &&
    report.scenarios.lateAndRepeat?.verdict === 'PASS';

  report.finishedAt = new Date().toISOString();
  paint(
    report.ok
      ? '2.34: host containment PASS on tracked SDK_REAL workers. CSP egress / MV3 / post-close activity NOT DEMONSTRATED. G8/G9 FAIL.'
      : '2.34 incomplete — see scenarios. G8/G9 FAIL.',
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
