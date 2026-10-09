/**
 * tokenParsing.test.ts — Unit tests for SPL token discovery (Phase 5b).
 */

import { describe, expect, it, vi } from 'vitest';
import { address } from '@solana/kit';
import { SolanaReadClient } from '../../src/solana/read/SolanaReadClient.js';
import { SolanaReadError } from '../../src/solana/read/types.js';
import type { DevnetRpcClient } from '../../src/solana/rpc/RpcClient.js';

const VALID_PUBKEY = '4Nd1mBQtrCGZXm3XgMy5b2nStJcQG3FmPkWG3wVvjT8Q';
const MOCK_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const MOCK_TOKEN_ACC = '2Qp6t4iG2X1E7e3p24N5zZ3m6Y6L1x9F1H5m5C9V7H9F';

function createMockRpc(overrides: Partial<DevnetRpcClient> = {}): DevnetRpcClient {
  return {
    getTokenAccountsByOwner: vi.fn(),
    ...overrides,
  } as unknown as DevnetRpcClient;
}

function mockTokenAccount(
  pubkey: string,
  amount: string,
  decimals: number,
  mint: string = MOCK_MINT,
  owner: string = VALID_PUBKEY,
  uiAmountString?: string
) {
  return {
    pubkey: address(pubkey),
    account: {
      lamports: 2039280n,
      owner: address(TOKEN_PROGRAM_ID),
      executable: false,
      data: {
        program: 'spl-token',
        parsed: {
          info: {
            mint,
            owner,
            tokenAmount: { amount, decimals, uiAmountString },
          },
        },
      },
    },
  };
}

