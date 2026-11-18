import { describe, expect, it, vi } from 'vitest';
import { STELLAR_SOROBAN_TESTNET_RPC } from '@solanym/wallet-core/src/stellar/spp/sppNymOption.js';
import {
  STELLAR_MIXFETCH_TESTNET_HORIZON_URL,
  createStellarTransportFetch,
  rewriteSdfHorizonUrlForMixFetch,
} from '../../../src/background/nym/stellarTransportFetch.js';
import {
  STELLAR_LOGICAL_MAINNET_HORIZON_URL,
  STELLAR_LOGICAL_TESTNET_HORIZON_URL,
  STELLAR_NYM_EFFECTIVE_MAINNET_HORIZON_DEFAULT,
  STELLAR_NYM_EFFECTIVE_TESTNET_HORIZON_DEFAULT,
} from '../../../src/background/nym/stellarHorizonNymConfig.js';

const JSON_RPC_BODY = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' });

function nymHarness() {
  const fetchViaRouter = vi.fn(async (_url: string, _init?: RequestInit) => {
    return new Response('{"ok":true}', { status: 200 });
  });
  const fetchImpl = createStellarTransportFetch({
    getMode: () => 'nym',
    fetchViaRouter,
    nymTimeoutMs: 5_000,
  });
  return { fetchViaRouter, fetchImpl };
}

