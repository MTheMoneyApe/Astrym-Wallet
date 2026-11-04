/**
 * Host-page WalletSigner that RPCs signing to the service worker vault.
 * Never holds seeds or private keys in the spp-host realm.
 */

import type {
  SignAuthEntryResult,
  SignMessageResult,
  SignOptions,
  SignTransactionResult,
  WalletSigner,
} from 'stellar-private-payments';
import {
  SPP_HOST_BRIDGE_CHANNEL,
  parseSppHostSignResult,
  type SppHostSignRequest,
} from '../shared/sppHostBridge.js';

export type SppHostRemoteSignerOptions = {
  /** Bound G… address expected for this session. */
  stellarAddress: string;
  networkPassphrase: string;
  send?: (message: SppHostSignRequest) => Promise<unknown>;
};

async function defaultSend(message: SppHostSignRequest): Promise<unknown> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    throw new Error('chrome.runtime.sendMessage unavailable for SPP remote signer');
  }
  return chrome.runtime.sendMessage(message);
}

export class SppHostRemoteSigner implements WalletSigner {
  private readonly _stellarAddress: string;
  private readonly _networkPassphrase: string;
  private readonly _send: (message: SppHostSignRequest) => Promise<unknown>;

  constructor(options: SppHostRemoteSignerOptions) {
    this._stellarAddress = options.stellarAddress;
    this._networkPassphrase = options.networkPassphrase;
    this._send = options.send ?? defaultSend;
  }

  async getPublicKey(): Promise<string> {
    return this._stellarAddress;
  }

  async signMessage(message: string, opts?: SignOptions): Promise<SignMessageResult> {
    const signed = await this._sign('message', message, opts);
    return { signedMessage: signed.signatureBase64, signerAddress: signed.signerAddress };
  }

  async signTransaction(xdr: string, opts?: SignOptions): Promise<SignTransactionResult> {
    const signed = await this._sign('transaction', xdr, opts);
    return { signedTxXdr: signed.signatureBase64, signerAddress: signed.signerAddress };
  }

  async signAuthEntry(xdr: string, opts?: SignOptions): Promise<SignAuthEntryResult> {
    const signed = await this._sign('auth_entry', xdr, opts);
    return { signedAuthEntry: signed.signatureBase64, signerAddress: signed.signerAddress };
  }

  private async _sign(
    kind: 'message' | 'transaction' | 'auth_entry',
    input: string,
    opts?: SignOptions,
  ): Promise<{ signatureBase64: string; signerAddress: string }> {
    if (opts?.address && opts.address !== this._stellarAddress) {
      throw new Error('Remote signer address mismatch');
    }
    if (opts?.networkPassphrase && opts.networkPassphrase !== this._networkPassphrase) {
      throw new Error('Remote signer network passphrase mismatch');
    }

    const id = crypto.randomUUID();
    const request: SppHostSignRequest = {
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_SIGN',
      id,
      payload: {
        kind,
        input,
        address: this._stellarAddress,
        networkPassphrase: this._networkPassphrase,
      },
    };

    const raw = await this._send(request);
    const result = parseSppHostSignResult(raw);
    if (!result || result.id !== id) {
      throw new Error('SPP remote signer: invalid SW response');
    }
    if (!result.ok) {
      throw new Error(`SPP remote signer refused (${result.code}): ${result.message}`);
    }
    if (result.signerAddress !== this._stellarAddress) {
      throw new Error('SPP remote signer returned unexpected address');
    }
    return {
      signatureBase64: result.signatureBase64,
      signerAddress: result.signerAddress,
    };
  }
}
