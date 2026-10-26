/**
 * Adapter: SOLANYM SoftwareSigner (vault HD) → stellar-private-payments WalletSigner.
 *
 * Message format: SEP-0053 (prefix + SHA-256), matching Freighter / SPP expectations.
 * Transaction: parse XDR, enforce bound network + source, sign tx.hash(), return signed XDR.
 * Auth entry: allowlisted HashIdPreimage variants only; sign sha256(preimage.toXDR()).
 *
 * Cryptographic layer limits (not enforced here — UI/extension must review before approve):
 *   - Transaction ops, amounts, memo, destinations are NOT semantically inspected.
 *   - Soroban invocation trees (contract, function, args, sub-invocations) are NOT inspected.
 *   - Payload binding via SignatureAuthorizationGate proves the digest was authorized, not that
 *     a human reviewed the meaning of that digest.
 *
 * StateCoordinator.authorizeSignature() is lifecycle-only (no payload binding). Extension
 * integration must approve the exact SignatureAuthContext before authorize() under
 * require-prior-approval mode.
 *
 * Does not call Horizon/RPC. Secrets never logged.
 */

import { ed25519 } from '@noble/curves/ed25519.js';
import {
  Address,
  FeeBumpTransaction,
  hash,
  Networks,
  StrKey,
  Transaction,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import type {
  SignAuthEntryResult,
  SignMessageResult,
  SignOptions,
  SignTransactionResult,
  WalletSigner,
} from 'stellar-private-payments';
import type { SoftwareSigner } from '../../signer/SoftwareSigner.js';
import { uint8ArrayToBase64 } from '../transaction/StellarTransactionClient.js';
import { hashSep53Message } from './sep53.js';
import {
  digestToHex,
  type SignatureAuthContext,
  type SignatureAuthorizationGate,
  type SignatureKind,
  type SignatureLease,
} from './signatureGate.js';

/** HashIdPreimage variants accepted for signAuthEntry (stellar-sdk / Freighter Soroban auth). */
const ALLOWED_AUTH_PREIMAGE_TYPES = new Set([
  'envelopeTypeSorobanAuthorization',
  'envelopeTypeSorobanAuthorizationWithAddress',
]);

export type SppWalletSignerAdapterOptions = {
  signer: SoftwareSigner;
  accountIndex: number;
  /** G… StrKey for the bound HD account (must match signer.getPublicKey(accountIndex)). */
  stellarAddress: string;
  /**
   * Fixed network passphrase for this adapter instance.
   * Defaults to Testnet. Callers cannot switch networks via SignOptions.
   */
  networkPassphrase?: string;
  authorizationGate: SignatureAuthorizationGate;
};

export class SppSignerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SppSignerError';
  }
}

export class SppWalletSignerAdapter implements WalletSigner {
  private readonly _signer: SoftwareSigner;
  private readonly _accountIndex: number;
  private readonly _stellarAddress: string;
  private readonly _networkPassphrase: string;
  private readonly _gate: SignatureAuthorizationGate;

  constructor(options: SppWalletSignerAdapterOptions) {
    if (options.signer.chain !== 'stellar') {
      throw new SppSignerError('SppWalletSignerAdapter requires SoftwareSigner with chain "stellar"');
    }
    if (!StrKey.isValidEd25519PublicKey(options.stellarAddress)) {
      throw new SppSignerError('stellarAddress must be a valid Ed25519 G… StrKey');
    }
    if (!Number.isInteger(options.accountIndex) || options.accountIndex < 0) {
      throw new SppSignerError('accountIndex must be a non-negative integer');
    }
    const network = options.networkPassphrase ?? Networks.TESTNET;
    if (network !== Networks.TESTNET && network !== Networks.PUBLIC) {
      throw new SppSignerError('Unsupported network passphrase');
    }
    this._signer = options.signer;
    this._accountIndex = options.accountIndex;
    this._stellarAddress = options.stellarAddress;
    this._networkPassphrase = network;
    this._gate = options.authorizationGate;
  }

  async getPublicKey(): Promise<string> {
    return this._assertBoundAccount();
  }

