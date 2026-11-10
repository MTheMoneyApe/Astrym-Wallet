import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createSppNymScopedFetch,
  executeSppPrivatePayment,
  sppOptionAvailability,
  sppPrivatePaymentsAllowed,
  withSppRpcThroughNym,
  xlmToStroops,
  type SppPrivatePool,
} from '../../../src/stellar/spp/sppNymOption.js';
import {
  privatePaymentFingerprint,
  resetPrivatePaymentExecutionGuardForTests,
  beginPrivatePaymentExecution,
} from '../../../src/stellar/spp/sppExecutionGuard.js';
import {
  resetSppBroadcastGateForTests,
  setSppTestnetBroadcastAuthorized,
} from '../../../src/stellar/spp/sppBroadcastGate.js';

const RPC = 'https://soroban-testnet.stellar.org';

function poolContract(): string {
  return StrKey.encodeContract(Keypair.random().rawPublicKey());
}

function readyPool(): SppPrivatePool {
  return {
    deposit: vi.fn(async () => ({ txHash: 'deposit-tx' })),
    transfer: vi.fn(async () => ({ txHash: 'transfer-tx' })),
    withdraw: vi.fn(async () => ({ txHash: 'withdraw-tx' })),
  };
}

function auth(request: {
  operation: 'deposit' | 'transfer' | 'withdraw';
  poolContract: string;
  amountStroops: string;
  recipient?: string;
}) {
  return privatePaymentFingerprint({
    operation: request.operation,
    poolContract: request.poolContract,
    amountStroops: request.amountStroops,
    recipient: request.recipient ?? null,
  });
}

afterEach(() => {
  resetPrivatePaymentExecutionGuardForTests();
  resetSppBroadcastGateForTests();
});

beforeEach(() => {
  // Unit tests that exercise the pool mock may authorize; production default remains OFF.
  setSppTestnetBroadcastAuthorized(true);
});

