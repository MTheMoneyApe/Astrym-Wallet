/**
 * Static reachability notes for wasm-bindgen `new Worker(` glue.
 * Does NOT declare RO-1 nested spawn ruled out.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const SITES = [
  {
    id: 'main_web_new_with_options',
    file: 'vendor/dist/stellar_private_payments_web.js',
    symbol: '__wbg_new_with_options_6b48999e016c6fc6',
    realm: 'window / extension page (main WASM)',
    ro1LikelyUse:
      'YES — Storage.open / Client.new / ProverBridge.spawn on the host page go through main WASM imports; these constructs are what host containment registers as SDK_REAL.',
  },
  {
    id: 'main_web_new_plain',
    file: 'vendor/dist/stellar_private_payments_web.js',
    symbol: '__wbg_new_8f0c2d11e48a4727',
    realm: 'window / extension page (main WASM)',
    ro1LikelyUse:
      'POSSIBLE — alternate Worker constructor import (no options). May be used by same spawn paths; still page-realm → host wrapper can see it.',
  },
  {
    id: 'storage_worker_module_new_with_options',
    file: 'vendor/dist/workers/storage-worker-module.js',
    symbol: '__wbg_new_with_options_6b48999e016c6fc6',
    realm: 'inside storage DedicatedWorker',
    ro1LikelyUse:
      'UNKNOWN — glue is present because the wasm-bindgen module embeds Worker imports. Static JS cannot prove whether storage WASM invokes this import during RO-1 aspState/allContractsData.',
  },
  {
    id: 'prover_worker_module_new_with_options',
    file: 'vendor/dist/workers/prover-worker-module.js',
    symbol: '__wbg_new_with_options_6b48999e016c6fc6',
    realm: 'inside prover DedicatedWorker',
    ro1LikelyUse:
      'UNKNOWN — same as storage: import present; nested spawn during RO-1 init is not statically decidable.',
  },
];

/**
 * @param {string} [root]
 */
export function analyzeWasmGlueWorkerReachability(root = ROOT) {
  const analyzedAt = new Date().toISOString();
  const findings = [];

  for (const site of SITES) {
    const full = join(root, site.file);
    if (!existsSync(full)) {
      findings.push({
        ...site,
        present: false,
        error: 'FILE_MISSING',
      });
      continue;
    }
    const text = readFileSync(full, 'utf8');
    const present = text.includes(site.symbol) || /new\s+Worker\s*\(/.test(text);
    const lineHint = (() => {
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('new Worker(')) {
          return { line: i + 1, excerpt: lines[i].trim().slice(0, 140) };
        }
      }
      return null;
    })();
    findings.push({
      ...site,
      present,
      lineHint,
      ruledOutByStaticAnalysis: false,
      note: 'Static presence ≠ runtime invocation. Do not set wasmGlueNewWorkerRuledOut from this report alone.',
    });
  }

  return {
    analyzedAt,
    findings,
    summary: {
      pageRealmSites: findings.filter((f) => String(f.realm).includes('window')).length,
      insideDedicatedWorkerSites: findings.filter((f) =>
        String(f.realm).includes('DedicatedWorker'),
      ).length,
      anyInsideWorkerGluePresent: findings.some(
        (f) => f.present && String(f.realm).includes('DedicatedWorker'),
      ),
    },
    runtimeEvidenceThatCouldRuleOutNestedSpawn: [
      'Chrome DevTools → Sources → Threads during entire RO-1: only storage-worker.js + prover-worker.js (no extra dedicated workers)',
      'Same Threads view for ≥5s after emergencyClose: zero live workers (or only expected terminated leftovers documented)',
      'Optional CDP Target.getTargets listing worker URLs — only in a future authorized debug Chrome session',
      'If an unexpected worker URL appears, set runtimeObservation=NESTED_OBSERVED_OUTSIDE_REGISTRY (FAIL path), do not rule out glue',
    ],
    cannotInfer: [
      'Absence of nested workers from window.Worker wrapper emptiness',
      'wasmGlueNewWorkerRuledOut:true from static scan alone',
      'networkRequestsObserved:0 from page PerformanceObserver alone',
    ],
  };
}
