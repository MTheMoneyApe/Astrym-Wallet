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
  sppKeyDerivationMessage,
  sppRegistrationDigest,
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

function digestHex(message: string): string {
  const digest = sppRegistrationDigest(message);
  let hex = '';
  for (let i = 0; i < digest.length; i += 1) {
    hex += digest[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Transport fields for a register request built from the Derivation v3 message.
 * They are the digest of that public message, not note keys, proofs, or signatures.
 */
export function sppDerivationV3RegisterFields(kdfDomain: string): {
  noteKeyHex: string;
  encryptionKeyHex: string;
  noteKeyProofHex: string;
  encryptionKeySignatureHex: string;
  ownerSignatureHex: string;
} {
  const commitment = digestHex(sppKeyDerivationMessage(kdfDomain));
  const signatureSlot = commitment + commitment;
  return {
    noteKeyHex: commitment,
    encryptionKeyHex: commitment,
    noteKeyProofHex: commitment,
    encryptionKeySignatureHex: signatureSlot,
    ownerSignatureHex: signatureSlot,
  };
}

function isSppDerivationV3Register(
  payload: {
    noteKeyHex: string;
    encryptionKeyHex: string;
    noteKeyProofHex: string;
    encryptionKeySignatureHex: string;
    ownerSignatureHex: string;
  },
  kdfDomain: string,
): boolean {
  const fields = sppDerivationV3RegisterFields(kdfDomain);
  return payload.noteKeyHex.toLowerCase() === fields.noteKeyHex
    && payload.encryptionKeyHex.toLowerCase() === fields.encryptionKeyHex
    && payload.noteKeyProofHex.toLowerCase() === fields.noteKeyProofHex
    && payload.encryptionKeySignatureHex.toLowerCase() === fields.encryptionKeySignatureHex
    && payload.ownerSignatureHex.toLowerCase() === fields.ownerSignatureHex;
}

const HELD_REGISTRATION_NOTE = 'Registro retenido: aún no hay firma Registration v1';

function heldAtSign(): never {
  throw Object.assign(new Error(HELD_REGISTRATION_NOTE), {
    name: 'UNAUTHORIZED',
    code: 'BROADCAST_AWAITING_APPROVAL',
  });
}

/**
 * Bind the Derivation v3 registration before mint. Broadcast OFF makes bind
 * throw before an intent exists. This never mints and never signs.
 */
function refuseSppDerivationV3RegisterAtSign(
  address: string,
  registryContractId: string,
  kdfDomain: string,
): never {
  const fields = sppDerivationV3RegisterFields(kdfDomain);
  if (!isSppTestnetBroadcastAuthorized()) {
    revokeSppSignApprovals(address);
    try {
      bindSppRegistrationBeforeMint({
        account: address,
        registryContractId,
        ...fields,
        maxFeeStroops: maxFeeStroopsForOperation('register_public_keys'),
      });
      revokeSppSignApprovals(address);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      if (!message.includes('SPP_BROADCAST_AWAITING_APPROVAL')) throw cause;
    }
    heldAtSign();
  }
  heldAtSign();
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
    const config = getNethermindPublicTestnetContractConfig();
    if (isSppDerivationV3Register(payload, config.kdf_domain)) {
      refuseSppDerivationV3RegisterAtSign(address, config.public_key_registry, config.kdf_domain);
    }
    if (!isSppTestnetBroadcastAuthorized()) {
      revokeSppSignApprovals(address);
      throw Object.assign(
        new Error('SPP_BROADCAST_AWAITING_APPROVAL: registration is disabled. No approval was minted.'),
        { name: 'UNAUTHORIZED', code: 'BROADCAST_AWAITING_APPROVAL' },
      );
    }
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
