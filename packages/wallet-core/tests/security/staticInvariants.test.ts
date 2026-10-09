/**
 * staticInvariants.test.ts — Security invariants static analysis.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

function walkDir(dir: string): string[] {
  let results: string[] = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(walkDir(filePath));
    } else if (filePath.endsWith('.ts')) {
      results.push(filePath);
    }
  }
  return results;
}

const SRC_DIR = path.resolve(__dirname, '../../src');
const ALL_TS_FILES = walkDir(SRC_DIR);

describe('Security — Static Invariants', () => {
  it('no case-insensitive "mainnet" under src/', () => {
    for (const file of ALL_TS_FILES) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content.toLowerCase()).not.toContain('mainnet');
    }
  });

  it('no chrome.storage.session.setAccessLevel() under src/', () => {
    for (const file of ALL_TS_FILES) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).not.toMatch(/chrome\.storage\.session\.setAccessLevel\s*\(/);
    }
  });

  it('no imports from crypto/, vault/, signer/, or keyManager/ inside solana/', () => {
    const solanaFiles = ALL_TS_FILES.filter(f => f.includes(`${path.sep}solana${path.sep}`));
    for (const file of solanaFiles) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).not.toMatch(/from\s+['"].*\/crypto\/.*['"]/);
      expect(content).not.toMatch(/from\s+['"].*\/vault\/.*['"]/);
      expect(content).not.toMatch(/from\s+['"].*\/signer\/.*['"]/);
      expect(content).not.toMatch(/from\s+['"].*\/keyManager\/.*['"]/);
      
      // Also catch parent directory relative imports mapping to those directories
      expect(content).not.toMatch(/from\s+['"]\.\.\/crypto.*['"]/);
      expect(content).not.toMatch(/from\s+['"]\.\.\/\.\.\/crypto.*['"]/);
      expect(content).not.toMatch(/from\s+['"]\.\.\/vault.*['"]/);
      expect(content).not.toMatch(/from\s+['"]\.\.\/\.\.\/vault.*['"]/);
      expect(content).not.toMatch(/from\s+['"]\.\.\/signer.*['"]/);
      expect(content).not.toMatch(/from\s+['"]\.\.\/\.\.\/signer.*['"]/);
      expect(content).not.toMatch(/from\s+['"]\.\.\/keyManager.*['"]/);
      expect(content).not.toMatch(/from\s+['"]\.\.\/\.\.\/keyManager.*['"]/);
    }
  });

  it('no console.* inside solana/', () => {
    const solanaFiles = ALL_TS_FILES.filter(f => f.includes(`${path.sep}solana${path.sep}`));
    for (const file of solanaFiles) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).not.toMatch(/console\.(log|info|warn|error|debug|trace|dir)/);
    }
  });

  it('no @solana/web3.js or @solana/spl-token imports under src/', () => {
    for (const file of ALL_TS_FILES) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).not.toContain('@solana/web3.js');
      expect(content).not.toContain('@solana/spl-token');
    }
  });
});
