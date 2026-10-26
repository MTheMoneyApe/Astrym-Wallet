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

describe('Extension Security — Static Invariants', () => {
  it('no chrome.storage.session.setAccessLevel() in extension code', () => {
    for (const file of ALL_TS_FILES) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).not.toMatch(/chrome\.storage\.session\.setAccessLevel\s*\(/);
      expect(content).not.toMatch(/browser\.storage\.session\.setAccessLevel\s*\(/);
    }
  });

  it('no @solana/web3.js or @solana/spl-token imports in extension code', () => {
    for (const file of ALL_TS_FILES) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).not.toContain('@solana/web3.js');
      expect(content).not.toContain('@solana/spl-token');
    }
  });

  it('no direct usage of fetch (must use ITransport/RpcClient)', () => {
    for (const file of ALL_TS_FILES) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).not.toMatch(/\Wfetch\s*\(/);
    }
  });

  it('no console logging of sensitive variables', () => {
    for (const file of ALL_TS_FILES) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).not.toMatch(/console\.(log|info|warn|error|debug)\(.*(?:password|seed|mnemonic|secret|private).*?\)/i);
    }
  });

  it('timers: setInterval banned; setTimeout only on explicit allowlisted paths', () => {
    // Policy:
    // - Vault auto-lock / SW lifecycle MUST use chrome.alarms (IAlarmService), never setTimeout.
    // - setInterval is banned everywhere in extension src.
    // - setTimeout is banned by default; only the exact relative paths below are allowed,
    //   each for a documented non-lifecycle reason. Do not broaden this set casually.
    //
    // Allowed:
    // - background/StateCoordinator.ts — bounded signature-drain wait during lock (SIGNATURE_DRAIN_TIMEOUT_MS).
    // - background/dapp/PendingRequestManager.ts — expire pending connect/sign requests in-memory.
    // - popup/{Send,Dashboard,Onboarding}.tsx — short-lived clipboard/copy UI feedback only.
    const setTimeoutAllowlist = new Set(
      [
        'background/StateCoordinator.ts',
        'background/dapp/PendingRequestManager.ts',
        'popup/Send.tsx',
        'popup/Dashboard.tsx',
        'popup/Onboarding.tsx',
      ].map((rel) => path.normalize(rel)),
    );

    for (const file of ALL_TS_FILES) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).not.toMatch(/\WsetInterval\s*\(/);

      const rel = path.normalize(path.relative(SRC_DIR, file));
      if (setTimeoutAllowlist.has(rel)) {
        continue;
      }
      expect(content).not.toMatch(/\WsetTimeout\s*\(/);
    }
  });

  it('no secret-bearing properties in IPC response schemas', () => {
    // Statically check that ipcSchemas.ts does not define any properties
    // named mnemonic, seed, privateKey, secretKey, password, vaultContents, CryptoKey
    const ipcSchemasPath = path.resolve(__dirname, '../../src/shared/ipcSchemas.ts');
    const content = fs.readFileSync(ipcSchemasPath, 'utf8');
    
    const forbiddenProps = [
      'mnemonic',
      'seed',
      'privateKey',
      'secretKey',
      'password', // Although request can have it, response shouldn't. Wait, the rule is "no secret fields in IPC response schemas". It's hard to distinguish request vs response statically via regex, so we just ban these words generally in the file except where explicitly known (like UnlockVaultRequestSchema).
      'vaultContents',
      'CryptoKey'
    ];

    // Check response schemas specifically by doing a simple line-by-line or block check,
    // or just ensure these words don't appear anywhere in the file (except password in request).
    for (const prop of forbiddenProps) {
      if (prop === 'password') {
        // Only allow password inside known schemas
        let withoutRequest = content.replace(/UnlockVaultRequestSchema[\s\S]*?password[\s\S]*?}/, '');
        withoutRequest = withoutRequest.replace(/CreateVaultRequestSchema[\s\S]*?password[\s\S]*?}/, '');
        withoutRequest = withoutRequest.replace(/ImportVaultRequestSchema[\s\S]*?password[\s\S]*?}/, '');
        expect(withoutRequest).not.toContain(prop);
      } else {
        expect(content).not.toContain(prop);
      }
    }
  });
});
