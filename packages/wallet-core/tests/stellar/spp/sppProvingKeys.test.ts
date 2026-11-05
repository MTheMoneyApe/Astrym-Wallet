import { describe, expect, it, vi } from 'vitest';
import {
  listCircuitArtifactNames,
  listCircuitIds,
  parseCircuitLock,
  probeSppProvingKeys,
  probeSppProvingKeysOnDisk,
  resolveCircuitArtifactUrl,
  SPP_PACKAGED_CIRCUIT_COUNT_0_2_1,
} from '../../../src/stellar/spp/sppProvingKeys.js';

const lock = {
  version: '0.6',
  meta: { repository: 'NethermindEth/stellar-private-payments' },
  policy_tx_2_2: {
    r1cs: 'aa',
    'graph.bin': 'bb',
    'proving_key.bin': 'cc',
  },
};

describe('sppProvingKeys', () => {
  it('parses circuit locks and lists circuit ids', () => {
    expect(() => parseCircuitLock({ labPlaceholder: true })).toThrow(/labPlaceholder/);
    const parsed = parseCircuitLock(lock);
    expect(listCircuitIds(parsed)).toEqual(['policy_tx_2_2']);
    expect(listCircuitArtifactNames('policy_tx_2_2')).toEqual([
      'policy_tx_2_2.r1cs',
      'policy_tx_2_2.graph.bin',
      'policy_tx_2_2_proving_key.bin',
    ]);
    expect(SPP_PACKAGED_CIRCUIT_COUNT_0_2_1).toBe(16);
  });

  it('reports missing proving keys without inventing readiness', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 404 }));
    const result = await probeSppProvingKeys({
      circuitsBaseUrl: 'chrome-extension://id/spp/dist/circuits/',
      lock: parseCircuitLock(lock),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('missing_proving_keys');
      expect(result.missing.length).toBeGreaterThan(0);
    }
  });

  it('accepts present artifacts via HEAD ok', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 }));
    const result = await probeSppProvingKeys({
      circuitsBaseUrl: 'chrome-extension://id/spp/dist/circuits/',
      lock: parseCircuitLock(lock),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(true);
  });

  it('resolves path-absolute webapp bases without URL constructor', () => {
    expect(resolveCircuitArtifactUrl('/spp/dist/circuits/', 'circuits.json')).toBe(
      '/spp/dist/circuits/circuits.json',
    );
    expect(
      resolveCircuitArtifactUrl('chrome-extension://id/spp/dist/circuits/', 'a.bin'),
    ).toBe('chrome-extension://id/spp/dist/circuits/a.bin');
  });

  it('probes proving keys under path-absolute bases', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(String(url).startsWith('/spp/dist/circuits/')).toBe(true);
      return new Response('', { status: 200 });
    });
    const result = await probeSppProvingKeys({
      circuitsBaseUrl: '/spp/dist/circuits/',
      lock: parseCircuitLock(lock),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(true);
  });

  it('probes proving keys on disk without inventing readiness', () => {
    const present = new Set([
      '/circuits/policy_tx_2_2.r1cs',
      '/circuits/policy_tx_2_2.graph.bin',
      '/circuits/policy_tx_2_2_proving_key.bin',
    ]);
    const ok = probeSppProvingKeysOnDisk({
      circuitsDir: '/circuits',
      lock: parseCircuitLock(lock),
      existsSync: (p) => present.has(p),
      joinPath: (...parts) => parts.join('/').replace(/\/{2,}/g, '/'),
    });
    expect(ok.ok).toBe(true);

    const missing = probeSppProvingKeysOnDisk({
      circuitsDir: '/circuits',
      lock: parseCircuitLock(lock),
      existsSync: () => false,
      joinPath: (...parts) => parts.join('/').replace(/\/{2,}/g, '/'),
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.reason).toBe('missing_proving_keys');
      expect(missing.missing).toContain('policy_tx_2_2_proving_key.bin');
    }
  });
});
