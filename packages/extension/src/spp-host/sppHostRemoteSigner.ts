/**
 * Host-page WalletSigner that RPCs signing to the service worker vault.
 * Never holds seeds or private keys in the spp-host realm.
 */

import {
  FeeBumpTransaction,
  Networks,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import type {
  SignAuthEntryResult,
  SignMessageResult,
  SignOptions,
  SignTransactionResult,
  WalletSigner,
} from 'stellar-private-payments';
import { assertStellarTestnetPassphrase } from '@solanym/wallet-core/src/stellar/spp/sppSignGate.js';
import {
  SPP_HOST_BRIDGE_CHANNEL,
  parseSppHostSignResult,
  type SppHostSignRequest,
} from '../shared/sppHostBridge.js';
import {
  assertHostAssembledTransactionFee,
  assertHostAuthEntry,
} from './sppHostFeeScope.js';

export type SppHostRemoteSignerOptions = {
  /** Bound G… address expected for this session. */
  stellarAddress: string;
  networkPassphrase: string;
  prepareGeneration: number;
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
  private readonly _prepareGeneration: number;
  private readonly _send: (message: SppHostSignRequest) => Promise<unknown>;

  constructor(options: SppHostRemoteSignerOptions) {
    assertStellarTestnetPassphrase(options.networkPassphrase);
    this._stellarAddress = options.stellarAddress;
    if (!Number.isSafeInteger(options.prepareGeneration) || options.prepareGeneration <= 0) throw new Error('SPP remote signer requires a valid prepare generation');
    this._networkPassphrase = options.networkPassphrase;
    this._prepareGeneration = options.prepareGeneration;
    this._send = options.send ?? defaultSend;
  }

  async getPublicKey(): Promise<string> {
    return this._stellarAddress;
  }

  async signMessage(message: string, opts?: SignOptions): Promise<SignMessageResult> {
    const signed = await this._sign('message', message, opts);
    return { signedMessage: signed.signatureBase64, signerAddress: signed.signerAddress };
  }

  async signStorageUnlockMessage(
    message: string,
    approvalToken: string,
    opts?: SignOptions,
  ): Promise<SignMessageResult> {
    const signed = await this._sign('message', message, opts, 'storage_unlock', approvalToken);
    return { signedMessage: signed.signatureBase64, signerAddress: signed.signerAddress };
  }

  async signTransaction(xdr: string, opts?: SignOptions): Promise<SignTransactionResult> {
    this._assertHostTransaction(xdr);
    const signed = await this._sign('transaction', xdr, opts);
    return { signedTxXdr: signed.signatureBase64, signerAddress: signed.signerAddress };
  }

  async signAuthEntry(xdr: string, opts?: SignOptions): Promise<SignAuthEntryResult> {
    assertHostAuthEntry(xdr, this._stellarAddress);
    const signed = await this._sign('auth_entry', xdr, opts);
    return { signedAuthEntry: signed.signatureBase64, signerAddress: signed.signerAddress };
  }

  private _assertHostTransaction(xdrInput: string): void {
    assertStellarTestnetPassphrase(this._networkPassphrase);
    let parsed: ReturnType<typeof TransactionBuilder.fromXDR>;
    try {
      parsed = TransactionBuilder.fromXDR(xdrInput, Networks.TESTNET);
    } catch {
      throw new Error('SPP host refused to forward an unreadable transaction');
    }
    if (parsed instanceof FeeBumpTransaction) {
      throw new Error('SPP host refused a fee-bump transaction');
    }
    assertHostAssembledTransactionFee(parsed.fee);
  }

  private async _sign(
    kind: 'message' | 'transaction' | 'auth_entry',
    input: string,
    opts?: SignOptions,
    authorization: 'standard' | 'storage_unlock' = 'standard',
    storageUnlockApprovalToken?: string,
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
        prepareGeneration: this._prepareGeneration,
        ...(authorization === 'storage_unlock'
          ? { authorization, storageUnlockApprovalToken }
          : {}),
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
