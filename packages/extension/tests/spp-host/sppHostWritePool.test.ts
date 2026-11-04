import { describe, expect, it, vi } from 'vitest';
import { SPP_HOST_BRIDGE_CHANNEL } from '../../src/shared/sppHostBridge.js';
import {
  clearSppHostWritePool,
  executeSppHostWritePool,
  getSppHostWritePoolStatus,
  noteSppHostReadonlySessionReady,
  registerSppHostWritePool,
  setSppHostLifecyclePublisher,
} from '../../src/spp-host/sppHostWritePool.js';

const POOL = 'C'.padEnd(56, 'A');

function request(
  overrides: Partial<{
    operation: 'deposit' | 'transfer' | 'withdraw';
    recipient?: string;
    nymConnected: boolean;
    poolContract: string;
  }> = {},
) {
  return {
    channel: SPP_HOST_BRIDGE_CHANNEL,
    type: 'SPP_HOST_EXECUTE_PRIVATE_PAYMENT' as const,
    id: 'exec-1',
    payload: {
      operation: overrides.operation ?? 'deposit',
      poolContract: overrides.poolContract ?? POOL,
      amountStroops: '10',
      rpcUrl: 'https://soroban-testnet.stellar.org',
      nymMode: 'nym' as const,
      nymConnected: overrides.nymConnected ?? true,
      sppSelected: true as const,
      ...(overrides.recipient !== undefined ? { recipient: overrides.recipient } : {}),
    },
  };
}

describe('sppHostWritePool', () => {
  it('publishes readonly lifecycle and refuses execute without a write pool', async () => {
    clearSppHostWritePool();
    const events: string[] = [];
    setSppHostLifecyclePublisher((e) => events.push(e.state));
    noteSppHostReadonlySessionReady();
    expect(events).toContain('session_ready_readonly');
    expect(getSppHostWritePoolStatus().hasWritePool).toBe(false);

    const result = await executeSppHostWritePool(request());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('SESSION_NOT_READY');
  });

  it('executes deposit/transfer/withdraw against a registered adapter and propagates failures', async () => {
    clearSppHostWritePool();
    const deposit = vi.fn(async () => ({ txHash: 'dep' }));
    const transfer = vi.fn(async () => ({ txHash: 'tr' }));
    const withdraw = vi.fn(async () => {
      throw new Error('wasm boom');
    });
    registerSppHostWritePool({
      poolContract: POOL,
      pool: { deposit, transfer, withdraw },
    });
    expect(getSppHostWritePoolStatus().hasWritePool).toBe(true);

    await expect(executeSppHostWritePool(request({ operation: 'deposit' }))).resolves.toMatchObject({
      ok: true,
      txHash: 'dep',
      rpcRoutedViaNym: true,
    });
    await expect(
      executeSppHostWritePool(
        request({ operation: 'transfer', recipient: 'G'.padEnd(56, 'B') }),
      ),
    ).resolves.toMatchObject({ ok: true, txHash: 'tr' });

    const failed = await executeSppHostWritePool(request({ operation: 'withdraw' }));
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.code).toBe('EXECUTION_FAILED');
      expect(failed.message).toContain('wasm boom');
    }
  });

  it('fail-closes when Nym is off and on poolContract mismatch', async () => {
    clearSppHostWritePool();
    registerSppHostWritePool({
      poolContract: POOL,
      pool: {
        deposit: async () => ({ txHash: 'x' }),
        transfer: async () => ({ txHash: 'x' }),
        withdraw: async () => ({ txHash: 'x' }),
      },
    });
    const nymOff = await executeSppHostWritePool(request({ nymConnected: false }));
    expect(nymOff.ok).toBe(false);
    if (!nymOff.ok) expect(nymOff.code).toBe('NYM_REQUIRED');

    const mismatch = await executeSppHostWritePool(
      request({ poolContract: 'C'.padEnd(56, 'Z') }),
    );
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.code).toBe('INVALID_REQUEST');
  });
});
