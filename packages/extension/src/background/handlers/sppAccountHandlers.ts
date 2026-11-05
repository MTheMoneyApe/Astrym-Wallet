/**
 * Popup IPC handlers for SPP account surface (snapshot / lookup / register).
 * Proxies to spp-host over the bridge; never invents success.
 */

import type { ValidatedRequestPayload, ValidatedResponsePayload } from '../../shared/ipcTypes.js';
import { getNymRuntimeController } from '../nym/NymRuntimeController.js';
import { getSppHostLifecycle } from '../spp/sppPrivatePoolRegistry.js';
import { querySppHostAccount } from '../spp/sppHostAccountProxy.js';

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

export function createSppRegisterPublicKeysHandler() {
  return async (
    payload: ValidatedRequestPayload<'SPP_REGISTER_PUBLIC_KEYS'>,
  ): Promise<ValidatedResponsePayload<'SPP_REGISTER_PUBLIC_KEYS'>> => {
    const nym = requireNymAndWritePool();
    const result = await querySppHostAccount({
      ...nym,
      action: 'register_public_keys',
      freshSequence: payload.freshSequence,
      transactionFingerprint: payload.transactionFingerprint,
      registryContract: payload.registryContract,
    });
    if (!result.ok) mapHostFailure(result);
    return {
      txHash: result.registerTxHash ?? null,
      rpcRoutedViaNym: true as const,
      confirmation: result.registerTxHash ? ('confirmed' as const) : ('unknown' as const),
    };
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