  async signMessage(message: string, opts?: SignOptions): Promise<SignMessageResult> {
    this._assertOptionalAddress(opts?.address);
    this._assertNetworkOption(opts?.networkPassphrase);
    if (typeof message !== 'string') {
      throw new SppSignerError('signMessage requires a string message');
    }

    const digest = hashSep53Message(message);
    return this._withAuthorization('message', digest, async (assertBeforeSign) => {
      assertBeforeSign();
      const signature = await this._signer.signMessage(digest, this._accountIndex);
      return {
        signedMessage: uint8ArrayToBase64(signature),
        signerAddress: this._stellarAddress,
      };
    });
  }

  async signTransaction(xdrInput: string, opts?: SignOptions): Promise<SignTransactionResult> {
    this._assertOptionalAddress(opts?.address);
    this._assertNetworkOption(opts?.networkPassphrase);
    if (typeof xdrInput !== 'string' || xdrInput.length === 0) {
      throw new SppSignerError('signTransaction requires a non-empty XDR string');
    }

    const networkPassphrase = this._networkPassphrase;

    let parsed: Transaction | FeeBumpTransaction;
    try {
      parsed = TransactionBuilder.fromXDR(xdrInput, networkPassphrase);
    } catch {
      throw new SppSignerError('Invalid transaction XDR or network passphrase mismatch');
    }

    if (parsed instanceof FeeBumpTransaction) {
      throw new SppSignerError('Fee-bump transactions are not supported by this adapter');
    }

    const tx = parsed as Transaction;
    if (tx.source !== this._stellarAddress) {
      throw new SppSignerError('Transaction source does not match the bound Stellar account');
    }

    // Explicit policy: unsigned envelopes only. Multi-sig / co-signing is out of scope.
    if (tx.signatures.length > 0) {
      throw new SppSignerError('Transaction envelope already contains signatures');
    }

    const txHash = tx.hash();
    const digest =
      txHash instanceof Uint8Array ? txHash : new Uint8Array(txHash as ArrayLike<number>);

    return this._withAuthorization('transaction', digest, async (assertBeforeSign) => {
      assertBeforeSign();
      const signature = await this._signer.signTransaction(digest, this._accountIndex);
      // SDK verifies the signature against the public key before attaching.
      tx.addSignature(this._stellarAddress, uint8ArrayToBase64(signature));
      return {
        signedTxXdr: tx.toXDR(),
        signerAddress: this._stellarAddress,
      };
    });
  }

  /**
   * Signs a Soroban authorization preimage (HashIdPreimage XDR).
   * Allowlist: envelopeTypeSorobanAuthorization | envelopeTypeSorobanAuthorizationWithAddress.
   * WithAddress: preimage address must equal the bound account.
   *
   * Layer limit: invocation contents are not semantically validated here.
   */
  async signAuthEntry(xdrInput: string, opts?: SignOptions): Promise<SignAuthEntryResult> {
    this._assertOptionalAddress(opts?.address);
    this._assertNetworkOption(opts?.networkPassphrase);
    if (typeof xdrInput !== 'string' || xdrInput.length === 0) {
      throw new SppSignerError('signAuthEntry requires a non-empty XDR string');
    }

    const networkPassphrase = this._networkPassphrase;

    let preimage: xdr.HashIdPreimage;
    try {
      preimage = xdr.HashIdPreimage.fromXDR(xdrInput, 'base64');
    } catch {
      throw new SppSignerError(
        'Invalid auth-entry preimage XDR (expected HashIdPreimage, not a raw transaction)',
      );
    }

    this._assertAllowedAuthPreimage(preimage);
    this._assertPreimageNetwork(preimage, networkPassphrase);

    const payload = hash(preimage.toXDR());
    const digest = payload instanceof Uint8Array ? payload : new Uint8Array(payload);

    return this._withAuthorization('auth_entry', digest, async (assertBeforeSign) => {
      assertBeforeSign();
      const signature = await this._signer.signTransaction(digest, this._accountIndex);
      return {
        signedAuthEntry: uint8ArrayToBase64(signature),
        signerAddress: this._stellarAddress,
      };
    });
  }

  /**
   * authorize(context) → assert → verify HD binding → fn(assertBeforeSign) → end in finally.
   * {@code assertBeforeSign} must be invoked immediately before SoftwareSigner.
   */
  private async _withAuthorization<T>(
    kind: SignatureKind,
    digest: Uint8Array,
    fn: (assertBeforeSign: () => void) => Promise<T>,
  ): Promise<T> {
    const context = this._buildContext(kind, digest);
    let lease: SignatureLease;
    try {
      lease = this._gate.authorize(context);
    } catch (cause) {
      throw new SppSignerError(
        cause instanceof Error ? cause.message : 'Signature authorization denied',
      );
    }
    try {
      this._gate.assertActive(lease, context);
      await this._assertBoundAccount();
      const assertBeforeSign = (): void => {
        this._gate.assertActive(lease, context);
      };
      return await fn(assertBeforeSign);
    } finally {
      this._gate.end(lease);
    }
  }

