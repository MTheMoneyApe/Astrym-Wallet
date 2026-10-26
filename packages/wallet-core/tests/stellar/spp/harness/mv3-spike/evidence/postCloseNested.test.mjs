/**
 * Fase 2.36 — Node tests for post-close lifecycle + nested-worker host limits + static audit.
 * Does not talk to Chrome, RPC, or Testnet.
 *
 * Run: node evidence/postCloseNested.test.mjs
 */
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHostContainment } from '../host/containment.mjs';
import { auditSdkWorkerScriptsForNestedWorker } from './staticNestedWorkerAudit.mjs';
import {
  assessPostCloseProof,
  assessNestedWorkers,
  POST_CLOSE_ABSENCE_REQUIRED,
  NESTED_WORKERS_REQUIRED,
} from './g9ResidualCriteria.mjs';
import { evaluateGates } from './evaluateGates.mjs';
import { validateEvidenceReport } from './validateEvidence.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;
/** @type {object[]} */
const results = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    results.push({ name, status: 'PASS' });
    console.log(`PASS ${name}`);
  } catch (e) {
    failed += 1;
    results.push({
      name,
      status: 'FAIL',
      error: e instanceof Error ? e.message : String(e),
    });
    console.error(`FAIL ${name}:`, e instanceof Error ? e.message : e);
  }
}

/** Minimal fake Worker for Node (no real threads). */
function installFakeWorker() {
  class FakeWorker {
    constructor(script) {
      this.script = String(script);
      this.terminated = false;
    }
    terminate() {
      this.terminated = true;
    }
  }
  const prev = globalThis.Worker;
  globalThis.Worker = FakeWorker;
  return {
    FakeWorker,
    restore() {
      globalThis.Worker = prev;
    },
  };
}

test('criteria lists are non-empty documentation contracts', () => {
  assert.ok(POST_CLOSE_ABSENCE_REQUIRED.length >= 5);
  assert.ok(NESTED_WORKERS_REQUIRED.length >= 4);
});

test('post-close: NO_ACTIVITY_OBSERVED remains INSUFFICIENT', () => {
  const r = assessPostCloseProof({ classification: 'NO_ACTIVITY_OBSERVED' });
  assert.equal(r.status, 'INSUFFICIENT_EVIDENCE');
});

test('post-close: ABSENCE_DEMONSTRATED without proof is INSUFFICIENT', () => {
  const r = assessPostCloseProof({ classification: 'ABSENCE_DEMONSTRATED' });
  assert.equal(r.status, 'INSUFFICIENT_EVIDENCE');
  assert.match(r.detail, /without postClose\.proof/);
});

test('post-close: ABSENCE_DEMONSTRATED with complete proof schema is PASS (schema only)', () => {
  const r = assessPostCloseProof({
    classification: 'ABSENCE_DEMONSTRATED',
    proof: {
      observeWindowMs: 8000,
      networkRequestsObserved: 0,
      liveWorkerThreadsObserved: 0,
      technique: 'devtools_network_and_threads',
      recordedAt: new Date().toISOString(),
    },
  });
  assert.equal(r.status, 'PASS');
});

test('host emergencyClose terminates registered workers; late construct denied', () => {
  const { restore } = installFakeWorker();
  try {
    const host = createHostContainment({ sessionId: 'node-close-1' });
    const w1 = new globalThis.Worker('/vendor/dist/workers/storage-worker.js', {
      type: 'module',
    });
    const w2 = new globalThis.Worker('/vendor/dist/workers/prover-worker.js', {
      type: 'module',
    });
    assert.equal(host.snapshot().length, 2);
    const close = host.emergencyClose('node_test');
    assert.equal(close.ok, true);
    assert.equal(close.terminatedNow, 2);
    assert.ok(host.snapshot().every((e) => e.terminated && e.terminateCalls >= 1));
    assert.equal(w1.terminated, true);
    assert.equal(w2.terminated, true);
    let denied = false;
    try {
      new globalThis.Worker('/vendor/dist/workers/storage-worker.js');
    } catch (e) {
      denied = /HOST_CLOSED/.test(e instanceof Error ? e.message : String(e));
    }
    assert.equal(denied, true);
    const close2 = host.emergencyClose('repeat');
    assert.equal(close2.idempotent, true);
    host.uninstall();
  } finally {
    restore();
  }
});

test('nested: Worker constructed via OrigWorker is invisible to host registry', () => {
  const { restore } = installFakeWorker();
  try {
    const host = createHostContainment({ sessionId: 'unreg' });
    const orphan = new host.OrigWorker('/vendor/dist/workers/storage-worker.js');
    assert.equal(host.snapshot().length, 0);
    assert.equal(host.realmCoverage.nestedWorkersInsideDedicatedWorker, false);
    orphan.terminate();
    host.emergencyClose('cleanup');
    host.uninstall();
  } finally {
    restore();
  }
});

test('nested: simulated inner-realm Worker is not captured by window wrapper', () => {
  const { FakeWorker, restore } = installFakeWorker();
  try {
    const host = createHostContainment({ sessionId: 'inner' });
    // Page-level construct is tracked
    new globalThis.Worker('/vendor/dist/workers/storage-worker.js');
    assert.equal(host.snapshot().length, 1);
    // Simulate construction that would happen inside a DedicatedWorker:
    // uses the original constructor (same as worker realm not seeing TrackedWorker).
    const inner = new host.OrigWorker('blob:nested-simulated');
    assert.equal(host.snapshot().length, 1);
    assert.ok(inner instanceof FakeWorker);
    host.emergencyClose('x');
    // Inner orphan was NOT terminated by host
    assert.equal(inner.terminated, false);
    inner.terminate();
    host.uninstall();
  } finally {
    restore();
  }
});

