/**
 * TransactionClient.test.ts — Unit tests for sendSol and signing flow.
 */

import { describe, expect, it, vi } from 'vitest';
import { TransactionClient } from '../../src/solana/transaction/TransactionClient.js';
import { TransactionError } from '../../src/solana/transaction/types.js';
import type { DevnetRpcClient } from '../../src/solana/rpc/RpcClient.js';
import type { IAccountMetadataProvider, ITransactionSigner } from '../../src/solana/transaction/types.js';

import { getBase58Encoder } from '@solana/kit';

const DESTINATION = '9Nd1mBQtrCGZXm3XgMy5b2nStJcQG3FmPkWG3wVvjT8Q';
const SOURCE_PUBKEY = '4Nd1mBQtrCGZXm3XgMy5b2nStJcQG3FmPkWG3wVvjT8Q';
const SOURCE_INDEX = 0;
const SIGNATURE = '5Xq...signature...';

function createMocks() {
  const rpc = {
    getLatestBlockhash: vi.fn().mockReturnValue({
      send: vi.fn().mockResolvedValue({
        value: { blockhash: '2GkHjXXXXXXXXXXXXXXXXXXXXXXXXXXXX', lastValidBlockHeight: 100n },
      }),
    }),
    getFeeForMessage: vi.fn().mockReturnValue({ send: vi.fn().mockResolvedValue({ value: 5000n }) }),
    getBalance: vi.fn().mockReturnValue({ send: vi.fn().mockResolvedValue({ value: 10_000_000_000n }) }),
    sendTransaction: vi.fn().mockReturnValue({
      send: vi.fn().mockResolvedValue(SIGNATURE),
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

  const signer = {
    sign: vi.fn().mockResolvedValue(new Uint8Array(64).fill(1)),
  } as unknown as ITransactionSigner;

  return { rpc, keyManager, signer };
}

describe('TransactionClient — sendSol', () => {
  it('constructs, signs, and sends transaction successfully', async () => {
    const { rpc, keyManager, signer } = createMocks();
    const client = new TransactionClient(rpc, keyManager, signer);

    const sig = await client.sendSol({
      sourceAccountIndex: SOURCE_INDEX,
      destination: DESTINATION,
      lamports: 1000n,
    });

    expect(sig).toBe(SIGNATURE);
    expect(rpc.getLatestBlockhash).toHaveBeenCalled();
    expect(signer.sign).toHaveBeenCalled();
    expect(rpc.sendTransaction).toHaveBeenCalled();
    
    // Ensure it was called with base64 encoding configuration
    expect(rpc.sendTransaction).toHaveBeenCalledWith(
      expect.any(String),
      { encoding: 'base64' }
    );
  });

  it('fails safely if signer throws (e.g. vault locked)', async () => {
    const { rpc, keyManager, signer } = createMocks();
    signer.sign = vi.fn().mockRejectedValue(new Error('Vault is locked'));
    const client = new TransactionClient(rpc, keyManager, signer);

    await expect(
      client.sendSol({
        sourceAccountIndex: SOURCE_INDEX,
        destination: DESTINATION,
        lamports: 1000n,
      })
    ).rejects.toThrow(/Failed to sign transaction/);

    expect(rpc.sendTransaction).not.toHaveBeenCalled();
  });

  it('fails safely if sendTransaction RPC throws', async () => {
    const { rpc, keyManager, signer } = createMocks();
    rpc.sendTransaction = vi.fn().mockReturnValue({
      send: vi.fn().mockRejectedValue(new Error('RPC Error')),
    });
    const client = new TransactionClient(rpc, keyManager, signer);

    await expect(
      client.sendSol({
        sourceAccountIndex: SOURCE_INDEX,
        destination: DESTINATION,
        lamports: 1000n,
      })
    ).rejects.toThrow(/Failed to send transaction/);
  });

  it('does not call the signer when balance cannot cover amount and estimated fee', async () => {
    const { rpc, keyManager, signer } = createMocks();
    rpc.getBalance = vi.fn().mockReturnValue({ send: vi.fn().mockResolvedValue({ value: 5999n }) });
    const client = new TransactionClient(rpc, keyManager, signer);

    await expect(client.sendSol({
      sourceAccountIndex: SOURCE_INDEX,
      destination: DESTINATION,
      lamports: 1000n,
    })).rejects.toThrow('Insufficient SOL to cover the transfer and network fee');

    expect(signer.sign).not.toHaveBeenCalled();
    expect(rpc.sendTransaction).not.toHaveBeenCalled();
  });

  it('does not sign when the RPC cannot estimate the fee for the final message', async () => {
    const { rpc, keyManager, signer } = createMocks();
    rpc.getFeeForMessage = vi.fn().mockReturnValue({ send: vi.fn().mockResolvedValue({ value: null }) });
    const client = new TransactionClient(rpc, keyManager, signer);

    await expect(client.sendSol({
      sourceAccountIndex: SOURCE_INDEX,
      destination: DESTINATION,
      lamports: 1000n,
    })).rejects.toThrow('Network fee estimate unavailable; transaction not signed');

    expect(signer.sign).not.toHaveBeenCalled();
    expect(rpc.sendTransaction).not.toHaveBeenCalled();
  });
});

describe('TransactionClient — reviewSolTransfer fee estimate', () => {
  it('returns the exact-message fee and current source balance', async () => {
    const { rpc, keyManager, signer } = createMocks();
    const client = new TransactionClient(rpc, keyManager, signer);

    const summary = await client.reviewSolTransfer({
      sourceAccountIndex: SOURCE_INDEX,
      destination: DESTINATION,
      lamports: 25_000n,
    });

    expect(summary.sourceAddress).toBe(SOURCE_PUBKEY);
    expect(summary.destinationAddress).toBe(DESTINATION);
    expect(summary.lamports).toBe(25_000n);
    expect(summary.feeLamports).toBe(5000n);
    expect(summary.balanceLamports).toBe(10_000_000_000n);
    expect(rpc.getFeeForMessage).toHaveBeenCalledWith(expect.any(String));
    expect(rpc.getBalance).toHaveBeenCalledWith(SOURCE_PUBKEY);
    expect(signer.sign).not.toHaveBeenCalled();
  });

  it('fails closed when the RPC returns no fee estimate', async () => {
    const { rpc, keyManager, signer } = createMocks();
    rpc.getFeeForMessage = vi.fn().mockReturnValue({ send: vi.fn().mockResolvedValue({ value: null }) });
    const client = new TransactionClient(rpc, keyManager, signer);

    await expect(client.reviewSolTransfer({
      sourceAccountIndex: SOURCE_INDEX,
      destination: DESTINATION,
      lamports: 25_000n,
    })).rejects.toThrow('Network fee estimate unavailable');
  });
});
