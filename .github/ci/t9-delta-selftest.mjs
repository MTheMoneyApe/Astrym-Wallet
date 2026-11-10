import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { compareFingerprints } from './t9-delta.mjs';

const tool = { node: 'v22.23.4', pnpm: '10.33.4' };
function tree(errors, tests) {
  return { git: { sha: 'a'.repeat(40) }, toolchain: { ...tool }, errors, tests };
}
const baseErr = [{ package: 'extension', file: 'src/a.ts', code: 'TS4111', message: 'Property x' }];
const baseFail = [{ package: 'extension', file: 'tests/a.test.ts', fullName: 'timer gate', status: 'failed', reason: 'setTimeout' }];
const base = tree(baseErr, baseFail);

function check(name, result, ok) {
  if (result.ok !== ok) {
    process.stderr.write(`${name} expected ok=${ok}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`${name}=${ok ? 'PASS' : 'FAIL'}\n`);
  }
}

check('same', compareFingerprints(base, tree(baseErr, baseFail)), true);
check('added-error', compareFingerprints(base, tree([...baseErr, { package: 'extension', file: 'src/b.ts', code: 'TS2304', message: 'missing' }], baseFail)), false);
check('added-failure', compareFingerprints(base, tree(baseErr, [...baseFail, { package: 'extension', file: 'tests/b.test.ts', fullName: 'new', status: 'failed', reason: 'no' }])), false);
check('resolved-failure', compareFingerprints(base, tree(baseErr, [{ ...baseFail[0], status: 'passed', reason: '' }])), true);

const dir = mkdtempSync(join(tmpdir(), 't9-delta-'));
const basePath = join(dir, 'base.json');
const candPath = join(dir, 'cand.json');
writeFileSync(basePath, JSON.stringify(base));
writeFileSync(candPath, JSON.stringify(tree([...baseErr, { package: 'extension', file: 'src/b.ts', code: 'TS2304', message: 'missing' }], baseFail)));
const cli = spawnSync(process.execPath, [join(import.meta.dirname, 't9-delta.mjs'), basePath, candPath], { encoding: 'utf8' });
if (cli.status !== 1) {
  process.stderr.write(`cli exit ${cli.status}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('cli-added-error=FAIL\n');
}
if (process.exitCode) process.exit(process.exitCode);
