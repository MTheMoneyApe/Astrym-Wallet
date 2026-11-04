import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import {
  StellarTransactionClient,
  attachHorizonFetchAdapter,
  isJsonMediaType,
  STELLAR_BASE_RESERVE_XLM,
  STELLAR_MIN_ACCOUNT_RESERVE_XLM,
  uint8ArrayToBase64,
} from '../../src/stellar/transaction/StellarTransactionClient.js';
import {
  InsufficientXlmBalanceError,
  InvalidStellarAmountError,
  InvalidStellarDestinationError,
  InvalidStellarMemoError,
  StellarAccountNotFundedError,
  StellarFeeChangedError,
  StellarTransactionFailedError,
  StellarTransportMissingError,
} from '../../src/stellar/transaction/types.js';

interface MockAccountData {
  sequence?: string;
  subentry_count?: number;
  balances?: Array<{ asset_type: string; balance: string }>;
}

describe('StellarTransactionClient', () => {
  const sourceKp = Keypair.random();
  const destKp = Keypair.random();
  const sourceAddress = sourceKp.publicKey();
  const destAddress = destKp.publicKey();

  const mockKeyManager = {
    getAccounts: vi.fn().mockResolvedValue([
      {
        index: 0,
        publicKey: sourceKp.rawPublicKey(),
        label: 'Account 1',
        chain: 'stellar',
      },
    ]),
  };

  const mockSigner = {
    signTransaction: vi.fn().mockImplementation((data: Uint8Array) => {
      return sourceKp.sign(data);
    }),
  };

  let mockAccounts: Map<string, MockAccountData | null>;
  let mockBaseFee: number;
  let mockSubmitHandler: ((txBody: string) => Promise<Response> | Response) | null;
  let mockTransactionRecord: { successful: boolean; ledger_attr?: number } | null | 404;
  let mockFetch: any;
  let client: StellarTransactionClient;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAccounts = new Map();
    // Default funded source account
    mockAccounts.set(sourceAddress, {
      sequence: '100',
      subentry_count: 0,
      balances: [{ asset_type: 'native', balance: '100.0000000' }],
    });
    // Default funded destination account
    mockAccounts.set(destAddress, {
      sequence: '50',
      subentry_count: 0,
      balances: [{ asset_type: 'native', balance: '20.0000000' }],
    });

    mockBaseFee = 100;
    mockSubmitHandler = null;
    mockTransactionRecord = null;

    mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const method = (init?.method || 'GET').toUpperCase();

      // POST /transactions
      if (url.includes('/transactions') && method === 'POST') {
        if (mockSubmitHandler) {
          return mockSubmitHandler(init?.body as string);
        }
        return new Response(
          JSON.stringify({
            hash: 'b78a3b4c469b284360d131dab7c3c313abf9e606b9705e0e7e9953a360fb1275',
            ledger: 123456,
            successful: true,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // GET /transactions/:hash
      if (url.includes('/transactions/')) {
        if (mockTransactionRecord === 404) {
          return new Response(
            JSON.stringify({
              status: 404,
              title: 'Resource Missing',
              type: 'https://stellar.org/horizon-errors/not_found',
            }),
            { status: 404, headers: { 'Content-Type': 'application/problem+json' } },
          );
        }
        if (mockTransactionRecord) {
          return new Response(
            JSON.stringify({
              hash: url.split('/transactions/')[1]?.split('?')[0],
              ...mockTransactionRecord,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
      }

      // GET /accounts/:address
      if (url.includes('/accounts/')) {
        const addr = url.split('/accounts/')[1]?.split('?')[0];
        const acc = addr ? mockAccounts.get(addr) : undefined;
        if (acc === null || acc === undefined) {
          return new Response(
            JSON.stringify({
              status: 404,
              title: 'Resource Missing',
              type: 'https://stellar.org/horizon-errors/not_found',
            }),
            { status: 404, headers: { 'Content-Type': 'application/problem+json' } },
          );
        }
        return new Response(
          JSON.stringify({
            id: addr,
            sequence: acc.sequence ?? '100',
            subentry_count: acc.subentry_count ?? 0,
            balances: acc.balances ?? [{ asset_type: 'native', balance: '100.0000000' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // GET /fee_stats
      if (url.includes('/fee_stats')) {
        return new Response(
          JSON.stringify({
            fee_charged: { min: String(mockBaseFee), mode: String(mockBaseFee), p10: String(mockBaseFee) },
            base_fee_in_stroops: mockBaseFee,
            last_ledger_base_fee: mockBaseFee,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // GET /ledgers
      if (url.includes('/ledgers')) {
        return new Response(
          JSON.stringify({
            _embedded: {
              records: [{ sequence: 1000, closed_at: '2026-11-01T15:00:00Z' }],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response('Not Found', { status: 404 });
    });

    client = new StellarTransactionClient(
      'https://horizon-testnet.stellar.org',
      mockKeyManager,
      mockSigner,
      Networks.TESTNET,
      mockFetch,
    );
  });

  describe('Validation', () => {
    it('validates a correct destination address', () => {
      expect(client.validateDestination(destAddress)).toBe(destAddress);
    });

    it('rejects an invalid destination format', () => {
      expect(() => client.validateDestination('not-a-stellar-key')).toThrow(
        InvalidStellarDestinationError,
      );
    });

    it('rejects sending to self', () => {
      expect(() => client.validateDestination(sourceAddress, sourceAddress)).toThrow(
        InvalidStellarDestinationError,
      );
    });

    it('validates a valid amount string', () => {
      expect(client.validateAmount('10.5')).toBe('10.5');
      expect(client.validateAmount('0.0000001')).toBe('0.0000001');
    });

    it('rejects non-positive or malformed amounts', () => {
      expect(() => client.validateAmount('0')).toThrow(InvalidStellarAmountError);
      expect(() => client.validateAmount('-5')).toThrow(InvalidStellarAmountError);
      expect(() => client.validateAmount('abc')).toThrow(InvalidStellarAmountError);
      expect(() => client.validateAmount('1.12345678')).toThrow(InvalidStellarAmountError);
    });

    it('validates memo length within 28 bytes', () => {
      expect(client.validateMemo('Payment for coffee')).toBe('Payment for coffee');
      expect(client.validateMemo('')).toBeUndefined();
      expect(() => client.validateMemo('This is a very long memo that exceeds 28 bytes total')).toThrow(
        InvalidStellarMemoError,
      );
    });
  });

  describe('reviewXlmTransfer', () => {
    it('reviews a payment to an existing account', async () => {
      const summary = await client.reviewXlmTransfer({
        sourceAccountIndex: 0,
        destination: destAddress,
        amountXlm: '5.0',
        memo: 'Hello',
      });

      expect(summary.sourceAddress).toBe(sourceAddress);
      expect(summary.destinationAddress).toBe(destAddress);
      expect(summary.amountXlm).toBe('5.0');
      expect(summary.feeXlm).toBe('0.0000100');
      expect(summary.feeStroops).toBe(100);
      expect(summary.destinationExists).toBe(true);
      expect(summary.operationType).toBe('payment');
      expect(summary.memo).toBe('Hello');
    });

    it('detects unfunded destination and requires minimum 1 XLM createAccount', async () => {
      mockAccounts.set(destAddress, null); // 404

      // Amount >= 1.0 succeeds with createAccount
      const summary = await client.reviewXlmTransfer({
        sourceAccountIndex: 0,
        destination: destAddress,
        amountXlm: '2.5',
      });

      expect(summary.destinationExists).toBe(false);
      expect(summary.operationType).toBe('createAccount');

      // Amount < 1.0 rejects because destination does not exist
      await expect(
        client.reviewXlmTransfer({
          sourceAccountIndex: 0,
          destination: destAddress,
          amountXlm: '0.5',
        }),
      ).rejects.toThrow(InvalidStellarAmountError);
    });

    it('throws StellarAccountNotFundedError if source account is unfunded (404)', async () => {
      mockAccounts.set(sourceAddress, null); // 404

      await expect(
        client.reviewXlmTransfer({
          sourceAccountIndex: 0,
          destination: destAddress,
          amountXlm: '10',
        }),
      ).rejects.toThrow(StellarAccountNotFundedError);
    });

    it('throws InsufficientXlmBalanceError if transfer exceeds available balance reserve', async () => {
      mockAccounts.set(sourceAddress, {
        sequence: '100',
        subentry_count: 2, // reserve = (2 + 2) * 0.5 = 2.0 XLM
        balances: [{ asset_type: 'native', balance: '10.0000000' }], // available = 8.0 XLM
      });

      // 9 XLM > 8 XLM available
      await expect(
        client.reviewXlmTransfer({
          sourceAccountIndex: 0,
          destination: destAddress,
          amountXlm: '9.0',
        }),
      ).rejects.toThrow(InsufficientXlmBalanceError);
    });

    it('balance check uses approvedFeeStroops (not a lower live base fee)', async () => {
      mockBaseFee = 100;
      mockAccounts.set(sourceAddress, {
        sequence: '100',
        subentry_count: 0, // reserve 1.0 -> available 2.0 from balance 3.0
        balances: [{ asset_type: 'native', balance: '3.0000000' }],
      });

      // amount 2.0 + approved 0.0000100 would fit; approved 1_000_000 stroops (=0.1 XLM) still fits
      const ok = await client.reviewXlmTransfer({
        sourceAccountIndex: 0,
        destination: destAddress,
        amountXlm: '1.9',
        approvedFeeStroops: 1_000_000,
      });
      expect(ok.feeStroops).toBe(1_000_000);
      expect(ok.feeXlm).toBe('0.1000000');

      // amount 1.95 + 0.1 fee = 2.05 > available 2.0
      await expect(
        client.reviewXlmTransfer({
          sourceAccountIndex: 0,
          destination: destAddress,
          amountXlm: '1.95',
          approvedFeeStroops: 1_000_000,
        }),
      ).rejects.toThrow(InsufficientXlmBalanceError);
    });
  });

  describe('sendXlm', () => {
    it('builds, signs through signer, and submits transaction to Horizon', async () => {
      const onBeforeSign = vi.fn();

      const result = await client.sendXlm(
        {
          sourceAccountIndex: 0,
          destination: destAddress,
          amountXlm: '1.5',
          memo: 'Test Send',
          approvedFeeStroops: 100,
        },
        onBeforeSign,
      );

      expect(onBeforeSign).toHaveBeenCalledOnce();
      expect(mockSigner.signTransaction).toHaveBeenCalledOnce();
      expect(result.status).toBe('confirmed');
      expect(result.hash).toBe(
        'b78a3b4c469b284360d131dab7c3c313abf9e606b9705e0e7e9953a360fb1275',
      );
      expect(result.ledger).toBe(123456);
    });

    it('F1: builds TX with approvedFeeStroops even when live base fee is lower', async () => {
      mockBaseFee = 50;
      let submittedBody = '';
      mockSubmitHandler = (body: string) => {
        submittedBody = body;
        return new Response(
          JSON.stringify({
            hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            ledger: 1,
            successful: true,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      };

      const result = await client.sendXlm({
        sourceAccountIndex: 0,
        destination: destAddress,
        amountXlm: '1.0',
        approvedFeeStroops: 200,
      });

      expect(result.status).toBe('confirmed');
      expect(mockSigner.signTransaction).toHaveBeenCalledOnce();
      expect(submittedBody).toContain('tx=');

      const params = new URLSearchParams(submittedBody);
      const txXdr = params.get('tx');
      expect(txXdr).toBeTruthy();
      const parsedTx = TransactionBuilder.fromXDR(txXdr!, Networks.TESTNET);
      expect(String(parsedTx.fee)).toBe('200');
    });

    it('F2: aborts before sign/submit when network fee exceeds approvedFeeStroops', async () => {
      mockBaseFee = 500;

      await expect(
        client.sendXlm({
          sourceAccountIndex: 0,
          destination: destAddress,
          amountXlm: '1.0',
          approvedFeeStroops: 100,
        }),
      ).rejects.toThrow(StellarFeeChangedError);

      expect(mockSigner.signTransaction).not.toHaveBeenCalled();
      const submittedPost = mockFetch.mock.calls.find(
        ([url, init]: [string, RequestInit]) => url.includes('/transactions') && init?.method === 'POST',
      );
      expect(submittedPost).toBeUndefined();
    });

    it('formats Horizon error codes cleanly when submission fails', async () => {
      mockSubmitHandler = () =>
        new Response(
          JSON.stringify({
            type: 'https://stellar.org/horizon-errors/transaction_failed',
            title: 'Transaction Failed',
            status: 400,
            detail: 'The transaction failed when submitted to the stellar network.',
            extras: {
              result_codes: {
                transaction: 'tx_failed',
                operations: ['op_underfunded'],
              },
            },
          }),
          { status: 400, headers: { 'Content-Type': 'application/problem+json' } },
        );

      await expect(
        client.sendXlm({
          sourceAccountIndex: 0,
          destination: destAddress,
          amountXlm: '5.0',
          approvedFeeStroops: 100,
        }),
      ).rejects.toThrow(StellarTransactionFailedError);
    });
  });

  describe('confirmTransaction', () => {
    it('returns confirmed status when Horizon reports successful', async () => {
      mockTransactionRecord = {
        successful: true,
        ledger_attr: 98765,
      };

      const res = await client.confirmTransaction('some-hash');
      expect(res.status).toBe('confirmed');
      expect(res.ledger).toBe(98765);
    });

    it('returns failed status when Horizon reports successful: false', async () => {
      mockTransactionRecord = {
        successful: false,
        ledger_attr: 4242,
      };

      const res = await client.confirmTransaction('failed-hash');
      expect(res.status).toBe('failed');
      expect(res.ledger).toBe(4242);
      expect(res.status).not.toBe('confirmed');
      expect(res.status).not.toBe('unknown');
    });

    it('returns unknown status on 404 pending confirmation', async () => {
      mockTransactionRecord = 404;

      const res = await client.confirmTransaction('pending-hash');
      expect(res.status).toBe('unknown');
    });
  });

  describe('Browser Environment & Buffer-Free Encoding (Regression Tests)', () => {
    it('uint8ArrayToBase64 encodes bytes identically to standard base64 without Buffer', () => {
      const testCases = [
        new Uint8Array([]),
        new Uint8Array([0]),
        new Uint8Array([255]),
        new Uint8Array([0, 1, 2, 3, 4, 5, 250, 254, 255]),
        new Uint8Array(64).fill(42),
      ];

      for (const bytes of testCases) {
        const buf = (globalThis as any).Buffer;
        const expected = buf
          ? buf.from(bytes).toString('base64')
          : btoa(String.fromCharCode(...bytes));
        expect(uint8ArrayToBase64(bytes)).toBe(expected);
      }
    });

    it('sendXlm signs and submits successfully when globalThis.Buffer is undefined', async () => {
      const originalBuffer = (globalThis as any).Buffer;
      try {
        delete (globalThis as any).Buffer;

        const result = await client.sendXlm({
          sourceAccountIndex: 0,
          destination: destAddress,
          amountXlm: '10.0',
          approvedFeeStroops: 100,
        });

        expect(result.status).toBe('confirmed');
        expect(result.hash).toBe(
          'b78a3b4c469b284360d131dab7c3c313abf9e606b9705e0e7e9953a360fb1275',
        );
      } finally {
        (globalThis as any).Buffer = originalBuffer;
      }
    });
  });

  describe('Transport Integrity & Fail-Closed Enforcement (Module 1A)', () => {
    it('rejects construction if fetchImpl is missing, undefined, null, or not a function', () => {
      expect(
        () =>
          new StellarTransactionClient(
            'https://horizon-testnet.stellar.org',
            mockKeyManager,
            mockSigner,
            Networks.TESTNET,
            undefined as any,
          ),
      ).toThrow(StellarTransportMissingError);

      expect(
        () =>
          new StellarTransactionClient(
            'https://horizon-testnet.stellar.org',
            mockKeyManager,
            mockSigner,
            Networks.TESTNET,
            null as any,
          ),
      ).toThrow(StellarTransportMissingError);

      expect(
        () =>
          new StellarTransactionClient(
            'https://horizon-testnet.stellar.org',
            mockKeyManager,
            mockSigner,
            Networks.TESTNET,
            'not-a-function' as any,
          ),
      ).toThrow(StellarTransportMissingError);
    });

    it('verifies no production test-only bypass exists on StellarTransactionClient', () => {
      expect((StellarTransactionClient as any).createForTesting).toBeUndefined();
      expect((client as any)._horizon).toBeDefined();
    });

    it('routes GET requests through injected transport', async () => {
      const globalFetchSpy = vi.spyOn(globalThis, 'fetch');

      const review = await client.reviewXlmTransfer({
        sourceAccountIndex: 0,
        destination: destAddress,
        amountXlm: '5.0',
      });

      expect(review.amountXlm).toBe('5.0');
      expect(mockFetch).toHaveBeenCalled();
      expect(globalFetchSpy).not.toHaveBeenCalled();

      globalFetchSpy.mockRestore();
    });

    it('routes POST submission through injected transport with URL-encoded form data', async () => {
      const globalFetchSpy = vi.spyOn(globalThis, 'fetch');

      const result = await client.sendXlm({
        sourceAccountIndex: 0,
        destination: destAddress,
        amountXlm: '5.0',
        approvedFeeStroops: 100,
      });

      expect(result.status).toBe('confirmed');

      const postCall = mockFetch.mock.calls.find(
        ([url, init]: [string, RequestInit]) => url.includes('/transactions') && init?.method === 'POST',
      );
      expect(postCall).toBeDefined();
      expect(postCall[1].headers['content-type']).toContain('application/x-www-form-urlencoded');
      expect(postCall[1].body).toContain('tx=');
      expect(globalFetchSpy).not.toHaveBeenCalled();

      globalFetchSpy.mockRestore();
    });

    it('preserves usable Horizon error information on HTTP error', async () => {
      mockSubmitHandler = () =>
        new Response(
          JSON.stringify({
            type: 'https://stellar.org/horizon-errors/transaction_failed',
            title: 'Transaction Failed',
            status: 400,
            detail: 'The transaction failed when submitted to the stellar network.',
            extras: {
              result_codes: {
                transaction: 'tx_bad_seq',
              },
            },
          }),
          {
            status: 400,
            statusText: 'Bad Request',
            headers: { 'Content-Type': 'application/problem+json' },
          },
        );

      await expect(
        client.sendXlm({
          sourceAccountIndex: 0,
          destination: destAddress,
          amountXlm: '5.0',
          approvedFeeStroops: 100,
        }),
      ).rejects.toThrow(/tx_bad_seq/);
    });

    it('handles JSON content types with charset parameters', async () => {
      expect(isJsonMediaType('application/json; charset=utf-8')).toBe(true);

      let capturedUrl = '';
      const testFetch = vi.fn().mockImplementation(async (url: string) => {
        capturedUrl = url;
        return new Response(JSON.stringify({ parsed: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      });

      const fakeServer: any = { httpClient: { defaults: {} } };
      attachHorizonFetchAdapter(fakeServer, testFetch);

      const res = await fakeServer.httpClient.defaults.adapter({
        method: 'GET',
        url: 'https://horizon-testnet.stellar.org/fee_stats',
      });

      expect(res.data).toEqual({ parsed: true });
      expect(capturedUrl).toContain('/fee_stats');
    });

    it('handles vendor +json responses', async () => {
      expect(isJsonMediaType('application/problem+json')).toBe(true);
      expect(isJsonMediaType('application/problem+json; charset=utf-8')).toBe(true);
      expect(isJsonMediaType('application/vnd.stellar-horizon.v1+json')).toBe(true);

      const testFetch = vi.fn().mockImplementation(async () => {
        return new Response(JSON.stringify({ error_type: 'bad_request' }), {
          status: 200,
          headers: { 'Content-Type': 'application/problem+json; charset=utf-8' },
        });
      });

      const fakeServer: any = { httpClient: { defaults: {} } };
      attachHorizonFetchAdapter(fakeServer, testFetch);

      const res = await fakeServer.httpClient.defaults.adapter({
        method: 'GET',
        url: 'https://horizon-testnet.stellar.org/test_error',
      });

      expect(res.data).toEqual({ error_type: 'bad_request' });
    });

    it('handles malformed JSON responses safely without throwing stream read errors', async () => {
      const malformedBody = '{"not": valid json...';
      const testFetch = vi.fn().mockImplementation(async () => {
        return new Response(malformedBody, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const fakeServer: any = { httpClient: { defaults: {} } };
      attachHorizonFetchAdapter(fakeServer, testFetch);

      const res = await fakeServer.httpClient.defaults.adapter({
        method: 'GET',
        url: 'https://horizon-testnet.stellar.org/malformed',
      });

      expect(res.data).toBe(malformedBody);
    });

    it('correctly serializes repeated and array query parameters', async () => {
      let requestedUrl = '';
      const testFetch = vi.fn().mockImplementation(async (url: string) => {
        requestedUrl = url;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const fakeServer: any = { httpClient: { defaults: {} } };
      attachHorizonFetchAdapter(fakeServer, testFetch);

      await fakeServer.httpClient.defaults.adapter({
        method: 'GET',
        url: 'https://horizon-testnet.stellar.org/ledgers',
        params: {
          tag: ['alpha', 'beta'],
          order: 'desc',
          limit: 10,
        },
      });

      expect(requestedUrl).toContain('tag=alpha');
      expect(requestedUrl).toContain('tag=beta');
      expect(requestedUrl).toContain('order=desc');
      expect(requestedUrl).toContain('limit=10');

      // Test with URLSearchParams
      const searchParams = new URLSearchParams();
      searchParams.append('cursor', 'now');
      searchParams.append('filter', 'op_payment');
      searchParams.append('filter', 'op_create_account');

      await fakeServer.httpClient.defaults.adapter({
        method: 'GET',
        url: 'https://horizon-testnet.stellar.org/operations',
        params: searchParams,
      });

      expect(requestedUrl).toContain('cursor=now');
      expect(requestedUrl).toContain('filter=op_payment&filter=op_create_account');
    });

    it('handles supported Axios header representations safely', async () => {
      let sentHeaders: any;
      const testFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        sentHeaders = init?.headers;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const fakeServer: any = { httpClient: { defaults: {} } };
      attachHorizonFetchAdapter(fakeServer, testFetch);

      // Plain object
      await fakeServer.httpClient.defaults.adapter({
        method: 'GET',
        url: 'https://horizon-testnet.stellar.org/test',
        headers: { 'X-Header-One': 'val1' },
      });
      expect(sentHeaders['x-header-one']).toBe('val1');

      // AxiosHeaders with toJSON
      const mockAxiosHeaders = {
        toJSON: () => ({ 'X-Header-Two': 'val2' }),
      };
      await fakeServer.httpClient.defaults.adapter({
        method: 'GET',
        url: 'https://horizon-testnet.stellar.org/test',
        headers: mockAxiosHeaders,
      });
      expect(sentHeaders['x-header-two']).toBe('val2');

      // Iterable / array entries
      await fakeServer.httpClient.defaults.adapter({
        method: 'GET',
        url: 'https://horizon-testnet.stellar.org/test',
        headers: [['X-Header-Three', 'val3']],
      });
      expect(sentHeaders['x-header-three']).toBe('val3');
    });

    it('respects cancellation and timeout behavior', async () => {
      const testFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.signal?.aborted) {
          throw new Error('aborted');
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const fakeServer: any = { httpClient: { defaults: {} } };
      attachHorizonFetchAdapter(fakeServer, testFetch);

      const controller = new AbortController();
      controller.abort(new Error('User cancelled'));

      await expect(
        fakeServer.httpClient.defaults.adapter({
          method: 'GET',
          url: 'https://horizon-testnet.stellar.org/test',
          signal: controller.signal,
        }),
      ).rejects.toThrow('aborted');
    });

    it('propagates transport error directly without falling back to clearnet fetch', async () => {
      const nymError = new Error('Nym mixnet gateway unavailable');
      const failFetch = vi.fn().mockRejectedValue(nymError);
      const globalFetchSpy = vi.spyOn(globalThis, 'fetch');

      const injectedClient = new StellarTransactionClient(
        'https://horizon-testnet.stellar.org',
        mockKeyManager,
        mockSigner,
        Networks.TESTNET,
        failFetch,
      );

      await expect(
        injectedClient.reviewXlmTransfer({
          sourceAccountIndex: 0,
          destination: destAddress,
          amountXlm: '5.0',
        }),
      ).rejects.toThrow('Nym mixnet gateway unavailable');

      expect(failFetch).toHaveBeenCalled();
      expect(globalFetchSpy).not.toHaveBeenCalled();

      globalFetchSpy.mockRestore();
    });
  });
});
