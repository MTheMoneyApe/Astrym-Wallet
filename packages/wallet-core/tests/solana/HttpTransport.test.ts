/**
 * HttpTransport.test.ts — Guarded Devnet transport tests (Phase 5a).
 *
 * The global fetch is stubbed with vi.stubGlobal — NO live network calls.
 * Kit's HTTP transport calls the global `fetch` at request time, so the stub
 * intercepts every request made through createDefaultRpcTransport().
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { address, isSolanaError } from '@solana/kit';
import { NetworkConfigError, resolveNetworkConfig, type NetworkConfig } from '../../src/solana/rpc/endpoints.js';
import { createRpcClient } from '../../src/solana/rpc/RpcClient.js';
import {
  ALLOWED_RPC_METHODS,
  DEFAULT_RPC_TIMEOUT_MS,
  RpcMethodNotAllowedError,
  RpcTimeoutError,
  createHttpTransport,
} from '../../src/solana/transport/HttpTransport.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEVNET = 'https://api.devnet.solana.com';
const CONFIG: NetworkConfig = resolveNetworkConfig(DEVNET);
const CANARY = 'CANARY_abandon_secret_7f3a';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';

type FetchInit = {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  credentials?: string;
};

function okResponse(bodyText: string): Response {
  return new Response(bodyText, { status: 200, headers: { 'content-type': 'application/json' } });
}

/** A fetch stub that answers every request with a JSON-RPC envelope. */
function envelopeFetch(result: unknown = 'ok') {
  return vi.fn(async (_url: string, init: FetchInit) => {
    const req = JSON.parse(init.body ?? '{}') as { id?: string };
    return okResponse(JSON.stringify({ jsonrpc: '2.0', id: req.id ?? '0', result }));
  });
}

/** A fetch stub that never resolves until its signal aborts. */
function hangingFetch() {
  return vi.fn(
    (_url: string, init: FetchInit) =>
      new Promise<Response>((_resolve, reject) => {
        if (init.signal?.aborted) {
          reject(init.signal.reason);
          return;
        }
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      }),
  );
}

function payload(method: string, params: unknown = [], id = '1') {
  return { jsonrpc: '2.0', id, method, params };
}

function lastInit(fetchMock: ReturnType<typeof vi.fn>): FetchInit {
  const call = fetchMock.mock.calls.at(-1);
  return (call?.[1] ?? {}) as FetchInit;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── Policy constants ─────────────────────────────────────────────────────────

describe('HttpTransport — policy constants', () => {
  it('allowlist contains exactly the nine approved methods', () => {
    expect([...ALLOWED_RPC_METHODS].sort()).toEqual(
      [
        'getAccountInfo',
        'getBalance',
        'getFeeForMessage',
        'getGenesisHash',
        'getLatestBlockhash',
        'getMinimumBalanceForRentExemption',
        'getSignatureStatuses',
        'getTokenAccountsByOwner',
        'sendTransaction',
      ].sort(),
    );
  });

  it('allowlist does not contain requestAirdrop', () => {
    expect((ALLOWED_RPC_METHODS as readonly string[]).includes('requestAirdrop')).toBe(false);
  });

  it('allowlist is frozen', () => {
    expect(Object.isFrozen(ALLOWED_RPC_METHODS)).toBe(true);
  });

  it('default timeout is 30 seconds', () => {
    expect(DEFAULT_RPC_TIMEOUT_MS).toBe(30_000);
  });
});

// ─── Construction / config validation ─────────────────────────────────────────

describe('HttpTransport — construction', () => {
  it('creates a callable transport for a valid Devnet config', () => {
    expect(typeof createHttpTransport(CONFIG)).toBe('function');
  });

  it('re-validates the URL: a hand-built config with another host is rejected', () => {
    const forged = { network: 'devnet', rpcUrl: 'https://evil.example' } as unknown as NetworkConfig;
    expect(() => createHttpTransport(forged)).toThrow(NetworkConfigError);
  });

  it('rejects a hand-built config with a non-devnet network', () => {
    const forged = { network: 'testnet', rpcUrl: DEVNET } as unknown as NetworkConfig;
    expect(() => createHttpTransport(forged)).toThrow(NetworkConfigError);
  });

  it.each([0, -1, 30_001, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects out-of-range timeoutMs %p',
    (timeoutMs) => {
      expect(() => createHttpTransport(CONFIG, { timeoutMs })).toThrow(RangeError);
    },
  );

  it('accepts timeoutMs equal to the 30 s maximum', () => {
    expect(() => createHttpTransport(CONFIG, { timeoutMs: 30_000 })).not.toThrow();
  });
});

// ─── Allowed methods are forwarded ────────────────────────────────────────────

describe('HttpTransport — allowed methods are forwarded', () => {
  it.each([...ALLOWED_RPC_METHODS])('forwards %s to the fixed Devnet URL', async (method) => {
    const fetchMock = envelopeFetch();
    vi.stubGlobal('fetch', fetchMock);
    const transport = createHttpTransport(CONFIG);

    await transport({ payload: payload(method) });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(DEVNET);
    const body = JSON.parse(lastInit(fetchMock).body ?? '{}') as { method: string; jsonrpc: string };
    expect(body.method).toBe(method);
    expect(body.jsonrpc).toBe('2.0');
  });

  it('sends a POST with the payload serialised as the body', async () => {
    const fetchMock = envelopeFetch();
    vi.stubGlobal('fetch', fetchMock);
    const transport = createHttpTransport(CONFIG);
    const p = payload('getBalance', [SYSTEM_PROGRAM], '77');

    await transport({ payload: p });

    const init = lastInit(fetchMock);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body ?? '{}')).toEqual(p);
  });
});

