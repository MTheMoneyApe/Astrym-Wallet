import { describe, expect, it, vi } from 'vitest';
import {
  STELLAR_MIXFETCH_TESTNET_HORIZON_URL,
  createStellarTransportFetch,
  rewriteSdfHorizonUrlForMixFetch,
} from '../../../src/background/nym/stellarTransportFetch.js';
import {
  STELLAR_LOGICAL_TESTNET_HORIZON_URL,
  STELLAR_NYM_EFFECTIVE_TESTNET_HORIZON_DEFAULT,
} from '../../../src/background/nym/stellarHorizonNymConfig.js';

describe('createStellarTransportFetch', () => {
  it('nym mode remaps SDF logical URL, sets unsafe-ignore-cors, strips AbortSignal', async () => {
    const fetchViaRouter = vi.fn(async (url: string, init?: RequestInit & { mode?: string }) => {
      expect(url).toBe(`${STELLAR_MIXFETCH_TESTNET_HORIZON_URL}/fee_stats`);
      expect(init?.mode).toBe('unsafe-ignore-cors');
      expect(init?.signal).toBeUndefined();
      return new Response('{"ok":true}', { status: 200 });
    });
    const onResolved = vi.fn();
    const fetchImpl = createStellarTransportFetch({
      getMode: () => 'nym',
      fetchViaRouter,
      nymTimeoutMs: 5_000,
      onResolved,
    });
    const res = await fetchImpl('https://horizon-testnet.stellar.org/fee_stats', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(1000),
    });
    expect(res.status).toBe(200);
    expect(fetchViaRouter).toHaveBeenCalledOnce();
    expect(onResolved).toHaveBeenCalledWith(
      expect.objectContaining({
        rewritten: true,
        logicalUrl: 'https://horizon-testnet.stellar.org/fee_stats',
        effectiveUrl: `${STELLAR_NYM_EFFECTIVE_TESTNET_HORIZON_DEFAULT}/fee_stats`,
      }),
    );
  });

  it('direct mode preserves AbortSignal, URL, and does not set cors mode', async () => {
    const signal = AbortSignal.timeout(5_000);
    const fetchViaRouter = vi.fn(async (url: string, init?: RequestInit & { mode?: string }) => {
      expect(url).toBe('https://horizon-testnet.stellar.org/');
      expect(init?.mode).toBeUndefined();
      expect(init?.signal).toBe(signal);
      return new Response('ok', { status: 200 });
    });
    const fetchImpl = createStellarTransportFetch({
      getMode: () => 'direct',
      fetchViaRouter,
    });
    await fetchImpl('https://horizon-testnet.stellar.org/', { signal });
    expect(fetchViaRouter).toHaveBeenCalledOnce();
  });

  it('nym timeout error cites logical and effective URLs', async () => {
    const fetchImpl = createStellarTransportFetch({
      getMode: () => 'nym',
      fetchViaRouter: () => new Promise(() => {}),
      nymTimeoutMs: 30,
    });
    await expect(
      fetchImpl(`${STELLAR_LOGICAL_TESTNET_HORIZON_URL}/fee_stats`),
    ).rejects.toThrow(/logical=.*effective=.*no clearnet fallback/);
  });
});

describe('rewriteSdfHorizonUrlForMixFetch', () => {
  it('rewrites SDF testnet Horizon path onto Ankr MixFetch base', () => {
    expect(
      rewriteSdfHorizonUrlForMixFetch(
        'https://horizon-testnet.stellar.org/accounts/GABC',
      ),
    ).toBe(`${STELLAR_MIXFETCH_TESTNET_HORIZON_URL}/accounts/GABC`);
  });

  it('leaves non-SDF hosts unchanged', () => {
    const url = `${STELLAR_MIXFETCH_TESTNET_HORIZON_URL}/fee_stats`;
    expect(rewriteSdfHorizonUrlForMixFetch(url)).toBe(url);
  });
});
