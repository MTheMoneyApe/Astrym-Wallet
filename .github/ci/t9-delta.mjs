/**
 * Fail closed when the candidate adds tsc diagnostics, failing files, deleted
 * tests, or tests that became skipped. Identity is package + file + line +
 * code. The message text is not part of the key. Empty suites and non-zero
 * exits with no parsed failures are failures.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function normalizeText(value) {
  return String(value ?? '')
    .replace(/[A-Za-z]:\\[^\s'")]+/g, '<wt>')
    .replace(/(?:^|[\s'"(=])\/[^\s'")]+/g, (match) => `${match.slice(0, 1) === '/' ? '' : match.slice(0, 1)}<wt>`)
    .replace(/\s+/g, ' ')
    .trim();
}

function bump(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function errorKey(entry) {
  return [entry.package, entry.file, String(entry.line), entry.code].join('\0');
}

function testKey(entry) {
  return [entry.package, entry.file, entry.fullName].join('\0');
}

function fileKey(entry) {
  return [entry.package, entry.file].join('\0');
}

function sum(map) {
  let total = 0;
  for (const count of map.values()) total += count;
  return total;
}

function failingFiles(tests) {
  const files = new Set();
  for (const entry of tests ?? []) {
    if (entry.status === 'failed') files.add(fileKey(entry));
  }
  return files;
}

function exitProblem(side, fingerprint) {
  const exits = fingerprint.exits ?? {};
  const problems = [];
  for (const name of ['pnpm-install', 'typecheck-extension', 'typecheck-wallet-core', 'test-full-extension', 'test-full-wallet-core']) {
    if (!(name in exits) || exits[name] === null || exits[name] === '') {
      problems.push({ side, name, reason: 'missing-exit' });
    }
  }
  const tests = fingerprint.tests ?? [];
  for (const name of ['test-full-extension', 'test-full-wallet-core']) {
    const code = exits[name];
    const packageName = name.endsWith('wallet-core') ? 'wallet-core' : 'extension';
    const parsed = tests.filter((entry) => entry.package === packageName);
    const failed = parsed.filter((entry) => entry.status === 'failed').length;
    if (parsed.length === 0) problems.push({ side, name, reason: 'tests=0' });
    if (code === null || code === undefined) continue;
    if (Number(code) !== 0 && failed === 0) problems.push({ side, name, reason: 'nonzero-exit-without-failures', exit: Number(code) });
    if (Number(code) === 0 && failed > 0) problems.push({ side, name, reason: 'zero-exit-with-failures', exit: 0 });
  }
  if (!fingerprint.toolchain?.node || !fingerprint.toolchain?.pnpm) {
    problems.push({ side, name: 'toolchain', reason: 'missing-toolchain-file' });
  }
  return problems;
}

export function compareFingerprints(baseline, candidate) {
  const baseErrors = new Map();
  const candErrors = new Map();
  for (const entry of baseline.errors ?? []) bump(baseErrors, errorKey(entry));
  for (const entry of candidate.errors ?? []) bump(candErrors, errorKey(entry));
  const addedErrors = [];
  for (const [key, count] of candErrors) {
    const extra = count - (baseErrors.get(key) ?? 0);
    if (extra > 0) {
      const [pkg, file, line, code] = key.split('\0');
      addedErrors.push({ package: pkg, file, line: Number(line), code, count: extra });
    }
  }

  const baseTests = new Map((baseline.tests ?? []).map((entry) => [testKey(entry), entry]));
  const candTests = new Map((candidate.tests ?? []).map((entry) => [testKey(entry), entry]));
  const baseFailed = new Map();
  const candFailed = new Map();
  for (const [key, entry] of baseTests) if (entry.status === 'failed') bump(baseFailed, key);
  for (const [key, entry] of candTests) if (entry.status === 'failed') bump(candFailed, key);
  const addedFailures = [];
  for (const [key, count] of candFailed) {
    const extra = count - (baseFailed.get(key) ?? 0);
    if (extra > 0) {
      const [pkg, file, fullName] = key.split('\0');
      addedFailures.push({ package: pkg, file, fullName, count: extra });
    }
  }
  const deletedTests = [];
  const becameSkipped = [];
  for (const [key, entry] of baseTests) {
    const next = candTests.get(key);
    if (!next) {
      deletedTests.push({ package: entry.package, file: entry.file, fullName: entry.fullName, baselineStatus: entry.status });
      continue;
    }
    if ((entry.status === 'passed' || entry.status === 'failed') && (next.status === 'skipped' || next.status === 'pending' || next.status === 'todo')) {
      becameSkipped.push({ package: entry.package, file: entry.file, fullName: entry.fullName, from: entry.status, to: next.status });
    }
  }
  const baseFiles = failingFiles(baseline.tests);
  const candFiles = failingFiles(candidate.tests);
  const addedFailingFiles = [];
  for (const key of candFiles) {
    if (!baseFiles.has(key)) {
      const [pkg, file] = key.split('\0');
      addedFailingFiles.push({ package: pkg, file });
    }
  }

  const problems = [...exitProblem('baseline', baseline), ...exitProblem('candidate', candidate)];
  const baseNode = baseline.toolchain?.node ?? '';
  const candNode = candidate.toolchain?.node ?? '';
  const basePnpm = baseline.toolchain?.pnpm ?? '';
  const candPnpm = candidate.toolchain?.pnpm ?? '';
  const sameTools = Boolean(baseNode && candNode && baseNode === candNode && basePnpm && candPnpm && basePnpm === candPnpm);
  const ok = addedErrors.length === 0 && addedFailures.length === 0 && addedFailingFiles.length === 0 && deletedTests.length === 0 && becameSkipped.length === 0 && problems.length === 0 && sameTools;
  return {
    ok,
    baselineSha: baseline.git?.sha ?? null,
    candidateSha: candidate.git?.sha ?? null,
    baseSha: candidate.git?.baseSha ?? baseline.git?.baseSha ?? null,
    headSha: candidate.git?.headSha ?? baseline.git?.headSha ?? null,
    mergeSha: candidate.git?.mergeSha ?? baseline.git?.mergeSha ?? null,
    baselineErrorCount: sum(baseErrors),
    candidateErrorCount: sum(candErrors),
    baselineFailedCount: sum(baseFailed),
    candidateFailedCount: sum(candFailed),
    baselineFailingFiles: baseFiles.size,
    candidateFailingFiles: candFiles.size,
    addedErrors,
    addedFailures,
    addedFailingFiles,
    deletedTests,
    becameSkipped,
    problems,
    toolchain: {
      baseline: { node: baseNode, pnpm: basePnpm },
      candidate: { node: candNode, pnpm: candPnpm },
      same: sameTools,
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [baselinePath, candidatePath, outFlag, outPath] = process.argv.slice(2);
  if (!baselinePath || !candidatePath) {
    process.stderr.write('usage: t9-delta.mjs <baseline.json> <candidate.json> [--out file]\n');
    process.exit(2);
  }
  const result = compareFingerprints(JSON.parse(readFileSync(baselinePath, 'utf8')), JSON.parse(readFileSync(candidatePath, 'utf8')));
  const text = `${JSON.stringify(result, null, 2)}\n`;
  if (outFlag === '--out' && outPath) writeFileSync(outPath, text);
  process.stdout.write(text);
  process.exit(result.ok ? 0 : 1);
}
