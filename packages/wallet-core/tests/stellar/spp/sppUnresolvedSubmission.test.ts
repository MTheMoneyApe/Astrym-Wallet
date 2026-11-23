import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/stellar/spp/sppSignGate.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/stellar/spp/sppSignGate.js')>();
  const { sppProbeEconomicsBypass } = await import('./seams/sppProbeEconomicsBypass.js');
  return {
    ...actual,
    assertSppPoolPaymentEconomicsBound(
      operation: Parameters<typeof actual.assertSppPoolPaymentEconomicsBound>[0],
    ): void {
      if (sppProbeEconomicsBypass.enabled) return;
      actual.assertSppPoolPaymentEconomicsBound(operation);
    },
  };
});

import { sppProbeEconomicsBypass } from './seams/sppProbeEconomicsBypass.js';
import { runSppProbedPoolPayment } from './seams/runSppProbedPoolPayment.js';
import {
  executeSppPrivatePayment,
  type SppPrivatePool,
} from '../../../src/stellar/spp/sppNymOption.js';
import {
  beginPrivatePaymentExecution,
  hasUnresolvedSubmission,
  hydrateUnresolvedSubmissions,
  persistUnresolvedSubmission,
  privatePaymentFingerprint,
  reconcileUnresolvedSubmission,
  resetPrivatePaymentExecutionGuardForTests,
  resetUnresolvedSubmissionStoreForTests,
  setUnresolvedSubmissionStore,
  type UnresolvedSubmissionRecord,
} from '../../../src/stellar/spp/sppExecutionGuard.js';
import {
  resetSppBroadcastGateForTests,
  setSppTestnetBroadcastAuthorized,
} from '../../../src/stellar/spp/sppBroadcastGate.js';

const RPC = 'https://soroban-testnet.stellar.org';

function memoryStore(saved: UnresolvedSubmissionRecord[]) {
  return {
    async read() {
      return saved.map((record) => ({ ...record, hashes: [...record.hashes] }));
    },
    async write(records: readonly UnresolvedSubmissionRecord[]) {
      saved.splice(
        0,
        saved.length,
        ...records.map((record) => ({ ...record, hashes: [...record.hashes] })),
      );
    },
  };
}

function poolWith(deposit: SppPrivatePool['deposit']): SppPrivatePool {
  return {
    deposit,
    transfer: vi.fn(async () => ({ txHash: null })),
    withdraw: vi.fn(async () => ({ txHash: null })),
  };
}

