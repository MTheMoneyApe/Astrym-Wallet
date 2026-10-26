/**
 * Test-only WalletSigner that records SDK-shaped calls and never produces a
 * valid signature or submits anything.
 *
 * Intended for: (1) unit tests of capture/classification; (2) future browser
 * harnesses that wrap the real stellar-private-payments WASM session.
 * Not a production authorization path.
 */

import type {
  SignAuthEntryResult,
  SignMessageResult,
  SignOptions,
  SignTransactionResult,
  WalletSigner,
} from 'stellar-private-payments';

export type RecordedSignerMethod = 'getPublicKey' | 'signMessage' | 'signTransaction' | 'signAuthEntry';

export type RecordedSignerCall = {
  method: RecordedSignerMethod;
  /** First positional argument (message string or XDR string), if any. */
  input?: string;
  opts?: SignOptions;
  /** Wall-clock ms when the call was received (tests only). */
  atMs: number;
};

export type RecordingWalletSignerOptions = {
  /** Synthetic G… address returned by getPublicKey. */
  publicKey: string;
  /**
   * If true (default), sign* methods throw after recording so no caller can
   * treat the result as a successful signature.
   */
  rejectSigning?: boolean;
};

const HARNESS_REJECT = 'RecordingWalletSigner: harness does not produce valid signatures';

/**
 * Implements the stellar-private-payments WalletSigner shape for offline tests.
 * Always refuses to return usable signature material when rejectSigning is true.
 */
export class RecordingWalletSigner implements WalletSigner {
  readonly calls: RecordedSignerCall[] = [];
  private readonly _publicKey: string;
  private readonly _rejectSigning: boolean;

  constructor(options: RecordingWalletSignerOptions) {
    this._publicKey = options.publicKey;
    this._rejectSigning = options.rejectSigning !== false;
  }

  clear(): void {
    this.calls.length = 0;
  }

  async getPublicKey(): Promise<string> {
    this.calls.push({ method: 'getPublicKey', atMs: Date.now() });
    return this._publicKey;
  }

  async signMessage(message: string, opts?: SignOptions): Promise<SignMessageResult> {
    this._record('signMessage', message, opts);
    if (this._rejectSigning) {
      throw new Error(HARNESS_REJECT);
    }
    return { signedMessage: '', signerAddress: this._publicKey };
  }

  async signTransaction(xdr: string, opts?: SignOptions): Promise<SignTransactionResult> {
    this._record('signTransaction', xdr, opts);
    if (this._rejectSigning) {
      throw new Error(HARNESS_REJECT);
    }
    return { signedTxXdr: '', signerAddress: this._publicKey };
  }

  async signAuthEntry(xdr: string, opts?: SignOptions): Promise<SignAuthEntryResult> {
    this._record('signAuthEntry', xdr, opts);
    if (this._rejectSigning) {
      throw new Error(HARNESS_REJECT);
    }
    return { signedAuthEntry: '', signerAddress: this._publicKey };
  }

  private _record(method: RecordedSignerMethod, input: string, opts?: SignOptions): void {
    const entry: RecordedSignerCall = { method, input, atMs: Date.now() };
    if (opts !== undefined) {
      entry.opts = { ...opts };
    }
    this.calls.push(entry);
  }
}

export { HARNESS_REJECT };
