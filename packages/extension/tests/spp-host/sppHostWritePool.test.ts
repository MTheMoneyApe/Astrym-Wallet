import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetSppBroadcastGateForTests,
  setSppTestnetBroadcastAuthorized,
} from '@solanym/wallet-core/src/stellar/spp/sppBroadcastGate.js';
import { SppMultiAccountSequenceTracker } from '@solanym/wallet-core/src/stellar/spp/sppAccountSequenceTracker.js';
import { SPP_HOST_BRIDGE_CHANNEL } from '../../src/shared/sppHostBridge.js';
import {
  clearSppHostWritePool,
  executeSppHostWritePool,
  getSppHostSequenceTracker,
  getSppHostWritePoolStatus,
  noteSppHostReadonlySessionReady,
  registerSppHostWritePool,
  resetSppHostSequenceTrackerForTests,
  setSppHostLifecyclePublisher,
  setSppHostSequenceTracker,
} from '../../src/spp-host/sppHostWritePool.js';

const POOL = 'C'.padEnd(56, 'A');
const SENDER = 'G'.padEnd(56, 'A');
const RECIPIENT = 'G'.padEnd(56, 'B');

function request(
  overrides: Partial<{
    operation: 'deposit' | 'transfer' | 'withdraw';
    recipient?: string;
    nymConnected: boolean;
    poolContract: string;
    signingAccount?: string;
    freshSequence?: string;
    nextFreshSequence?: string;
    operationFingerprint?: string;
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
      ...(overrides.signingAccount !== undefined
        ? { signingAccount: overrides.signingAccount }
        : {}),
      ...(overrides.freshSequence !== undefined ? { freshSequence: overrides.freshSequence } : {}),
      ...(overrides.nextFreshSequence !== undefined
        ? { nextFreshSequence: overrides.nextFreshSequence }
        : {}),
      ...(overrides.operationFingerprint !== undefined
        ? { operationFingerprint: overrides.operationFingerprint }
        : {}),
    },
  };
}

const TX_DEP = 'dep0000000000001';
const TX_TR = 'tr00000000000001';

function registerOkPool(
  hooks: Partial<{
    deposit: () => Promise<{ txHash: string | null }>;
    transfer: () => Promise<{ txHash: string | null }>;
    withdraw: () => Promise<{ txHash: string | null }>;
  }> = {},
) {
  const deposit = hooks.deposit ?? vi.fn(async () => ({ txHash: TX_DEP }));
  const transfer = hooks.transfer ?? vi.fn(async () => ({ txHash: TX_TR }));
  const withdraw = hooks.withdraw ?? vi.fn(async () => ({ txHash: 'wd00000000000001' }));
  registerSppHostWritePool({
    poolContract: POOL,
    pool: { deposit, transfer, withdraw },
  });
  return { deposit, transfer, withdraw };
}

