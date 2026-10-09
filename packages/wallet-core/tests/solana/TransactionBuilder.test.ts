/**
 * TransactionBuilder.test.ts — Unit tests for transaction review and fee estimation.
 */

import { describe, expect, it, vi } from 'vitest';
import { address } from '@solana/kit';
import { TransactionClient } from '../../src/solana/transaction/TransactionClient.js';
import {
  InvalidDestinationError,
  InvalidTransactionAmountError,
  TransactionError,
} from '../../src/solana/transaction/types.js';
import type { DevnetRpcClient } from '../../src/solana/rpc/RpcClient.js';
import type { IAccountMetadataProvider, ITransactionSigner } from '../../src/solana/transaction/types.js';

import { getBase58Encoder } from '@solana/kit';

const DESTINATION = '9Nd1mBQtrCGZXm3XgMy5b2nStJcQG3FmPkWG3wVvjT8Q';
const SOURCE_PUBKEY = '4Nd1mBQtrCGZXm3XgMy5b2nStJcQG3FmPkWG3wVvjT8Q';
const SOURCE_INDEX = 0;

function createMocks() {
  const rpc = {
    getLatestBlockhash: vi.fn().mockReturnValue({
      send: vi.fn().mockResolvedValue({
        value: { blockhash: '2GkHjXXXXXXXXXXXXXXXXXXXXXXXXXXXX', lastValidBlockHeight: 100n },
      }),
    }),
    getFeeForMessage: vi.fn().mockReturnValue({
      send: vi.fn().mockResolvedValue({ value: 5000n }),
    }),
  } as unknown as DevnetRpcClient;

  const keyManager = {
    getAccounts: vi.fn().mockResolvedValue([
      {
        index: SOURCE_INDEX,
        publicKey: getBase58Encoder().encode(SOURCE_PUBKEY),
      },
    ]),
  } as unknown as IAccountMetadataProvider;

  const signer = {} as ITransactionSigner;

  return { rpc, keyManager, signer };
}

describe('TransactionClient — reviewSolTransfer', () => {
  it('rejects invalid amounts before network calls', async () => {
    const { rpc, keyManager, signer } = createMocks();
    const client = new TransactionClient(rpc, keyManager, signer);

    await expect(
      client.reviewSolTransfer({
        sourceAccountIndex: SOURCE_INDEX,
        destination: DESTINATION,
        lamports: 0n,
      }),
    ).rejects.toBeInstanceOf(InvalidTransactionAmountError);

    await expect(
      client.reviewSolTransfer({
        sourceAccountIndex: SOURCE_INDEX,
        destination: DESTINATION,
        lamports: -100n,
      }),
    ).rejects.toBeInstanceOf(InvalidTransactionAmountError);

    expect(rpc.getLatestBlockhash).not.toHaveBeenCalled();
  });

  it('rejects missing source account index', async () => {
    const { rpc, keyManager, signer } = createMocks();
    const client = new TransactionClient(rpc, keyManager, signer);

    await expect(
      client.reviewSolTransfer({
        sourceAccountIndex: 99,
        destination: DESTINATION,
        lamports: 1000n,
      }),
    ).rejects.toThrow(TransactionError);
  });

  it('returns valid transaction summary successfully', async () => {
    const { rpc, keyManager, signer } = createMocks();
    const client = new TransactionClient(rpc, keyManager, signer);

    const summary = await client.reviewSolTransfer({
      sourceAccountIndex: SOURCE_INDEX,
      destination: DESTINATION,
      lamports: 1000000n,
    });

    expect(summary.lamports).toBe(1000000n);
    expect(summary.feeLamports).toBe(5000n);
    expect(summary.sourceAddress).toBe(SOURCE_PUBKEY);
    expect(summary.destinationAddress).toBe(DESTINATION);

    expect(rpc.getLatestBlockhash).toHaveBeenCalled();
    expect(rpc.getFeeForMessage).toHaveBeenCalled();
  });

  it('handles fee RPC failure gracefully', async () => {
    const { rpc, keyManager, signer } = createMocks();
    rpc.getFeeForMessage = vi.fn().mockReturnValue({
      send: vi.fn().mockRejectedValue(new Error('RPC Error')),
    });
    const client = new TransactionClient(rpc, keyManager, signer);

    const err = await client.reviewSolTransfer({
      sourceAccountIndex: SOURCE_INDEX,
      destination: DESTINATION,
      lamports: 1000000n,
    }).catch(e => e);

    expect(err).toBeInstanceOf(TransactionError);
    expect((err as Error).message).toContain('Failed to estimate transaction fee');
  });

  it('rejects invalid destination addresses', async () => {
    const { rpc, keyManager, signer } = createMocks();
    const client = new TransactionClient(rpc, keyManager, signer);

    await expect(
      client.reviewSolTransfer({
        sourceAccountIndex: SOURCE_INDEX,
        destination: 'invalid_base58_address!@#',
        lamports: 1000000n,
      }),
    ).rejects.toBeInstanceOf(InvalidDestinationError);
  });
});
