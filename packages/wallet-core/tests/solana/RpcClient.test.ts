/**
 * RpcClient.test.ts — Devnet RPC client and cluster verification tests (Phase 5a).
 */

import { describe, expect, it, vi } from 'vitest';
import {
  assertDevnetCluster,
  ClusterMismatchError,
  createRpcClient,
} from '../../src/solana/rpc/RpcClient.js';
import { DEVNET_GENESIS_HASH } from '../../src/solana/rpc/endpoints.js';
import type { DevnetRpcTransport } from '../../src/solana/transport/ITransport.js';

describe('RpcClient — createRpcClient', () => {
  it('wraps the transport and returns a callable client', () => {
    const fakeTransport = vi.fn() as unknown as DevnetRpcTransport;
    const client = createRpcClient(fakeTransport);
    
    expect(typeof client).toBe('object');
    expect(typeof client.getGenesisHash).toBe('function');
  });
});

describe('RpcClient — assertDevnetCluster', () => {
  it('succeeds silently if the genesis hash matches exactly', async () => {
    const mockRpc = {
      getGenesisHash: () => ({
        send: vi.fn().mockResolvedValue(DEVNET_GENESIS_HASH),
      }),
    };
    
    await expect(assertDevnetCluster(mockRpc as any)).resolves.toBeUndefined();
  });

  it('throws ClusterMismatchError if the hash differs', async () => {
    const wrongHash = 'MainnetGenesisHashXXXXXXXXXXXXXXXXXXXXXXXXX'; // 43 chars base58
    const mockRpc = {
      getGenesisHash: () => ({
        send: vi.fn().mockResolvedValue(wrongHash),
      }),
    };
    
    const err = await assertDevnetCluster(mockRpc as any).catch(e => e);
    
    expect(err).toBeInstanceOf(ClusterMismatchError);
    expect(err.receivedGenesisHash).toBe(wrongHash);
    expect(err.message).toContain(DEVNET_GENESIS_HASH);
    expect(err.message).toContain(wrongHash);
  });

  it('ClusterMismatchError redacts malformed genesis hashes from error messages', async () => {
    const malformed = 'NotBase58!!!<script>alert(1)</script>';
    const mockRpc = {
      getGenesisHash: () => ({
        send: vi.fn().mockResolvedValue(malformed),
      }),
    };
    
    const err = await assertDevnetCluster(mockRpc as any).catch(e => e);
    
    expect(err).toBeInstanceOf(ClusterMismatchError);
    expect(err.receivedGenesisHash).toBeNull();
    expect(err.message).toContain('<malformed>');
    expect(err.message).not.toContain(malformed);
  });

  it('ClusterMismatchError redacts wrong-length base58 from error messages', async () => {
    // Correct characters, but too short (less than 32 chars)
    const tooShort = '1234567890123456789012345678901';
    const mockRpc = {
      getGenesisHash: () => ({
        send: vi.fn().mockResolvedValue(tooShort),
      }),
    };
    
    const err = await assertDevnetCluster(mockRpc as any).catch(e => e);
    
    expect(err).toBeInstanceOf(ClusterMismatchError);
    expect(err.receivedGenesisHash).toBeNull();
    expect(err.message).toContain('<malformed>');
    expect(err.message).not.toContain(tooShort);
  });

  it('propagates transport/RPC errors directly', async () => {
    const networkError = new Error('Network Timeout');
    const mockRpc = {
      getGenesisHash: () => ({
        send: vi.fn().mockRejectedValue(networkError),
      }),
    };
    
    await expect(assertDevnetCluster(mockRpc as any)).rejects.toThrow('Network Timeout');
  });
});
