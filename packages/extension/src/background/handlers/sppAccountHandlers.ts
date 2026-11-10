/**
 * Popup IPC handlers for SPP account surface (snapshot / lookup / register).
 * Proxies to spp-host over the bridge; never invents success.
 */

import browser from 'webextension-polyfill';
import { maxFeeStroopsForOperation } from '@solanym/wallet-core/src/stellar/spp/sppFeePolicy.js';
import {
  bindSppRegistrationBeforeMint,
  mintSppSignApproval,
  revokeSppSignApprovals,
} from '@solanym/wallet-core/src/stellar/spp/sppSignGate.js';
import { isSppTestnetBroadcastAuthorized } from '@solanym/wallet-core/src/stellar/spp/sppBroadcastGate.js';
import { getNethermindPublicTestnetContractConfig } from '@solanym/wallet-core/src/stellar/spp/nethermind/nethermindPublicTestnet.js';
import type { KeyManager } from '@solanym/wallet-core/src/keyManager/KeyManager.js';
import type { ValidatedRequestPayload, ValidatedResponsePayload } from '../../shared/ipcTypes.js';
import { getNymRuntimeController } from '../nym/NymRuntimeController.js';
import { getSppHostLifecycle } from '../spp/sppPrivatePoolRegistry.js';
import { querySppHostAccount } from '../spp/sppHostAccountProxy.js';
import { isTrustedWalletPageUrl } from '../trustedWalletOrigin.js';
import { resolveActiveStellarAddress } from '../spp/sppBoundAccount.js';

function requireNymAndWritePool(): { nymMode: 'direct' | 'nym'; nymConnected: boolean } {
  const snap = getNymRuntimeController().getSnapshot();
  if (snap.mode !== 'nym' || !snap.connected) {
    throw Object.assign(new Error('Nym debe estar conectado para consultas SPP de cuenta.'), {
      name: 'NYM_REQUIRED',
    });
  }
  const host = getSppHostLifecycle();
  if (host.state !== 'write_pool_ready') {
    throw Object.assign(
      new Error(
        `write_pool_ready requerido (estado host=${host.state}). Completa la preparación SPP primero.`,
      ),
      { name: 'SESSION_NOT_READY' },
    );
  }
  return { nymMode: snap.mode, nymConnected: snap.connected };
}

function requiredKeyManager(keyManager: KeyManager | undefined): KeyManager {
  if (!keyManager) {
    throw Object.assign(new Error('Registration signer is not configured'), { name: 'UNAUTHORIZED' });
  }
  return keyManager;
}

function mapHostFailure(result: { ok: false; code: string; message: string }): never {
  throw Object.assign(new Error(result.message), { name: result.code });
}

export function createSppAccountSnapshotHandler() {
  return async (
    _payload: ValidatedRequestPayload<'SPP_ACCOUNT_SNAPSHOT'>,
  ): Promise<ValidatedResponsePayload<'SPP_ACCOUNT_SNAPSHOT'>> => {
    const nym = requireNymAndWritePool();
    const result = await querySppHostAccount({ ...nym, action: 'snapshot' });
    if (!result.ok) mapHostFailure(result);
    if (!result.snapshot) {
      throw Object.assign(new Error('Host no devolvió snapshot de cuenta SPP.'), {
        name: 'HOST_UNAVAILABLE',
      });
    }
    return {
      ...result.snapshot,
      rpcRoutedViaNym: true as const,
    };
  };
}

export function createSppRecipientLookupHandler() {
  return async (
    payload: ValidatedRequestPayload<'SPP_RECIPIENT_LOOKUP'>,
  ): Promise<ValidatedResponsePayload<'SPP_RECIPIENT_LOOKUP'>> => {
    const nym = requireNymAndWritePool();
    const result = await querySppHostAccount({
      ...nym,
      action: 'recipient_lookup',
      recipientAddress: payload.address,
    });
    if (!result.ok) mapHostFailure(result);
    if (!result.lookup) {
      throw Object.assign(new Error('Host no devolvió lookup de destinatario.'), {
        name: 'HOST_UNAVAILABLE',
      });
    }
    return {
      ...result.lookup,
      rpcRoutedViaNym: true as const,
    };
  };
}

export function createSppRegisterPublicKeysHandler(deps: {
  keyManager?: KeyManager;
  resolveAccount?: () => Promise<string>;
}) {
  return async (
    payload: ValidatedRequestPayload<'SPP_REGISTER_PUBLIC_KEYS'>,
    sender?: browser.Runtime.MessageSender,
  ): Promise<ValidatedResponsePayload<'SPP_REGISTER_PUBLIC_KEYS'>> => {
    if (payload.acknowledgeBroadcast !== true) {
      throw Object.assign(
        new Error('Registration requires an explicit broadcast acknowledgement'),
        { name: 'UNAUTHORIZED' },
      );
    }
    if (!sender || sender.id !== browser.runtime.id || !isTrustedWalletPageUrl(sender.url)) {
      throw Object.assign(
        new Error('Registration must originate from trusted wallet UI'),
        { name: 'UNAUTHORIZED' },
      );
    }
    const address = deps.resolveAccount
      ? await deps.resolveAccount()
      : (await resolveActiveStellarAddress(requiredKeyManager(deps.keyManager))).address;
    if (!isSppTestnetBroadcastAuthorized()) {
      revokeSppSignApprovals(address);
      throw Object.assign(
        new Error('SPP_BROADCAST_AWAITING_APPROVAL: registration is disabled. No approval was minted.'),
        { name: 'UNAUTHORIZED', code: 'BROADCAST_AWAITING_APPROVAL' },
      );
    }
    const config = getNethermindPublicTestnetContractConfig();
    let minted = false;
    try {
      const intent = bindSppRegistrationBeforeMint({
        account: address,
        registryContractId: config.public_key_registry,
        noteKeyHex: payload.noteKeyHex,
        encryptionKeyHex: payload.encryptionKeyHex,
        noteKeyProofHex: payload.noteKeyProofHex,
        encryptionKeySignatureHex: payload.encryptionKeySignatureHex,
        ownerSignatureHex: payload.ownerSignatureHex,
        maxFeeStroops: maxFeeStroopsForOperation('register_public_keys'),
      });
      mintSppSignApproval(intent);
      minted = true;
      const nym = requireNymAndWritePool();
      const result = await querySppHostAccount({ ...nym, action: 'register_public_keys' });
      if (!result.ok) mapHostFailure(result);
      return {
        txHash: result.registerTxHash ?? null,
        rpcRoutedViaNym: true as const,
        confirmation: result.registerTxHash ? ('confirmed' as const) : ('unknown' as const),
      };
    } catch (cause) {
      if (minted) revokeSppSignApprovals(address);
      throw cause;
    }
  };
}

export function createSppAccountSyncHandler() {
  return async (
    _payload: ValidatedRequestPayload<'SPP_ACCOUNT_SYNC'>,
  ): Promise<ValidatedResponsePayload<'SPP_ACCOUNT_SYNC'>> => {
    const nym = requireNymAndWritePool();
    const result = await querySppHostAccount({ ...nym, action: 'sync' });
    if (!result.ok) mapHostFailure(result);
    return {
      synced: true,
      snapshot: result.snapshot ?? null,
      rpcRoutedViaNym: true as const,
    };
  };
}
