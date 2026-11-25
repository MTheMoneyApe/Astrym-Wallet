import { describe, expect, it, vi } from 'vitest';
import type { Client, WalletSigner } from 'stellar-private-payments';
import {
  SppPoolExecuteError,
  mapSdkPoolExecuteResult,
  initializeSppHostWritePool,
} from '../../src/spp-host/sppHostWritePoolFactory.js';

describe('mapSdkPoolExecuteResult', () => {
  it('keeps every completed hash and does not confirm a prefix', () => {
    const failed = () => mapSdkPoolExecuteResult({
      status: 'failed',
      hashes: ['step-1', 'step-2'],
      message: 'submit stopped',
    });
    expect(failed).toThrow(SppPoolExecuteError);
    try {
      failed();
    } catch (cause) {
      expect(cause).toBeInstanceOf(SppPoolExecuteError);
      if (cause instanceof SppPoolExecuteError) {
        expect(cause.txHashes).toEqual(['step-1', 'step-2']);
        expect(cause.message).toContain('step-1');
        expect(cause.message).toContain('step-2');
      }
    }
    expect(mapSdkPoolExecuteResult({
      status: 'ok',
      hashes: ['only'],
    })).toEqual({ txHash: 'only', txHashes: ['only'] });
    expect(mapSdkPoolExecuteResult({
      status: 'ok',
      hashes: ['first', 'second'],
    })).toEqual({ txHash: null, txHashes: ['first', 'second'] });
  });
});

describe('initializeSppHostWritePool', () => {
  it('surfaces failed indexer sync and never creates a write pool', async () => {
    const pool = vi.fn();
    const sync = vi.fn().mockRejectedValue(new Error('indexer unavailable'));
    const derivePrivacyKeys = vi.fn().mockResolvedValue(undefined);
    const client = {
      account: vi.fn().mockResolvedValue({ derivePrivacyKeys, pool }),
      sync,
    } as unknown as Client;
    await expect(initializeSppHostWritePool({
      client,
      rpcUrl: 'https://soroban-testnet.stellar.org',
      poolContract: 'unused',
      userAddress: 'unused',
      networkPassphrase: 'Test SDF Network ; September 2015',
      prepareGeneration: 1,
      signer: {} as WalletSigner,
    })).rejects.toThrow('SPP_INDEXER_SYNC_FAILED: indexer unavailable');
    expect(derivePrivacyKeys).toHaveBeenCalledOnce();
    expect(sync).toHaveBeenCalledOnce();
    expect(pool).not.toHaveBeenCalled();
  });
});