  private _buildContext(kind: SignatureKind, digest: Uint8Array): SignatureAuthContext {
    return {
      kind,
      account: this._stellarAddress,
      networkPassphrase: this._networkPassphrase,
      payloadDigestHex: digestToHex(digest),
    };
  }

  private async _assertBoundAccount(): Promise<string> {
    const pub = await this._signer.getPublicKey(this._accountIndex);
    const encoded = StrKey.encodeEd25519PublicKey(pub);
    if (encoded !== this._stellarAddress) {
      throw new SppSignerError('Bound stellarAddress does not match derived public key for accountIndex');
    }
    return encoded;
  }

  private _assertOptionalAddress(address: string | undefined): void {
    if (address === undefined) return;
    if (address !== this._stellarAddress) {
      throw new SppSignerError('Requested signer address does not match the bound Stellar account');
    }
  }

  /** Symmetric network lock: opts may omit or match; any other passphrase is rejected. */
  private _assertNetworkOption(networkPassphrase: string | undefined): void {
    if (networkPassphrase === undefined) return;
    if (networkPassphrase !== this._networkPassphrase) {
      throw new SppSignerError('Network passphrase does not match the adapter binding');
    }
  }

  private _assertAllowedAuthPreimage(preimage: xdr.HashIdPreimage): void {
    const typeName = String((preimage as { type?: unknown }).type ?? '');
    if (!ALLOWED_AUTH_PREIMAGE_TYPES.has(typeName)) {
      throw new SppSignerError(
        `Auth preimage variant is not allowed (${typeName || 'unknown'}); expected Soroban authorization`,
      );
    }

    if (typeName === 'envelopeTypeSorobanAuthorizationWithAddress') {
      const value = preimage.value as { address?: xdr.ScAddress };
      const scAddress = value?.address;
      if (!scAddress) {
        throw new SppSignerError('Auth preimage WithAddress is missing address');
      }
      let encoded: string;
      try {
        encoded = Address.fromScAddress(scAddress).toString();
      } catch {
        throw new SppSignerError('Auth preimage address is not a recognizable ScAddress');
      }
      if (!StrKey.isValidEd25519PublicKey(encoded)) {
        // Contract (C…) or other identities: not supported for this classic G… adapter.
        throw new SppSignerError('Auth preimage address is not a classic G… account');
      }
      if (encoded !== this._stellarAddress) {
        throw new SppSignerError('Auth preimage address does not match the bound Stellar account');
      }
    }
  }

  private _assertPreimageNetwork(preimage: xdr.HashIdPreimage, networkPassphrase: string): void {
    const expectedNetworkId = hash(Buffer.from(networkPassphrase, 'utf8'));
    const value = preimage.value as {
      networkId?: Buffer | Uint8Array | { toXDR: (format: string) => Buffer | Uint8Array };
    };
    const raw = value.networkId;
    if (!raw) {
      throw new SppSignerError('Auth preimage does not carry a networkId');
    }
    const got = extractHashBytes(raw);
    if (!bytesEqual(got, expectedNetworkId)) {
      throw new SppSignerError('Auth preimage networkId does not match network passphrase');
    }
  }
}

function extractHashBytes(
  value: Buffer | Uint8Array | { toXDR: (format: string) => Buffer | Uint8Array },
): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value && typeof (value as { toXDR?: unknown }).toXDR === 'function') {
    const raw = (value as { toXDR: (format: string) => Buffer | Uint8Array }).toXDR('raw');
    return raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  }
  throw new SppSignerError('Auth preimage networkId is not a recognizable hash encoding');
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Verify a SEP-53 signature against a public key (uses production hasher — for convenience). */
export function verifySep53Signature(
  message: string,
  signatureBase64: string,
  publicKey: Uint8Array,
): boolean {
  const digest = hashSep53Message(message);
  const sig = Uint8Array.from(atob(signatureBase64), (c) => c.charCodeAt(0));
  return ed25519.verify(sig, digest, publicKey);
}
