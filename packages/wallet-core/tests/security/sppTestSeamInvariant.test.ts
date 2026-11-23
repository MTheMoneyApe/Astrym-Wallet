/**
 * Production src must not import or export the SPP test seams.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const FORBIDDEN = [
  'setSppPaymentIdentityChecksForTests',
  'runSppProbedPoolPayment',
] as const;

const SRC_DIRS = [
  path.resolve(__dirname, '../../src'),
  path.resolve(__dirname, '../../../extension/src'),
];

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...walk(full));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

/** True when `symbol` is bound by an import or export, not merely declared. */
function importsOrExportsSymbol(source: string, symbol: string): boolean {
  const code = stripComments(source);
  const name = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const ident = new RegExp(`\\b${name}\\b`);
  const exportHeader = new RegExp(
    `^\\s*export\\s+(?:async\\s+)?(?:function|const|let|var|class)\\s+${name}\\b`,
    'm',
  );
  if (exportHeader.test(code)) return true;
  const clause = /\b(?:import|export)\s+(?:type\s+)?\{([^{}]*)\}/g;
  for (const match of code.matchAll(clause)) {
    if (ident.test(match[1] ?? '')) return true;
  }
  return new RegExp(`^\\s*import\\s+${name}\\s+from\\b`, 'm').test(code);
}

describe('SPP test seams stay out of src', () => {
  it('flags an import or export and ignores a private declaration', () => {
    expect(importsOrExportsSymbol(
      'export function setSppPaymentIdentityChecksForTests(enabled: boolean): void {}',
      'setSppPaymentIdentityChecksForTests',
    )).toBe(true);
    expect(importsOrExportsSymbol(
      'export async function runSppProbedPoolPayment() { return null; }',
      'runSppProbedPoolPayment',
    )).toBe(true);
    expect(importsOrExportsSymbol(
      "import {\n  runSppProbedPoolPayment,\n} from './sppNymOption.js';",
      'runSppProbedPoolPayment',
    )).toBe(true);
    expect(importsOrExportsSymbol(
      'async function runSppProbedPoolPayment() { return null; }',
      'runSppProbedPoolPayment',
    )).toBe(false);
  });

  it('nothing under src/ imports or exports the test-only symbols', () => {
    const hits: string[] = [];
    for (const dir of SRC_DIRS) {
      for (const file of walk(dir)) {
        const source = fs.readFileSync(file, 'utf8');
        for (const symbol of FORBIDDEN) {
          if (importsOrExportsSymbol(source, symbol)) {
            hits.push(`${path.relative(path.resolve(__dirname, '../../../..'), file)} exports or imports ${symbol}`);
          }
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
