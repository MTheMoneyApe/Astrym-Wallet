import { Keypair } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';

import type { StellarReadFetch } from '../../src/stellar/read/StellarReadClient.js';
import { StellarTransactionClient } from '../../src/stellar/transaction/StellarTransactionClient.js';
import { StellarAccountNotFundedError } from '../../src/stellar/transaction/types.js';

describe('StellarTransactionClient injected Horizon fetch', () => {
  it('loads the source account through fetchImpl and maps HTTP 404', async () => {
    const sourceKp = Keypair.random();
    const destKp = Keypair.random();
    const calledUrls: string[] = [];
    const fetchImpl: StellarReadFetch = async (url) => {
      calledUrls.push(url);
      return new Response('{"status":404}', { status: 404, statusText: 'Not Found' });
    };
    const client = new StellarTransactionClient(
      'https://horizon-testnet.stellar.org',
      {
        getAccounts: async () => [
          {
            index: 0,
            publicKey: sourceKp.rawPublicKey(),
            label: 'Account 1',
            chain: 'stellar' as const,
          },
        ],
      },
      { signTransaction: async (data: Uint8Array) => sourceKp.sign(data) },
      'Test SDF Network ; September 2015',
      undefined,
      fetchImpl,
    );

    await expect(
      client.reviewXlmTransfer({
        sourceAccountIndex: 0,
        destination: destKp.publicKey(),
        amountXlm: '2',
      }),
    ).rejects.toThrow(StellarAccountNotFundedError);

    expect(calledUrls.length).toBeGreaterThan(0);
    const calledUrl = calledUrls[0] ?? '';
    expect(calledUrl).toContain(sourceKp.publicKey());
    expect(calledUrl).toContain('horizon-testnet.stellar.org');
  });
});
