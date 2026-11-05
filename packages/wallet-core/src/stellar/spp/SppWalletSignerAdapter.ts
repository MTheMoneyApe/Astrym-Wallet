/**
 * Adapter: SOLANYM SoftwareSigner (vault HD) → stellar-private-payments WalletSigner.
 *
 * Every signature goes through {@link authorizeSppSignature} first. That gate
 * allowlists Testnet, requires a single-use user intent, and checks the
 * envelope (operation, amount, recipient, contract, function, tx.fee).
 * A disposable Testnet key plugs in as {@link SppDigestSigner}; it receives
 * only the authorized digest.
 *
 * Does not call Horizon/RPC. Secrets never logged.
 */

import { ed25519 } from '@noble/curves/ed25519.js';
import {
  FeeBumpTransaction,
  Networks,
  StrKey,
  TransactionBuilder,
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
  type ContextualSignatureGate,
  type SignatureAuthContext,
  type SignatureAuthorizationGate,
  type SignatureKind,
  type SignatureLease,
} from './signatureGate.js';
import {
  SppSignerError,
  assertStellarTestnetPassphrase,
  authorizeSppSignature,
  type SppDigestSigner,
} from './sppSignGate.js';

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
  /**
   * Raw digest signer. When omitted, the vault SoftwareSigner is used.
   * A disposable Testnet key sets this and still cannot bypass the gate.
   */
  digestSigner?: SppDigestSigner;
};

export { SppSignerError } from './sppSignGate.js';

export class SppWalletSignerAdapter implements WalletSigner {
  private readonly _signer: SoftwareSigner;
  private readonly _accountIndex: number;
  private readonly _stellarAddress: string;
  private readonly _networkPassphrase: string;
  private readonly _gate: SignatureAuthorizationGate;
  private readonly _digestSigner: SppDigestSigner | null;

  constructor(options: SppWalletSignerAdapterOptions) {
    if (options.signer.chain !== 'stellar') {
      throw new SppSignerError('SppWalletSignerAdapter requires SoftwareSigner with chain "stellar"');
    }
    if (!StrKey.isValidEd25519PublicKey(options.stellarAddress)) {
      throw new SppSignerError('stellarAddress must be a valid Ed25519 G… StrKey', 'INVALID_REQUEST');
    }
    if (!Number.isInteger(options.accountIndex) || options.accountIndex < 0) {
      throw new SppSignerError('accountIndex must be a non-negative integer', 'INVALID_REQUEST');
    }
    const network = options.networkPassphrase ?? Networks.TESTNET;
    assertStellarTestnetPassphrase(network);
    this._signer = options.signer;
    this._accountIndex = options.accountIndex;
    this._stellarAddress = options.stellarAddress;
    this._networkPassphrase = network;
    this._gate = options.authorizationGate;
    this._digestSigner = options.digestSigner ?? null;
  }

  async getPublicKey(): Promise<string> {
    return this._assertBoundAccount();
  }

  async signMessage(message: string, opts?: SignOptions): Promise<SignMessageResult> {
    this._assertOptionalAddress(opts?.address);
    this._assertNetworkOption(opts?.networkPassphrase);
    if (typeof message !== 'string') {
      throw new SppSignerError('signMessage requires a string message', 'INVALID_REQUEST');
    }

    const authorization = authorizeSppSignature({
      kind: 'message',
      input: message,
      boundAccount: this._stellarAddress,
      networkPassphrase: this._networkPassphrase,
    });
    return this._withAuthorization('message', authorization.digest, async (assertBeforeSign) => {
      assertBeforeSign();
      const signature = await this._signDigest(authorization.digest, 'message');
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
      throw new SppSignerError('signTransaction requires a non-empty XDR string', 'INVALID_REQUEST');
    }

    const authorization = authorizeSppSignature({
      kind: 'transaction',
      input: xdrInput,
      boundAccount: this._stellarAddress,
      networkPassphrase: this._networkPassphrase,
    });
    return this._withAuthorization('transaction', authorization.digest, async (assertBeforeSign) => {
      assertBeforeSign();
      const signature = await this._signDigest(authorization.digest, 'transaction');
      const parsed = TransactionBuilder.fromXDR(
        authorization.unsignedTransactionXdr ?? xdrInput,
        this._networkPassphrase,
      );
      if (parsed instanceof FeeBumpTransaction) {
        throw new SppSignerError('Fee-bump transactions are not supported by this adapter');
      }
      parsed.addSignature(this._stellarAddress, uint8ArrayToBase64(signature));
      return {
        signedTxXdr: parsed.toXDR(),
        signerAddress: this._stellarAddress,
      };
    });
  }

  /**
   * Signs a Soroban authorization preimage only after the gate accepts its
   * networkId, address, contract, function, and intent.
   */
  async signAuthEntry(xdrInput: string, opts?: SignOptions): Promise<SignAuthEntryResult> {
    this._assertOptionalAddress(opts?.address);
    this._assertNetworkOption(opts?.networkPassphrase);
    if (typeof xdrInput !== 'string' || xdrInput.length === 0) {
      throw new SppSignerError('signAuthEntry requires a non-empty XDR string', 'INVALID_REQUEST');
    }

    const authorization = authorizeSppSignature({
      kind: 'auth_entry',
      input: xdrInput,
      boundAccount: this._stellarAddress,
      networkPassphrase: this._networkPassphrase,
    });
    return this._withAuthorization('auth_entry', authorization.digest, async (assertBeforeSign) => {
      assertBeforeSign();
      const signature = await this._signDigest(authorization.digest, 'auth_entry');
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
    const approvable = this._gate as Partial<ContextualSignatureGate>;
    if (typeof approvable.approve === 'function') {
      approvable.approve(context);
    }
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

  private async _signDigest(digest: Uint8Array, kind: SignatureKind): Promise<Uint8Array> {
    if (this._digestSigner) {
      return this._digestSigner.signDigest(digest);
    }
    if (kind === 'message') {
      return this._signer.signMessage(digest, this._accountIndex);
    }
    return this._signer.signTransaction(digest, this._accountIndex);
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
