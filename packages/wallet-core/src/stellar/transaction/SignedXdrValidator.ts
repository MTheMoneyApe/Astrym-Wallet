import {
  Keypair,
  Transaction,
  TransactionBuilder,
  type FeeBumpTransaction,
} from '@stellar/stellar-sdk';
import {
  StellarXdrValidationError,
  type TrustedStellarTransferReview,
} from './types.js';

export const MAX_STELLAR_FEE_STROOPS = 100_000;

const STROOPS_PER_XLM = 10_000_000n;
const MAX_STELLAR_AMOUNT_STROOPS = 9_223_372_036_854_775_807n;

function decimalToStroops(amount: string): bigint | undefined {
  // Match Stellar's decimal amount precision; extra trailing zeroes are rejected too.
  if (typeof amount !== 'string' || !/^\d+(?:\.\d{1,7})?$/.test(amount)) return undefined;

  const [whole, fraction = ''] = amount.split('.');
  const normalizedWhole = whole!.replace(/^0+(?=\d)/, '');
  if (normalizedWhole.length > 12) return undefined;

  const stroops =
    BigInt(normalizedWhole) * STROOPS_PER_XLM +
    BigInt(fraction.padEnd(7, '0') || '0');
  return stroops <= MAX_STELLAR_AMOUNT_STROOPS ? stroops : undefined;
}