const staticAudit = auditSdkWorkerScriptsForNestedWorker();

test('static audit of vendor SDK workers runs without network', () => {
  assert.equal(staticAudit.ok, true);
  assert.ok(staticAudit.files.includes('storage-worker-module.js'));
  assert.ok(staticAudit.files.includes('prover-worker-module.js'));
  // wasm-bindgen glue historically embeds new Worker(
  assert.ok(
    staticAudit.newWorkerCallSites >= 1,
    `expected new Worker( sites, got ${staticAudit.newWorkerCallSites}`,
  );
});

test('nested assess: static sites without runtime → INSUFFICIENT', () => {
  const r = assessNestedWorkers(null, {
    newWorkerCallSites: staticAudit.newWorkerCallSites,
  });
  assert.equal(r.status, 'INSUFFICIENT_EVIDENCE');
});

test('nested assess: runtime PASS blocked until wasmGlueNewWorkerRuledOut', () => {
  const r = assessNestedWorkers(
    {
      runtimeObservation: 'NO_NESTED_OUTSIDE_REGISTRY',
      method: 'devtools_sources_threads',
      proof: { observedAt: new Date().toISOString() },
      staticAudit: { newWorkerCallSites: 2 },
    },
    { newWorkerCallSites: 2 },
  );
  assert.equal(r.status, 'INSUFFICIENT_EVIDENCE');
  assert.match(r.detail, /wasmGlueNewWorkerRuledOut/);
});

test('evaluateGates: canonical-like residual keeps G9 FAIL', () => {
  const e = {
    phase: '2.36',
    artifactVersion: '0.0.36',
    sessionId: 'residual-sim',
    ok: true,
    context: { isExtensionPage: true },
    chromeDesktopExecution: 'OPERATOR_EXPORT',
    vaultAccess: false,
    keysAccess: false,
    signingWired: false,
    stages: { aspState: { ok: true }, allContractsData: { ok: true } },
    rpc: {
      observed: [{ method: 'getLedgerEntries' }],
      deniedProbes: [{ rejected: true }],
      onlyGetLedgerEntries: true,
      allowlist: ['getLedgerEntries'],
    },
    workers: {
      registered: [
        { class: 'SDK_REAL', script: 'storage-worker.js' },
        { class: 'SDK_REAL', script: 'prover-worker.js' },
      ],
      terminated: [],
    },
    egressAttempts: [
      {
        worker: 'storage-worker.js',
        classification: 'PASS_CSP_CONFIRMED',
        notes: 'ok',
        technique: 'devtools_worker_console_fetch_invalid_no_sdk_substitute',
      },
      {
        worker: 'prover-worker.js',
        classification: 'PASS_CSP_CONFIRMED',
        notes: 'ok',
        technique: 'devtools_worker_console_fetch_invalid_no_sdk_substitute',
      },
    ],
    lifecycle: { operator_close: { close: { ok: true, terminatedNow: 2 }, idempotentRepeat: true } },
    postClose: { classification: 'NO_ACTIVITY_OBSERVED' },
    nestedWorkers: { staticAudit },
    gates: { G8: 'FAIL', G9: 'FAIL' },
  };
  const g = evaluateGates(e);
  assert.equal(g.G9, 'FAIL');
  assert.equal(g.checklist.postCloseAbsence.status, 'INSUFFICIENT_EVIDENCE');
  assert.equal(g.checklist.nestedWorkers.status, 'INSUFFICIENT_EVIDENCE');
  assert.equal(g.checklist.workerEgressStorage.status, 'PASS');
  assert.equal(g.checklist.workerEgressProver.status, 'PASS');
});

test('validateEvidence on synthetic residual export stays structurally ok; G9 FAIL', () => {
  const e = {
    phase: '2.36',
    artifactVersion: '0.0.36',
    sessionId: 'node-residual-export',
    startedAt: new Date().toISOString(),
    ok: false,
    rpc: { observed: [], deniedProbes: [], allowlist: ['getLedgerEntries'] },
    workers: { registered: [], terminated: [] },
    gates: { G8: 'FAIL', G9: 'FAIL' },
    postClose: { classification: 'NOT_TESTED' },
    nestedWorkers: { staticAudit },
  };
  const r = validateEvidenceReport(e);
  assert.equal(r.ok, true);
  assert.equal(r.gates.G9, 'FAIL');
});

const outDir = join(__dirname, 'runs');
mkdirSync(outDir, { recursive: true });
const outName = `g9-residual-node-${Date.now()}.json`;
const outPath = join(outDir, outName);
const artifact = {
  kind: 'g9-residual-node-automation',
  phase: '2.36',
  createdAt: new Date().toISOString(),
  notChromeExecution: true,
  chromeInstrumentation: 'NOT_EXECUTED',
  staticNestedWorkerAudit: staticAudit,
  postCloseCriteria: POST_CLOSE_ABSENCE_REQUIRED,
  nestedCriteria: NESTED_WORKERS_REQUIRED,
  tests: { passed, failed, results },
  gatesPolicy:
    'G9 remains FAIL until postClose.proof + nestedWorkers runtime proof (with wasmGlue ruled out) are present; Node tests do not flip G9',
};
writeFileSync(outPath, JSON.stringify(artifact, null, 2));
console.log(JSON.stringify({ outPath, passed, failed, staticSites: staticAudit.newWorkerCallSites }, null, 2));
process.exit(failed === 0 ? 0 : 1);
