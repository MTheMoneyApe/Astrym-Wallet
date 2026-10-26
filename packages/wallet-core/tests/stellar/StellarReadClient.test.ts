import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { StellarReadClient } from '../../src/stellar/read/StellarReadClient.js';
import { InvalidStellarAddressError, StellarNetworkError } from '../../src/stellar/read/types.js';

const VALID_STELLAR_ADDR = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';

describe('StellarReadClient', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('rejects invalid Stellar addresses before making network calls', async () => {
    const client = new StellarReadClient();
    await expect(client.getBalance('malformed_address')).rejects.toThrow(InvalidStellarAddressError);
    await expect(client.fundTestnetAccount('malformed_address')).rejects.toThrow(InvalidStellarAddressError);
  });

  it('handles unfunded accounts (404) gracefully without throwing', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 404,
      ok: false,
    } as unknown as Response);

    const client = new StellarReadClient();
    const balance = await client.getBalance(VALID_STELLAR_ADDR);

    expect(balance.exists).toBe(false);
    expect(balance.balance).toBe('0');
    expect(balance.asset).toBe('XLM');
    expect(balance.balances).toEqual([]);
    expect(balance.address).toBe(VALID_STELLAR_ADDR);
  });

  it('parses funded account balance and assets correctly', async () => {
    const mockHorizonResponse = {
      subentry_count: 1,
      balances: [
        {
          asset_type: 'native',
          balance: '10000.0000000',
        },
        {
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
          balance: '25.5000000',
        },
      ],
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => mockHorizonResponse,
    } as unknown as Response);

    const client = new StellarReadClient();
    const balance = await client.getBalance(VALID_STELLAR_ADDR);

    expect(balance.exists).toBe(true);
    expect(balance.balance).toBe('10000.0000000');
    expect(balance.asset).toBe('XLM');
    expect(balance.subentryCount).toBe(1);
    expect(balance.balances).toHaveLength(2);
    expect(balance.balances[0]!.assetType).toBe('native');
    expect(balance.balances[1]!.assetCode).toBe('USDC');
  });

  it('wraps network and server failures in StellarNetworkError', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection reset by peer'));

    const client = new StellarReadClient();
    await expect(client.getBalance(VALID_STELLAR_ADDR)).rejects.toThrow(StellarNetworkError);
  });

  it('handles Friendbot funding success', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ hash: 'abc123hash' }),
    } as unknown as Response);

    const client = new StellarReadClient();
    const result = await client.fundTestnetAccount(VALID_STELLAR_ADDR);

    expect(result.success).toBe(true);
    expect(result.txHash).toBe('abc123hash');
    expect(result.message).toContain('10,000 Testnet XLM');
  });

  it('handles Friendbot error response (e.g. 400 already funded)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 400,
      ok: false,
      json: async () => ({ detail: 'account already funded to starting balance' }),
    } as unknown as Response);

    const client = new StellarReadClient();
    const result = await client.fundTestnetAccount(VALID_STELLAR_ADDR);

    expect(result.success).toBe(false);
    expect(result.message).toContain('account already funded to starting balance');
  });
});