describe('unresolved SPP submission lock', () => {
  beforeEach(() => {
    setSppTestnetBroadcastAuthorized(true);
  });

  afterEach(() => {
    resetPrivatePaymentExecutionGuardForTests();
    resetUnresolvedSubmissionStoreForTests();
    resetSppBroadcastGateForTests();
  });

  it('persists a multi-hash SUBMISSION_UNKNOWN and the lock survives reload', async () => {
    const saved: UnresolvedSubmissionRecord[] = [];
    setUnresolvedSubmissionStore(memoryStore(saved));
    const nymFetch = vi.fn(async () => new Response('{"result":"ok"}', { status: 200 }));
    await expect(runSppProbedPoolPayment({
      request: { operation: 'deposit', amount: 10n, recipient: null },
      rpcUrl: RPC,
      nymFetch,
      pool: poolWith(async () => ({ txHash: 'first', txHashes: ['first', 'second'] })),
      preferInjectedTransport: true,
    })).rejects.toMatchObject({
      code: 'SUBMISSION_UNKNOWN',
      txHashes: ['first', 'second'],
    });
    expect(saved).toHaveLength(1);
    expect(saved[0]?.hashes).toEqual(['first', 'second']);
    const fingerprint = saved[0]?.fingerprint ?? '';
    resetPrivatePaymentExecutionGuardForTests();
    expect(saved).toEqual([
      expect.objectContaining({ fingerprint, hashes: ['first', 'second'] }),
    ]);
    expect(await hasUnresolvedSubmission(fingerprint)).toBe(true);
    await hydrateUnresolvedSubmissions();
    expect(() => beginPrivatePaymentExecution(fingerprint)).toThrow(/reconcil/);
  });

  it('blocks re-authorization of the same fingerprint until getTransaction reconciles it', async () => {
    const fingerprint = 'deposit|pool-contract|10|';
    const saved: UnresolvedSubmissionRecord[] = [];
    setUnresolvedSubmissionStore(memoryStore(saved));
    await persistUnresolvedSubmission({
      fingerprint,
      hashes: ['hash-1', 'hash-2'],
      at: 42,
    });
    resetPrivatePaymentExecutionGuardForTests();
    await hydrateUnresolvedSubmissions();
    expect(() => beginPrivatePaymentExecution(fingerprint)).toThrow(/getTransaction/);

    const seen: string[] = [];
    const stillLocked = await reconcileUnresolvedSubmission({
      fingerprint,
      readTransaction: async (hash) => {
        seen.push(hash);
        return hash === 'hash-1' ? 'SUCCESS' : 'NOT_FOUND';
      },
    });
    expect(stillLocked).toEqual({ locked: true });
    expect(seen).toEqual(['hash-1', 'hash-2']);
    expect(() => beginPrivatePaymentExecution(fingerprint)).toThrow(/reconcil/);

    const cleared = await reconcileUnresolvedSubmission({
      fingerprint,
      readTransaction: async () => 'FAILED',
    });
    expect(cleared).toEqual({ locked: false, confirmation: 'failed' });
    expect(saved).toEqual([]);
    const release = beginPrivatePaymentExecution(fingerprint);
    release.release();
  });

  it('locks a single submitted hash until getTransaction reconciles it', async () => {
    const saved: UnresolvedSubmissionRecord[] = [];
    setUnresolvedSubmissionStore(memoryStore(saved));
    const poolContract = StrKey.encodeContract(Keypair.random().rawPublicKey());
    const amountStroops = '10';
    const fingerprint = privatePaymentFingerprint({
      operation: 'deposit',
      poolContract,
      amountStroops,
      recipient: null,
    });
    const request = { operation: 'deposit' as const, poolContract, amountStroops };
    const pay = async (
      confirmTransaction: (hash: string) => Promise<'SUCCESS' | 'FAILED' | 'NOT_FOUND'>,
      txHash = 'only-hash',
    ) => {
      sppProbeEconomicsBypass.enabled = true;
      try {
        return await executeSppPrivatePayment({
          gate: { mode: 'nym', connected: true, selected: true },
          request,
          rpcUrl: RPC,
          nymFetch: async () => new Response('{"result":"ok"}', { status: 200 }),
          pool: poolWith(async () => ({ txHash })),
          preferInjectedTransport: true,
          authorizationFingerprint: fingerprint,
          confirmTransaction,
        });
      } finally {
        sppProbeEconomicsBypass.enabled = false;
      }
    };

    const submitted = await pay(async () => 'NOT_FOUND');
    expect(submitted.confirmation).toBe('submitted');
    expect(submitted.txHashes).toEqual(['only-hash']);
    expect(saved).toEqual([
      expect.objectContaining({ fingerprint, hashes: ['only-hash'] }),
    ]);
    resetPrivatePaymentExecutionGuardForTests();
    expect(await hasUnresolvedSubmission(fingerprint)).toBe(true);
    await hydrateUnresolvedSubmissions();
    await expect(pay(async () => 'SUCCESS')).rejects.toMatchObject({ code: 'SUBMISSION_UNKNOWN' });

    const pending = await reconcileUnresolvedSubmission({
      fingerprint,
      readTransaction: async () => 'NOT_FOUND',
    });
    expect(pending).toEqual({ locked: true });
    expect(() => beginPrivatePaymentExecution(fingerprint)).toThrow(/reconcil/);

    const failed = await reconcileUnresolvedSubmission({
      fingerprint,
      readTransaction: async () => 'FAILED',
    });
    expect(failed).toEqual({ locked: false, confirmation: 'failed' });
    expect(saved).toEqual([]);
    const failedPayment = await pay(async () => 'FAILED');
    expect(failedPayment.confirmation).toBe('failed');
    expect(await hasUnresolvedSubmission(fingerprint)).toBe(false);

    const confirmed = await pay(async () => 'SUCCESS', 'ok-hash');
    expect(confirmed.confirmation).toBe('confirmed');
    expect(saved).toEqual([]);
    expect(await hasUnresolvedSubmission(fingerprint)).toBe(false);
  });
});
