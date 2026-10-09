/**
 * SolanaReadClient.test.ts — Unit tests for SOL balance and Account info.
 */

import { describe, expect, it, vi } from 'vitest';
import { address } from '@solana/kit';
import { SolanaReadClient } from '../../src/solana/read/SolanaReadClient.js';
import { SolanaReadError } from '../../src/solana/read/types.js';
import type { DevnetRpcClient } from '../../src/solana/rpc/RpcClient.js';

const VALID_PUBKEY = '4Nd1mBQtrCGZXm3XgMy5b2nStJcQG3FmPkWG3wVvjT8Q';
const INVALID_PUBKEY = 'not_a_valid_base58_string_!@#$';

function createMockRpc(overrides: Partial<DevnetRpcClient> = {}): DevnetRpcClient {
  return {
    getBalance: vi.fn(),
    getAccountInfo: vi.fn(),
    getTokenAccountsByOwner: vi.fn(),
    ...overrides,
  } as unknown as DevnetRpcClient;
}

describe('SolanaReadClient — SOL balance', () => {
  it('fetches SOL balance successfully and preserves bigint', async () => {
    const mockRpc = createMockRpc({
      getBalance: vi.fn().mockReturnValue({
        send: vi.fn().mockResolvedValue({ context: { slot: 1 }, value: 18446744073709551615n }),
      }),
    });
    const client = new SolanaReadClient(mockRpc);

    const balance = await client.getSolBalance(VALID_PUBKEY);
    expect(balance.lamports).toBe(18446744073709551615n);
    expect(mockRpc.getBalance).toHaveBeenCalledWith(address(VALID_PUBKEY));
  });

  it('handles zero balance properly', async () => {
    const mockRpc = createMockRpc({
      getBalance: vi.fn().mockReturnValue({
        send: vi.fn().mockResolvedValue({ context: { slot: 1 }, value: 0n }),
      }),
    });
    const client = new SolanaReadClient(mockRpc);

    const balance = await client.getSolBalance(VALID_PUBKEY);
    expect(balance.lamports).toBe(0n);
  });

  it('rejects invalid pubkey before making RPC call', async () => {
    const mockRpc = createMockRpc();
    const client = new SolanaReadClient(mockRpc);

    await expect(client.getSolBalance(INVALID_PUBKEY)).rejects.toBeInstanceOf(SolanaReadError);
    expect(mockRpc.getBalance).not.toHaveBeenCalled();
  });

  it('wraps RPC network errors safely', async () => {
    const mockRpc = createMockRpc({
      getBalance: vi.fn().mockReturnValue({
        send: vi.fn().mockRejectedValue(new Error('Network timeout')),
      }),
    });
    const client = new SolanaReadClient(mockRpc);

    const err = await client.getSolBalance(VALID_PUBKEY).catch((e) => e);
    expect(err).toBeInstanceOf(SolanaReadError);
    expect((err as Error).message).toBe('Failed to fetch SOL balance');
    expect((err as any).cause?.message).toBe('Network timeout');
  });
});

describe('SolanaReadClient — Account info', () => {
  it('returns normalized data for an existing account', async () => {
    const ownerAddr = address('11111111111111111111111111111111');
    const mockRpc = createMockRpc({
      getAccountInfo: vi.fn().mockReturnValue({
        send: vi.fn().mockResolvedValue({
          context: { slot: 1 },
          value: {
            lamports: 5000000n,
            owner: ownerAddr,
            executable: false,
            
            data: 'some_base64_data',
          },
        }),
      }),
    });
    const client = new SolanaReadClient(mockRpc);

    const info = await client.getAccountInfo(VALID_PUBKEY);
    expect(info.exists).toBe(true);
    expect(info.lamports).toBe(5000000n);
    expect(info.owner).toBe(ownerAddr);
    expect(info.executable).toBe(false);
    
    
    // Ensures raw data is not leaked
    expect((info as any).data).toBeUndefined();
  });

  it('handles non-existent (unallocated) accounts safely', async () => {
    const mockRpc = createMockRpc({
      getAccountInfo: vi.fn().mockReturnValue({
        send: vi.fn().mockResolvedValue({
          context: { slot: 1 },
          value: null, // Kit returns null for missing accounts
        }),
      }),
    });
    const client = new SolanaReadClient(mockRpc);

    const info = await client.getAccountInfo(VALID_PUBKEY);
    expect(info.exists).toBe(false);
    expect(info.lamports).toBe(0n);
    expect(info.owner).toBeNull();
    expect(info.executable).toBe(false);
  });

  it('rejects invalid pubkey before making RPC call', async () => {
    const mockRpc = createMockRpc();
    const client = new SolanaReadClient(mockRpc);

    await expect(client.getAccountInfo(INVALID_PUBKEY)).rejects.toBeInstanceOf(SolanaReadError);
    expect(mockRpc.getAccountInfo).not.toHaveBeenCalled();
  });

  it('wraps RPC network errors safely', async () => {
    const mockRpc = createMockRpc({
      getAccountInfo: vi.fn().mockReturnValue({
        send: vi.fn().mockRejectedValue(new Error('Server error')),
      }),
    });
    const client = new SolanaReadClient(mockRpc);

    await expect(client.getAccountInfo(VALID_PUBKEY)).rejects.toBeInstanceOf(SolanaReadError);
  });
});