describe('SPP option while Nym is on', () => {
  it('refuses broadcast until the Testnet approval gate is opened', async () => {
    setSppTestnetBroadcastAuthorized(false);
    const pool = readyPool();
    const nymFetch = vi.fn();
    const request = { operation: 'deposit' as const, poolContract: poolContract(), amountStroops: '10' };
    await expect(
      executeSppPrivatePayment({
        gate: { mode: 'nym', connected: true, selected: true },
        request,
        rpcUrl: RPC,
        nymFetch,
        pool,
        authorizationFingerprint: auth(request),
        senderAddress: Keypair.random().publicKey(),
      }),
    ).rejects.toMatchObject({ code: 'BROADCAST_AWAITING_APPROVAL' });
    expect(pool.deposit).not.toHaveBeenCalled();
    expect(nymFetch).not.toHaveBeenCalled();
  });

  it('stays closed until Nym is connected and the option is selected', () => {
    expect(sppOptionAvailability({ mode: 'direct', connected: true })).toBe('requires_nym');
    expect(sppOptionAvailability({ mode: 'nym', connected: false })).toBe('requires_nym');
    expect(sppOptionAvailability({ mode: 'nym', connected: true })).toBe('ready_to_enable');
    expect(sppPrivatePaymentsAllowed({ mode: 'nym', connected: true, selected: false })).toBe(false);
    expect(sppPrivatePaymentsAllowed({ mode: 'nym', connected: true, selected: true })).toBe(true);
    expect(xlmToStroops('1.5')).toBe('15000000');
  });

  it('does not touch MixFetch or the pool when Nym is off', async () => {
    const pool = readyPool();
    const nymFetch = vi.fn();
    const request = { operation: 'deposit' as const, poolContract: poolContract(), amountStroops: '10' };
    await expect(
      executeSppPrivatePayment({
        gate: { mode: 'direct', connected: false, selected: true },
        request,
        rpcUrl: RPC,
        nymFetch,
        pool,
        authorizationFingerprint: auth(request),
      }),
    ).rejects.toMatchObject({ code: 'NYM_REQUIRED' });
    expect(nymFetch).not.toHaveBeenCalled();
    expect(pool.deposit).not.toHaveBeenCalled();
  });

  it('asks for a session before any RPC call', async () => {
    const nymFetch = vi.fn();
    const request = { operation: 'deposit' as const, poolContract: poolContract(), amountStroops: '1' };
    await expect(
      executeSppPrivatePayment({
        gate: { mode: 'nym', connected: true, selected: true },
        request,
        rpcUrl: RPC,
        nymFetch,
        pool: null,
        authorizationFingerprint: auth(request),
      }),
    ).rejects.toMatchObject({ code: 'SESSION_NOT_READY' });
    expect(nymFetch).not.toHaveBeenCalled();
  });

  it('rejects mismatched authorization fingerprints', async () => {
    const pool = readyPool();
    const nymFetch = vi.fn(async () => new Response('{"result":"ok"}', { status: 200 }));
    const request = { operation: 'deposit' as const, poolContract: poolContract(), amountStroops: '10' };
    await expect(
      executeSppPrivatePayment({
        gate: { mode: 'nym', connected: true, selected: true },
        request,
        rpcUrl: RPC,
        nymFetch,
        pool,
        authorizationFingerprint: 'tampered',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(pool.deposit).not.toHaveBeenCalled();
  });

  it('does not call the pool for a deposit while private economics are blocked', async () => {
    const previous = globalThis.fetch;
    const direct = vi.fn(async () => new Response('clearnet', { status: 200 }));
    globalThis.fetch = direct as typeof fetch;
    const nymFetch = vi.fn(async () => new Response('{"result":"ok"}', { status: 200 }));
    const pool = readyPool();
    const request = { operation: 'deposit' as const, poolContract: poolContract(), amountStroops: '10' };
    try {
      await expect(executeSppPrivatePayment({
        gate: { mode: 'nym', connected: true, selected: true },
        request,
        rpcUrl: RPC,
        nymFetch,
        pool,
        preferInjectedTransport: true,
        authorizationFingerprint: auth(request),
      })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      expect(pool.deposit).not.toHaveBeenCalled();
      expect(nymFetch).not.toHaveBeenCalled();
      expect(direct).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = previous;
    }
  });

  it('rejects a deposit before the pool while economics are blocked', async () => {
    const nymFetch = vi.fn(async () => new Response('{"result":"ok"}', { status: 200 }));
    const pool = readyPool();
    const request = { operation: 'deposit' as const, poolContract: poolContract(), amountStroops: '10' };
    await expect(executeSppPrivatePayment({
      gate: { mode: 'nym', connected: true, selected: true },
      request,
      rpcUrl: RPC,
      nymFetch,
      pool,
      authorizationFingerprint: auth(request),
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(pool.deposit).not.toHaveBeenCalled();
    expect(nymFetch).not.toHaveBeenCalled();
  });

  it('blocks a repeat after a partial result is held for reconciliation', () => {
    const first = beginPrivatePaymentExecution('deposit|pool|10|');
    first.release({ reconcile: true });
    expect(() => beginPrivatePaymentExecution('deposit|pool|10|')).toThrow(/duplicado/);
  });

  it('does not confirm only the first hash when the pool reports several', async () => {
    const nymFetch = vi.fn(async () => new Response('{"result":"ok"}', { status: 200 }));
    const pool: SppPrivatePool = {
      deposit: vi.fn(async () => ({ txHash: 'first', txHashes: ['first', 'second'] })),
      transfer: vi.fn(async () => ({ txHash: null })),
      withdraw: vi.fn(async () => ({ txHash: null })),
    };
    const request = { operation: 'deposit' as const, poolContract: poolContract(), amountStroops: '10' };
    await expect(
      executeSppPrivatePayment({
        gate: { mode: 'nym', connected: true, selected: true },
        request,
        rpcUrl: RPC,
        nymFetch,
        pool,
        authorizationFingerprint: auth(request),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(pool.deposit).not.toHaveBeenCalled();
  });

  it('marks missing tx hash as SUBMISSION_UNKNOWN (no invented confirmation)', async () => {
    const nymFetch = vi.fn(async () => new Response('{"result":"ok"}', { status: 200 }));
    const pool: SppPrivatePool = {
      deposit: vi.fn(async () => ({ txHash: null })),
      transfer: vi.fn(async () => ({ txHash: null })),
      withdraw: vi.fn(async () => ({ txHash: null })),
    };
    const request = { operation: 'deposit' as const, poolContract: poolContract(), amountStroops: '10' };
    await expect(
      executeSppPrivatePayment({
        gate: { mode: 'nym', connected: true, selected: true },
        request,
        rpcUrl: RPC,
        nymFetch,
        pool,
        authorizationFingerprint: auth(request),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(pool.deposit).not.toHaveBeenCalled();
  });

  it('scoped fetch rejects non-RPC origins', async () => {
    const nymFetch = vi.fn(async () => new Response('ok', { status: 200 }));
    const scoped = createSppNymScopedFetch(RPC, nymFetch);
    await expect(scoped('https://evil.example/')).rejects.toMatchObject({ code: 'RPC_FAILED' });
    expect(nymFetch).not.toHaveBeenCalled();
    await scoped(RPC, { method: 'POST' });
    expect(nymFetch).toHaveBeenCalledOnce();
  });

  it('serializes legacy withSppRpcThroughNym wraps so concurrent ops do not clobber fetch', async () => {
    const previous = globalThis.fetch;
    const direct = vi.fn(async () => new Response('clearnet', { status: 200 }));
    globalThis.fetch = direct as typeof fetch;
    const order: string[] = [];
    const nymA = vi.fn(async () => {
      order.push('a-start');
      await new Promise((r) => setTimeout(r, 30));
      order.push('a-end');
      return new Response('a', { status: 200 });
    });
    const nymB = vi.fn(async () => {
      order.push('b-start');
      await new Promise((r) => setTimeout(r, 5));
      order.push('b-end');
      return new Response('b', { status: 200 });
    });
    try {
      await Promise.all([
        withSppRpcThroughNym(RPC, nymA, async () => {
          await fetch(RPC);
        }),
        withSppRpcThroughNym(RPC, nymB, async () => {
          await fetch(RPC);
        }),
      ]);
      expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
      expect(direct).not.toHaveBeenCalled();
      expect(globalThis.fetch).toBe(direct);
    } finally {
      globalThis.fetch = previous;
    }
  });

  it('does not run the pool when private economics are blocked', async () => {
    const pool = readyPool();
    const nymFetch = vi.fn(async () => {
      throw new Error('mixnet down');
    });
    const request = { operation: 'withdraw' as const, poolContract: poolContract(), amountStroops: '3' };
    await expect(
      executeSppPrivatePayment({
        gate: { mode: 'nym', connected: true, selected: true },
        request,
        rpcUrl: RPC,
        nymFetch,
        pool,
        authorizationFingerprint: auth(request),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(pool.withdraw).not.toHaveBeenCalled();
    expect(nymFetch).not.toHaveBeenCalled();
  });
});
