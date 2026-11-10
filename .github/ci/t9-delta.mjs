/**
 * Fail when the candidate has more tsc diagnostics or more failing tests
 * than the baseline. A failure that already exists on both does not fail
 * this comparison. Absolute paths in messages are normalized first.
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

export function compareFingerprints(baseline, candidate) {
  const baseErrors = new Map();
  const candErrors = new Map();
  for (const entry of baseline.errors ?? []) {
    bump(baseErrors, [entry.package, entry.file, entry.code, normalizeText(entry.message)].join('\0'));
  }
  for (const entry of candidate.errors ?? []) {
    bump(candErrors, [entry.package, entry.file, entry.code, normalizeText(entry.message)].join('\0'));
  }
  const addedErrors = [];
  for (const [key, count] of candErrors) {
    const extra = count - (baseErrors.get(key) ?? 0);
    if (extra > 0) {
      const [pkg, file, code, message] = key.split('\0');
      addedErrors.push({ package: pkg, file, code, message, count: extra });
    }
  }

  const baseFailed = new Map();
  const candFailed = new Map();
  for (const entry of baseline.tests ?? []) {
    if (entry.status === 'failed') {
      bump(baseFailed, [entry.package, entry.file, entry.fullName].join('\0'));
    }
  }
  for (const entry of candidate.tests ?? []) {
    if (entry.status === 'failed') {
      bump(candFailed, [entry.package, entry.file, entry.fullName].join('\0'));
    }
  }
  const addedFailures = [];
  for (const [key, count] of candFailed) {
    const extra = count - (baseFailed.get(key) ?? 0);
    if (extra > 0) {
      const [pkg, file, fullName] = key.split('\0');
      addedFailures.push({ package: pkg, file, fullName, count: extra });
    }
  }

  const baseNode = baseline.toolchain?.node ?? '';
  const candNode = candidate.toolchain?.node ?? '';
  const basePnpm = baseline.toolchain?.pnpm ?? '';
  const candPnpm = candidate.toolchain?.pnpm ?? '';
  const sameTools = baseNode && candNode && baseNode === candNode && basePnpm && candPnpm && basePnpm === candPnpm;
  const ok = addedErrors.length === 0 && addedFailures.length === 0 && sameTools;
  return {
    ok,
    baselineSha: baseline.git?.sha ?? null,
    candidateSha: candidate.git?.sha ?? null,
    baselineErrorCount: [...baseErrors.values()].reduce((sum, n) => sum + n, 0),
    candidateErrorCount: [...candErrors.values()].reduce((sum, n) => sum + n, 0),
    baselineFailedCount: [...baseFailed.values()].reduce((sum, n) => sum + n, 0),
    candidateFailedCount: [...candFailed.values()].reduce((sum, n) => sum + n, 0),
    addedErrors,
    addedFailures,
    toolchain: {
      baseline: { node: baseNode, pnpm: basePnpm },
      candidate: { node: candNode, pnpm: candPnpm },
      same: Boolean(sameTools),
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
