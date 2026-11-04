import { describe, expect, it } from 'vitest';
import {
  Account,
  Asset,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import {
  SignedXdrValidator,
  MAX_STELLAR_FEE_STROOPS,
} from '../../src/stellar/transaction/SignedXdrValidator.js';
import {
  StellarXdrValidationError,
  type TrustedStellarTransferReview,
} from '../../src/stellar/transaction/types.js';

describe('SignedXdrValidator', () => {
  // Deterministic Ed25519 test keypairs (never production secrets)
  const sourceKp = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));
  const destKp = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2));
  const otherKp = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3));

  const DEFAULT_SEQUENCE = '100';
  const DEFAULT_EXPECTED_SEQ = '101';
  const DEFAULT_FEE_STROOPS = 100;
  const DEFAULT_MIN_TIME = 1700000000;
  const DEFAULT_MAX_TIME = 1700000300;
  const DEFAULT_AMOUNT_XLM = '10.5';

  function buildValidReview(
    overrides?: Partial<TrustedStellarTransferReview>,
  ): TrustedStellarTransferReview {
    return {
      sourceAddress: sourceKp.publicKey(),
      destinationAddress: destKp.publicKey(),
      amountXlm: DEFAULT_AMOUNT_XLM,
      approvedFeeStroops: DEFAULT_FEE_STROOPS,
      memo: 'test memo',
      operationType: 'payment',
      timebounds: {
        minTime: DEFAULT_MIN_TIME,
        maxTime: DEFAULT_MAX_TIME,
      },
      expectedSequence: DEFAULT_EXPECTED_SEQ,
      ...overrides,
    };
  }

  function buildPaymentTx(opts?: {
    source?: Keypair;
    destination?: string;
    amount?: string;
    fee?: number;
    sequence?: string;
    memo?: Memo;
    timebounds?: { minTime: number | string; maxTime: number | string };
    asset?: Asset;
    opSource?: string;
    networkPassphrase?: string;
    signer?: Keypair;
    omitSign?: boolean;
    extraSigner?: Keypair;
    extraOperation?: boolean;
    noOperations?: boolean;
  }) {
    const s = opts?.source ?? sourceKp;
    const seq = opts?.sequence ?? DEFAULT_SEQUENCE;
    const account = new Account(s.publicKey(), seq);
    const networkPassphrase = opts?.networkPassphrase ?? Networks.TESTNET;

    const builder = new TransactionBuilder(account, {
      fee: String(opts?.fee ?? DEFAULT_FEE_STROOPS),
      networkPassphrase,
    });

    if (opts?.timebounds) {
      builder.setTimeout(0); // Clear any default
      (builder as any).timeBounds = {
        minTime: String(opts.timebounds.minTime),
        maxTime: String(opts.timebounds.maxTime),
      };
    } else {
      (builder as any).timeBounds = {
        minTime: String(DEFAULT_MIN_TIME),
        maxTime: String(DEFAULT_MAX_TIME),
      };
    }

    if (opts?.memo) {
      builder.addMemo(opts.memo);
    }

    if (!opts?.noOperations) {
      const opConfig: any = {
        destination: opts?.destination ?? destKp.publicKey(),
        asset: opts?.asset ?? Asset.native(),
        amount: opts?.amount ?? DEFAULT_AMOUNT_XLM,
      };
      if (opts?.opSource) {
        opConfig.source = opts.opSource;
      }
      builder.addOperation(Operation.payment(opConfig));

      if (opts?.extraOperation) {
        builder.addOperation(
          Operation.payment({
            destination: destKp.publicKey(),
            asset: Asset.native(),
            amount: '1.0',
          }),
        );
      }
    }

    const tx = builder.build();

    if (!opts?.omitSign) {
      const signer = opts?.signer ?? s;
      tx.sign(signer);
    }
    if (opts?.extraSigner) {
      tx.sign(opts.extraSigner);
    }

    return tx;
  }

  function buildCreateAccountTx(opts?: {
    source?: Keypair;
    destination?: string;
    startingBalance?: string;
    fee?: number;
    sequence?: string;
    memo?: Memo;
    timebounds?: { minTime: number | string; maxTime: number | string };
    opSource?: string;
    networkPassphrase?: string;
    signer?: Keypair;
  }) {
    const s = opts?.source ?? sourceKp;
    const account = new Account(s.publicKey(), opts?.sequence ?? DEFAULT_SEQUENCE);
    const networkPassphrase = opts?.networkPassphrase ?? Networks.TESTNET;

    const builder = new TransactionBuilder(account, {
      fee: String(opts?.fee ?? DEFAULT_FEE_STROOPS),
      networkPassphrase,
    });

    (builder as any).timeBounds = {
      minTime: String(opts?.timebounds?.minTime ?? DEFAULT_MIN_TIME),
      maxTime: String(opts?.timebounds?.maxTime ?? DEFAULT_MAX_TIME),
    };

    if (opts?.memo) {
      builder.addMemo(opts.memo);
    }

    const opConfig: any = {
      destination: opts?.destination ?? destKp.publicKey(),
      startingBalance: opts?.startingBalance ?? DEFAULT_AMOUNT_XLM,
    };
    if (opts?.opSource) {
      opConfig.source = opts.opSource;
    }
    builder.addOperation(Operation.createAccount(opConfig));

    const tx = builder.build();
    tx.sign(opts?.signer ?? s);
    return tx;
  }

  // -------------------------------------------------------------------------
  // 1. Valid approved signed transaction
  // -------------------------------------------------------------------------
  describe('1. Valid approved transactions', () => {
    it('accepts valid approved payment transaction with text memo', () => {
      const review = buildValidReview({ memo: 'donation' });
      const tx = buildPaymentTx({ memo: Memo.text('donation') });

      expect(() => {
        SignedXdrValidator.assertValid(tx, review, Networks.TESTNET);
      }).not.toThrow();
    });

    it('accepts valid approved payment without memo', () => {
      const review = buildValidReview({ memo: undefined });
      const tx = buildPaymentTx({ memo: undefined });

      expect(() => {
        SignedXdrValidator.assertValid(tx, review, Networks.TESTNET);
      }).not.toThrow();
    });

    it('accepts valid transaction when passed as base64 envelope string', () => {
      const review = buildValidReview({ memo: 'base64 test' });
      const tx = buildPaymentTx({ memo: Memo.text('base64 test') });
      const base64 = tx.toEnvelope().toXDR('base64');

      expect(() => {
        SignedXdrValidator.assertValid(base64, review, Networks.TESTNET);
      }).not.toThrow();
    });

    it('accepts valid createAccount transaction', () => {
      const review = buildValidReview({
        operationType: 'createAccount',
        memo: undefined,
      });
      const tx = buildCreateAccountTx({ memo: undefined });

      expect(() => {
        SignedXdrValidator.assertValid(tx, review, Networks.TESTNET);
      }).not.toThrow();
    });

    it('handles numeric decimal formatting normalization between review and SDK', () => {
      // Review may have '10.5' while SDK fromXDR normalizes to '10.5000000'
      const review = buildValidReview({ amountXlm: '10.5' });
      const tx = buildPaymentTx({ amount: '10.5000000', memo: Memo.text('test memo') });

      expect(() => {
        SignedXdrValidator.assertValid(tx, review, Networks.TESTNET);
      }).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // 2. Malformed or undecodable XDR
  // -------------------------------------------------------------------------
  describe('2. Malformed or undecodable XDR', () => {
    it('rejects invalid base64 string', () => {
      const review = buildValidReview();
      expect(() => {
        SignedXdrValidator.assertValid('not-valid-base64!!!', review, Networks.TESTNET);
      }).toThrow(StellarXdrValidationError);
    });

    it('rejects truncated XDR bytes', () => {
      const review = buildValidReview();
      expect(() => {
        SignedXdrValidator.assertValid('AAAAAA==', review, Networks.TESTNET);
      }).toThrow(StellarXdrValidationError);
    });

    it('rejects null or empty transaction input', () => {
      const review = buildValidReview();
      expect(() => {
        SignedXdrValidator.assertValid('' as any, review, Networks.TESTNET);
      }).toThrow(StellarXdrValidationError);
      expect(() => {
        SignedXdrValidator.assertValid(null as any, review, Networks.TESTNET);
      }).toThrow(StellarXdrValidationError);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Wrong network / passphrase
  // -------------------------------------------------------------------------
  describe('3. Wrong network/passphrase', () => {
    it('rejects transaction signed for PUBLIC network when TESTNET is expected', () => {
      const review = buildValidReview({ memo: 'network' });
      const tx = buildPaymentTx({
        memo: Memo.text('network'),
        networkPassphrase: Networks.PUBLIC,
      });

      expect(() => {
        SignedXdrValidator.assertValid(tx, review, Networks.TESTNET);
      }).toThrow(StellarXdrValidationError);
    });

    it('rejects envelope base64 decoded with wrong network passphrase', () => {
      const review = buildValidReview({ memo: 'network' });
      const tx = buildPaymentTx({
        memo: Memo.text('network'),
        networkPassphrase: Networks.PUBLIC,
      });
      const base64 = tx.toEnvelope().toXDR('base64');

      // Decoding a public-net envelope against testnet fails signature verification
      expect(() => {
        SignedXdrValidator.assertValid(base64, review, Networks.TESTNET);
      }).toThrow(StellarXdrValidationError);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Wrong source
  // -------------------------------------------------------------------------
  describe('4. Wrong source', () => {
    it('rejects transaction when envelope source does not match review sourceAddress', () => {
      const review = buildValidReview({ sourceAddress: otherKp.publicKey() });
      const tx = buildPaymentTx({ source: sourceKp, memo: Memo.text('test memo') });

      expect(() => {
        SignedXdrValidator.assertValid(tx, review, Networks.TESTNET);
      }).toThrow(StellarXdrValidationError);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Wrong destination
  // -------------------------------------------------------------------------
  describe('5. Wrong destination', () => {
    it('rejects payment with mismatched destination address', () => {
      const review = buildValidReview({ destinationAddress: otherKp.publicKey() });
      const tx = buildPaymentTx({ destination: destKp.publicKey(), memo: Memo.text('test memo') });

      expect(() => {
        SignedXdrValidator.assertValid(tx, review, Networks.TESTNET);
      }).toThrow(StellarXdrValidationError);
    });

    it('rejects createAccount with mismatched destination address', () => {
      const review = buildValidReview({
        operationType: 'createAccount',
        destinationAddress: otherKp.publicKey(),
        memo: undefined,
      });
      const tx = buildCreateAccountTx({ destination: destKp.publicKey(), memo: undefined });

      expect(() => {
        SignedXdrValidator.assertValid(tx, review, Networks.TESTNET);
      }).toThrow(StellarXdrValidationError);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Wrong asset
  // -------------------------------------------------------------------------
  describe('6. Wrong asset', () => {
    it('rejects non-native asset payment', () => {
      const review = buildValidReview({ memo: 'asset' });
      const customAsset = new Asset('USD', otherKp.publicKey());
      const tx = buildPaymentTx({ asset: customAsset, memo: Memo.text('asset') });

      expect(() => {
        SignedXdrValidator.assertValid(tx, review, Networks.TESTNET);
      }).toThrow(/Non-native asset/);
    });
  });

  // -------------------------------------------------------------------------
  // 7. Wrong amount
  // -------------------------------------------------------------------------
  describe('7. Wrong amount', () => {
    it('rejects payment when amount differs from approved review', () => {
      const review = buildValidReview({ amountXlm: '10.5' });
      const tx = buildPaymentTx({ amount: '10.6', memo: Memo.text('test memo') });

      expect(() => {
        SignedXdrValidator.assertValid(tx, review, Networks.TESTNET);
      }).toThrow(/Amount mismatch/);
    });

    it('rejects createAccount when startingBalance differs from approved review', () => {
      const review = buildValidReview({
        operationType: 'createAccount',
        amountXlm: '10.5',
        memo: undefined,
      });
      const tx = buildCreateAccountTx({ startingBalance: '10.0', memo: undefined });

      expect(() => {
        SignedXdrValidator.assertValid(tx, review, Networks.TESTNET);
      }).toThrow(/Starting balance mismatch/);
    });
  });

  // -------------------------------------------------------------------------
  // 8. Wrong fee
  // -------------------------------------------------------------------------
  describe('8. Wrong fee', () => {
    it('rejects transaction when fee differs from approvedFeeStroops', () => {
      const review = buildValidReview({ approvedFeeStroops: 100 });
      const tx = buildPaymentTx({ fee: 200, memo: Memo.text('test memo') });

      expect(() => {
        SignedXdrValidator.assertValid(tx, review, Networks.TESTNET);
      }).toThrow(/Fee mismatch/);
    });

    it('rejects envelope fee exceeding MAX_STELLAR_FEE_STROOPS ceiling', () => {
      const excessFee = MAX_STELLAR_FEE_STROOPS + 1;
      const review = buildValidReview({ approvedFeeStroops: excessFee });
      const tx = buildPaymentTx({ fee: excessFee, memo: Memo.text('test memo') });

      expect(() => {
        SignedXdrValidator.assertValid(tx, review, Networks.TESTNET);
      }).toThrow(/exceeds wallet maximum ceiling/);
    });
  });

  // -------------------------------------------------------------------------
  // 9. Wrong sequence
  // -------------------------------------------------------------------------
  describe('9. Wrong sequence', () => {
    it('rejects transaction when sequence does not match expectedSequence', () => {
      const review = buildValidReview({ expectedSequence: '999' });
      const tx = buildPaymentTx({ sequence: '100', memo: Memo.text('test memo') });

      expect(() => {
        SignedXdrValidator.assertValid(tx, review, Networks.TESTNET);
      }).toThrow(/Sequence number mismatch/);
    });
  });

  // -------------------------------------------------------------------------
  // 10. Wrong or unexpected memo
  // -------------------------------------------------------------------------
  describe('10. Wrong or unexpected memo', () => {
    it('rejects transaction with unexpected memo when none was approved', () => {
      const review = buildValidReview({ memo: undefined });
      const tx = buildPaymentTx({ memo: Memo.text('unapproved') });

      expect(() => {
        SignedXdrValidator.assertValid(tx, review, Networks.TESTNET);
      }).toThrow(/Unexpected memo/);
    });

    it('rejects transaction when memo text does not match approved memo', () => {
      const review = buildValidReview({ memo: 'original' });
      const tx = buildPaymentTx({ memo: Memo.text('tampered') });

      expect(() => {
        SignedXdrValidator.assertValid(tx, review, Networks.TESTNET);
      }).toThrow(/Memo mismatch/);
    });

    it('rejects unsupported memo types like Memo.id', () => {
      const review = buildValidReview({ memo: undefined });
      const tx = buildPaymentTx({ memo: Memo.id('12345678') });

      expect(() => {
        SignedXdrValidator.assertValid(tx, review, Networks.TESTNET);
      }).toThrow(/Unexpected memo of type "id"/);
    });

    it('supports memo text stored as Buffer in XDR', () => {
      const review = buildValidReview({ memo: 'utf8-memo' });
      const tx = buildPaymentTx({ memo: Memo.text('utf8-memo') });

      // Emulate Buffer in rawMemo
      const envelopeBase64 = tx.toEnvelope().toXDR('base64');
      expect(() => {
        SignedXdrValidator.assertValid(envelopeBase64, review, Networks.TESTNET);
      }).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // 11. Expired or mismatched timebounds
  // -------------------------------------------------------------------------
  describe('11. Expired or mismatched timebounds', () => {
    it('rejects unbounded timebounds (maxTime = 0)', () => {
      const review = buildValidReview();
      const tx = buildPaymentTx({
        timebounds: { minTime: 0, maxTime: 0 },
        memo: Memo.text('test memo'),
      });

      expect(() => {
        SignedXdrValidator.assertValid(tx, review, Networks.TESTNET);
      }).toThrow(/Unbounded timebounds/);
    });

    it('rejects minTime mismatch', () => {
      const review = buildValidReview({
        timebounds: { minTime: 100, maxTime: DEFAULT_MAX_TIME },
      });
      const tx = buildPaymentTx({
        timebounds: { minTime: 200, maxTime: DEFAULT_MAX_TIME },
        memo: Memo.text('test memo'),
      });

      expect(() => {
        SignedXdrValidator.assertValid(tx, review, Networks.TESTNET);
      }).toThrow(/Timebounds mismatch/);
    });

    it('rejects maxTime mismatch', () => {
      const review = buildValidReview({
        timebounds: { minTime: DEFAULT_MIN_TIME, maxTime: 500 },
      });
      const tx = buildPaymentTx({
        timebounds: { minTime: DEFAULT_MIN_TIME, maxTime: 600 },
        memo: Memo.text('test memo'),
      });

      expect(() => {
        SignedXdrValidator.assertValid(tx, review, Networks.TESTNET);
      }).toThrow(/Timebounds mismatch/);
    });

    it('rejects expired timebounds when currentTimeSeconds > maxTime', () => {
      const review = buildValidReview({
        timebounds: { minTime: 1000, maxTime: 2000 },
      });
      const tx = buildPaymentTx({
        timebounds: { minTime: 1000, maxTime: 2000 },
        memo: Memo.text('test memo'),
      });

      expect(() => {
        SignedXdrValidator.assertValid(tx, review, Networks.TESTNET, 2001);
      }).toThrow(/expired/);
    });
  });

  // -------------------------------------------------------------------------
  // 12. Zero operations
  // -------------------------------------------------------------------------
  describe('12. Zero operations', () => {
    it('rejects transaction envelope with 0 operations', () => {
      const review = buildValidReview();
      const tx = buildPaymentTx({ noOperations: true, memo: Memo.text('test memo') });

      expect(() => {
        SignedXdrValidator.assertValid(tx, review, Networks.TESTNET);
      }).toThrow(/Expected exactly 1 operation, found 0/);
    });
  });

  // -------------------------------------------------------------------------
  // 13. Multiple operations
  // -------------------------------------------------------------------------
  describe('13. Multiple operations', () => {
    it('rejects transaction envelope with more than 1 operation', () => {
      const review = buildValidReview();
      const tx = buildPaymentTx({ extraOperation: true, memo: Memo.text('test memo') });

      expect(() => {
        SignedXdrValidator.assertValid(tx, review, Networks.TESTNET);
      }).toThrow(/Expected exactly 1 operation, found 2/);
    });
  });

  // -------------------------------------------------------------------------
  // 14. Unsupported operation types
  // -------------------------------------------------------------------------
  describe('14. Unsupported operation types', () => {
    it('rejects review type mismatch (review says createAccount, envelope is payment)', () => {
      const review = buildValidReview({
        operationType: 'createAccount',
        memo: 'mismatch',
      });
      const tx = buildPaymentTx({ memo: Memo.text('mismatch') });

      expect(() => {
        SignedXdrValidator.assertValid(tx, review, Networks.TESTNET);
      }).toThrow(/Operation type mismatch: expected createAccount, got payment/);
    });

    it('rejects review type mismatch (review says payment, envelope is createAccount)', () => {
      const review = buildValidReview({
        operationType: 'payment',
        memo: undefined,
      });
      const tx = buildCreateAccountTx({ memo: undefined });

      expect(() => {
        SignedXdrValidator.assertValid(tx, review, Networks.TESTNET);
      }).toThrow(/Operation type mismatch: expected payment, got createAccount/);
    });
  });

  // -------------------------------------------------------------------------
  // 15. Missing signature
  // -------------------------------------------------------------------------
  describe('15. Missing signature', () => {
    it('rejects transaction with 0 signatures', () => {
      const review = buildValidReview();
      const tx = buildPaymentTx({ omitSign: true, memo: Memo.text('test memo') });

      expect(() => {
        SignedXdrValidator.assertValid(tx, review, Networks.TESTNET);
      }).toThrow(/Expected exactly 1 signature, found 0/);
    });
  });

  // -------------------------------------------------------------------------
  // 16. Invalid cryptographic signature
  // -------------------------------------------------------------------------
  describe('16. Invalid cryptographic signature', () => {
    it('rejects transaction when signature bytes are corrupted', () => {
      const review = buildValidReview();
      const tx = buildPaymentTx({ memo: Memo.text('test memo') });

      // Corrupt signature bytes
      const sig = tx.signatures[0];
      const rawSig = (sig as any).signature?.value ?? (sig as any).signature;
      rawSig[0] ^= 0xff; // Invert first byte

      expect(() => {
        SignedXdrValidator.assertValid(tx, review, Networks.TESTNET);
      }).toThrow(/Cryptographic signature verification failed/);
    });
  });

  // -------------------------------------------------------------------------
  // 17. Unexpected signer or signature count
  // -------------------------------------------------------------------------
  describe('17. Unexpected signer or signature count', () => {
    it('rejects transaction signed by a keypair different from review sourceAddress', () => {
      const review = buildValidReview(); // Expects sourceKp
      const tx = buildPaymentTx({ signer: otherKp, memo: Memo.text('test memo') }); // Signed by otherKp

      expect(() => {
        SignedXdrValidator.assertValid(tx, review, Networks.TESTNET);
      }).toThrow(/Signature hint mismatch/);
    });

    it('rejects transaction with 2 signatures (violates Single-Signer MVP)', () => {
      const review = buildValidReview();
      const tx = buildPaymentTx({ extraSigner: otherKp, memo: Memo.text('test memo') });

      expect(() => {
        SignedXdrValidator.assertValid(tx, review, Networks.TESTNET);
      }).toThrow(/Expected exactly 1 signature, found 2/);
    });
  });

  // -------------------------------------------------------------------------
  // 18. Additional edge cases required by ARCH-03
  // -------------------------------------------------------------------------
  describe('18. Additional ARCH-03 edge cases', () => {
    it('T-24: strictly rejects per-operation source account override', () => {
      const review = buildValidReview();
      const tx = buildPaymentTx({
        opSource: otherKp.publicKey(),
        memo: Memo.text('test memo'),
      });

      expect(() => {
        SignedXdrValidator.assertValid(tx, review, Networks.TESTNET);
      }).toThrow(/Per-operation source override detected/);
    });

    it('rejects invalid or negative fee', () => {
      const review = buildValidReview({ approvedFeeStroops: -1 });
      const tx = buildPaymentTx({ fee: -1, memo: Memo.text('test memo') });

      expect(() => {
        SignedXdrValidator.assertValid(tx, review, Networks.TESTNET);
      }).toThrow(/Invalid envelope fee/);
    });

    it('rejects invalid source public key on review', () => {
      const review = buildValidReview({ sourceAddress: 'not-a-valid-stellar-key' });
      const tx = buildPaymentTx({ memo: Memo.text('test memo') });

      expect(() => {
        SignedXdrValidator.assertValid(tx, review, Networks.TESTNET);
      }).toThrow(/Invalid source public key/);
    });
  });
});
