/**
 * Run: node evidence/residualDraftBuilder.test.mjs
 */
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildResidualDraft } from './residualDraftBuilder.mjs';
import { analyzeWasmGlueWorkerReachability } from './wasmGlueWorkerReachability.mjs';

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

const base = {
  startedAt: new Date(Date.now() - 8000).toISOString(),
  endedAt: new Date().toISOString(),
  observeWindowMs: 8000,
  detectionMethod: {
    network: 'devtools_network_panel',
    threads: 'devtools_sources_threads',
  },
};

test('rejects networkRequestsObserved 0 without full_window visibility', () => {
  const r = buildResidualDraft({
    ...base,
    networkVisibility: 'partial',
    threadsVisibility: 'full_window',
    networkRequestsObserved: 0,
    liveWorkerThreadsObserved: 0,
    workersObserved: ['storage-worker.js'],
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /networkRequestsObserved===0/.test(e)));
});

test('rejects inferNoNestedFromHostWrapper', () => {
  const r = buildResidualDraft({
    ...base,
    networkVisibility: 'full_window',
    threadsVisibility: 'full_window',
    networkRequestsObserved: 0,
    liveWorkerThreadsObserved: 0,
    workersObserved: [],
    inferNoNestedFromHostWrapper: true,
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /inferNoNestedFromHostWrapper/.test(e)));
});

test('rejects pagePerf claimsFullNetworkVisibility', () => {
  const r = buildResidualDraft({
    ...base,
    networkVisibility: 'full_window',
    threadsVisibility: 'full_window',
    networkRequestsObserved: 0,
    liveWorkerThreadsObserved: 0,
    workersObserved: [],
    pagePerformanceObserver: { pageResourceEntries: 0, claimsFullNetworkVisibility: true },
  });
  assert.equal(r.ok, false);
});

test('rejects nested intent without wasmGlueNewWorkerRuledOut', () => {
  const r = buildResidualDraft({
    ...base,
    networkVisibility: 'full_window',
    threadsVisibility: 'full_window',
    networkRequestsObserved: 0,
    liveWorkerThreadsObserved: 0,
    workersObserved: ['storage-worker.js'],
    intendNestedNoOutsideRegistry: true,
    wasmGlueNewWorkerRuledOut: false,
    nestedMethod: 'devtools_sources_threads',
  });
  assert.equal(r.ok, false);
});

test('accepts absence intent with full visibility and zeros', () => {
  const r = buildResidualDraft({
    ...base,
    networkVisibility: 'full_window',
    threadsVisibility: 'full_window',
    networkRequestsObserved: 0,
    liveWorkerThreadsObserved: 0,
    workersObserved: [],
    intendAbsenseDemonstrated: true,
  });
  assert.equal(r.ok, true);
  assert.equal(r.draft.postClose.classification, 'ABSENCE_DEMONSTRATED');
  assert.equal(r.draft.gatePreview.postCloseAbsence.status, 'PASS');
});

test('wasm glue reachability marks inside-worker sites UNKNOWN / not ruled out', () => {
  const a = analyzeWasmGlueWorkerReachability();
  assert.equal(a.summary.anyInsideWorkerGluePresent, true);
  const inside = a.findings.filter((f) => String(f.realm).includes('DedicatedWorker'));
  assert.ok(inside.every((f) => f.ruledOutByStaticAnalysis === false));
  assert.ok(a.cannotInfer.some((x) => /wasmGlueNewWorkerRuledOut/.test(x)));
});

const outDir = join(__dirname, 'runs');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `g9-residual-assist-node-${Date.now()}.json`);
writeFileSync(
  outPath,
  JSON.stringify(
    {
      kind: 'g9-residual-assist-node',
      createdAt: new Date().toISOString(),
      passed,
      failed,
      wasmGlue: analyzeWasmGlueWorkerReachability(),
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ outPath, passed, failed }, null, 2));
process.exit(failed === 0 ? 0 : 1);
