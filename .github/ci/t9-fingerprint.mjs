/**
 * Read tsc logs and vitest JSON already produced by t9-check.sh.
 * Does not run the suite.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeText } from './t9-delta.mjs';

const errorLine = /^(?<file>.+?)\((?<line>\d+),(?<col>\d+)\): error (?<code>TS\d+): (?<msg>.*)$/;

function readText(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

export function parseTypecheck(logText, packageName) {
  const errors = [];
  let current = null;
  const flush = () => {
    if (!current) return;
    current.message = normalizeText(current.message);
    errors.push(current);
    current = null;
  };
  for (const line of logText.split(/\r?\n/)) {
    const match = errorLine.exec(line);
    if (match) {
      flush();
      let file = match.groups.file.replaceAll('\\', '/');
      for (const marker of ['packages/extension/', 'packages/wallet-core/']) {
        const index = file.indexOf(marker);
        if (index >= 0) file = file.slice(index + marker.length);
      }
      current = {
        package: packageName,
        file,
        line: Number(match.groups.line),
        code: match.groups.code,
        message: match.groups.msg,
      };
      continue;
    }
    const global = /^error (?<code>TS\d+): (?<msg>.*)$/.exec(line);
    if (global) {
      flush();
      errors.push({
        package: packageName,
        file: '<global>',
        line: 0,
        code: global.groups.code,
        message: normalizeText(global.groups.msg),
      });
      continue;
    }
    if (current && (line.startsWith(' ') || line.startsWith('\t'))) {
      current.message += ` ${line.trim()}`;
      continue;
    }
    if (current && line.trim() !== '') flush();
  }
  flush();
  return errors;
}

function testFile(name) {
  const normalized = String(name).replaceAll('\\', '/');
  const marker = '/packages/';
  const index = normalized.indexOf(marker);
  const rel = index >= 0 ? normalized.slice(index + marker.length) : normalized;
  if (rel.startsWith('wallet-core/')) return { package: 'wallet-core', file: rel.slice('wallet-core/'.length) };
  if (rel.startsWith('extension/')) return { package: 'extension', file: rel.slice('extension/'.length) };
  return { package: 'extension', file: rel };
}

export function parseVitest(jsonText) {
  if (!jsonText.trim()) return [];
  const data = JSON.parse(jsonText);
  const tests = [];
  for (const result of data.testResults ?? []) {
    const loc = testFile(result.name);
    for (const assertion of result.assertionResults ?? []) {
      const reason = Array.isArray(assertion.failureMessages) ? assertion.failureMessages[0] ?? '' : '';
      tests.push({
        package: loc.package,
        file: loc.file,
        fullName: assertion.fullName,
        status: assertion.status,
        reason: normalizeText(String(reason).split(/\r?\n/, 1)[0] ?? ''),
      });
    }
  }
  return tests;
}

function fields(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf('=');
    if (index > 0) out[line.slice(0, index)] = line.slice(index + 1);
  }
  return out;
}

function readExit(logDir, name) {
  const path = join(logDir, `${name}.exit`);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8').trim();
  if (text === '') return null;
  const value = Number(text);
  return Number.isInteger(value) ? value : null;
}

export function assembleFingerprint(logDir, git) {
  const tool = fields(`${readText(join(logDir, '00-toolchain.txt'))}\n${readText(join(logDir, '01-tool-versions-after-install.txt'))}`);
  const names = ['pnpm-install', 'typecheck-extension', 'typecheck-wallet-core', 'test-full-extension', 'test-full-wallet-core'];
  const exits = {};
  for (const name of names) exits[name] = readExit(logDir, name);
  const tests = [
    ...parseVitest(readText(join(logDir, 'test-full-extension.json'))),
    ...parseVitest(readText(join(logDir, 'test-full-wallet-core.json'))),
  ];
  return {
    git,
    toolchain: { node: tool.node ?? '', pnpm: tool.pnpm ?? '' },
    exits,
    errors: [
      ...parseTypecheck(readText(join(logDir, 'typecheck-extension.log')), 'extension'),
      ...parseTypecheck(readText(join(logDir, 'typecheck-wallet-core.log')), 'wallet-core'),
    ],
    tests,
  };
}

function arg(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : '';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const logDir = arg('--log-dir');
  const out = arg('--out');
  if (!logDir || !out) {
    process.stderr.write('usage: t9-fingerprint.mjs --log-dir DIR --out FILE --sha SHA\n');
    process.exit(2);
  }
  const fingerprint = assembleFingerprint(logDir, {
    sha: arg('--sha'),
    baseSha: arg('--base-sha'),
    headSha: arg('--head-sha'),
    mergeSha: arg('--merge-sha'),
  });
  writeFileSync(out, `${JSON.stringify(fingerprint)}\n`);
  process.stdout.write(`errors=${fingerprint.errors.length} tests=${fingerprint.tests.length}\n`);
}