function amountsEqual(a: string, b: string): boolean {
  const stroopsA = decimalToStroops(a);
  const stroopsB = decimalToStroops(b);
  return stroopsA !== undefined && stroopsB !== undefined && stroopsA === stroopsB;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function memoTextEquals(value: unknown, expected: string): boolean {
  if (typeof value === 'string') return value === expected;
  if (!(value instanceof Uint8Array)) return false;
  return bytesEqual(value, new TextEncoder().encode(expected));
}

/**
 * Validates a signed Stellar transaction envelope against an approved immutable
 * review proposal (`TrustedStellarTransferReview`) immediately before network dispatch.
 *
 * Implements checks 1-9 specified in ARCH-03 §4.1 and §4.3:
 * 1. Decode & Verify Envelope Type (rejects malformed XDR and FeeBumpTransaction)
 * 2. Network Passphrase Identity
 * 3. Envelope Source Account
 * 4. Exact Fee Match & Fee Ceiling (enforces MAX_STELLAR_FEE_STROOPS = 100,000)
 * 5. Sequence Number Match
 * 6. Timebounds Verification (rejects unbounded maxTime: 0 and mismatches)
 * 7. Defensive Memo Handling (byte array or string, unexpected memo types)
 * 8. Operation Verification & Override Guard (exactly 1 op, rejects op.source override)
 * 9. Cryptographic Ed25519 Signature Verification over tx.hash() and source account
 */
export class SignedXdrValidator {
  public static assertValid(
    tx: Transaction | string,
    trusted: TrustedStellarTransferReview,
    expectedNetworkPassphrase: string,
    currentTimeSeconds?: number,
  ): void {
    if (!tx) {
      throw new StellarXdrValidationError('Transaction input cannot be null or undefined');
    }

    // 1. Decode & Verify Envelope Type (INV-01 / SDK-03)
    let decoded: Transaction | FeeBumpTransaction;
    try {
      const envelopeBase64 = typeof tx === 'string' ? tx : tx.toEnvelope().toXDR('base64');
      decoded = TransactionBuilder.fromXDR(envelopeBase64, expectedNetworkPassphrase);
    } catch (err: any) {
      if (err instanceof StellarXdrValidationError) {
        throw err;
      }
      throw new StellarXdrValidationError(
        `Failed to decode transaction XDR: ${err?.message ?? String(err)}`,
        err,
      );
    }

    if (!(decoded instanceof Transaction)) {
      throw new StellarXdrValidationError('Fee bump transactions are strictly forbidden');
    }

    // 2. Network Passphrase Identity
    if (typeof tx !== 'string' && tx.networkPassphrase && tx.networkPassphrase !== expectedNetworkPassphrase) {
      throw new StellarXdrValidationError(
        `Network passphrase mismatch: expected "${expectedNetworkPassphrase}", got "${tx.networkPassphrase}"`,
      );
    }
    if (decoded.networkPassphrase !== expectedNetworkPassphrase) {
      throw new StellarXdrValidationError(
        `Network passphrase mismatch in signed XDR: expected "${expectedNetworkPassphrase}", got "${decoded.networkPassphrase}"`,
      );
    }

    // 3. Envelope Source Account
    if (decoded.source !== trusted.sourceAddress) {
      throw new StellarXdrValidationError(
        `Source address mismatch: expected ${trusted.sourceAddress}, got ${decoded.source}`,
      );
    }

    // 4. Exact Fee Match & Fee Ceiling
    const feeStroops = Number(decoded.fee);
    if (!Number.isFinite(feeStroops) || feeStroops < 0) {
      throw new StellarXdrValidationError(`Invalid envelope fee: ${decoded.fee}`);
    }
    if (feeStroops > MAX_STELLAR_FEE_STROOPS) {
      throw new StellarXdrValidationError(
        `Envelope fee (${feeStroops}) exceeds wallet maximum ceiling (${MAX_STELLAR_FEE_STROOPS})`,
      );
    }
    if (feeStroops !== trusted.approvedFeeStroops) {
      throw new StellarXdrValidationError(
        `Fee mismatch: expected ${trusted.approvedFeeStroops}, got ${feeStroops}`,
      );
    }

    // 5. Sequence Number Match (SDK-01)
    if (String(decoded.sequence) !== String(trusted.expectedSequence)) {
      throw new StellarXdrValidationError(
        `Sequence number mismatch: expected ${trusted.expectedSequence}, got ${decoded.sequence}`,
      );
    }

    // 6. Timebounds Verification
    if (!decoded.timeBounds || Number(decoded.timeBounds.maxTime) === 0) {
      throw new StellarXdrValidationError('Unbounded timebounds detected in signed XDR');
    }
    const minTime = Number(decoded.timeBounds.minTime);
    const maxTime = Number(decoded.timeBounds.maxTime);
    if (minTime !== trusted.timebounds.minTime || maxTime !== trusted.timebounds.maxTime) {
      throw new StellarXdrValidationError('Timebounds mismatch in signed XDR');
    }
    if (currentTimeSeconds !== undefined && maxTime < currentTimeSeconds) {
      throw new StellarXdrValidationError(
        `Transaction timebounds have expired: maxTime ${maxTime} is earlier than current time ${currentTimeSeconds}`,
      );
    }

    // 7. Defensive Memo Handling (DEFECT-05)
    const expectedMemo = trusted.memo && trusted.memo !== '' ? trusted.memo : undefined;
    if (expectedMemo === undefined) {
      if (decoded.memo.type !== 'none' || decoded.memo.value !== null) {
        throw new StellarXdrValidationError(
          `Unexpected memo of type "${decoded.memo.type}" found in signed XDR when none was approved`,
        );
      }
    } else {
      if (decoded.memo.type !== 'text') {
        throw new StellarXdrValidationError(
          `Memo type mismatch: expected "text", got "${decoded.memo.type}"`,
        );
      }
      const rawMemo = decoded.memo.value;
      if (!memoTextEquals(rawMemo, expectedMemo)) {
        throw new StellarXdrValidationError(
          `Memo mismatch: expected "${expectedMemo}"`,
        );
      }
    }

    // 8. Operation Verification & Override Guard (DEFECT-04)
    if (!decoded.operations || decoded.operations.length !== 1) {
      throw new StellarXdrValidationError(
        `Expected exactly 1 operation, found ${decoded.operations?.length ?? 0}`,
      );
    }

    const op = decoded.operations[0];
    if (!op) {
      throw new StellarXdrValidationError('Expected exactly 1 operation, found 0');
    }

    // DEFECT-04: Strict check against per-operation source override
    if (op.source !== undefined && op.source !== null) {
      throw new StellarXdrValidationError(
        `Per-operation source override detected: ${op.source}`,
      );
    }

    if (trusted.operationType === 'payment') {
      if (op.type !== 'payment') {
        throw new StellarXdrValidationError(
          `Operation type mismatch: expected payment, got ${op.type}`,
        );
      }
      if (!op.asset.isNative()) {
        throw new StellarXdrValidationError('Non-native asset detected in XLM transfer');
      }
      if (op.destination !== trusted.destinationAddress) {
        throw new StellarXdrValidationError(
          `Destination address mismatch in payment operation: expected ${trusted.destinationAddress}, got ${op.destination}`,
        );
      }
      if (op.amount !== trusted.amountXlm && !amountsEqual(op.amount, trusted.amountXlm)) {
        throw new StellarXdrValidationError(
          `Amount mismatch in payment operation: expected ${trusted.amountXlm}, got ${op.amount}`,
        );
      }
    } else if (trusted.operationType === 'createAccount') {
      if (op.type !== 'createAccount') {
        throw new StellarXdrValidationError(
          `Operation type mismatch: expected createAccount, got ${op.type}`,
        );
      }
      if (op.destination !== trusted.destinationAddress) {
        throw new StellarXdrValidationError(
          `Destination address mismatch in createAccount operation: expected ${trusted.destinationAddress}, got ${op.destination}`,
        );
      }
      if (op.startingBalance !== trusted.amountXlm && !amountsEqual(op.startingBalance, trusted.amountXlm)) {
        throw new StellarXdrValidationError(
          `Starting balance mismatch in createAccount operation: expected ${trusted.amountXlm}, got ${op.startingBalance}`,
        );
      }
    } else {
      throw new StellarXdrValidationError(
        `Unsupported review operation type: ${(trusted as any).operationType}`,
      );
    }

    // 9. Cryptographic Signature Verification (PASS 4 CLARIFICATION 1)
    if (!decoded.signatures || decoded.signatures.length !== 1) {
      throw new StellarXdrValidationError(
        `Expected exactly 1 signature, found ${decoded.signatures?.length ?? 0}`,
      );
    }

    const decoratedSig = decoded.signatures[0];
    if (!decoratedSig) {
      throw new StellarXdrValidationError('Expected exactly 1 signature, found 0');
    }
    let keypair: Keypair;
    try {
      keypair = Keypair.fromPublicKey(trusted.sourceAddress);
    } catch (err: any) {
      throw new StellarXdrValidationError(
        `Invalid source public key for signature verification: ${trusted.sourceAddress}`,
        err,
      );
    }

    const hintBytes: unknown = decoratedSig.hint?.value;
    const expectedHint = keypair.signatureHint();
    if (
      !(hintBytes instanceof Uint8Array) ||
      hintBytes.length !== expectedHint.length ||
      !bytesEqual(hintBytes, expectedHint)
    ) {
      throw new StellarXdrValidationError('Signature hint mismatch for source account');
    }

    const sigBytes: unknown = decoratedSig.signature?.value;
    if (!(sigBytes instanceof Uint8Array) || sigBytes.length !== 64) {
      throw new StellarXdrValidationError(
        'Missing or malformed signature payload in decorated signature',
      );
    }

    let isValidSignature = false;
    try {
      isValidSignature = keypair.verify(decoded.hash(), sigBytes);
    } catch (err: any) {
      throw new StellarXdrValidationError(
        `Cryptographic signature verification failed: ${err?.message ?? String(err)}`,
        err,
      );
    }
    if (!isValidSignature) {
      throw new StellarXdrValidationError(
        'Cryptographic signature verification failed for source account',
      );
    }
  }
}