// ─── Forbidden methods / malformed payloads ───────────────────────────────────

describe('HttpTransport — forbidden methods are rejected before fetch', () => {
  it.each([
    'requestAirdrop',
    'simulateTransaction',
    'getProgramAccounts',
    'getMultipleAccounts',
    'getSignaturesForAddress',
    'getTransaction',
    'getVersion',
    'eth_sendTransaction',
    '',
    'GETBALANCE',
    'getBalance ',
  ])('rejects %p', async (method) => {
    const fetchMock = envelopeFetch();
    vi.stubGlobal('fetch', fetchMock);
    const transport = createHttpTransport(CONFIG);

    await expect(transport({ payload: payload(method) })).rejects.toBeInstanceOf(
      RpcMethodNotAllowedError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('explicitly rejects requestAirdrop without any network request', async () => {
    const fetchMock = envelopeFetch();
    vi.stubGlobal('fetch', fetchMock);
    const transport = createHttpTransport(CONFIG);

    await expect(
      transport({ payload: payload('requestAirdrop', [SYSTEM_PROGRAM, 1_000_000_000]) }),
    ).rejects.toBeInstanceOf(RpcMethodNotAllowedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('HttpTransport — batch and malformed payloads are rejected before fetch', () => {
  it.each<[string, unknown]>([
    ['batch of one allowed request', [payload('getBalance')]],
    ['batch of two allowed requests', [payload('getBalance'), payload('getGenesisHash', [], '2')]],
    ['empty batch', []],
    ['null payload', null],
    ['undefined payload', undefined],
    ['string payload', '{"jsonrpc":"2.0","method":"getBalance","params":[]}'],
    ['missing jsonrpc', { id: '1', method: 'getBalance', params: [] }],
    ['wrong jsonrpc version', { jsonrpc: '1.0', id: '1', method: 'getBalance', params: [] }],
    ['missing params', { jsonrpc: '2.0', id: '1', method: 'getBalance' }],
    ['non-string method', { jsonrpc: '2.0', id: '1', method: 42, params: [] }],
  ])('rejects %s', async (_label, bad) => {
    const fetchMock = envelopeFetch();
    vi.stubGlobal('fetch', fetchMock);
    const transport = createHttpTransport(CONFIG);

    await expect(transport({ payload: bad })).rejects.toBeInstanceOf(RpcMethodNotAllowedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejection error message never contains payload data', async () => {
    vi.stubGlobal('fetch', envelopeFetch());
    const transport = createHttpTransport(CONFIG);

    const err = await transport({ payload: payload(`requestAirdrop_${CANARY}`, [CANARY]) }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RpcMethodNotAllowedError);
    expect((err as Error).message).not.toContain(CANARY);
    expect((err as Error).message).not.toContain('requestAirdrop');
  });
});

// ─── Timeout ──────────────────────────────────────────────────────────────────

describe('HttpTransport — timeout', () => {
  it('applies AbortSignal.timeout(30_000) by default', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal('fetch', envelopeFetch());
    const transport = createHttpTransport(CONFIG);

    await transport({ payload: payload('getGenesisHash') });

    expect(timeoutSpy).toHaveBeenCalledWith(30_000);
  });

  it('applies a custom timeoutMs when provided (test-only override)', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal('fetch', envelopeFetch());
    const transport = createHttpTransport(CONFIG, { timeoutMs: 1234 });

    await transport({ payload: payload('getGenesisHash') });

    expect(timeoutSpy).toHaveBeenCalledWith(1234);
  });

  it('passes an AbortSignal to fetch', async () => {
    const fetchMock = envelopeFetch();
    vi.stubGlobal('fetch', fetchMock);
    const transport = createHttpTransport(CONFIG);

    await transport({ payload: payload('getGenesisHash') });

    expect(lastInit(fetchMock).signal).toBeInstanceOf(AbortSignal);
  });

  it('throws RpcTimeoutError when the request exceeds timeoutMs', async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal('fetch', fetchMock);
    const transport = createHttpTransport(CONFIG, { timeoutMs: 50 });

    const err = await transport({ payload: payload('getGenesisHash') }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RpcTimeoutError);
    expect((err as RpcTimeoutError).timeoutMs).toBe(50);
  });

  it('the timeout aborts the underlying fetch signal', async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal('fetch', fetchMock);
    const transport = createHttpTransport(CONFIG, { timeoutMs: 50 });

    await transport({ payload: payload('getGenesisHash') }).catch(() => undefined);
    // Kit's coalescer aborts the shared request in a microtask once all consumers abort.
    await Promise.resolve();
    await Promise.resolve();

    expect(lastInit(fetchMock).signal?.aborted).toBe(true);
  });

  it('timeout error message contains no payload data', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const transport = createHttpTransport(CONFIG, { timeoutMs: 50 });

    const err = await transport({ payload: payload('getBalance', [CANARY]) }).catch((e: unknown) => e);

    expect((err as Error).message).not.toContain(CANARY);
  });
});

// ─── Caller AbortSignal composition ───────────────────────────────────────────

describe('HttpTransport — caller AbortSignal is composed', () => {
  it('composes the timeout signal with the caller signal via AbortSignal.any', async () => {
    const anySpy = vi.spyOn(AbortSignal, 'any');
    vi.stubGlobal('fetch', envelopeFetch());
    const transport = createHttpTransport(CONFIG);
    const controller = new AbortController();

    await transport({ payload: payload('getGenesisHash'), signal: controller.signal });

    expect(anySpy).toHaveBeenCalledTimes(1);
    const signals = anySpy.mock.calls[0]?.[0] as AbortSignal[];
    expect(signals).toHaveLength(2);
    expect(signals).toContain(controller.signal);
  });

  it('a caller abort rejects with the caller reason, not RpcTimeoutError', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const transport = createHttpTransport(CONFIG);
    const controller = new AbortController();
    const reason = new Error('caller-cancelled');

    const pending = transport({ payload: payload('getGenesisHash'), signal: controller.signal });
    controller.abort(reason);
    const err = await pending.catch((e: unknown) => e);

    expect(err).toBe(reason);
    expect(err).not.toBeInstanceOf(RpcTimeoutError);
  });

  it('an already-aborted caller signal rejects without waiting for the timeout', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const transport = createHttpTransport(CONFIG);
    const controller = new AbortController();
    const reason = new Error('pre-aborted');
    controller.abort(reason);

    const err = await transport({ payload: payload('getGenesisHash'), signal: controller.signal }).catch(
      (e: unknown) => e,
    );

    expect(err).toBe(reason);
  });
});

// ─── No retries ───────────────────────────────────────────────────────────────

describe('HttpTransport — no automatic retries', () => {
  it('an HTTP 500 is surfaced after exactly one fetch', async () => {
    const fetchMock = vi.fn(async () => new Response('fail', { status: 500, statusText: 'Server Error' }));
    vi.stubGlobal('fetch', fetchMock);
    const transport = createHttpTransport(CONFIG);

    const err = await transport({ payload: payload('getBalance', [CANARY]) }).catch((e: unknown) => e);

    expect(isSolanaError(err)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((err as Error).message).not.toContain(CANARY);
  });

  it('a network failure is surfaced after exactly one fetch', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('network down');
    });
    vi.stubGlobal('fetch', fetchMock);
    const transport = createHttpTransport(CONFIG);

    await expect(transport({ payload: payload('getGenesisHash') })).rejects.toThrow('network down');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a timeout is surfaced after exactly one fetch', async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal('fetch', fetchMock);
    const transport = createHttpTransport(CONFIG, { timeoutMs: 50 });

    await expect(transport({ payload: payload('getGenesisHash') })).rejects.toBeInstanceOf(RpcTimeoutError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ─── Headers / cookies ────────────────────────────────────────────────────────

describe('HttpTransport — no secret headers, no cookies', () => {
  it('sends only Kit-standard headers', async () => {
    const fetchMock = envelopeFetch();
    vi.stubGlobal('fetch', fetchMock);
    const transport = createHttpTransport(CONFIG);

    await transport({ payload: payload('getGenesisHash') });

    const headers = lastInit(fetchMock).headers ?? {};
    const allowed = new Set(['accept', 'content-type', 'solana-client', 'accept-encoding']);
    for (const name of Object.keys(headers)) {
      expect(allowed.has(name.toLowerCase())).toBe(true);
    }
    expect(headers['accept']).toBe('application/json');
    expect(headers['content-type']).toBe('application/json; charset=utf-8');
    expect(headers['solana-client']).toBe('js/8.3.0');
  });

  it('sends no authorization, cookie, or API-key headers', async () => {
    const fetchMock = envelopeFetch();
    vi.stubGlobal('fetch', fetchMock);
    const transport = createHttpTransport(CONFIG);

    await transport({ payload: payload('getGenesisHash') });

    const names = Object.keys(lastInit(fetchMock).headers ?? {}).map((h) => h.toLowerCase());
    for (const forbidden of ['authorization', 'cookie', 'x-api-key', 'proxy-authorization']) {
      expect(names).not.toContain(forbidden);
    }
  });

  it('does not opt in to sending credentials/cookies', async () => {
    const fetchMock = envelopeFetch();
    vi.stubGlobal('fetch', fetchMock);
    const transport = createHttpTransport(CONFIG);

    await transport({ payload: payload('getGenesisHash') });

    expect(lastInit(fetchMock).credentials).not.toBe('include');
  });
});

// ─── Kit JSON-RPC envelope handling ───────────────────────────────────────────

describe('HttpTransport — Kit JSON-RPC envelope handling is preserved', () => {
  it('the transport returns the full JSON-RPC envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse('{"jsonrpc":"2.0","id":"9","result":"hash123"}')),
    );
    const transport = createHttpTransport(CONFIG);

    const response = await transport({ payload: payload('getGenesisHash', [], '9') });

    expect(response).toEqual({ jsonrpc: '2.0', id: '9', result: 'hash123' });
  });

  it('large u64 values survive via Kit bigint JSON handling (through the RPC client)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        okResponse(
          '{"jsonrpc":"2.0","id":"1","result":{"context":{"slot":1},"value":18446744073709551615}}',
        ),
      ),
    );
    const rpc = createRpcClient(createHttpTransport(CONFIG));

    const res = await rpc.getBalance(address(SYSTEM_PROGRAM)).send();

    expect(res.value).toBe(18446744073709551615n);
  });

  it('a JSON-RPC error envelope becomes a SolanaError at the RPC layer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        okResponse('{"jsonrpc":"2.0","id":"1","error":{"code":-32602,"message":"Invalid params"}}'),
      ),
    );
    const rpc = createRpcClient(createHttpTransport(CONFIG));

    const err = await rpc.getBalance(address(SYSTEM_PROGRAM)).send().catch((e: unknown) => e);

    expect(isSolanaError(err)).toBe(true);
  });

  it("Kit's request coalescing is preserved (identical concurrent requests → one fetch)", async () => {
    const fetchMock = envelopeFetch({ context: { slot: 1 }, value: 5 });
    vi.stubGlobal('fetch', fetchMock);
    const rpc = createRpcClient(createHttpTransport(CONFIG));

    const [a, b] = await Promise.all([
      rpc.getBalance(address(SYSTEM_PROGRAM)).send(),
      rpc.getBalance(address(SYSTEM_PROGRAM)).send(),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a.value).toBe(b.value);
  });
});