describe('SolanaReadClient — Token discovery', () => {
  it('returns empty array when wallet has no token accounts', async () => {
    const mockRpc = createMockRpc({
      getTokenAccountsByOwner: vi.fn().mockReturnValue({
        send: vi.fn().mockResolvedValue({ context: { slot: 1 }, value: [] }),
      }),
    });
    const client = new SolanaReadClient(mockRpc);

    const accounts = await client.getTokenAccounts(VALID_PUBKEY);
    expect(accounts).toEqual([]);
  });

  it('parses exactly one token account properly', async () => {
    const mockRpc = createMockRpc({
      getTokenAccountsByOwner: vi.fn().mockReturnValue({
        send: vi.fn().mockResolvedValue({
          context: { slot: 1 },
          value: [mockTokenAccount(MOCK_TOKEN_ACC, '1234567', 6, MOCK_MINT, VALID_PUBKEY, '1.234567')],
        }),
      }),
    });
    const client = new SolanaReadClient(mockRpc);

    const accounts = await client.getTokenAccounts(VALID_PUBKEY);
    expect(accounts).toHaveLength(1);
    const acc = accounts[0];
    if (!acc) throw new Error('not found');
    expect(acc.address).toBe(MOCK_TOKEN_ACC);
    expect(acc.mint).toBe(MOCK_MINT);
    expect(acc.owner).toBe(VALID_PUBKEY);
    expect(acc.amount).toBe(1234567n);
    expect(acc.decimals).toBe(6);
    expect(acc.uiAmountString).toBe('1.234567');
    expect(acc.program).toBe(TOKEN_PROGRAM_ID);
  });

  it('parses multiple token accounts, even for the same mint', async () => {
    const mockRpc = createMockRpc({
      getTokenAccountsByOwner: vi.fn().mockReturnValue({
        send: vi.fn().mockResolvedValue({
          context: { slot: 1 },
          value: [
            mockTokenAccount('acc1111111111111111111111111111111111111111', '100', 6),
            mockTokenAccount('acc2222222222222222222222222222222222222222', '200', 6),
          ],
        }),
      }),
    });
    const client = new SolanaReadClient(mockRpc);

    const accounts = await client.getTokenAccounts(VALID_PUBKEY);
    expect(accounts).toHaveLength(2);
    const acc0 = accounts[0];
    const acc1 = accounts[1];
    if (!acc0 || !acc1) throw new Error('not found');
    expect(acc0.amount).toBe(100n);
    expect(acc1.amount).toBe(200n);
  });

  it('handles zero balance token accounts', async () => {
    const mockRpc = createMockRpc({
      getTokenAccountsByOwner: vi.fn().mockReturnValue({
        send: vi.fn().mockResolvedValue({
          context: { slot: 1 },
          value: [mockTokenAccount(MOCK_TOKEN_ACC, '0', 6)],
        }),
      }),
    });
    const client = new SolanaReadClient(mockRpc);

    const accounts = await client.getTokenAccounts(VALID_PUBKEY);
    const acc = accounts[0];
    if (!acc) throw new Error('not found');
    expect(acc.amount).toBe(0n);
  });

  it('preserves huge bigint amounts accurately', async () => {
    // 2^64 - 1
    const maxU64 = '18446744073709551615';
    const mockRpc = createMockRpc({
      getTokenAccountsByOwner: vi.fn().mockReturnValue({
        send: vi.fn().mockResolvedValue({
          context: { slot: 1 },
          value: [mockTokenAccount(MOCK_TOKEN_ACC, maxU64, 9)],
        }),
      }),
    });
    const client = new SolanaReadClient(mockRpc);

    const accounts = await client.getTokenAccounts(VALID_PUBKEY);
    const acc = accounts[0];
    if (!acc) throw new Error('not found');
    expect(acc.amount).toBe(18446744073709551615n);
  });

  it('throws typed error if token amount is malformed', async () => {
    const mockRpc = createMockRpc({
      getTokenAccountsByOwner: vi.fn().mockReturnValue({
        send: vi.fn().mockResolvedValue({
          context: { slot: 1 },
          value: [mockTokenAccount(MOCK_TOKEN_ACC, 'not_a_number', 9)],
        }),
      }),
    });
    const client = new SolanaReadClient(mockRpc);

    const err = await client.getTokenAccounts(VALID_PUBKEY).catch(e => e);
    expect(err).toBeInstanceOf(SolanaReadError);
    expect(err.message).toBe('Invalid token amount numeric format');
  });

  it('throws typed error if RPC returns unparsed binary data', async () => {
    const mockRpc = createMockRpc({
      getTokenAccountsByOwner: vi.fn().mockReturnValue({
        send: vi.fn().mockResolvedValue({
          context: { slot: 1 },
          value: [{
            pubkey: address(MOCK_TOKEN_ACC),
            account: { data: 'some_base64_string', owner: address(TOKEN_PROGRAM_ID) }
          }],
        }),
      }),
    });
    const client = new SolanaReadClient(mockRpc);

    const err = await client.getTokenAccounts(VALID_PUBKEY).catch(e => e);
    expect(err).toBeInstanceOf(SolanaReadError);
    expect(err.message).toBe('Unexpected raw binary data in token account');
  });

  it('skips unrecognized program data safely without crashing', async () => {
    const mockRpc = createMockRpc({
      getTokenAccountsByOwner: vi.fn().mockReturnValue({
        send: vi.fn().mockResolvedValue({
          context: { slot: 1 },
          value: [{
            pubkey: address(MOCK_TOKEN_ACC),
            account: { data: { program: 'some-other-program' }, owner: address(TOKEN_PROGRAM_ID) }
          }],
        }),
      }),
    });
    const client = new SolanaReadClient(mockRpc);

    const accounts = await client.getTokenAccounts(VALID_PUBKEY);
    expect(accounts).toEqual([]); // skipped
  });

  it('throws typed error if token data structure is unexpectedly missing info', async () => {
    const mockRpc = createMockRpc({
      getTokenAccountsByOwner: vi.fn().mockReturnValue({
        send: vi.fn().mockResolvedValue({
          context: { slot: 1 },
          value: [{
            pubkey: address(MOCK_TOKEN_ACC),
            account: { data: { program: 'spl-token', parsed: {} }, owner: address(TOKEN_PROGRAM_ID) }
          }],
        }),
      }),
    });
    const client = new SolanaReadClient(mockRpc);

    const err = await client.getTokenAccounts(VALID_PUBKEY).catch(e => e);
    expect(err).toBeInstanceOf(SolanaReadError);
    expect(err.message).toContain('Malformed');
  });
});