describe('sppHostWritePool', () => {
  beforeEach(() => {
    setSppTestnetBroadcastAuthorized(true);
    resetSppHostSequenceTrackerForTests();
  });
  afterEach(() => {
    resetSppBroadcastGateForTests();
    clearSppHostWritePool();
    resetSppHostSequenceTrackerForTests();
  });

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

  it('blocks Testnet broadcast until the approval gate is opened', async () => {
    setSppTestnetBroadcastAuthorized(false);
    registerSppHostWritePool({
      poolContract: POOL,
      pool: {
        deposit: vi.fn(async () => ({ txHash: 'dep' })),
        transfer: async () => ({ txHash: 'x' }),
        withdraw: async () => ({ txHash: 'x' }),
      },
    });
    const blocked = await executeSppHostWritePool(request({ operation: 'deposit' }));
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.code).toBe('UNAUTHORIZED');
      expect(blocked.message).toContain('SPP_BROADCAST_AWAITING_APPROVAL');
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

  it('advances account sequence only when execute returns txHash + nextFreshSequence', async () => {
    registerOkPool();
    const tracker = getSppHostSequenceTracker();
    tracker.seed(SENDER, '100');

    await expect(
      executeSppHostWritePool(
        request({
          signingAccount: SENDER,
          freshSequence: '100',
          nextFreshSequence: '101',
          operationFingerprint: 'fp-deposit-1',
        }),
      ),
    ).resolves.toMatchObject({ ok: true, txHash: TX_DEP });

    const after = tracker.get(SENDER);
    expect(after?.expectedFreshSequence).toBe('101');
    expect(after?.inFlightFingerprint).toBeNull();
    expect(after?.confirmedTxHashes).toEqual([TX_DEP]);
  });

  it('clears in-flight without advancing when nextFreshSequence is missing on success', async () => {
    registerOkPool();
    const tracker = getSppHostSequenceTracker();
    tracker.seed(SENDER, '100');

    await expect(
      executeSppHostWritePool(
        request({
          signingAccount: SENDER,
          freshSequence: '100',
          operationFingerprint: 'fp-no-next',
        }),
      ),
    ).resolves.toMatchObject({ ok: true, txHash: TX_DEP });

    const after = tracker.get(SENDER);
    expect(after?.expectedFreshSequence).toBe('100');
    expect(after?.inFlightFingerprint).toBeNull();
    expect(after?.confirmedTxHashes).toEqual([]);
  });

  it('refuses sequence drift and aborts in-flight after gate refuse or execution failure', async () => {
    registerOkPool({
      deposit: vi.fn(async () => {
        throw new Error('wasm boom');
      }),
    });
    const tracker = new SppMultiAccountSequenceTracker();
    tracker.seed(SENDER, '100');
    setSppHostSequenceTracker(tracker);

    const drift = await executeSppHostWritePool(
      request({
        signingAccount: SENDER,
        freshSequence: '999',
        operationFingerprint: 'fp-drift-1',
      }),
    );
    expect(drift.ok).toBe(false);
    if (!drift.ok) {
      expect(drift.code).toBe('INVALID_REQUEST');
      expect(drift.message).toContain('expected=100');
    }
    expect(tracker.get(SENDER)?.inFlightFingerprint).toBeNull();

    setSppTestnetBroadcastAuthorized(false);
    const gated = await executeSppHostWritePool(
      request({
        signingAccount: SENDER,
        freshSequence: '100',
        operationFingerprint: 'fp-gate-refuse',
      }),
    );
    expect(gated.ok).toBe(false);
    if (!gated.ok) expect(gated.code).toBe('UNAUTHORIZED');
    expect(tracker.get(SENDER)?.inFlightFingerprint).toBeNull();
    expect(tracker.get(SENDER)?.expectedFreshSequence).toBe('100');

    setSppTestnetBroadcastAuthorized(true);
    const failed = await executeSppHostWritePool(
      request({
        signingAccount: SENDER,
        freshSequence: '100',
        nextFreshSequence: '101',
        operationFingerprint: 'fp-exec-fail',
      }),
    );
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.code).toBe('EXECUTION_FAILED');
    expect(tracker.get(SENDER)?.inFlightFingerprint).toBeNull();
    expect(tracker.get(SENDER)?.expectedFreshSequence).toBe('100');
  });

  it('tracks sender and recipient accounts independently', async () => {
    registerOkPool({
      transfer: vi.fn(async () => ({ txHash: 'tr-hash-ok12' })),
    });
    const tracker = getSppHostSequenceTracker();
    tracker.seed(SENDER, '100');
    tracker.seed(RECIPIENT, '200');

    await expect(
      executeSppHostWritePool(
        request({
          operation: 'transfer',
          recipient: RECIPIENT,
          signingAccount: SENDER,
          freshSequence: '100',
          nextFreshSequence: '101',
          operationFingerprint: 'fp-sender-xfer',
        }),
      ),
    ).resolves.toMatchObject({ ok: true, txHash: 'tr-hash-ok12' });

    expect(tracker.get(SENDER)?.expectedFreshSequence).toBe('101');
    expect(tracker.get(RECIPIENT)?.expectedFreshSequence).toBe('200');
    expect(tracker.get(RECIPIENT)?.inFlightFingerprint).toBeNull();
  });
});
