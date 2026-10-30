import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { describe, expect, it, vi } from 'vitest';

import {
  executeSppPrivatePayment,
  sppOptionAvailability,
  sppPrivatePaymentsAllowed,
  xlmToStroops,
  type SppPrivatePool,
} from '../../../src/stellar/spp/sppNymOption.js';

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

describe('SPP option while Nym is on', () => {
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
    await expect(
      executeSppPrivatePayment({
        gate: { mode: 'direct', connected: false, selected: true },
        request: { operation: 'deposit', poolContract: poolContract(), amountStroops: '10' },
        rpcUrl: RPC,
        nymFetch,
        pool,
      }),
    ).rejects.toMatchObject({ code: 'NYM_REQUIRED' });
    expect(nymFetch).not.toHaveBeenCalled();
    expect(pool.deposit).not.toHaveBeenCalled();
  });

  it('asks for a session before any RPC call', async () => {
    const nymFetch = vi.fn();
    await expect(
      executeSppPrivatePayment({
        gate: { mode: 'nym', connected: true, selected: true },
        request: { operation: 'deposit', poolContract: poolContract(), amountStroops: '1' },
        rpcUrl: RPC,
        nymFetch,
        pool: null,
      }),
    ).rejects.toMatchObject({ code: 'SESSION_NOT_READY' });
    expect(nymFetch).not.toHaveBeenCalled();
  });

  it('routes Soroban RPC through Nym and then deposits', async () => {
    const direct = vi.fn(async () => new Response('clearnet', { status: 200 }));
    const previous = globalThis.fetch;
    globalThis.fetch = direct as typeof fetch;
    const nymFetch = vi.fn(async () => new Response('{"result":"ok"}', { status: 200 }));
    const pool = readyPool();
    pool.deposit = vi.fn(async () => {
      const res = await fetch(RPC, { method: 'POST', body: '{}' });
      expect(await res.text()).toBe('{"result":"ok"}');
      return { txHash: 'deposit-tx' };
    });
    try {
      const result = await executeSppPrivatePayment({
        gate: { mode: 'nym', connected: true, selected: true },
        request: { operation: 'deposit', poolContract: poolContract(), amountStroops: '10' },
        rpcUrl: RPC,
        nymFetch,
        pool,
      });
      expect(result.rpcRoutedViaNym).toBe(true);
      expect(result.txHash).toBe('deposit-tx');
      expect(direct).not.toHaveBeenCalled();
      expect(String(nymFetch.mock.calls[0]?.[0])).toContain('soroban-testnet.stellar.org');
    } finally {
      globalThis.fetch = previous;
    }
  });

  it('does not run the pool when the Nym RPC probe fails', async () => {
    const pool = readyPool();
    const nymFetch = vi.fn(async () => {
      throw new Error('mixnet down');
    });
    await expect(
      executeSppPrivatePayment({
        gate: { mode: 'nym', connected: true, selected: true },
        request: { operation: 'withdraw', poolContract: poolContract(), amountStroops: '3' },
        rpcUrl: RPC,
        nymFetch,
        pool,
      }),
    ).rejects.toMatchObject({ code: 'RPC_FAILED' });
    expect(pool.withdraw).not.toHaveBeenCalled();
  });
});
