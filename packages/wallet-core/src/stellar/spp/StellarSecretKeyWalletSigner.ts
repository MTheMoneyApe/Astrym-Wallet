/**
 * WalletSigner backed by a raw Stellar S… secret (not BIP-44 HD).
 *
 * Use for disposable Testnet identities that were funded as classic Keypair
 * accounts (S… → G…). Astrym's SoftwareSigner HD path (m/44'/148'/i') cannot
 * represent those identities — this signer binds the exact G… address.
 *
 * SECURITY:
 * - Secret is held only in a private closure; never logged or returned.
 * - Constructor refuses Mainnet passphrase.
 * - Constructor verifies Keypair public key equals expectedAddress.
 * - No console.* calls.
 */

import {
  Keypair,
  Networks,
  StrKey,
  Transaction,
  TransactionBuilder,
  hash,
  xdr,
} from '@stellar/stellar-sdk';
import type {
  SignAuthEntryResult,
  SignMessageResult,
  SignOptions,
  SignTransactionResult,
  WalletSigner,
} from 'stellar-private-payments';
import { uint8ArrayToBase64 } from '../transaction/StellarTransactionClient.js';
import { hashSep53Message } from './sep53.js';

const ALLOWED_AUTH_PREIMAGE_TYPES = new Set([
  'envelopeTypeSorobanAuthorization',
  'envelopeTypeSorobanAuthorizationWithAddress',
]);

export class StellarSecretKeySignerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StellarSecretKeySignerError';
  }
}

export type StellarSecretKeyWalletSignerOptions = {
  /** Stellar S… secret seed. Never logged. */
  secret: string;
  /** Expected G… address — must match Keypair.fromSecret(secret).publicKey(). */
  expectedAddress: string;
  /** Must be Testnet. Defaults to Networks.TESTNET. */
  networkPassphrase?: string;
};

export class StellarSecretKeyWalletSigner implements WalletSigner {
  private readonly _keypair: Keypair;
  private readonly _address: string;
  private readonly _networkPassphrase: string;

  constructor(options: StellarSecretKeyWalletSignerOptions) {
    const network = options.networkPassphrase ?? Networks.TESTNET;
    if (network === Networks.PUBLIC) {
      throw new StellarSecretKeySignerError(
        'StellarSecretKeyWalletSigner refuses Mainnet (PUBLIC) passphrase',
      );
    }
    if (!StrKey.isValidEd25519SecretSeed(options.secret)) {
      throw new StellarSecretKeySignerError('secret must be a valid Stellar S… seed');
    }
    if (!StrKey.isValidEd25519PublicKey(options.expectedAddress)) {
      throw new StellarSecretKeySignerError('expectedAddress must be a valid Stellar G… address');
    }

    let keypair: Keypair;
    try {
      keypair = Keypair.fromSecret(options.secret);
    } catch {
      throw new StellarSecretKeySignerError('Failed to parse Stellar secret seed');
    }

    if (keypair.publicKey() !== options.expectedAddress) {
      throw new StellarSecretKeySignerError(
        'Secret does not derive the expected G… address (refusing identity mismatch)',
      );
    }

    this._keypair = keypair;
    this._address = options.expectedAddress;
    this._networkPassphrase = network;
  }

  async getPublicKey(): Promise<string> {
    return this._address;
  }

  async signMessage(message: string, opts?: SignOptions): Promise<SignMessageResult> {
    this._assertOptionalAddress(opts?.address);
    this._assertNetworkOption(opts?.networkPassphrase);
    if (typeof message !== 'string') {
      throw new StellarSecretKeySignerError('signMessage requires a string message');
    }
    const digest = hashSep53Message(message);
    const signature = this._keypair.sign(digest);
    return {
      signedMessage: uint8ArrayToBase64(signature),
      signerAddress: this._address,
    };
  }

  async signTransaction(xdrInput: string, opts?: SignOptions): Promise<SignTransactionResult> {
    this._assertOptionalAddress(opts?.address);
    this._assertNetworkOption(opts?.networkPassphrase);
    if (typeof xdrInput !== 'string' || xdrInput.length === 0) {
      throw new StellarSecretKeySignerError('signTransaction requires a non-empty XDR string');
    }

    let parsed: Transaction;
    try {
      const tx = TransactionBuilder.fromXDR(xdrInput, this._networkPassphrase);
      if (!(tx instanceof Transaction)) {
        throw new StellarSecretKeySignerError('Fee-bump transactions are not supported');
      }
      parsed = tx;
    } catch (cause) {
      if (cause instanceof StellarSecretKeySignerError) throw cause;
      throw new StellarSecretKeySignerError('Invalid transaction XDR or network passphrase mismatch');
    }

    if (parsed.source !== this._address) {
      throw new StellarSecretKeySignerError('Transaction source does not match the bound Stellar account');
    }
    if (parsed.signatures.length > 0) {
      throw new StellarSecretKeySignerError('Transaction envelope already contains signatures');
    }

    parsed.sign(this._keypair);
    return {
      signedTxXdr: parsed.toXDR(),
      signerAddress: this._address,
    };
  }

  async signAuthEntry(xdrInput: string, opts?: SignOptions): Promise<SignAuthEntryResult> {
    this._assertOptionalAddress(opts?.address);
    this._assertNetworkOption(opts?.networkPassphrase);
    if (typeof xdrInput !== 'string' || xdrInput.length === 0) {
      throw new StellarSecretKeySignerError('signAuthEntry requires a non-empty XDR string');
    }

    let preimage: xdr.HashIdPreimage;
    try {
      preimage = xdr.HashIdPreimage.fromXDR(xdrInput, 'base64');
    } catch {
      throw new StellarSecretKeySignerError('Invalid auth-entry preimage XDR');
    }

    const switchName = preimage.switch().name;
    if (!ALLOWED_AUTH_PREIMAGE_TYPES.has(switchName)) {
      throw new StellarSecretKeySignerError(`Auth preimage type not allowlisted: ${switchName}`);
    }

    const payload = hash(preimage.toXDR());
    const digest = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    const signature = this._keypair.sign(digest);
    return {
      signedAuthEntry: uint8ArrayToBase64(signature),
      signerAddress: this._address,
    };
  }

  private _assertOptionalAddress(address: string | undefined): void {
    if (address !== undefined && address !== this._address) {
      throw new StellarSecretKeySignerError('Requested address does not match bound account');
    }
  }

  private _assertNetworkOption(passphrase: string | undefined): void {
    if (passphrase !== undefined && passphrase !== this._networkPassphrase) {
      throw new StellarSecretKeySignerError('Network passphrase mismatch');
    }
  }
}
