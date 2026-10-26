/**
 * Fase 2.30 — Browser host: typed broker + fake RO-1 backend.
 * Real SDK path remains ro1-host.html (2.27/2.28). Results are separated.
 */

import { Ro1BrokerStandalone, createFakeRo1Backend } from './ro1-broker.standalone.mjs';

function paint(status, report) {
  document.getElementById('status').textContent = status;
  document.getElementById('report').textContent = JSON.stringify(report, null, 2);
  window.__SPP_BROKER_HOST__ = report;
}

async function run() {
  const report = {
    phase: '2.30',
    kind: 'typed-broker browser host (fake backend)',
    notWalletIntegration: true,
    sdk: {
      realSdkExecutedHere: false,
      note: 'Real SDK RO-1 evidenced in FASE-2.28 via ro1-host.html; this page validates broker envelopes only',
      package: 'stellar-private-payments',
      expectedVersion: '0.2.1',
    },
    gates: { G8: 'FAIL', G9: 'FAIL' },
    startedAt: new Date().toISOString(),
    steps: [],
    adversarial: {},
  };

  const backend = createFakeRo1Backend();
  const broker = new Ro1BrokerStandalone(backend);
  const sess = broker.openSession();
  report.sessionId = sess.sessionId;
  report.gates = broker.gateStatus();

  // Expose only broker dispatch — never a Client
  window.__SPP_RO1_BROKER__ = {
    dispatch: (m) => broker.dispatch(m),
    buildRequest: (...a) => broker.buildRequest(...a),
    closeSession: () => broker.closeSession(sess.sessionId),
    get closed() {
      return broker.sessions.get(sess.sessionId)?.state !== 'open';
    },
  };

  const rpcUrl = `${location.origin}/rpc-ro1`;
  const contractConfig = { harness: true, synthetic: true };

  const runOp = async (method, args) => {
    const res = await broker.dispatch(broker.buildRequest(sess.sessionId, method, args));
    report.steps.push({
      method,
      ok: res.ok,
      code: res.response.error?.code,
      resultKeys:
        res.ok && res.response.result && typeof res.response.result === 'object'
          ? Object.keys(res.response.result)
          : [],
    });
    return res;
  };

  await runOp('Storage.open', {});
  await runOp('Client.new', { rpcUrl, contractConfig });
  await runOp('Client.aspState', {});
  await runOp('Client.allContractsData', {});

  // Adversarial: unknown method, extra field, replay, close
  const denied = await broker.dispatch({
    v: 1,
    kind: 'req',
    sessionId: sess.sessionId,
    requestId: broker.mintRequestId(),
    method: 'sendTransaction',
    args: {},
  });
  report.adversarial.unknownMethod = {
    ok: denied.ok,
    code: denied.response.error?.code,
  };

  const extra = await broker.dispatch({
    v: 1,
    kind: 'req',
    sessionId: sess.sessionId,
    requestId: broker.mintRequestId(),
    method: 'Storage.open',
    args: {},
    forged: 1,
  });
  report.adversarial.extraField = { ok: extra.ok, code: extra.response.error?.code };

  const rid = broker.mintRequestId();
  await broker.dispatch(broker.buildRequest(sess.sessionId, 'Storage.open', {}, rid));
  const replay = await broker.dispatch(
    broker.buildRequest(sess.sessionId, 'Storage.open', {}, rid),
  );
  report.adversarial.replay = { ok: replay.ok, code: replay.response.error?.code };

  broker.closeSession(sess.sessionId);
  const afterClose = await broker.dispatch(
    broker.buildRequest(sess.sessionId, 'Client.aspState', {}),
  );
  report.adversarial.afterClose = {
    ok: afterClose.ok,
    code: afterClose.response.error?.code,
  };

  report.clientExposedOnWindow = typeof window.__SPP_RAW_CLIENT__ !== 'undefined';
  report.brokerSurfaceKeys = Object.keys(window.__SPP_RO1_BROKER__);
  report.ok =
    report.steps.every((s) => s.ok) &&
    report.adversarial.unknownMethod.ok === false &&
    report.adversarial.extraField.ok === false &&
    report.adversarial.replay.ok === false &&
    report.adversarial.afterClose.ok === false &&
    report.clientExposedOnWindow === false;

  report.finishedAt = new Date().toISOString();
  paint(
    report.ok
      ? 'Broker host OBSERVADO (fake backend). Real SDK: see 2.28. G8/G9 FAIL.'
      : 'Broker host incomplete. G8/G9 FAIL.',
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
