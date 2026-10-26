/**
 * Fase 2.32 — DedicatedWorker CSP delivery + negative probes + host-controlled teardown.
 * Does not approve G8/G9. No public network targets (*.invalid only).
 */

import { installWorkerRegistry } from './workerRegistry.mjs';
import { Ro1BrokerStandalone, createFakeRo1Backend } from './ro1-broker.standalone.mjs';

const INVALID = 'https://ro1-csp-probe.invalid/worker-lifecycle';

function paint(status, report) {
  document.getElementById('status').textContent = status;
  document.getElementById('report').textContent = JSON.stringify(report, null, 2);
  window.__SPP_WORKER_LIFECYCLE__ = report;
}

function cspMeta() {
  return document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || null;
}

async function readScriptCspHeader(url) {
  const res = await fetch(url, { cache: 'no-store', method: 'GET' });
  return {
    http: res.status,
    csp: res.headers.get('content-security-policy'),
    contentType: res.headers.get('content-type'),
  };
}

function runWorker(url, options, payload, timeoutMs = 10000) {
  return new Promise((resolve) => {
    let worker;
    try {
      worker = new Worker(url, options);
    } catch (e) {
      resolve({ createError: e instanceof Error ? e.message : String(e) });
      return;
    }
    const timer = setTimeout(() => {
      try {
        worker.terminate();
      } catch {
        /* ignore */
      }
      resolve({ timeout: true });
    }, timeoutMs);
    worker.onmessage = (ev) => {
      clearTimeout(timer);
      resolve({ workerRef: worker, data: ev.data });
    };
    worker.onerror = (err) => {
      clearTimeout(timer);
      resolve({
        workerRef: worker,
        error: err?.message || 'worker error',
      });
    };
    worker.postMessage(payload);
  });
}

async function probeBlobInherited(documentViolations) {
  // blob: workers inherit creator document CSP (HTML / Chromium).
  const src = `
    const INVALID = ${JSON.stringify(INVALID)};
    self.onmessage = async () => {
      const violations = [];
      try {
        self.addEventListener('securitypolicyviolation', (e) => {
          violations.push({
            effectiveDirective: e.effectiveDirective,
            blockedURI: e.blockedURI,
            disposition: e.disposition,
            originalPolicy: e.originalPolicy,
          });
        });
      } catch (e) {}
      let invalid;
      try {
        await fetch(INVALID, { cache: 'no-store' });
        invalid = { status: 'REACHED' };
      } catch (e) {
        invalid = { status: 'failed', message: String(e && e.message || e) };
      }
      await new Promise((r) => setTimeout(r, 100));
      const related = violations.filter((v) =>
        String(v.blockedURI || '').includes('.invalid') ||
        String(v.effectiveDirective || '').includes('connect')
      );
      let verdict = 'NO DEMOSTRADO_CSP';
      if (invalid.status === 'REACHED') verdict = 'FAIL';
      else if (related.length) verdict = 'PASS_CSP_CONFIRMED';
      self.postMessage({ experiment: 'blob-inherit', invalid, violations, classification: { invalid: verdict } });
    };
  `;
  const blob = new Blob([src], { type: 'text/javascript' });
  const blobUrl = URL.createObjectURL(blob);
  const before = documentViolations.length;
  const result = await runWorker(blobUrl, undefined, {});
  URL.revokeObjectURL(blobUrl);
  // Also check document-level violations (some browsers surface there)
  const docRelated = documentViolations.slice(before).filter((v) =>
    String(v.blockedURI || '').includes('.invalid'),
  );
  if (
    result.data?.classification?.invalid !== 'PASS_CSP_CONFIRMED' &&
    docRelated.length > 0
  ) {
    return {
      ...result,
      data: {
        ...result.data,
        classification: {
          invalid: 'PASS_CSP_CONFIRMED',
          policySource: 'blob-inherits-document-csp',
          documentViolations: docRelated,
        },
      },
    };
  }
  return result;
}

