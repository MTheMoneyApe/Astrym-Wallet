/**
 * TransactionConfirmation.test.ts — Unit tests for polling confirmation.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { TransactionClient } from '../../src/solana/transaction/TransactionClient.js';
import type { DevnetRpcClient } from '../../src/solana/rpc/RpcClient.js';
import type { IAccountMetadataProvider, ITransactionSigner } from '../../src/solana/transaction/types.js';

const SIGNATURE = '5Xq...signature...';

function createRpc(getSignatureStatusesFn: any) {
  return {
    getSignatureStatuses: getSignatureStatusesFn,
  } as unknown as DevnetRpcClient;
}

describe('TransactionClient — confirmTransaction', () => {
  beforeEach(() => {
    // We don't want to actually wait 1.5s per iteration in tests.
    // However, vitest vi.useFakeTimers() affects setTimeout, but our client
    // uses AbortSignal.timeout which might not be mocked by vi.useFakeTimers.
    // For these tests, we can just ensure that the timeout bounds logic works,
    // or if we rely on Date.now(), we can mock Date.now().
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns confirmed status successfully', async () => {
    const rpc = createRpc(
      vi.fn().mockReturnValue({
        send: vi.fn().mockResolvedValue({
          value: [{ confirmationStatus: 'confirmed', err: null }],
        }),
      })
    );
    const client = new TransactionClient(rpc, {} as IAccountMetadataProvider, {} as ITransactionSigner);

    const result = await client.confirmTransaction(SIGNATURE);
    expect(result.status).toBe('confirmed');
    expect(result.signature).toBe(SIGNATURE);
  });

  it('returns failed status if transaction has err', async () => {
    const rpc = createRpc(
      vi.fn().mockReturnValue({
        send: vi.fn().mockResolvedValue({
          value: [{ confirmationStatus: 'confirmed', err: { InstructionError: [0, 'Custom'] } }],
        }),
      })
    );
    const client = new TransactionClient(rpc, {} as IAccountMetadataProvider, {} as ITransactionSigner);

    const result = await client.confirmTransaction(SIGNATURE);
    expect(result.status).toBe('failed');
  });

  it('times out if not confirmed in time bounds', async () => {
    // Return null status continuously
    const rpc = createRpc(
      vi.fn().mockReturnValue({
        send: vi.fn().mockResolvedValue({
          value: [null],
        }),
      })
    );
    const client = new TransactionClient(rpc, {} as IAccountMetadataProvider, {} as ITransactionSigner);
    
    // We need to advance time so Date.now() thinks timeout passed
    // But confirmTransaction awaits a Promise. We need to let the event loop spin.
    // Instead of messing with complex async timers for AbortSignal, we can just mock Date.now().
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1000) // startTime
      .mockReturnValueOnce(1000) // first loop check
      .mockReturnValueOnce(35000); // second loop check (exceeds 30000)

    const result = await client.confirmTransaction(SIGNATURE, 30000);
    expect(result.status).toBe('timeout');
    
    vi.restoreAllMocks();
  });
});
