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
  StellarClockSkewTooLargeError,
  StellarFeeChangedError,
  StellarFeeCeilingExceededError,
  StellarFeeQueryFailedError,
  StellarTimeboundsQueryFailedError,
  StellarTransportMissingError,
  StellarWriteAheadFailedError,
} from '../../src/stellar/transaction/types.js';
import type { StellarSubmissionLifecycle } from '../../src/stellar/transaction/types.js';

interface MockAccountData {
  sequence?: string;
  subentry_count?: number;
  balances?: Array<{ asset_type: string; balance: string }>;
}

const testSubmissionLifecycle = {
  beforeDispatch: vi.fn<StellarSubmissionLifecycle['beforeDispatch']>(async () => {}),
  resolve: vi.fn<StellarSubmissionLifecycle['resolve']>(async () => {}),
};

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
  let mockFeeStats: unknown;
  let mockFeeFailure: Error | null;
  let mockLedgerResponse: unknown;
  let mockServerDate: string | null | undefined;
  let mockResolvedServerDate: string | null;
  let mockLedgerAge: string | null;
  let mockSubmitHandler: ((txBody: string) => Promise<Response> | Response) | null;
  let mockTransactionRecord: { successful: boolean; ledger_attr?: number } | null | 404;
  let mockFetch: any;
  let client: StellarTransactionClient;

  beforeEach(() => {
    vi.clearAllMocks();
    testSubmissionLifecycle.beforeDispatch.mockResolvedValue(undefined);
    testSubmissionLifecycle.resolve.mockResolvedValue(undefined);

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
    mockFeeStats = null;
    mockFeeFailure = null;
    mockLedgerResponse = null;
    mockServerDate = undefined;
    mockResolvedServerDate = null;
    mockLedgerAge = null;
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
            account_id: addr,
            sequence: acc.sequence ?? '100',
            subentry_count: acc.subentry_count ?? 0,
            data_attr: {},
            balances: acc.balances ?? [{ asset_type: 'native', balance: '100.0000000' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // GET /fee_stats
      if (url.includes('/fee_stats')) {
        if (mockFeeFailure) throw mockFeeFailure;
        const feeStats = mockFeeStats ?? {
          fee_charged: { min: String(mockBaseFee), mode: String(mockBaseFee), p10: String(mockBaseFee) },
          base_fee_in_stroops: mockBaseFee,
          last_ledger_base_fee: mockBaseFee,
        };
        return new Response(
          JSON.stringify(feeStats),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // GET /ledgers
      if (url.includes('/ledgers')) {
        const serverDate = mockServerDate === undefined ? new Date().toUTCString() : mockServerDate;
        mockResolvedServerDate = serverDate;
        const currentLedger = {
          sequence: 1000,
          closed_at: serverDate === null
            ? new Date().toISOString()
            : new Date(Date.parse(serverDate)).toISOString(),
        };
        const headers = new Headers({
          'Content-Type': 'application/json',
          ...(serverDate !== null ? { Date: serverDate } : {}),
          ...(mockLedgerAge !== null ? { Age: mockLedgerAge } : {}),
        });
        return new Response(
          JSON.stringify(mockLedgerResponse ?? {
            _embedded: {
              records: [currentLedger],
            },
          }),
          { status: 200, headers },
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
      testSubmissionLifecycle,
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

    it('uses last_ledger_base_fee, not fee_charged aggregate statistics', async () => {
      mockFeeStats = {
        last_ledger_base_fee: '250',
        fee_charged: { min: '9_999', mode: '9_999', p10: '9_999' },
      };
      const summary = await client.reviewXlmTransfer({
        sourceAccountIndex: 0,
        destination: destAddress,
        amountXlm: '1.0',
      });
      expect(summary.feeStroops).toBe(250);
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
        approvedFeeStroops: 100_000,
      });
      expect(ok.feeStroops).toBe(100_000);
      expect(ok.feeXlm).toBe('0.0100000');

      // amount 1.995 + 0.01 fee = 2.005 > available 2.0
      await expect(
        client.reviewXlmTransfer({
          sourceAccountIndex: 0,
          destination: destAddress,
          amountXlm: '1.995',
          approvedFeeStroops: 100_000,
        }),
      ).rejects.toThrow(InsufficientXlmBalanceError);
    });

    it.each([
      ['missing fee', {}, StellarFeeQueryFailedError],
      ['negative fee', { last_ledger_base_fee: -1 }, StellarFeeQueryFailedError],
      ['zero fee', { last_ledger_base_fee: 0 }, StellarFeeQueryFailedError],
      ['fractional fee', { last_ledger_base_fee: 1.5 }, StellarFeeQueryFailedError],
      ['unsafe fee', { last_ledger_base_fee: Number.MAX_SAFE_INTEGER + 1 }, StellarFeeQueryFailedError],
      ['non-numeric fee', { last_ledger_base_fee: '100 stroops' }, StellarFeeQueryFailedError],
      ['over-ceiling fee', { last_ledger_base_fee: 10_001 }, StellarFeeCeilingExceededError],
    ])('rejects a %s response from Horizon before signing or submission', async (_label, payload, expectedError) => {
      mockFeeStats = payload;
      await expect(client.sendXlm({
        sourceAccountIndex: 0,
        destination: destAddress,
        amountXlm: '1.0',
        approvedFeeStroops: 100,
      })).rejects.toThrow(expectedError);

      expect(mockSigner.signTransaction).not.toHaveBeenCalled();
      expect(mockFetch.mock.calls.some(
        ([url, init]: [string, RequestInit]) => url.includes('/transactions') && init?.method === 'POST',
      )).toBe(false);
      expect(testSubmissionLifecycle.beforeDispatch).not.toHaveBeenCalled();
      expect(testSubmissionLifecycle.resolve).not.toHaveBeenCalled();
    });

    it('fails closed on fee endpoint network failures without signing, posting, or clearing uncertainty', async () => {
      mockFeeFailure = new TypeError('network unavailable');
      await expect(client.sendXlm({
        sourceAccountIndex: 0,
        destination: destAddress,
        amountXlm: '1.0',
        approvedFeeStroops: 100,
      })).rejects.toThrow(StellarFeeQueryFailedError);

      expect(mockSigner.signTransaction).not.toHaveBeenCalled();
      expect(mockFetch.mock.calls.some(
        ([url, init]: [string, RequestInit]) => url.includes('/transactions') && init?.method === 'POST',
      )).toBe(false);
      expect(testSubmissionLifecycle.beforeDispatch).not.toHaveBeenCalled();
      expect(testSubmissionLifecycle.resolve).not.toHaveBeenCalled();
    });

    it('rejects an approved fee above 100,000 stroops without substituting a lower fee', async () => {
      await expect(client.sendXlm({
        sourceAccountIndex: 0,
        destination: destAddress,
        amountXlm: '1.0',
        approvedFeeStroops: 100_001,
      })).rejects.toThrow(StellarFeeCeilingExceededError);
      expect(mockSigner.signTransaction).not.toHaveBeenCalled();
      expect(mockFetch.mock.calls.some(
        ([url, init]: [string, RequestInit]) => url.includes('/transactions') && init?.method === 'POST',
      )).toBe(false);
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
      expect(result.status).toBe('SUBMITTED_INGESTED');
      expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.ledger).toBe(123456);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/ledgers?order=desc&limit=1'),
        expect.objectContaining({
          cache: 'no-store',
          headers: expect.objectContaining({
            'Cache-Control': 'no-cache, no-store, max-age=0',
            Pragma: 'no-cache',
          }),
        }),
      );
      const currentServerTime = Math.floor(
        Date.parse(mockResolvedServerDate ?? '') / 1000,
      );
      expect(testSubmissionLifecycle.beforeDispatch.mock.calls[0]?.[0].maxTime).toBe(
        currentServerTime + 300,
      );
    });

    it.each([
      ['missing Date header', null, null],
      ['malformed Date header', 'not-a-date', null],
      ['stale cached response', null, '1'],
    ])('fails closed when Horizon time is untrustworthy (%s)', async (_label, dateHeader, ageHeader) => {
      mockServerDate = dateHeader;
      mockLedgerAge = ageHeader;
      await expect(client.sendXlm({
        sourceAccountIndex: 0,
        destination: destAddress,
        amountXlm: '1.0',
        approvedFeeStroops: 100,
      })).rejects.toThrow(StellarTimeboundsQueryFailedError);

      expect(mockSigner.signTransaction).not.toHaveBeenCalled();
      expect(mockFetch.mock.calls.some(
        ([url, init]: [string, RequestInit]) => url.includes('/transactions') && init?.method === 'POST',
      )).toBe(false);
      expect(testSubmissionLifecycle.beforeDispatch).not.toHaveBeenCalled();
      expect(testSubmissionLifecycle.resolve).not.toHaveBeenCalled();
    });

    it('rejects a Horizon Date header whose clock differs from local time by more than 60 seconds', async () => {
      const oldServerDate = new Date((Math.floor(Date.now() / 1000) - 61) * 1000);
      mockServerDate = oldServerDate.toUTCString();
      await expect(client.sendXlm({
        sourceAccountIndex: 0,
        destination: destAddress,
        amountXlm: '1.0',
        approvedFeeStroops: 100,
      })).rejects.toThrow(StellarClockSkewTooLargeError);

      expect(mockSigner.signTransaction).not.toHaveBeenCalled();
      expect(mockFetch.mock.calls.some(
        ([url, init]: [string, RequestInit]) => url.includes('/transactions') && init?.method === 'POST',
      )).toBe(false);
    });

    it('rejects a zero maximum time instead of submitting an unbounded transaction', async () => {
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(-300_000);
      mockServerDate = new Date(-300_000).toUTCString();
      try {
        await expect(client.sendXlm({
          sourceAccountIndex: 0,
          destination: destAddress,
          amountXlm: '1.0',
          approvedFeeStroops: 100,
        })).rejects.toThrow(StellarTimeboundsQueryFailedError);
      } finally {
        nowSpy.mockRestore();
      }

      expect(mockSigner.signTransaction).not.toHaveBeenCalled();
      expect(mockFetch.mock.calls.some(
        ([url, init]: [string, RequestInit]) => url.includes('/transactions') && init?.method === 'POST',
      )).toBe(false);
    });

    it.each([
      ['missing sequence', { _embedded: { records: [{ closed_at: new Date().toISOString() }] } }],
      ['zero sequence', { _embedded: { records: [{ sequence: 0, closed_at: new Date().toISOString() }] } }],
      ['missing close time', { _embedded: { records: [{ sequence: 1000 }] } }],
      ['stale ledger', {
        _embedded: {
          records: [{
            sequence: 1000,
            closed_at: new Date(Date.now() - 61_000).toISOString(),
          }],
        },
      }],
      ['future ledger', {
        _embedded: {
          records: [{
            sequence: 1000,
            closed_at: new Date(Date.now() + 2_000).toISOString(),
          }],
        },
      }],
    ])('rejects unreliable ledger data (%s) before signing or dispatch', async (_label, payload) => {
      mockLedgerResponse = payload;
      await expect(client.sendXlm({
        sourceAccountIndex: 0,
        destination: destAddress,
        amountXlm: '1.0',
        approvedFeeStroops: 100,
      })).rejects.toThrow(StellarTimeboundsQueryFailedError);

      expect(mockSigner.signTransaction).not.toHaveBeenCalled();
      expect(mockFetch.mock.calls.some(
        ([url, init]: [string, RequestInit]) => url.includes('/transactions') && init?.method === 'POST',
      )).toBe(false);
      expect(testSubmissionLifecycle.beforeDispatch).not.toHaveBeenCalled();
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

      expect(result.status).toBe('SUBMITTED_INGESTED');
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

    it('keeps tx_failed ambiguous because it does not prove pre-inclusion rejection', async () => {
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

      const result = await client.sendXlm({
          sourceAccountIndex: 0,
          destination: destAddress,
          amountXlm: '5.0',
          approvedFeeStroops: 100,
        });

      expect(result.status).toBe('SUBMISSION_UNKNOWN');
      expect(testSubmissionLifecycle.resolve).not.toHaveBeenCalled();
    });

    it('persists SUBMITTING and acquires the lock before dispatching POST', async () => {
      const order: string[] = [];
      testSubmissionLifecycle.beforeDispatch.mockImplementation(async (record) => {
        expect(record.status).toBe('SUBMITTING');
        expect(record.txHash).toMatch(/^[a-f0-9]{64}$/);
        expect(record).toMatchObject({
          accountIndex: 0,
          sourceAddress,
          destinationAddress: destAddress,
          amountXlm: '1.0',
          approvedFeeStroops: 100,
          expectedSequence: '101',
        });
        expect(Object.keys(record)).not.toContain('signedXdr');
        order.push('write-ahead');
      });
      mockSubmitHandler = () => {
        order.push('post');
        return new Response(JSON.stringify({ hash: 'ignored', ledger: 42 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const result = await client.sendXlm({
        sourceAccountIndex: 0,
        destination: destAddress,
        amountXlm: '1.0',
        approvedFeeStroops: 100,
      });

      expect(order).toEqual(['write-ahead', 'post']);
      expect(result.status).toBe('SUBMITTED_INGESTED');
      expect(testSubmissionLifecycle.resolve).toHaveBeenCalledOnce();
    });

    it('does not POST when uncertainty persistence fails', async () => {
      testSubmissionLifecycle.beforeDispatch.mockRejectedValueOnce(new Error('session storage failed'));

      await expect(client.sendXlm({
        sourceAccountIndex: 0,
        destination: destAddress,
        amountXlm: '1.0',
        approvedFeeStroops: 100,
      })).rejects.toThrow(StellarWriteAheadFailedError);

      expect(mockFetch.mock.calls.some(
        ([url, init]: [string, RequestInit]) => url.includes('/transactions') && init?.method === 'POST',
      )).toBe(false);
    });

    it('does not POST when global lock acquisition fails after persistence', async () => {
      testSubmissionLifecycle.beforeDispatch.mockImplementationOnce(async () => {
        throw new Error('lock acquisition failed');
      });

      await expect(client.sendXlm({
        sourceAccountIndex: 0,
        destination: destAddress,
        amountXlm: '1.0',
        approvedFeeStroops: 100,
      })).rejects.toThrow(StellarWriteAheadFailedError);

      expect(mockFetch.mock.calls.some(
        ([url, init]: [string, RequestInit]) => url.includes('/transactions') && init?.method === 'POST',
      )).toBe(false);
    });

    it.each([
      ['timeout', new Error('request timeout')],
      ['network failure', new TypeError('connection reset')],
    ])('returns SUBMISSION_UNKNOWN for a %s without retrying', async (_label, error) => {
      mockSubmitHandler = () => Promise.reject(error);

      const result = await client.sendXlm({
        sourceAccountIndex: 0,
        destination: destAddress,
        amountXlm: '1.0',
        approvedFeeStroops: 100,
      });

      expect(result.status).toBe('SUBMISSION_UNKNOWN');
      expect(testSubmissionLifecycle.resolve).not.toHaveBeenCalled();
      expect(mockFetch.mock.calls.filter(
        ([url, init]: [string, RequestInit]) => url.includes('/transactions') && init?.method === 'POST',
      )).toHaveLength(1);
    });

    it('keeps HTTP 5xx ambiguous and retains the uncertain state', async () => {
      mockSubmitHandler = () => new Response('server error', { status: 503 });

      const result = await client.sendXlm({
        sourceAccountIndex: 0,
        destination: destAddress,
        amountXlm: '1.0',
        approvedFeeStroops: 100,
      });

      expect(result.status).toBe('SUBMISSION_UNKNOWN');
      expect(testSubmissionLifecycle.resolve).not.toHaveBeenCalled();
    });

    it('preserves the uncertain lock when clearing persistence fails after HTTP 200', async () => {
      testSubmissionLifecycle.resolve.mockRejectedValueOnce(new Error('session remove failed'));

      await expect(client.sendXlm({
        sourceAccountIndex: 0,
        destination: destAddress,
        amountXlm: '1.0',
        approvedFeeStroops: 100,
      })).rejects.toThrow(StellarWriteAheadFailedError);

      expect(mockFetch.mock.calls.some(
        ([url, init]: [string, RequestInit]) => url.includes('/transactions') && init?.method === 'POST',
      )).toBe(true);
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
      const makeBrowserResponse = (body: unknown, status = 200): Response => ({
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? 'OK' : 'Not Found',
        headers: {
          get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null,
          forEach: (callback: (value: string, key: string) => void) => callback('application/json', 'content-type'),
        },
        text: async () => JSON.stringify(body),
        json: async () => body,
      }) as Response;

      try {
        mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
          if (url.includes('/fee_stats')) {
            return makeBrowserResponse({
              last_ledger_base_fee: 100,
              fee_charged: { min: '100', mode: '100', p10: '100' },
            });
          }
          if (url.includes('/ledgers')) {
            const serverDate = new Date().toUTCString();
            return {
              ...makeBrowserResponse({
                _embedded: {
                  records: [{
                    sequence: 1000,
                    closed_at: new Date(Date.parse(serverDate)).toISOString(),
                  }],
                },
              }),
              headers: {
                get: (name: string) => name.toLowerCase() === 'date'
                  ? serverDate
                  : name.toLowerCase() === 'content-type'
                    ? 'application/json'
                    : null,
              },
            } as Response;
          }
          if (url.includes('/accounts/')) {
            const address = url.split('/accounts/')[1]?.split('?')[0];
            return makeBrowserResponse({
              id: address,
              account_id: address,
              sequence: '100',
              subentry_count: 0,
              data_attr: {},
              balances: [{ asset_type: 'native', balance: '100.0000000' }],
            });
          }
          if (url.includes('/transactions') && init?.method === 'POST') {
            return makeBrowserResponse({
              hash: 'b78a3b4c469b284360d131dab7c3c313abf9e606b9705e0e7e9953a360fb1275',
              ledger: 123456,
              successful: true,
            });
          }
          return makeBrowserResponse({ status: 404 }, 404);
        });
        delete (globalThis as any).Buffer;

        const result = await client.sendXlm({
          sourceAccountIndex: 0,
          destination: destAddress,
          amountXlm: '10.0',
          approvedFeeStroops: 100,
        });

        expect(result.status).toBe('SUBMITTED_INGESTED');
        expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
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
            testSubmissionLifecycle,
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
            testSubmissionLifecycle,
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
            testSubmissionLifecycle,
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

      expect(result.status).toBe('SUBMITTED_INGESTED');

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
      expect(testSubmissionLifecycle.resolve).toHaveBeenCalledOnce();
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

      // AxiosHeaders-style forEach
      await fakeServer.httpClient.defaults.adapter({
        method: 'GET',
        url: 'https://horizon-testnet.stellar.org/test',
        headers: { forEach: (callback: (value: string, key: string) => void) => callback('val', 'X-Header-ForEach') },
      });
      expect(sentHeaders['x-header-foreach']).toBe('val');

      // Iterable / array entries
      await fakeServer.httpClient.defaults.adapter({
        method: 'GET',
        url: 'https://horizon-testnet.stellar.org/test',
        headers: [['X-Header-Three', 'val3']],
      });
      expect(sentHeaders['x-header-three']).toBe('val3');

      await expect(
        fakeServer.httpClient.defaults.adapter({
          method: 'GET',
          url: 'https://horizon-testnet.stellar.org/test',
          headers: { forEach: (callback: (value: string, key: unknown) => void) => callback('bad', 1) },
        }),
      ).rejects.toThrow('malformed header name');

      await expect(
        fakeServer.httpClient.defaults.adapter({
          method: 'GET',
          url: 'https://horizon-testnet.stellar.org/test',
          headers: [[1, 'bad']],
        }),
      ).rejects.toThrow('malformed header name');

      await expect(
        fakeServer.httpClient.defaults.adapter({
          method: 'GET',
          url: 'https://horizon-testnet.stellar.org/test',
          headers: { toJSON: () => [] },
        }),
      ).rejects.toThrow('malformed serialized headers');
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
        testSubmissionLifecycle,
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
