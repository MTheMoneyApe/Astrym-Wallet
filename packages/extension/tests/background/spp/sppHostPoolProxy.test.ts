import { describe, expect, it, vi } from 'vitest';
import { SppPrivatePaymentError } from '@solanym/wallet-core/src/stellar/spp/sppNymOption.js';
import { SPP_HOST_BRIDGE_CHANNEL } from '../../../src/shared/sppHostBridge.js';
import { createSppHostPoolProxy } from '../../../src/background/spp/sppHostPoolProxy.js';

const POOL = 'C'.padEnd(56, 'A');

describe('createSppHostPoolProxy', () => {
  it('fail-closes when Nym is not connected without calling the host', async () => {
    const send = vi.fn();
    const proxy = createSppHostPoolProxy({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      nymMode: 'direct',
      nymConnected: false,
      poolContract: POOL,
      send,
    });
    await expect(proxy.deposit(1n)).rejects.toMatchObject({ code: 'NYM_REQUIRED' });
    expect(send).not.toHaveBeenCalled();
  });

  it('maps a successful host deposit response', async () => {
    const send = vi.fn(async (req) => ({
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_EXECUTE_PRIVATE_PAYMENT_RESULT',
      id: req.id,
      ok: true,
      operation: 'deposit',
      txHash: 'hash-1',
      rpcRoutedViaNym: true,
    }));
    const proxy = createSppHostPoolProxy({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      nymMode: 'nym',
      nymConnected: true,
      poolContract: POOL,
      send,
    });
    await expect(proxy.deposit(10n)).resolves.toEqual({ txHash: 'hash-1' });
    expect(send.mock.calls[0]?.[0]?.payload.operation).toBe('deposit');
  });

  it('propagates host SESSION_NOT_READY and EXECUTION_FAILED', async () => {
    const send = vi.fn(async (req) => ({
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_EXECUTE_PRIVATE_PAYMENT_RESULT',
      id: req.id,
      ok: false,
      code: 'SESSION_NOT_READY',
      message: 'no write pool',
    }));
    const proxy = createSppHostPoolProxy({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      nymMode: 'nym',
      nymConnected: true,
      poolContract: POOL,
      send,
    });
    await expect(proxy.transfer('G'.padEnd(56, 'B'), 5n)).rejects.toBeInstanceOf(SppPrivatePaymentError);
    await expect(proxy.transfer('G'.padEnd(56, 'B'), 5n)).rejects.toMatchObject({
      code: 'SESSION_NOT_READY',
    });
  });

  it('serializes concurrent proxy ops without inventing success', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const send = vi.fn(async (req) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight -= 1;
      return {
        channel: SPP_HOST_BRIDGE_CHANNEL,
        type: 'SPP_HOST_EXECUTE_PRIVATE_PAYMENT_RESULT',
        id: req.id,
        ok: true,
        operation: req.payload.operation,
        txHash: `tx-${req.payload.operation}`,
        rpcRoutedViaNym: true,
      };
    });
    const proxy = createSppHostPoolProxy({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      nymMode: 'nym',
      nymConnected: true,
      poolContract: POOL,
      send,
    });
    const results = await Promise.all([
      proxy.deposit(1n),
      proxy.withdraw(2n, null),
    ]);
    expect(results.map((r) => r.txHash)).toEqual(['tx-deposit', 'tx-withdraw']);
    expect(send).toHaveBeenCalledTimes(2);
    expect(maxInFlight).toBeGreaterThanOrEqual(1);
  });

  it('returns HOST_UNAVAILABLE when the sender throws', async () => {
    const proxy = createSppHostPoolProxy({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      nymMode: 'nym',
      nymConnected: true,
      poolContract: POOL,
      send: async () => {
        throw new Error('no receiver');
      },
    });
    await expect(proxy.deposit(1n)).rejects.toMatchObject({ code: 'HOST_UNAVAILABLE' });
  });
});
