/**
 * SW-side handlers for spp-host bridge requests that must touch the vault or Nym.
 * Signatures and HTTP bodies only — never seeds or private keys on the wire.
 */

import { StrKey } from '@solanym/wallet-core';
import type { SoftwareSigner } from '@solanym/wallet-core/src/signer/SoftwareSigner.js';
import type { KeyManager } from '@solanym/wallet-core/src/keyManager/KeyManager.js';
import { SppWalletSignerAdapter } from '@solanym/wallet-core/src/stellar/spp/SppWalletSignerAdapter.js';
import { createContextualSignatureGate } from '@solanym/wallet-core/src/stellar/spp/signatureGate.js';
import {
  SPP_HOST_BRIDGE_CHANNEL,
  type SppHostNymFetchRequest,
  type SppHostNymFetchResult,
  type SppHostSignRequest,
  type SppHostSignResult,
} from '../../shared/sppHostBridge.js';
import { getNymRuntimeController } from '../nym/NymRuntimeController.js';
import { activeAccountManager } from '../accounts/ActiveAccountManager.js';

/** Testnet passphrase (keep in sync with Networks.TESTNET). */
const STELLAR_TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

export type SppHostBridgeHandlerDeps = {
  signer: SoftwareSigner;
  keyManager: KeyManager;
  networkPassphrase?: string;
};

function sameOrigin(url: string, rpcUrl: string): boolean {
  return new URL(url).origin === new URL(rpcUrl).origin;
}

async function resolveBoundStellarAddress(
  keyManager: KeyManager,
): Promise<{ index: number; address: string }> {
  const index = activeAccountManager.getActiveAccountIndex();
  if (!Number.isInteger(index) || index < 0) {
    throw new Error('No active Stellar account');
  }
  const accounts = await keyManager.getAccounts();
  const account = accounts.find((a) => a.index === index);
  if (!account) {
    throw new Error(`Active account index ${index} not found`);
  }
  const address = StrKey.encodeEd25519PublicKey(account.publicKey);
  if (!StrKey.isValidEd25519PublicKey(address)) {
    throw new Error('Active account is not a Stellar G… address');
  }
  return { index, address };
}

/**
 * Handle host → SW signing. Uses bind-on-authorize: the caller already passed
 * Nym + SPP selection gates; digests are still one-shot lease-bound.
 */
export async function handleSppHostSignRequest(
  request: SppHostSignRequest,
  deps: SppHostBridgeHandlerDeps,
): Promise<SppHostSignResult> {
  const ctrl = getNymRuntimeController();
  const snap = ctrl.getSnapshot();
  if (snap.mode !== 'nym' || !snap.connected) {
    return {
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_SIGN_RESULT',
      id: request.id,
      ok: false,
      code: 'NYM_REQUIRED',
      message: 'SPP signing requires Nym connected (fail-closed).',
    };
  }

  try {
    if (deps.signer.chain !== 'stellar') {
      return {
        channel: SPP_HOST_BRIDGE_CHANNEL,
        type: 'SPP_HOST_SIGN_RESULT',
        id: request.id,
        ok: false,
        code: 'UNAUTHORIZED',
        message: 'Vault signer is not bound to Stellar.',
      };
    }

    const { index, address } = await resolveBoundStellarAddress(deps.keyManager);
    if (request.payload.address && request.payload.address !== address) {
      return {
        channel: SPP_HOST_BRIDGE_CHANNEL,
        type: 'SPP_HOST_SIGN_RESULT',
        id: request.id,
        ok: false,
        code: 'UNAUTHORIZED',
        message: 'Requested signer address does not match the active account.',
      };
    }

    const networkPassphrase = deps.networkPassphrase ?? STELLAR_TESTNET_PASSPHRASE;
    if (
      request.payload.networkPassphrase &&
      request.payload.networkPassphrase !== networkPassphrase
    ) {
      return {
        channel: SPP_HOST_BRIDGE_CHANNEL,
        type: 'SPP_HOST_SIGN_RESULT',
        id: request.id,
        ok: false,
        code: 'UNAUTHORIZED',
        message: 'Network passphrase does not match the wallet binding.',
      };
    }

    const gate = createContextualSignatureGate('bind-on-authorize');
    const adapter = new SppWalletSignerAdapter({
      signer: deps.signer,
      accountIndex: index,
      stellarAddress: address,
      networkPassphrase,
      authorizationGate: gate,
    });

    const { kind, input } = request.payload;
    let signatureBase64: string;
    switch (kind) {
      case 'message': {
        const result = await adapter.signMessage(input, { address, networkPassphrase });
        signatureBase64 =
          typeof result === 'string' ? result : result.signedMessage;
        break;
      }
      case 'transaction': {
        const result = await adapter.signTransaction(input, { address, networkPassphrase });
        signatureBase64 =
          typeof result === 'string' ? result : result.signedTxXdr;
        break;
      }
      case 'auth_entry': {
        const result = await adapter.signAuthEntry(input, { address, networkPassphrase });
        signatureBase64 =
          typeof result === 'string' ? result : result.signedAuthEntry;
        break;
      }
      default: {
        const unexpected: never = kind;
        return {
          channel: SPP_HOST_BRIDGE_CHANNEL,
          type: 'SPP_HOST_SIGN_RESULT',
          id: request.id,
          ok: false,
          code: 'INVALID_REQUEST',
          message: `Unknown sign kind: ${String(unexpected)}`,
        };
      }
    }

    return {
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_SIGN_RESULT',
      id: request.id,
      ok: true,
      kind,
      signatureBase64,
      signerAddress: address,
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'SPP sign failed';
    const code =
      /lock|unlock|vault/i.test(message) ? 'VAULT_LOCKED' as const : 'SIGN_FAILED' as const;
    return {
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_SIGN_RESULT',
      id: request.id,
      ok: false,
      code,
      message: message.slice(0, 500),
    };
  }
}

/** Host → SW: route Soroban-origin HTTP through Nym fail-closed fetch. */
export async function handleSppHostNymFetchRequest(
  request: SppHostNymFetchRequest,
): Promise<SppHostNymFetchResult> {
  const ctrl = getNymRuntimeController();
  const snap = ctrl.getSnapshot();
  if (snap.mode !== 'nym' || !snap.connected) {
    return {
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_NYM_FETCH_RESULT',
      id: request.id,
      ok: false,
      code: 'NYM_REQUIRED',
      message: 'SPP Nym fetch requires Nym connected (fail-closed).',
    };
  }

  const { rpcUrl, url, method, headers, body } = request.payload;
  try {
    if (!sameOrigin(url, rpcUrl)) {
      return {
        channel: SPP_HOST_BRIDGE_CHANNEL,
        type: 'SPP_HOST_NYM_FETCH_RESULT',
        id: request.id,
        ok: false,
        code: 'ORIGIN_BLOCKED',
        message: `Blocked non-Soroban origin for SPP RPC proxy: ${new URL(url).origin}`,
      };
    }

    const nymFetch = ctrl.getStellarFetch();
    const init: RequestInit = {
      method,
      headers: headers ?? {},
    };
    if (body !== undefined && method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD') {
      init.body = body;
    }
    const response = await nymFetch(url, init);
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key.toLowerCase()] = value;
    });
    const bodyText = await response.text();
    return {
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_NYM_FETCH_RESULT',
      id: request.id,
      ok: true,
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      bodyText,
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Nym fetch failed';
    return {
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_NYM_FETCH_RESULT',
      id: request.id,
      ok: false,
      code: 'RPC_FAILED',
      message: message.slice(0, 500),
    };
  }
}