async function run() {
  const documentViolations = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    documentViolations.push({
      at: new Date().toISOString(),
      realm: 'document',
      effectiveDirective: e.effectiveDirective,
      blockedURI: e.blockedURI,
      disposition: e.disposition,
      originalPolicy: e.originalPolicy,
    });
  });

  const registry = installWorkerRegistry();
  const report = {
    phase: '2.32',
    kind: 'worker-csp-lifecycle',
    notWalletIntegration: true,
    gates: { G8: 'FAIL', G9: 'FAIL' },
    startedAt: new Date().toISOString(),
    browser: { userAgent: navigator.userAgent },
    cspDocument: { meta: cspMeta() },
    policyModel: {
      dedicatedWorkerHttpScript:
        'CSP from worker script response headers (not creator document) — MDN / Chromium since ~2021',
      blobOrDataWorker: 'Inherits creator document CSP',
      mv3: 'Extension CSP via manifest; not demonstrated on this page',
    },
    experiments: {},
    wasmTransport: {
      binding: '__wbg_fetch → realm fetch',
      mainThreadClient: 'Controlled by document connect-src when Client runs on page',
      sppWorkers: 'Controlled by CSP on worker script response IF header present; fetch in worker realm',
      notCovered: 'Any non-fetch transport (none found in glue); unheadered worker scripts',
    },
    teardown: {},
    documentViolations,
  };

  paint('Running worker CSP experiments…', report);
  const localUrl = new URL('/mock-rpc-log', location.origin).href;

  // --- Headers on probe scripts ---
  report.experiments.headerClassicWithCsp = await readScriptCspHeader(
    new URL('./worker-csp-probe.classic.js', import.meta.url).href,
  );
  report.experiments.headerClassicNoCsp = await readScriptCspHeader(
    new URL('./worker-csp-probe.classic.js?nocsp=1', import.meta.url).href,
  );
  report.experiments.headerModuleWithCsp = await readScriptCspHeader(
    new URL('./worker-csp-probe.module.js', import.meta.url).href,
  );
  report.experiments.headerStorageWorker = await readScriptCspHeader(
    new URL(
      '/node_modules/stellar-private-payments/dist/workers/storage-worker.js',
      location.origin,
    ).href,
  );
  report.experiments.headerProverWorker = await readScriptCspHeader(
    new URL(
      '/node_modules/stellar-private-payments/dist/workers/prover-worker.js',
      location.origin,
    ).href,
  );

  // A) Classic WITH CSP header on script
  {
    const url = new URL('./worker-csp-probe.classic.js', import.meta.url).href;
    const r = await runWorker(url, undefined, {
      experiment: 'classic-with-script-csp',
      localUrl,
    });
    if (r.workerRef) {
      try {
        r.workerRef.terminate();
      } catch {
        /* ignore */
      }
    }
    report.experiments.classicWithScriptCsp = {
      headerPresent: Boolean(report.experiments.headerClassicWithCsp.csp),
      result: r.data || r,
      verdict: r.data?.classification?.invalid || (r.error ? 'NO DEMOSTRADO' : 'NO DEMOSTRADO'),
    };
  }

  // B) Classic WITHOUT CSP header (nocsp=1) — expect NO DEMOSTRADO_CSP (DNS fail likely)
  {
    const url = new URL('./worker-csp-probe.classic.js?nocsp=1', import.meta.url).href;
    const r = await runWorker(url, undefined, {
      experiment: 'classic-without-script-csp',
      localUrl,
    });
    if (r.workerRef) {
      try {
        r.workerRef.terminate();
      } catch {
        /* ignore */
      }
    }
    report.experiments.classicWithoutScriptCsp = {
      headerPresent: Boolean(report.experiments.headerClassicNoCsp.csp),
      result: r.data || r,
      verdict: r.data?.classification?.invalid || 'NO DEMOSTRADO',
      note: 'Control: without script CSP, failure must not be claimed as CSP',
    };
  }

  // C) Module worker WITH CSP
  {
    const url = new URL('./worker-csp-probe.module.js', import.meta.url).href;
    const r = await runWorker(url, { type: 'module' }, {
      experiment: 'module-with-script-csp',
      localUrl,
    });
    if (r.workerRef) {
      try {
        r.workerRef.terminate();
      } catch {
        /* ignore */
      }
    }
    report.experiments.moduleWithScriptCsp = {
      headerPresent: Boolean(report.experiments.headerModuleWithCsp.csp),
      result: r.data || r,
      verdict: r.data?.classification?.invalid || 'NO DEMOSTRADO',
    };
  }

  // D) blob: inherits document CSP
  {
    const r = await probeBlobInherited(documentViolations);
    if (r.workerRef) {
      try {
        r.workerRef.terminate();
      } catch {
        /* ignore */
      }
    }
    report.experiments.blobInheritsDocument = {
      result: r.data || r,
      verdict: r.data?.classification?.invalid || 'NO DEMOSTRADO',
    };
  }

  // E) Real SPP worker scripts — header audit + spawn (no forbidden ops)
  //    Distinct from test workers: we do NOT inject .invalid into SPP worker protocol.
  {
    const storageUrl = new URL(
      '/node_modules/stellar-private-payments/dist/workers/storage-worker.js',
      location.origin,
    ).href;
    let spawn;
    try {
      const w = new Worker(storageUrl, { type: 'module' });
      // Give init a moment; then terminate via host ref (tracked)
      await new Promise((r) => setTimeout(r, 200));
      w.terminate();
      spawn = { ok: true, terminatedByHost: true };
    } catch (e) {
      spawn = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    report.experiments.sppStorageWorker = {
      distinctExperiment: true,
      note: 'Real SPP storage-worker.js — CSP header audit + host terminate only; no .invalid inject into SDK protocol',
      responseCsp: report.experiments.headerStorageWorker.csp,
      cspHeaderPresent: Boolean(report.experiments.headerStorageWorker.csp),
      spawn,
      negativeInject: 'NO DEMOSTRADO',
      negativeInjectNote:
        'Cannot force SDK worker to fetch .invalid without modifying SDK or speaking private worker protocol',
    };
  }

  // --- Session teardown (broker fake + tracked workers) ---
  paint('Session teardown…', report);
  const backend = createFakeRo1Backend();
  const broker = new Ro1BrokerStandalone(backend);
  const sess = broker.openSession();
  await broker.dispatch(broker.buildRequest(sess.sessionId, 'Storage.open', {}));

  // Spawn a controllable probe worker tied to "session"
  const probeUrl = new URL('./worker-csp-probe.classic.js', import.meta.url).href;
  const held = await runWorker(probeUrl, undefined, { experiment: 'held-for-teardown', localUrl });
  const heldWorker = held.workerRef;
  report.teardown.beforeClose = {
    registryLive: registry.liveCount(),
    entries: registry.entries(),
  };

  // Close broker session — does NOT auto-kill workers
  broker.closeSession(sess.sessionId);
  const afterBrokerClose = await broker.dispatch(
    broker.buildRequest(sess.sessionId, 'Client.aspState', {}),
  );
  report.teardown.afterBrokerClose = {
    dispatchOk: afterBrokerClose.ok,
    code: afterBrokerClose.response?.error?.code,
    registryLiveStill: registry.liveCount(),
    note: 'Broker close ≠ worker terminate',
  };

  // Late message to held worker still possible until terminate
  let lateMsg = null;
  if (heldWorker) {
    lateMsg = await new Promise((resolve) => {
      const t = setTimeout(() => resolve({ timeout: true }), 3000);
      heldWorker.onmessage = (ev) => {
        clearTimeout(t);
        resolve({ received: true, verdict: ev.data?.classification?.invalid });
      };
      try {
        heldWorker.postMessage({ experiment: 'post-broker-close', localUrl });
      } catch (e) {
        clearTimeout(t);
        resolve({ error: e instanceof Error ? e.message : String(e) });
      }
    });
  }
  report.teardown.lateWorkerMessageAfterBrokerClose = lateMsg;

  // Host terminate of tracked workers
  const terminated = registry.terminateAll();
  report.teardown.hostTerminateAll = {
    terminatedCount: terminated,
    registryLive: registry.liveCount(),
    verdict: registry.liveCount() === 0 ? 'PASS' : 'FAIL',
  };

  // Reuse closed session
  {
    const reuse = await broker.dispatch(
      broker.buildRequest(sess.sessionId, 'Storage.open', {}),
    );
    report.teardown.reuseClosedSession = {
      ok: reuse.ok,
      code: reuse.response?.error?.code,
    };
  }

  // Init-error close path (handler throw)
  {
    const boom = new Ro1BrokerStandalone({
      async execute() {
        throw new Error('init boom');
      },
    });
    const s2 = boom.openSession();
    const r = await boom.dispatch(boom.buildRequest(s2.sessionId, 'Storage.open', {}));
    const again = await boom.dispatch(boom.buildRequest(s2.sessionId, 'Storage.open', {}));
    report.teardown.closeAfterInitError = {
      ok: r.ok,
      code: r.response?.error?.code,
      subsequentDenied: again.ok === false,
      subsequentCode: again.response?.error?.code,
    };
  }

  // Pending op + close mid-flight
  {
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const slow = new Ro1BrokerStandalone({
      async execute() {
        await gate;
        return { done: true };
      },
    });
    const s3 = slow.openSession();
    const pending = slow.dispatch(slow.buildRequest(s3.sessionId, 'Storage.open', {}));
    slow.closeSession(s3.sessionId);
    release();
    const done = await pending;
    report.teardown.closeDuringPending = {
      ok: done.ok,
      code: done.response?.error?.code,
      expectSessionClosed: done.response?.error?.code === 'SESSION_CLOSED',
    };
  }

  report.gates = { G8: 'FAIL', G9: 'FAIL' };
  report.verdicts = {
    classicWithScriptCsp: report.experiments.classicWithScriptCsp.verdict,
    classicWithoutScriptCsp: report.experiments.classicWithoutScriptCsp.verdict,
    moduleWithScriptCsp: report.experiments.moduleWithScriptCsp.verdict,
    blobInherit: report.experiments.blobInheritsDocument.verdict,
    sppWorkerNegativeInject: 'NO DEMOSTRADO',
    sppWorkerCspHeader: report.experiments.sppStorageWorker.cspHeaderPresent
      ? 'PASS_HEADER_PRESENT'
      : 'FAIL_NO_HEADER',
    hostTerminateTrackedWorkers: report.teardown.hostTerminateAll.verdict,
    brokerCloseRejects: report.teardown.afterBrokerClose.code === 'SESSION_CLOSED' ? 'PASS' : 'FAIL',
    G8: 'FAIL',
    G9: 'FAIL',
  };

  report.ok =
    report.verdicts.classicWithScriptCsp === 'PASS_CSP_CONFIRMED' &&
    report.verdicts.hostTerminateTrackedWorkers === 'PASS' &&
    report.verdicts.brokerCloseRejects === 'PASS';

  report.finishedAt = new Date().toISOString();
  registry.uninstall();
  paint(
    report.ok
      ? `2.32: worker CSP (script header) + host terminate OK. SPP inject NO DEMOSTRADO. G8/G9 FAIL.`
      : `2.32 incomplete — see verdicts. G8/G9 FAIL.`,
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
