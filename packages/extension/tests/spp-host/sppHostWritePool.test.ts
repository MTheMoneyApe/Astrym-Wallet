import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetSppBroadcastGateForTests,
  setSppTestnetBroadcastAuthorized,
} from '@solanym/wallet-core/src/stellar/spp/sppBroadcastGate.js';
import {
  SppMultiAccountSequenceTracker,
  beginSppAccountOperation,
} from '@solanym/wallet-core/src/stellar/spp/sppAccountSequenceTracker.js';
import { SPP_HOST_BRIDGE_CHANNEL } from '../../src/shared/sppHostBridge.js';
import {
  clearSppHostWritePool,
  confirmOrAbortSequence,
  executeSppHostWritePool,
  getSppHostSequenceTracker,
  getSppHostWritePoolStatus,
  noteSppHostReadonlySessionReady,
  registerSppHostWritePool,
  resetSppHostSequenceTrackerForTests,
  setSppHostLifecyclePublisher,
  setSppHostSequenceTracker,
} from '../../src/spp-host/sppHostWritePool.js';

/**
 * Test-only seam. Production execute still calls assertSppPoolPaymentEconomicsBound
 * and fail-closes with SPP_POOL_ECONOMICS_NOT_VERIFIED. Nothing here is exported
 * from production.
 * TODO: delete this seam and re-enable the success cases against the real gate
 * when SPP_POOL_ECONOMICS_NOT_VERIFIED is lifted.
 */
const poolEconomicsSeam = vi.hoisted(() => ({ pass: false }));

