/**
 * Static scan of vendor SDK worker scripts for `new Worker(` call sites.
 * Node-only. Does not execute workers or contact network.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_WORKERS_DIR = join(__dirname, '../vendor/dist/workers');

/**
 * @param {string} [workersDir]
 */
export function auditSdkWorkerScriptsForNestedWorker(workersDir = DEFAULT_WORKERS_DIR) {
  const scannedAt = new Date().toISOString();
  if (!existsSync(workersDir)) {
    return {
      ok: false,
      scannedAt,
      workersDir,
      error: 'WORKERS_DIR_MISSING',
      files: [],
      newWorkerCallSites: 0,
      matches: [],
      note: 'Run prepare-vendor.mjs offline before audit (operator); this function does not run it',
    };
  }

  const files = readdirSync(workersDir).filter((n) => n.endsWith('.js'));
  /** @type {{ file: string, line: number, excerpt: string }[]} */
  const matches = [];
  const re = /new\s+Worker\s*\(/g;

  for (const file of files) {
    const full = join(workersDir, file);
    const text = readFileSync(full, 'utf8');
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        matches.push({
          file,
          line: i + 1,
          excerpt: lines[i].trim().slice(0, 160),
        });
      }
      re.lastIndex = 0;
    }
  }

  return {
    ok: true,
    scannedAt,
    workersDir,
    files,
    newWorkerCallSites: matches.length,
    matches,
    interpretation:
      matches.length === 0
        ? 'No new Worker( in published worker JS text — still does not prove runtime absence of other spawn paths (WASM-only, etc.)'
        : 'new Worker( present in worker-module wasm-bindgen glue — nested construction possible; runtime observation required to PASS G9 nested criterion',
  };
}
