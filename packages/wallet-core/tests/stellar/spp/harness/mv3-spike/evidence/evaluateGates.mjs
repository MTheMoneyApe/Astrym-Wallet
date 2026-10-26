/**
 * Fase 2.36 — Gate evaluation from evidence JSON (no Chrome required).
 * Never auto-PASS G8/G9 from a single PASS_CSP_CONFIRMED entry.
 */
import { assessPostCloseProof, assessNestedWorkers } from './g9ResidualCriteria.mjs';

/** @typedef {'PASS'|'FAIL'|'NOT_EXECUTED'|'INSUFFICIENT_EVIDENCE'} CheckStatus */

/**
 * @param {any} evidence
 * @returns {{ worker: string, classification: string, notes: string|null, technique: string, index: number, duplicateOf: number|null }[]}
 */
export function normalizeEgressAttempts(evidence) {
  const raw = Array.isArray(evidence?.egressAttempts) ? evidence.egressAttempts : [];
  const out = [];
  const seen = new Map();
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i] || {};
    const key = [
      String(a.worker || ''),
      String(a.classification || ''),
      String(a.notes || ''),
      String(a.technique || ''),
    ].join('|');
    const prev = seen.get(key);
    out.push({
      worker: a.worker || null,
      classification: a.classification || 'NOT_TESTED',
      notes: a.notes ?? null,
      technique: a.technique || null,
      index: i,
      duplicateOf: prev === undefined ? null : prev,
    });
    if (prev === undefined) seen.set(key, i);
  }
  return out;
}

/**
 * Unique (non-duplicate) egress rows only.
 * @param {any} evidence
 */
export function uniqueEgressAttempts(evidence) {
  return normalizeEgressAttempts(evidence).filter((a) => a.duplicateOf === null);
}

/**
 * @param {string} status
 * @param {string} detail
 */
function check(status, detail) {
  return { status, detail };
}

/**
 * Evaluate harness checklist + official G8/G9 for this spike artifact.
 * @param {any} evidence
 */
export function evaluateGates(evidence) {
  const e = evidence || {};
  const egress = uniqueEgressAttempts(e);
  const registered = Array.isArray(e.workers?.registered) ? e.workers.registered : [];
  const sdkReal = registered.filter((w) => w && w.class === 'SDK_REAL');
  const observed = Array.isArray(e.rpc?.observed) ? e.rpc.observed : [];
  const denied = Array.isArray(e.rpc?.deniedProbes) ? e.rpc.deniedProbes : [];
  const ro1Ran =
    e.ok === true ||
    e.stages?.aspState?.ok === true ||
    (Array.isArray(e.events) && e.events.some((ev) => ev.type === 'ro1_complete'));

  const checklist = {
    extensionPageHost: e.context?.isExtensionPage
      ? check('PASS', 'chrome-extension:// host')
      : check(
          e.chromeDesktopExecution === 'PENDING_OPERATOR' ? 'NOT_EXECUTED' : 'FAIL',
          'host is not extension page',
        ),
    ro1ReadPath: !ro1Ran
      ? check(
          registered.length === 0 && observed.length === 0 ? 'NOT_EXECUTED' : 'INSUFFICIENT_EVIDENCE',
          'RO-1 not completed in this session evidence',
        )
      : e.stages?.aspState?.ok && e.stages?.allContractsData?.ok
        ? check('PASS', 'aspState + allContractsData ok')
        : check('INSUFFICIENT_EVIDENCE', 'RO-1 claimed ok but stages incomplete'),
    rpcAllowlistOnly:
      observed.length === 0
        ? check(ro1Ran ? 'INSUFFICIENT_EVIDENCE' : 'NOT_EXECUTED', 'no rpc.observed')
        : e.rpc?.onlyGetLedgerEntries === true &&
            observed.every((x) => x.method === 'getLedgerEntries')
          ? check('PASS', 'only getLedgerEntries observed')
          : check('FAIL', 'non-allowlisted RPC observed or flag false'),
    mutatorSurfaceDenied:
      denied.length === 0
        ? check(ro1Ran ? 'INSUFFICIENT_EVIDENCE' : 'NOT_EXECUTED', 'no deniedProbes')
        : denied.some((d) => d.rejected === true || d.ok === false)
          ? check('PASS', 'denied probes present')
          : check('FAIL', 'deniedProbes present but none rejected'),
    noVaultKeysSigning:
      e.vaultAccess === false && e.keysAccess === false && e.signingWired === false
        ? check('PASS', 'vault/keys/signing flags false')
        : check('FAIL', 'vault/keys/signing flag not false'),
    productionIntegration: check(
      'FAIL',
      'spike artifact is not production wallet integration (G8 product criterion)',
    ),
    workerEgressStorage: egressStatusFor(egress, 'storage-worker.js'),
    workerEgressProver: egressStatusFor(egress, 'prover-worker.js'),
    workersRegistered:
      sdkReal.length >= 2
        ? check('PASS', `${sdkReal.length} SDK_REAL registered`)
        : registered.length === 0
          ? check(ro1Ran ? 'INSUFFICIENT_EVIDENCE' : 'NOT_EXECUTED', 'workers.registered empty')
          : check('INSUFFICIENT_EVIDENCE', `SDK_REAL count=${sdkReal.length}`),
    hostTerminateAfterClose: terminateCheck(e),
    postCloseAbsence: (() => {
      const r = assessPostCloseProof(e.postClose);
      return check(r.status, r.detail);
    })(),
    nestedWorkers: (() => {
      const r = assessNestedWorkers(e.nestedWorkers, e.nestedWorkers?.staticAudit || null);
      return check(r.status, r.detail);
    })(),
  };

  const g8Reasons = [];
  if (checklist.productionIntegration.status !== 'PASS') {
    g8Reasons.push(checklist.productionIntegration.detail);
  }
  for (const key of [
    'extensionPageHost',
    'ro1ReadPath',
    'rpcAllowlistOnly',
    'mutatorSurfaceDenied',
    'noVaultKeysSigning',
  ]) {
    if (checklist[key].status !== 'PASS') {
      g8Reasons.push(`${key}: ${checklist[key].status} — ${checklist[key].detail}`);
    }
  }

  const g9Reasons = [];
  for (const key of [
    'workerEgressStorage',
    'workerEgressProver',
    'hostTerminateAfterClose',
    'postCloseAbsence',
    'nestedWorkers',
  ]) {
    if (checklist[key].status !== 'PASS') {
      g9Reasons.push(`${key}: ${checklist[key].status} — ${checklist[key].detail}`);
    }
  }

  // Official gates: PASS only if every required criterion is PASS (spike almost never).
  const G8 = g8Reasons.length === 0 ? 'PASS' : 'FAIL';
  const G9 = g9Reasons.length === 0 ? 'PASS' : 'FAIL';

  return {
    G8,
    G9,
    reasons: { G8: g8Reasons, G9: g9Reasons },
    checklist,
    egressDedup: {
      totalRows: normalizeEgressAttempts(e).length,
      uniqueRows: egress.length,
      duplicates: normalizeEgressAttempts(e).filter((a) => a.duplicateOf !== null).map((a) => ({
        index: a.index,
        duplicateOf: a.duplicateOf,
        worker: a.worker,
      })),
    },
    note: 'PASS_CSP_CONFIRMED alone does not flip G8/G9; all checklist criteria required',
  };
}