vi.mock('@solanym/wallet-core/src/stellar/spp/sppSignGate.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@solanym/wallet-core/src/stellar/spp/sppSignGate.js')>();
  return {
    ...actual,
    assertSppPoolPaymentEconomicsBound(
      operation: Parameters<typeof actual.assertSppPoolPaymentEconomicsBound>[0],
    ): void {
      if (poolEconomicsSeam.pass) return;
      actual.assertSppPoolPaymentEconomicsBound(operation);
    },
  };
});

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
    deposit: () => Promise<{ txHash: string | null; txHashes?: readonly string[] }>;
    transfer: () => Promise<{ txHash: string | null; txHashes?: readonly string[] }>;
    withdraw: () => Promise<{ txHash: string | null; txHashes?: readonly string[] }>;
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
    poolEconomicsSeam.pass = false;
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

  it('stays blocked: deposit, transfer, and withdraw while pool economics are unverified', async () => {
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
      ok: false,
      code: 'INVALID_REQUEST',
    });
    await expect(
      executeSppHostWritePool(
        request({ operation: 'transfer', recipient: 'G'.padEnd(56, 'B') }),
      ),
    ).resolves.toMatchObject({ ok: false, code: 'INVALID_REQUEST' });

    const failed = await executeSppHostWritePool(request({ operation: 'withdraw' }));
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.code).toBe('INVALID_REQUEST');
      expect(failed.message).toMatch(/SPP_POOL_ECONOMICS_NOT_VERIFIED/);
    }
    expect(deposit).not.toHaveBeenCalled();
    expect(transfer).not.toHaveBeenCalled();
    expect(withdraw).not.toHaveBeenCalled();
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

  it('stays blocked: sequence does not advance while pool economics are unverified', async () => {
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
    ).resolves.toMatchObject({ ok: false, code: 'INVALID_REQUEST' });

    const after = tracker.get(SENDER);
    expect(after?.expectedFreshSequence).toBe('100');
    expect(after?.inFlightFingerprint).toBeNull();
    expect(after?.confirmedTxHashes).toEqual([]);
  });

  it('clears in-flight without advancing when the payment stays blocked', async () => {
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
    ).resolves.toMatchObject({ ok: false, code: 'INVALID_REQUEST' });

    const after = tracker.get(SENDER);
    expect(after?.expectedFreshSequence).toBe('100');
    expect(after?.inFlightFingerprint).toBeNull();
    expect(after?.confirmedTxHashes).toEqual([]);
  });

  it('clears in-flight without advancing when nextFreshSequence is missing on success', () => {
    const tracker = new SppMultiAccountSequenceTracker();
    const seeded = tracker.seed(SENDER, '100');
    const begun = beginSppAccountOperation(seeded, 'fp-no-next');
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    tracker.replace(begun.state);
    setSppHostSequenceTracker(tracker);

    confirmOrAbortSequence(
      { address: SENDER, fingerprint: 'fp-no-next' },
      TX_DEP,
      undefined,
    );

    const after = tracker.get(SENDER);
    expect(after?.expectedFreshSequence).toBe('100');
    expect(after?.inFlightFingerprint).toBeNull();
    expect(after?.confirmedTxHashes).toEqual([]);
  });

  it('advances sequence when confirmOrAbortSequence receives txHash and nextFreshSequence', () => {
    const tracker = new SppMultiAccountSequenceTracker();
    const seeded = tracker.seed(SENDER, '100');
    const begun = beginSppAccountOperation(seeded, 'fp-confirm-ok');
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    tracker.replace(begun.state);
    setSppHostSequenceTracker(tracker);

    confirmOrAbortSequence(
      { address: SENDER, fingerprint: 'fp-confirm-ok' },
      TX_DEP,
      '101',
    );

    const after = tracker.get(SENDER);
    expect(after?.expectedFreshSequence).toBe('101');
    expect(after?.inFlightFingerprint).toBeNull();
    expect(after?.confirmedTxHashes).toEqual([TX_DEP]);
  });

  it('refuses sequence drift and aborts in-flight after gate refuse or execution failure', async () => {
    // TODO: drop this seam and re-enable against the real gate when SPP_POOL_ECONOMICS_NOT_VERIFIED is lifted.
    poolEconomicsSeam.pass = true;
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
    if (!failed.ok) {
      expect(failed.code).toBe('EXECUTION_FAILED');
      expect(failed.message).toContain('wasm boom');
    }
    expect(tracker.get(SENDER)?.inFlightFingerprint).toBeNull();
    expect(tracker.get(SENDER)?.expectedFreshSequence).toBe('100');
  });

  it('stays blocked: an execution throw is not reached while pool economics are unverified', async () => {
    const deposit = vi.fn(async () => {
      throw new Error('wasm boom');
    });
    registerOkPool({ deposit });
    const tracker = new SppMultiAccountSequenceTracker();
    tracker.seed(SENDER, '100');
    setSppHostSequenceTracker(tracker);

    const failed = await executeSppHostWritePool(
      request({
        signingAccount: SENDER,
        freshSequence: '100',
        nextFreshSequence: '101',
        operationFingerprint: 'fp-exec-fail',
      }),
    );
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.code).toBe('INVALID_REQUEST');
      expect(failed.message).toMatch(/SPP_POOL_ECONOMICS_NOT_VERIFIED/);
    }
    expect(deposit).not.toHaveBeenCalled();
    expect(tracker.get(SENDER)?.inFlightFingerprint).toBeNull();
    expect(tracker.get(SENDER)?.expectedFreshSequence).toBe('100');
  });

  it('stays blocked: sender and recipient sequences stay put while pool economics are unverified', async () => {
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
    ).resolves.toMatchObject({ ok: false, code: 'INVALID_REQUEST' });

    expect(tracker.get(SENDER)?.expectedFreshSequence).toBe('100');
    expect(tracker.get(RECIPIENT)?.expectedFreshSequence).toBe('200');
    expect(tracker.get(RECIPIENT)?.inFlightFingerprint).toBeNull();
  });

  // TODO: drop poolEconomicsSeam.pass in the cases below and re-enable them
  // against the real gate when SPP_POOL_ECONOMICS_NOT_VERIFIED is lifted.
  // Names stay at this describe level so the T9 delta still sees the baseline cases.
  it('executes deposit/transfer/withdraw against a registered adapter and propagates failures', async () => {
    poolEconomicsSeam.pass = true;
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

    await expect(executeSppHostWritePool(request({ operation: 'deposit' }))).resolves.toMatchObject({
      ok: true,
      operation: 'deposit',
      txHash: 'dep',
      txHashes: ['dep'],
      rpcRoutedViaNym: true,
    });
    await expect(
      executeSppHostWritePool(
        request({ operation: 'transfer', recipient: 'G'.padEnd(56, 'B') }),
      ),
    ).resolves.toMatchObject({
      ok: true,
      operation: 'transfer',
      txHash: 'tr',
      rpcRoutedViaNym: true,
    });

    const failed = await executeSppHostWritePool(request({ operation: 'withdraw' }));
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.code).toBe('EXECUTION_FAILED');
      expect(failed.message).toContain('wasm boom');
    }
    expect(deposit).toHaveBeenCalledTimes(1);
    expect(deposit).toHaveBeenCalledWith(10n);
    expect(transfer).toHaveBeenCalledWith('G'.padEnd(56, 'B'), 10n);
    expect(withdraw).toHaveBeenCalledWith(10n, null);
  });

  it('advances account sequence only when execute returns txHash + nextFreshSequence', async () => {
    poolEconomicsSeam.pass = true;
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
    ).resolves.toMatchObject({ ok: true, txHash: TX_DEP, rpcRoutedViaNym: true });

    const after = tracker.get(SENDER);
    expect(after?.expectedFreshSequence).toBe('101');
    expect(after?.inFlightFingerprint).toBeNull();
    expect(after?.confirmedTxHashes).toEqual([TX_DEP]);
  });

  it('clears in-flight without advancing when execute succeeds without nextFreshSequence', async () => {
    poolEconomicsSeam.pass = true;
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

  it('aborts in-flight after execution failure without advancing sequence', async () => {
    poolEconomicsSeam.pass = true;
    const deposit = vi.fn(async () => {
      throw new Error('wasm boom');
    });
    registerOkPool({ deposit });
    const tracker = new SppMultiAccountSequenceTracker();
    tracker.seed(SENDER, '100');
    setSppHostSequenceTracker(tracker);

    const failed = await executeSppHostWritePool(
      request({
        signingAccount: SENDER,
        freshSequence: '100',
        nextFreshSequence: '101',
        operationFingerprint: 'fp-exec-fail',
      }),
    );
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.code).toBe('EXECUTION_FAILED');
      expect(failed.message).toContain('wasm boom');
    }
    expect(deposit).toHaveBeenCalledTimes(1);
    expect(tracker.get(SENDER)?.inFlightFingerprint).toBeNull();
    expect(tracker.get(SENDER)?.expectedFreshSequence).toBe('100');
  });

  it('tracks sender and recipient accounts independently', async () => {
    poolEconomicsSeam.pass = true;
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
    expect(tracker.get(SENDER)?.confirmedTxHashes).toEqual(['tr-hash-ok12']);
    expect(tracker.get(RECIPIENT)?.expectedFreshSequence).toBe('200');
    expect(tracker.get(RECIPIENT)?.inFlightFingerprint).toBeNull();
  });

  it('returns SUBMISSION_UNKNOWN when execute reports more than one hash', async () => {
    poolEconomicsSeam.pass = true;
    registerOkPool({
      deposit: async () => ({ txHash: null, txHashes: ['hash-1', 'hash-2'] }),
    });
    const failed = await executeSppHostWritePool(request());
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.code).toBe('SUBMISSION_UNKNOWN');
      expect(failed.txHashes).toEqual(['hash-1', 'hash-2']);
    }
  });

  it('returns SUBMISSION_UNKNOWN when a failed execute recovers partial hashes', async () => {
    poolEconomicsSeam.pass = true;
    registerOkPool({
      deposit: async () => {
        throw Object.assign(new Error('partial write'), { txHashes: ['hash-1'] });
      },
    });
    const failed = await executeSppHostWritePool(request());
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.code).toBe('SUBMISSION_UNKNOWN');
      expect(failed.txHashes).toEqual(['hash-1']);
      expect(failed.message).toContain('hash-1');
    }
  });
});
