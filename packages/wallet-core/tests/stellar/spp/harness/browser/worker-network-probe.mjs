/**
 * Fase 2.30 — Page driver for worker network probe + CSP observation.
 * Local harness URLs only. No public domains.
 */

function paint(status, report) {
  const statusEl = document.getElementById('status');
  const reportEl = document.getElementById('report');
  if (statusEl) statusEl.textContent = status;
  if (reportEl) reportEl.textContent = JSON.stringify(report, null, 2);
  window.__SPP_WORKER_PROBE__ = report;
}

function cspFromMeta() {
  const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
  return meta ? meta.getAttribute('content') : null;
}

async function run() {
  const report = {
    phase: '2.30',
    kind: 'worker-network-probe + CSP draft',
    notWalletIntegration: true,
    gates: { G8: 'FAIL', G9: 'FAIL' },
    startedAt: new Date().toISOString(),
    document: {
      url: location.href,
      origin: location.origin,
      cspMeta: cspFromMeta(),
    },
    page: {
      fetchAvailable: typeof fetch === 'function',
      workerAvailable: typeof Worker === 'function',
    },
    workerLifecycle: {},
    workerNetwork: null,
    pageLocalFetch: null,
    classification: {},
    limitations: [
      'Page fetch guard does not apply inside DedicatedWorker',
      'No public-domain probes performed (by design)',
      'Absence of external requests ≠ external blocked',
      'WASM/reqwest channels not covered by this probe',
      'MV3 extension CSP/host_permissions differ from this document meta CSP',
    ],
  };

  paint('Running…', report);

  const localUrls = [
    new URL('/mock-rpc-log', location.origin).href,
    new URL('/tests/stellar/spp/harness/browser/fase-2.30-probe.css', location.origin).href,
  ];

  // Page-level local fetch (control)
  try {
    const res = await fetch(localUrls[0], { cache: 'no-store' });
    report.pageLocalFetch = {
      status: 'observed_local',
      http: res.status,
      url: localUrls[0],
    };
  } catch (e) {
    report.pageLocalFetch = {
      status: 'failed',
      message: e instanceof Error ? e.message : String(e),
    };
  }

  if (typeof Worker !== 'function') {
    report.workerLifecycle = { status: 'NO DEMOSTRADO', reason: 'Worker API unavailable' };
    report.classification.workerNetwork = 'NO DEMOSTRADO';
    report.ok = false;
    paint('Worker API unavailable', report);
    return;
  }

  const workerUrl = new URL('./worker-network-probe.worker.js', import.meta.url).href;
  let worker;
  try {
    worker = new Worker(workerUrl);
    report.workerLifecycle.created = true;
    report.workerLifecycle.script = workerUrl;
  } catch (e) {
    report.workerLifecycle = {
      status: 'failed',
      message: e instanceof Error ? e.message : String(e),
      note: 'May indicate CSP worker-src violation',
    };
    report.classification.workerCreate = 'FAIL';
    report.ok = false;
    paint('Worker create failed (check CSP)', report);
    return;
  }

  const workerReport = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ timeout: true, message: 'worker probe timed out' });
    }, 10000);
    worker.onmessage = (ev) => {
      clearTimeout(timer);
      resolve(ev.data);
    };
    worker.onerror = (err) => {
      clearTimeout(timer);
      resolve({
        error: true,
        message: err && err.message ? err.message : 'worker error',
      });
    };
    worker.postMessage({ localUrls });
  });

  report.workerNetwork = workerReport;
  try {
    worker.terminate();
    report.workerLifecycle.terminated = true;
  } catch {
    report.workerLifecycle.terminated = false;
  }

  // Classification (honest)
  const localObserved =
    workerReport &&
    Array.isArray(workerReport.results) &&
    workerReport.results.some(
      (r) =>
        (r.fetch && r.fetch.status === 'observed_local') ||
        (r.xhr && r.xhr.status === 'observed_local'),
    );

  report.classification = {
    workerFetchMechanism: workerReport?.fetchAvailable
      ? 'available'
      : workerReport?.fetchAvailable === false
        ? 'unavailable'
        : 'NO DEMOSTRADO',
    workerLocalAttempt: localObserved ? 'observed_local' : 'NO DEMOSTRADO',
    workerExternalBlockedByVerifiedPolicy: 'NO DEMOSTRADO',
    reasonExternal:
      'Not probed: phase forbids public-domain attempts; CSP connect-src self is present but external block not evidenced by a verified denied attempt',
    pageGuardAppliesToWorker: false,
    cspDraftPresent: Boolean(report.document.cspMeta),
    cspEffectOnWorkerCreate: report.workerLifecycle.created ? 'PASS (worker started)' : 'FAIL',
    cspBlocksAllWasmChannels: 'NO DEMOSTRADO',
  };

  report.ok = Boolean(report.workerLifecycle.created) && localObserved === true;
  report.finishedAt = new Date().toISOString();
  paint(
    report.ok
      ? 'Worker probe OBSERVADO (local only). G8/G9 FAIL.'
      : 'Worker probe incomplete — see report. G8/G9 FAIL.',
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
