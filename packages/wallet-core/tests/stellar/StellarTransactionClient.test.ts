import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import {
  StellarTransactionClient,
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
} from '../../src/stellar/transaction/types.js';

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

  let mockServer: any;
  let client: StellarTransactionClient;

  beforeEach(() => {
    vi.clearAllMocks();

    mockServer = {
      loadAccount: vi.fn(),
      fetchBaseFee: vi.fn().mockResolvedValue(100),
      fetchTimebounds: vi.fn().mockResolvedValue({ minTime: 0, maxTime: 0 }),
      submitTransaction: vi.fn(),
      transactions: vi.fn().mockReturnValue({
        transaction: vi.fn().mockReturnValue({
          call: vi.fn(),
        }),
      }),
    };

    client = new StellarTransactionClient(
      'https://horizon-testnet.stellar.org',
      mockKeyManager,
      mockSigner,
      'Test SDF Network ; September 2015',
      mockServer,
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
      expect(() => client.validateAmount('1.12345678')).toThrow(InvalidStellarAmountError); // > 7 decimals
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
      mockServer.loadAccount.mockImplementation((addr: string) => {
        if (addr === sourceAddress) {
          return Promise.resolve({
            id: sourceAddress,
            sequence: '100',
            subentry_count: 0,
            balances: [{ asset_type: 'native', balance: '100.0000000' }],
          });
        }
        if (addr === destAddress) {
          return Promise.resolve({
            id: destAddress,
            sequence: '50',
            subentry_count: 0,
            balances: [{ asset_type: 'native', balance: '20.0000000' }],
          });
        }
        return Promise.reject({ response: { status: 404 } });
      });

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
      mockServer.loadAccount.mockImplementation((addr: string) => {
        if (addr === sourceAddress) {
          return Promise.resolve({
            id: sourceAddress,
            sequence: '100',
            subentry_count: 0,
            balances: [{ asset_type: 'native', balance: '100.0000000' }],
          });
        }
        return Promise.reject({ response: { status: 404 }, name: 'NotFoundError' });
      });

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
      mockServer.loadAccount.mockRejectedValue({ response: { status: 404 }, name: 'NotFoundError' });

      await expect(
        client.reviewXlmTransfer({
          sourceAccountIndex: 0,
          destination: destAddress,
          amountXlm: '10',
        }),
      ).rejects.toThrow(StellarAccountNotFundedError);
    });

    it('throws InsufficientXlmBalanceError if transfer exceeds available balance reserve', async () => {
      mockServer.loadAccount.mockImplementation((addr: string) => {
        if (addr === sourceAddress) {
          return Promise.resolve({
            id: sourceAddress,
            sequence: '100',
            subentry_count: 2, // reserve = (2 + 2) * 0.5 = 2.0 XLM
            balances: [{ asset_type: 'native', balance: '10.0000000' }], // available = 8.0 XLM
          });
        }
        return Promise.resolve({ id: destAddress, balances: [] });
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
      mockServer.fetchBaseFee.mockResolvedValue(100);
      mockServer.loadAccount.mockImplementation((addr: string) => {
        if (addr === sourceAddress) {
          return Promise.resolve({
            id: sourceAddress,
            sequence: '100',
            subentry_count: 0, // reserve 1.0 → available 2.0 from balance 3.0
            balances: [{ asset_type: 'native', balance: '3.0000000' }],
          });
        }
        return Promise.resolve({ id: destAddress, balances: [] });
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
    const fundedSourceAccount = () => ({
      id: sourceAddress,
      sequence: '12345',
      subentry_count: 0,
      balances: [{ asset_type: 'native', balance: '100.0000000' }],
      accountId: () => sourceAddress,
      sequenceNumber: () => '12345',
      incrementSequenceNumber: () => {},
    });

    it('builds, signs through signer, and submits transaction to Horizon', async () => {
      mockServer.loadAccount.mockResolvedValue(fundedSourceAccount());
      mockServer.submitTransaction.mockResolvedValue({
        hash: 'b78a3b4c469b284360d131dab7c3c313abf9e606b9705e0e7e9953a360fb1275',
        ledger: 123456,
      });

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
      expect(mockServer.submitTransaction).toHaveBeenCalledOnce();
      expect(result.status).toBe('confirmed');
      expect(result.hash).toBe(
        'b78a3b4c469b284360d131dab7c3c313abf9e606b9705e0e7e9953a360fb1275',
      );
      expect(result.ledger).toBe(123456);
    });

    it('F1: builds TX with approvedFeeStroops even when live base fee is lower', async () => {
      mockServer.loadAccount.mockResolvedValue(fundedSourceAccount());
      // Live fee dropped after REVIEW; SEND must still attach the approved fee.
      mockServer.fetchBaseFee.mockResolvedValue(50);
      mockServer.submitTransaction.mockResolvedValue({
        hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        ledger: 1,
      });

      await client.sendXlm({
        sourceAccountIndex: 0,
        destination: destAddress,
        amountXlm: '1.0',
        approvedFeeStroops: 200,
      });

      const submittedTx = mockServer.submitTransaction.mock.calls[0][0];
      expect(String(submittedTx.fee)).toBe('200');
      expect(mockSigner.signTransaction).toHaveBeenCalledOnce();
    });

    it('F2: aborts before sign/submit when network fee exceeds approvedFeeStroops', async () => {
      mockServer.loadAccount.mockResolvedValue(fundedSourceAccount());
      mockServer.fetchBaseFee.mockResolvedValue(500);

      await expect(
        client.sendXlm({
          sourceAccountIndex: 0,
          destination: destAddress,
          amountXlm: '1.0',
          approvedFeeStroops: 100,
        }),
      ).rejects.toThrow(StellarFeeChangedError);

      expect(mockSigner.signTransaction).not.toHaveBeenCalled();
      expect(mockServer.submitTransaction).not.toHaveBeenCalled();
    });

    it('formats Horizon error codes cleanly when submission fails', async () => {
      mockServer.loadAccount.mockResolvedValue(fundedSourceAccount());
      mockServer.submitTransaction.mockRejectedValue({
        message: 'Transaction Failed',
        response: {
          data: {
            detail: 'The transaction failed when submitted to the stellar network.',
            extras: {
              result_codes: {
                transaction: 'tx_failed',
                operations: ['op_underfunded'],
              },
            },
          },
        },
      });

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
      mockServer.transactions().transaction().call.mockResolvedValue({
        successful: true,
        ledger_attr: 98765,
      });

      const res = await client.confirmTransaction('some-hash');
      expect(res.status).toBe('confirmed');
      expect(res.ledger).toBe(98765);
    });

    it('returns failed status when Horizon reports successful: false', async () => {
      mockServer.transactions().transaction().call.mockResolvedValue({
        successful: false,
        ledger_attr: 4242,
      });

      const res = await client.confirmTransaction('failed-hash');
      expect(res.status).toBe('failed');
      expect(res.ledger).toBe(4242);
      expect(res.status).not.toBe('confirmed');
      expect(res.status).not.toBe('unknown');
    });

    it('returns unknown status on 404 pending confirmation', async () => {
      mockServer.transactions().transaction().call.mockRejectedValue({
        response: { status: 404 },
        name: 'NotFoundError',
      });

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
        const expected = Buffer.from(bytes).toString('base64');
        expect(uint8ArrayToBase64(bytes)).toBe(expected);
      }
    });

    it('sendXlm signs and submits successfully when globalThis.Buffer is undefined', async () => {
      const sourceAccountObj = {
        id: sourceAddress,
        sequence: '12345',
        subentry_count: 0,
        balances: [{ asset_type: 'native', balance: '100.0000000' }],
        accountId: () => sourceAddress,
        sequenceNumber: () => '12345',
        incrementSequenceNumber: () => {},
      };

      mockServer.loadAccount.mockResolvedValue(sourceAccountObj);
      mockServer.fetchBaseFee.mockResolvedValue(100);
      mockServer.fetchTimebounds.mockResolvedValue({ minTime: 0, maxTime: 0 });
      mockServer.submitTransaction.mockResolvedValue({
        hash: 'b78a3b4c469b284360d131dab7c3c313abf9e606b9705e0e7e9953a360fb1275',
        ledger: 123456,
      });

      // Simulate browser extension environment where Buffer is undefined
      const originalBuffer = globalThis.Buffer;
      try {
        // @ts-expect-error simulating browser environment
        delete globalThis.Buffer;

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
        globalThis.Buffer = originalBuffer;
      }
    });
  });
});