describe('createStellarTransportFetch', () => {
  it('nym mode remaps SDF logical URL, sets unsafe-ignore-cors, strips AbortSignal', async () => {
    const fetchViaRouter = vi.fn(async (url: string, init?: RequestInit & { mode?: string }) => {
      expect(url).toBe(`${STELLAR_MIXFETCH_TESTNET_HORIZON_URL}/fee_stats`);
      expect(init?.mode).toBe('unsafe-ignore-cors');
      expect(init?.method).toBe('GET');
      expect(init?.redirect).toBe('error');
      expect(init?.signal).toBeUndefined();
      const headers = new Headers(init?.headers);
      expect(headers.get('accept')).toBe('application/json');
      expect(headers.get('cookie')).toBeNull();
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
      headers: { Accept: 'application/json', Cookie: 'session=secret' },
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

  it('preserves Horizon GET for account, ledger, and transaction lookups', async () => {
    const { fetchViaRouter, fetchImpl } = nymHarness();
    const paths = ['/accounts/GABC', '/ledgers/2', '/transactions/abc'];
    for (const path of paths) {
      fetchViaRouter.mockClear();
      await fetchImpl(`${STELLAR_LOGICAL_TESTNET_HORIZON_URL}${path}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      const call = fetchViaRouter.mock.calls[0];
      expect(call?.[0]).toBe(`${STELLAR_NYM_EFFECTIVE_TESTNET_HORIZON_DEFAULT}${path}`);
      expect(call?.[1]?.method).toBe('GET');
      expect(call?.[1]?.body).toBeUndefined();
      expect(call?.[1]?.signal).toBeUndefined();
    }
  });

  it('preserves Soroban RPC JSON-RPC POST and its body', async () => {
    const { fetchViaRouter, fetchImpl } = nymHarness();
    await fetchImpl(STELLAR_SOROBAN_TESTNET_RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'session=secret' },
      body: JSON_RPC_BODY,
    });
    const call = fetchViaRouter.mock.calls[0];
    expect(call?.[0]).toBe(new URL(STELLAR_SOROBAN_TESTNET_RPC).href);
    expect(call?.[1]?.method).toBe('POST');
    expect(call?.[1]?.body).toBe(JSON_RPC_BODY);
    const headers = new Headers(call?.[1]?.headers);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('cookie')).toBeNull();

    fetchViaRouter.mockClear();
    await fetchImpl(STELLAR_SOROBAN_TESTNET_RPC, { body: JSON_RPC_BODY });
    const omitted = fetchViaRouter.mock.calls[0];
    expect(omitted?.[1]?.method).toBe('POST');
    expect(omitted?.[1]?.body).toBe(JSON_RPC_BODY);
  });

  it('rejects a non-allowlisted host and does not call the router', async () => {
    const { fetchViaRouter, fetchImpl } = nymHarness();
    await expect(
      fetchImpl('https://evil.example/accounts/GABC', { method: 'GET' }),
    ).rejects.toThrow(/non-allowlisted host: evil\.example.*no clearnet fallback/);
    expect(fetchViaRouter).not.toHaveBeenCalled();
  });

  it('refuses a body on Horizon GET', async () => {
    const { fetchViaRouter, fetchImpl } = nymHarness();
    await expect(
      fetchImpl(`${STELLAR_LOGICAL_TESTNET_HORIZON_URL}/accounts/GABC`, {
        method: 'GET',
        body: JSON_RPC_BODY,
      }),
    ).rejects.toThrow(/refused body on GET/);
    await expect(
      fetchImpl(`${STELLAR_LOGICAL_TESTNET_HORIZON_URL}/accounts/GABC`, {
        method: 'HEAD',
        body: 'x',
      }),
    ).rejects.toThrow(/refused body on HEAD/);
    expect(fetchViaRouter).not.toHaveBeenCalled();
  });

  it('refuses methods other than GET, HEAD, and POST', async () => {
    const { fetchViaRouter, fetchImpl } = nymHarness();
    for (const method of ['PUT', 'DELETE', 'PATCH']) {
      fetchViaRouter.mockClear();
      await expect(
        fetchImpl(`${STELLAR_LOGICAL_TESTNET_HORIZON_URL}/accounts/GABC`, { method }),
      ).rejects.toThrow(new RegExp(`refused method: ${method}`));
      expect(fetchViaRouter).not.toHaveBeenCalled();
    }
  });

  it('refuses mainnet Horizon and Ankr mainnet hosts', async () => {
    const { fetchViaRouter } = nymHarness();
    const onResolved = vi.fn();
    const guarded = createStellarTransportFetch({
      getMode: () => 'nym',
      fetchViaRouter,
      nymTimeoutMs: 5_000,
      onResolved,
    });
    await expect(
      guarded(`${STELLAR_LOGICAL_MAINNET_HORIZON_URL}/accounts/GABC`, { method: 'GET' }),
    ).rejects.toThrow(/non-allowlisted host: horizon\.stellar\.org/);
    await expect(
      guarded(`${STELLAR_NYM_EFFECTIVE_MAINNET_HORIZON_DEFAULT}/accounts/GABC`, { method: 'GET' }),
    ).rejects.toThrow(/non-allowlisted host: rpc\.ankr\.com/);
    expect(fetchViaRouter).not.toHaveBeenCalled();
    expect(onResolved).not.toHaveBeenCalled();
  });

  it('allows Testnet Friendbot GET without body in Nym mode and strips AbortSignal', async () => {
    const fetchViaRouter = vi.fn(async (url: string, init?: RequestInit & { mode?: string }) => {
      expect(url).toBe('https://friendbot.stellar.org/?addr=GABC');
      expect(init?.method).toBe('GET');
      expect(init?.body).toBeUndefined();
      expect(init?.mode).toBe('unsafe-ignore-cors');
      expect(init?.redirect).toBe('error');
      expect(init?.signal).toBeUndefined();
      const headers = new Headers(init?.headers);
      expect(headers.get('accept')).toBe('application/json');
      expect(headers.get('cookie')).toBeNull();
      return new Response('{"hash":"tx123"}', { status: 200 });
    });
    const onResolved = vi.fn();
    const fetchImpl = createStellarTransportFetch({
      getMode: () => 'nym',
      getNetwork: () => 'testnet',
      fetchViaRouter,
      nymTimeoutMs: 5_000,
      onResolved,
    });

    const res = await fetchImpl('https://friendbot.stellar.org?addr=GABC', {
      headers: { Accept: 'application/json', Cookie: 'session=secret' },
      signal: AbortSignal.timeout(1000),
    });
    expect(res.status).toBe(200);
    expect(fetchViaRouter).toHaveBeenCalledOnce();
    expect(onResolved).toHaveBeenCalledWith(
      expect.objectContaining({
        rewritten: false,
        logicalUrl: 'https://friendbot.stellar.org?addr=GABC',
        effectiveUrl: 'https://friendbot.stellar.org?addr=GABC',
      }),
    );
  });

  it('refuses non-GET methods, bodies, and non-Testnet networks for Friendbot in Nym mode', async () => {
    const { fetchViaRouter, fetchImpl } = nymHarness();
    for (const method of ['POST', 'HEAD', 'PUT']) {
      await expect(
        fetchImpl('https://friendbot.stellar.org?addr=GABC', { method }),
      ).rejects.toThrow(new RegExp(`refused method: ${method}`));
    }
    await expect(
      fetchImpl('https://friendbot.stellar.org?addr=GABC', {
        method: 'GET',
        body: 'addr=GABC',
      }),
    ).rejects.toThrow(/refused body on GET/);
    await expect(
      fetchImpl('https://friendbot.stellar.org/other?addr=GABC', { method: 'GET' }),
    ).rejects.toThrow(/non-allowlisted host: friendbot\.stellar\.org/);
    expect(fetchViaRouter).not.toHaveBeenCalled();

    const mainnetFetch = createStellarTransportFetch({
      getMode: () => 'nym',
      getNetwork: () => 'mainnet',
      fetchViaRouter,
      nymTimeoutMs: 5_000,
    });
    await expect(
      mainnetFetch('https://friendbot.stellar.org?addr=GABC', { method: 'GET' }),
    ).rejects.toThrow(/non-allowlisted host: friendbot\.stellar\.org/);
    expect(fetchViaRouter).not.toHaveBeenCalled();
  });

  it('stays fail-closed for Friendbot when Nym router is disconnected', async () => {
    const fetchViaRouter = vi.fn(async () => {
      throw Object.assign(
        new Error('Nym mode enabled but mixnet is not connected; refusing clearnet fallback'),
        { code: 'NOT_CONNECTED' },
      );
    });
    const fetchImpl = createStellarTransportFetch({
      getMode: () => 'nym',
      getNetwork: () => 'testnet',
      fetchViaRouter,
      nymTimeoutMs: 5_000,
    });
    await expect(
      fetchImpl('https://friendbot.stellar.org?addr=GABC', { method: 'GET' }),
    ).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    expect(fetchViaRouter).toHaveBeenCalledOnce();
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
