import { describe, expect, it } from 'vitest';

import {
  ConfirmStellarTransferResponseSchema,
  SendStellarTransferResponseSchema,
  StellarTransferStatusSchema,
} from '../../src/shared/ipcSchemas.js';
import {
  StellarTransactionError,
  StellarFeeQueryFailedError,
  StellarFeeCeilingExceededError,
  StellarTimeboundsQueryFailedError,
  StellarClockSkewTooLargeError,
  StellarXdrValidationError,
  StellarWriteAheadFailedError,
  StellarSubmissionUnknownError,
  AccountLockedUncertainTransactionError,
  StellarTransactionExpiredError,
  StellarReconciliationFailedError,
  StellarFeeChangedError,
  StellarTransportMissingError,
  SESSION_UNCERTAIN_KEY,
  type MinimalUncertainSubmissionRecord,
  type UncertainTxSessionFlag,
  type TrustedStellarTransferReview,
  type StellarTransactionResult,
} from '../../../wallet-core/src/stellar/transaction/types.js';

describe('Stage 1: Stellar IPC Schemas & Types', () => {
  const VALID_HASH_64 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  describe('ConfirmStellarTransferResponseSchema', () => {
    it.each([
      'SUBMITTED_INGESTED',
      'CONFIRMED',
      'FAILED',
      'UNKNOWN',
      'SUBMISSION_UNKNOWN',
      'INDETERMINATE',
    ] as const)('accepts valid lifecycle status: %s', (status) => {
      const parsed = ConfirmStellarTransferResponseSchema.parse({
        txHash: VALID_HASH_64,
        status,
        ledger: 123456,
      });

      expect(parsed.status).toBe(status);
      expect(parsed.txHash).toBe(VALID_HASH_64);
      expect(parsed.ledger).toBe(123456);
    });

    it('accepts optional error string field', () => {
      const parsed = ConfirmStellarTransferResponseSchema.parse({
        txHash: VALID_HASH_64,
        status: 'FAILED',
        error: 'tx_bad_seq',
      });

      expect(parsed.error).toBe('tx_bad_seq');
    });

    it.each([
      'PENDING',        // PENDING is submission-only, not confirmation
      'SUCCESS',        // Non-standard
      'COMPLETED',
      'confirmed',      // Lowercase rejected
      '',
      12345,
      null,
      undefined,
    ])('rejects invalid or malformed status: %s', (invalidStatus) => {
      expect(() =>
        ConfirmStellarTransferResponseSchema.parse({
          txHash: VALID_HASH_64,
          status: invalidStatus,
        }),
      ).toThrow();
    });

    it('rejects payload missing txHash', () => {
      expect(() =>
        ConfirmStellarTransferResponseSchema.parse({
          status: 'CONFIRMED',
        }),
      ).toThrow();
    });
  });

  describe('SendStellarTransferResponseSchema', () => {
    it.each([
      'PENDING',
      'SUBMITTED_INGESTED',
      'SUBMISSION_UNKNOWN',
    ] as const)('accepts valid submission response status: %s', (status) => {
      const parsed = SendStellarTransferResponseSchema.parse({
        txHash: VALID_HASH_64,
        status,
      });

      expect(parsed.txHash).toBe(VALID_HASH_64);
      expect(parsed.status).toBe(status);
    });

    it('rejects invalid submission statuses (e.g. premature CONFIRMED)', () => {
      expect(() =>
        SendStellarTransferResponseSchema.parse({
          txHash: VALID_HASH_64,
          status: 'CONFIRMED',
        }),
      ).toThrow();
    });

    it('rejects txHash that is not exactly 64 characters', () => {
      expect(() =>
        SendStellarTransferResponseSchema.parse({
          txHash: 'too-short',
          status: 'PENDING',
        }),
      ).toThrow();
    });
  });

  describe('StellarTransferStatusSchema enum validation', () => {
    it('validates all lifecycle enum members', () => {
      expect(StellarTransferStatusSchema.options).toEqual([
        'SUBMITTED_INGESTED',
        'CONFIRMED',
        'FAILED',
        'UNKNOWN',
        'SUBMISSION_UNKNOWN',
        'INDETERMINATE',
      ]);
    });
  });

  describe('Typed Transaction Errors', () => {
    it('all new error classes inherit from StellarTransactionError and Error', () => {
      const errors = [
        new StellarFeeQueryFailedError('fee failed'),
        new StellarFeeCeilingExceededError('fee ceiling exceeded'),
        new StellarTimeboundsQueryFailedError('timebounds failed'),
        new StellarClockSkewTooLargeError('clock skew too large'),
        new StellarXdrValidationError('xdr mismatch'),
        new StellarWriteAheadFailedError('write-ahead failed'),
        new StellarSubmissionUnknownError(VALID_HASH_64),
        new AccountLockedUncertainTransactionError('account locked', VALID_HASH_64),
        new StellarTransactionExpiredError('tx expired', VALID_HASH_64),
        new StellarReconciliationFailedError('reconciliation failed'),
        new StellarFeeChangedError('fee changed'),
        new StellarTransportMissingError(),
      ];

      for (const err of errors) {
        expect(err).toBeInstanceOf(StellarTransactionError);
        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBeTruthy();
        expect(err.message).toBeTruthy();
      }
    });

    it('StellarSubmissionUnknownError captures txHash and preserves cause', () => {
      const cause = new Error('network drop');
      const err = new StellarSubmissionUnknownError(VALID_HASH_64, undefined, cause);

      expect(err.name).toBe('StellarSubmissionUnknownError');
      expect(err.txHash).toBe(VALID_HASH_64);
      expect(err.message).toContain(VALID_HASH_64);
      expect((err as any).cause).toBe(cause);
    });

    it('AccountLockedUncertainTransactionError captures txHash', () => {
      const err = new AccountLockedUncertainTransactionError('locked', VALID_HASH_64);
      expect(err.txHash).toBe(VALID_HASH_64);
    });

    it('StellarTransactionExpiredError captures txHash', () => {
      const err = new StellarTransactionExpiredError('expired', VALID_HASH_64);
      expect(err.txHash).toBe(VALID_HASH_64);
    });
  });

  describe('Data Contracts & Zero Secrets Policy', () => {
    it('SESSION_UNCERTAIN_KEY constant is solanym_uncertain_tx_v1', () => {
      expect(SESSION_UNCERTAIN_KEY).toBe('solanym_uncertain_tx_v1');
    });

    it('UncertainTxSessionFlag strictly contains non-sensitive metadata only', () => {
      const flag: UncertainTxSessionFlag = {
        schemaVersion: 1,
        txHash: VALID_HASH_64,
        accountIndex: 0,
        sourceAddress: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
        destinationAddress: 'GCGNF2T34X56JBNM3ZMQSFQ7Z72VDFTR6J7Z3P76WJ3N7C6XZQ4Q4Q4Q',
        amountXlm: '10.5',
        approvedFeeStroops: 100,
        expectedSequence: '123456789',
        maxTime: 1700000000,
        submittedAt: Date.now(),
        lastProbeAt: Date.now(),
        status: 'SUBMITTING',
      };

      // Verify no secret keys exist on the interface
      const keys = Object.keys(flag);
      expect(keys).not.toContain('privateKey');
      expect(keys).not.toContain('secretKey');
      expect(keys).not.toContain('seed');
      expect(keys).not.toContain('mnemonic');
      expect(keys).not.toContain('signature');
      expect(keys).not.toContain('signedXdr');
      expect(flag.schemaVersion).toBe(1);
    });

    it('MinimalUncertainSubmissionRecord strictly contains non-sensitive recovery metadata', () => {
      const record: MinimalUncertainSubmissionRecord = {
        schemaVersion: 1,
        txHash: VALID_HASH_64,
        sourceAddress: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
        accountIndex: 0,
        sequenceNumber: '123456789',
        destinationAddress: 'GCGNF2T34X56JBNM3ZMQSFQ7Z72VDFTR6J7Z3P76WJ3N7C6XZQ4Q4Q4Q',
        amountXlm: '10.5',
        feeStroops: 100,
        operationType: 'payment',
        timebounds: { minTime: 0, maxTime: 1700000300 },
        submittedAt: Date.now(),
        lastProbeAt: Date.now(),
        probeCount: 1,
        status: 'SUBMISSION_UNKNOWN',
      };

      const keys = Object.keys(record);
      expect(keys).not.toContain('privateKey');
      expect(keys).not.toContain('secretKey');
      expect(keys).not.toContain('seed');
      expect(keys).not.toContain('mnemonic');
      expect(keys).not.toContain('signature');
      expect(keys).not.toContain('signedXdr');
      expect(record.schemaVersion).toBe(1);
    });

    it('TrustedStellarTransferReview contract shape', () => {
      const review: TrustedStellarTransferReview = {
        sourceAddress: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
        destinationAddress: 'GCGNF2T34X56JBNM3ZMQSFQ7Z72VDFTR6J7Z3P76WJ3N7C6XZQ4Q4Q4Q',
        amountXlm: '5.0',
        approvedFeeStroops: 100,
        memo: 'test memo',
        operationType: 'payment',
        timebounds: { minTime: 0, maxTime: 1700000300 },
        expectedSequence: '123456790',
      };

      expect(review.amountXlm).toBe('5.0');
      expect(review.approvedFeeStroops).toBe(100);
    });

    it('StellarTransactionResult allows new lifecycle statuses', () => {
      const ingestedResult: StellarTransactionResult = {
        hash: VALID_HASH_64,
        status: 'SUBMITTED_INGESTED',
        ledger: 1000,
      };
      const unknownResult: StellarTransactionResult = {
        hash: VALID_HASH_64,
        status: 'SUBMISSION_UNKNOWN',
      };

      expect(ingestedResult.status).toBe('SUBMITTED_INGESTED');
      expect(unknownResult.status).toBe('SUBMISSION_UNKNOWN');
    });
  });
});