function egressStatusFor(egress, workerName) {
  const rows = egress.filter((a) => a.worker === workerName);
  if (rows.length === 0) {
    return check('NOT_EXECUTED', `no unique egressAttempts for ${workerName}`);
  }
  if (rows.some((a) => a.classification === 'PASS_CSP_CONFIRMED')) {
    const bad = rows.find(
      (a) =>
        a.classification === 'PASS_CSP_CONFIRMED' &&
        /unconfirmed|host document|document host/i.test(String(a.notes || '')),
    );
    if (bad) {
      return check(
        'INSUFFICIENT_EVIDENCE',
        `${workerName}: PASS_CSP_CONFIRMED but notes indicate unconfirmed/host context`,
      );
    }
    return check('PASS', `${workerName}: PASS_CSP_CONFIRMED (unique)`);
  }
  if (rows.every((a) => a.classification === 'NOT_DEMONSTRATED' || a.classification === 'NOT_TESTED')) {
    return check('INSUFFICIENT_EVIDENCE', `${workerName}: ${rows[0].classification}`);
  }
  if (rows.some((a) => a.classification === 'FAIL_REACHED')) {
    return check('FAIL', `${workerName}: FAIL_REACHED`);
  }
  if (rows.some((a) => a.classification === 'DNS_OR_NETWORK_ONLY')) {
    return check('INSUFFICIENT_EVIDENCE', `${workerName}: DNS_OR_NETWORK_ONLY (not CSP proof)`);
  }
  return check('INSUFFICIENT_EVIDENCE', `${workerName}: no CSP-confirmed unique row`);
}

function terminateCheck(e) {
  const life = e.lifecycle || {};
  const keys = Object.keys(life);
  if (keys.length === 0) {
    return check('NOT_EXECUTED', 'no lifecycle close recorded');
  }
  const any = keys.some((k) => {
    const c = life[k]?.close;
    return c && (c.ok === true || c.terminatedNow > 0 || life[k].idempotentRepeat === true);
  });
  if (any) return check('PASS', 'host emergencyClose recorded');
  return check('INSUFFICIENT_EVIDENCE', 'lifecycle present but terminate not evidenced');
}

