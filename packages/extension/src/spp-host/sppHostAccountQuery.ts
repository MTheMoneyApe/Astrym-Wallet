/**
 * Dispatch SW → host account-surface queries (lookup / balance / notes / register).
 */

import {
  SPP_HOST_BRIDGE_CHANNEL,
  type SppHostAccountQueryRequest,
  type SppHostAccountQueryResult,
} from '../shared/sppHostBridge.js';
import {
  getSppHostAccountBinding,
  lookupSppRecipient,
  readSppHostAccountSnapshot,
  registerSppHostPublicKeys,
  syncSppHostAccountIndexer,
} from './sppHostAccountSurface.js';

export async function executeSppHostAccountQuery(
  request: SppHostAccountQueryRequest,
): Promise<SppHostAccountQueryResult> {
  const { id, payload } = request;

  if (payload.nymMode !== 'nym' || !payload.nymConnected) {
    return {
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_ACCOUNT_QUERY_RESULT',
      id,
      ok: false,
      code: 'NYM_REQUIRED',
      message: 'Consultas SPP de cuenta requieren Nym conectado (fail-closed).',
    };
  }

  const binding = getSppHostAccountBinding();
  if (!binding.ready) {
    return {
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_ACCOUNT_QUERY_RESULT',
      id,
      ok: false,
      code: 'SESSION_NOT_READY',
      message:
        'Account surface no está vinculado. Espera write_pool_ready / PrivatePool en el host.',
    };
  }

  try {
    switch (payload.action) {
      case 'sync': {
        await syncSppHostAccountIndexer();
        const snapshot = await readSppHostAccountSnapshot();
        return {
          channel: SPP_HOST_BRIDGE_CHANNEL,
          type: 'SPP_HOST_ACCOUNT_QUERY_RESULT',
          id,
          ok: true,
          action: 'sync',
          snapshot,
          rpcRoutedViaNym: true,
        };
      }
      case 'snapshot': {
        const snapshot = await readSppHostAccountSnapshot();
        return {
          channel: SPP_HOST_BRIDGE_CHANNEL,
          type: 'SPP_HOST_ACCOUNT_QUERY_RESULT',
          id,
          ok: true,
          action: 'snapshot',
          snapshot,
          rpcRoutedViaNym: true,
        };
      }
      case 'recipient_lookup': {
        const address = payload.recipientAddress?.trim();
        if (!address) {
          return {
            channel: SPP_HOST_BRIDGE_CHANNEL,
            type: 'SPP_HOST_ACCOUNT_QUERY_RESULT',
            id,
            ok: false,
            code: 'INVALID_REQUEST',
            message: 'recipient_lookup requiere recipientAddress G…',
          };
        }
        const lookup = await lookupSppRecipient(address);
        return {
          channel: SPP_HOST_BRIDGE_CHANNEL,
          type: 'SPP_HOST_ACCOUNT_QUERY_RESULT',
          id,
          ok: true,
          action: 'recipient_lookup',
          lookup,
          rpcRoutedViaNym: true,
        };
      }
      case 'register_public_keys': {
        const freshSequence = payload.freshSequence?.trim();
        const transactionFingerprint = payload.transactionFingerprint?.trim();
        const registryContract = payload.registryContract?.trim();
        if (!freshSequence || !transactionFingerprint || !registryContract) {
          return {
            channel: SPP_HOST_BRIDGE_CHANNEL,
            type: 'SPP_HOST_ACCOUNT_QUERY_RESULT',
            id,
            ok: false,
            code: 'INVALID_REQUEST',
            message:
              'register_public_keys requiere freshSequence, transactionFingerprint y registryContract',
          };
        }
        const { txHash } = await registerSppHostPublicKeys({
          freshSequence,
          transactionFingerprint,
          registryContract,
        });
        return {
          channel: SPP_HOST_BRIDGE_CHANNEL,
          type: 'SPP_HOST_ACCOUNT_QUERY_RESULT',
          id,
          ok: true,
          action: 'register_public_keys',
          registerTxHash: txHash,
          rpcRoutedViaNym: true,
        };
      }
      default: {
        const unexpected: never = payload.action;
        return {
          channel: SPP_HOST_BRIDGE_CHANNEL,
          type: 'SPP_HOST_ACCOUNT_QUERY_RESULT',
          id,
          ok: false,
          code: 'INVALID_REQUEST',
          message: `Acción desconocida: ${String(unexpected)}`,
        };
      }
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Account query failed';
    const code =
      message.includes('SPP_REGISTRATION_AWAITING_APPROVAL') ||
      message.includes('SPP_BROADCAST_AWAITING_APPROVAL')
        ? 'UNAUTHORIZED'
        : 'EXECUTION_FAILED';
    return {
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_ACCOUNT_QUERY_RESULT',
      id,
      ok: false,
      code,
      message: message.slice(0, 500),
    };
  }
}
