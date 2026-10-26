/**
 * Fase 2.36 — Node tests for session persistence + evidence validation.
 * Run: node evidence/validateEvidence.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MemorySessionStore,
  beginSession,
  persistSession,
  loadSessionEvidence,
  emptyStore,
} from './sessionStore.mjs';
import { evaluateGates, uniqueEgressAttempts } from './evaluateGates.mjs';
import { validateEvidence, validateEvidenceReport } from './validateEvidence.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL ${name}:`, e instanceof Error ? e.message : e);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL ${name}:`, e instanceof Error ? e.message : e);
  }
}

function baseEvidence(overrides = {}) {
  return {
    phase: '2.36',
    artifactVersion: '0.0.36',
    sessionId: overrides.sessionId || `sess-${Date.now()}`,
    startedAt: new Date().toISOString(),
    ok: false,
    context: { isExtensionPage: true },
    chromeDesktopExecution: 'OPERATOR_EXPORT',
    rpc: { observed: [], deniedProbes: [], onlyGetLedgerEntries: false, allowlist: ['getLedgerEntries'] },
    workers: { registered: [], terminated: [] },
    egressAttempts: [],
    postClose: { classification: 'NOT_TESTED', notes: null },
    lifecycle: {},
    vaultAccess: false,
    keysAccess: false,
    signingWired: false,
    gates: { G8: 'FAIL', G9: 'FAIL' },
    ...overrides,
  };
}

await testAsync('new session does not overwrite prior evidence body', async () => {
  const store = new MemorySessionStore();
  const a = baseEvidence({ sessionId: 'A', ok: true, rpc: { observed: [{ method: 'getLedgerEntries' }], deniedProbes: [], onlyGetLedgerEntries: true, allowlist: ['getLedgerEntries'] }, workers: { registered: [{ class: 'SDK_REAL' }, { class: 'SDK_REAL' }], terminated: [] } });
  await beginSession(store, a);
  await persistSession(store, a);

  const b = baseEvidence({ sessionId: 'B' });
  await beginSession(store, b);

  assert.equal(b.previousSessionId, 'A');
  assert.equal(b.previousSessionRecoverable, true);
  assert.equal(b.previousSessionSummary.workersRegisteredCount, 2);

  const loaded = await loadSessionEvidence(store, 'A');
  assert.equal(loaded.recoverable, true);
  assert.equal(loaded.evidence.ok, true);
  assert.equal(loaded.evidence.workers.registered.length, 2);

  const data = await store.load();
  assert.deepEqual(data.sessionOrder, ['A', 'B']);
  assert.equal(data.sessions.A.evidence.ok, true);
  assert.equal(data.sessions.B.evidence.ok, false);
});

await testAsync('reload simulation: empty export is NOT_EXECUTED not termination', async () => {
  const empty = baseEvidence({ sessionId: 'empty-reload' });
  const report = validateEvidenceReport(empty);
  assert.equal(report.checks.sessionContent, 'NOT_EXECUTED');
  assert.equal(report.gates.G8, 'FAIL');
  assert.equal(report.gates.G9, 'FAIL');
  assert.ok(report.warnings.some((w) => /reloaded host session/i.test(w)));
});

test('duplicate egress not counted independently for gates', () => {
  const e = baseEvidence({
    sessionId: 'dup',
    egressAttempts: [
      {
        worker: 'storage-worker.js',
        classification: 'PASS_CSP_CONFIRMED',
        notes: 'csp',
        technique: 'devtools_worker_console_fetch_invalid_no_sdk_substitute',
      },
      {
        worker: 'storage-worker.js',
        classification: 'PASS_CSP_CONFIRMED',
        notes: 'csp',
        technique: 'devtools_worker_console_fetch_invalid_no_sdk_substitute',
      },
    ],
  });
  const uniq = uniqueEgressAttempts(e);
  assert.equal(uniq.length, 1);
  const g = evaluateGates(e);
  assert.equal(g.egressDedup.totalRows, 2);
  assert.equal(g.egressDedup.uniqueRows, 1);
  assert.equal(g.egressDedup.duplicates.length, 1);
});

test('PASS_CSP_CONFIRMED alone does not PASS G9', () => {
  const e = baseEvidence({
    sessionId: 'csp-only',
    ok: true,
    stages: { aspState: { ok: true }, allContractsData: { ok: true } },
    rpc: {
      observed: [{ method: 'getLedgerEntries' }],
      deniedProbes: [{ rpcMethod: 'sendTransaction', rejected: true }],
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
    postClose: { classification: 'NO_ACTIVITY_OBSERVED' },
  });
  const g = evaluateGates(e);
  assert.equal(g.G8, 'FAIL'); // productionIntegration
  assert.equal(g.G9, 'FAIL'); // postClose + nested
  assert.ok(g.reasons.G8.some((r) => /production/i.test(r)));
  assert.ok(g.checklist.workerEgressStorage.status === 'PASS');
});

test('unconfirmed worker notes demote CSP PASS to INSUFFICIENT', () => {
  const e = baseEvidence({
    sessionId: 'unc',
    egressAttempts: [
      {
        worker: 'storage-worker.js',
        classification: 'PASS_CSP_CONFIRMED',
        notes: 'worker console context unconfirmed',
        technique: 'devtools_worker_console_fetch_invalid_no_sdk_substitute',
      },
    ],
  });
  const g = evaluateGates(e);
  assert.equal(g.checklist.workerEgressStorage.status, 'INSUFFICIENT_EVIDENCE');
});

await testAsync('unknown previous session flagged not recoverable', async () => {
  const store = new MemorySessionStore({
    ...emptyStore(),
    currentSessionId: 'ghost',
    sessionOrder: ['ghost'],
    sessions: {},
  });
  const b = baseEvidence({ sessionId: 'after-ghost' });
  await beginSession(store, b);
  assert.equal(b.previousSessionId, 'ghost');
  assert.equal(b.previousSessionRecoverable, false);
  assert.match(String(b.previousSessionSummary.note), /not recoverable/i);
});

test('different sessions must not be merged by validator', () => {
  const e = baseEvidence({
    sessionId: 'B',
    previousSessionId: 'A',
    previousSessionRecoverable: true,
    previousSessionSummary: { workersRegisteredCount: 2, rpcObservedCount: 2 },
    // current still empty
  });
  const r = validateEvidence(e);
  assert.equal(r.checks.sessionContent, 'NOT_EXECUTED');
  assert.equal(e.workers.registered.length, 0);
});

// Optional: real export fixture if present (never invent Chrome)
const fixturePath = join(__dirname, 'fixtures', 'session-ro1-complete.sample.json');
if (existsSync(fixturePath)) {
  test('fixture RO-1 export validates structure and keeps G8/G9 FAIL', () => {
    const ev = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const r = validateEvidenceReport(ev);
    assert.equal(r.ok, true);
    assert.equal(r.gates.G8, 'FAIL');
    assert.equal(r.gates.G9, 'FAIL');
    assert.ok(Array.isArray(ev.workers.registered) && ev.workers.registered.length >= 2);
  });
} else {
  console.log('SKIP fixture RO-1 (fixtures/session-ro1-complete.sample.json absent)');
}

console.log(JSON.stringify({ passed, failed }, null, 2));
process.exit(failed === 0 ? 0 : 1);
