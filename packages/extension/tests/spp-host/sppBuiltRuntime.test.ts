/**
 * Loads the runtime produced by scripts/prepare-spp-runtime.sh.
 * Set SPP_SDK_ROOT to sdk/web of that build. Does not sign or open a network client.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { inspectSppSdkFacade } from '../../src/spp-host/sdkLoad.js';

const SOURCE_COMMIT = 'e6ce95c2a71ed6313f78bb19cfdd0de1d9663120';

function sdkRoot(): string {
  const root = process.env['SPP_SDK_ROOT'];
  if (!root) {
    throw new Error('SPP_SDK_ROOT is required. Run scripts/prepare-spp-runtime.sh and point it at sdk/web.');
  }
  return root;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('built SPP runtime', () => {
  it('rejects an altered wasm against the committed manifest', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const manifest = JSON.parse(readFileSync(join(
      here,
      '../../../wallet-core/src/stellar/spp/nethermind/spp-runtime-manifest.json',
    ), 'utf8')) as {
      files: Record<string, { sha256: string }>;
    };
    const expected = manifest.files['dist/stellar_private_payments_web_bg.wasm']!.sha256;
    const bytes = Buffer.from(readFileSync(join(sdkRoot(), 'dist/stellar_private_payments_web_bg.wasm')));
    expect(sha256(bytes)).toBe(expected);
    const altered = Buffer.from(bytes);
    altered[0] = altered[0]! ^ 0xff;
    expect(sha256(altered)).not.toBe(expected);
  });

  it('initializes the real wasm and exposes the host API without opening the network', async () => {
    const root = sdkRoot();
    const provenance = JSON.parse(readFileSync(join(root, 'SPP_SOURCE_PROVENANCE.json'), 'utf8')) as {
      sourceCommit: string;
    };
    expect(provenance.sourceCommit).toBe(SOURCE_COMMIT);

    const wasmPath = join(root, 'dist/stellar_private_payments_web_bg.wasm');
    const wasm = readFileSync(wasmPath);
    expect(wasm.includes(Buffer.from('Privacy Pool Key Derivation [v3]'))).toBe(true);
    expect(wasm.includes(Buffer.from('note_key_proof'))).toBe(true);
    expect(wasm.includes(Buffer.from('Privacy Pool Key Derivation [v2]'))).toBe(false);

    const mod = await import(pathToFileURL(join(root, 'dist/stellar_private_payments_web.js')).href) as Record<string, unknown>;
    const inspection = inspectSppSdkFacade(mod);
    expect(inspection.hasDefaultInit).toBe(true);
    expect(inspection.hasClientNew).toBe(true);
    expect(inspection.hasStorageOpen).toBe(true);

    const init = mod['default'] as (opts: { module_or_path: Buffer }) => Promise<unknown>;
    await init({ module_or_path: wasm });
    const parseTokenAmount = mod['parseTokenAmount'] as (value: string, decimals: number) => bigint;
    expect(parseTokenAmount('1.5', 7)).toBe(15_000_000n);

    const fetches: string[] = [];
    const previous = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetches.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      throw new Error('network blocked');
    }) as typeof fetch;
    try {
      const Client = mod['Client'] as { new: (...args: unknown[]) => unknown };
      expect(() => Client.new('http://127.0.0.1:9/rpc', null, null, {})).toThrow(/StorageHandle/);
      expect(fetches).toEqual([]);
    } finally {
      globalThis.fetch = previous;
    }

    const storageLoader = readFileSync(join(root, 'dist/workers/storage-worker.js'), 'utf8');
    const proverLoader = readFileSync(join(root, 'dist/workers/prover-worker.js'), 'utf8');
    expect(storageLoader).toContain("import init from './storage-worker-module.js'");
    expect(proverLoader).toContain("import init from './prover-worker-module.js'");
    expect(proverLoader).toContain('__STELLAR_PRIVATE_PAYMENTS_CIRCUITS_BASE__');
    expect(proverLoader).toContain('../circuits/');

    const circuits = JSON.parse(readFileSync(join(root, 'dist/circuits/circuits.json'), 'utf8')) as { version: string; keyOwnership?: unknown };
    expect(circuits.version).toBe('0.7');
    expect(circuits.keyOwnership).toBeTruthy();
  });
});
