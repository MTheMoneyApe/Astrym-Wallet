/**
 * SW → spp-host account query proxy (no WASM objects in the service worker).
 */

import {
  SPP_HOST_BRIDGE_CHANNEL,
  parseSppHostAccountQueryResult,
  type SppHostAccountQueryRequest,
  type SppHostAccountQueryResult,
} from '../../shared/sppHostBridge.js';

export type SppHostAccountProxyOptions = {
  nymMode: 'direct' | 'nym';
  nymConnected: boolean;
  send?: (message: SppHostAccountQueryRequest) => Promise<unknown>;
};

async function defaultSend(message: SppHostAccountQueryRequest): Promise<unknown> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    throw new Error('chrome.runtime.sendMessage unavailable');
  }
  return chrome.runtime.sendMessage(message);
}

export async function querySppHostAccount(
  options: SppHostAccountProxyOptions & {
    action: SppHostAccountQueryRequest['payload']['action'];
    recipientAddress?: string;
    freshSequence?: string;
    transactionFingerprint?: string;
    registryContract?: string;
  },
): Promise<SppHostAccountQueryResult> {
  const id = crypto.randomUUID();
  const payload: SppHostAccountQueryRequest['payload'] = {
    action: options.action,
    nymMode: options.nymMode,
    nymConnected: options.nymConnected,
  };
  if (options.recipientAddress) payload.recipientAddress = options.recipientAddress;
  if (options.freshSequence) payload.freshSequence = options.freshSequence;
  if (options.transactionFingerprint) {
    payload.transactionFingerprint = options.transactionFingerprint;
  }
  if (options.registryContract) payload.registryContract = options.registryContract;

  const request: SppHostAccountQueryRequest = {
    channel: SPP_HOST_BRIDGE_CHANNEL,
    type: 'SPP_HOST_ACCOUNT_QUERY',
    id,
    payload,
  };

  let raw: unknown;
  try {
    raw = await (options.send ?? defaultSend)(request);
  } catch (cause) {
    return {
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_ACCOUNT_QUERY_RESULT',
      id,
      ok: false,
      code: 'HOST_UNAVAILABLE',
      message:
        cause instanceof Error
          ? cause.message.slice(0, 500)
          : 'No se pudo contactar spp-host para la consulta de cuenta.',
    };
  }

  const result = parseSppHostAccountQueryResult(raw);
  if (!result || result.id !== id) {
    return {
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_ACCOUNT_QUERY_RESULT',
      id,
      ok: false,
      code: 'HOST_UNAVAILABLE',
      message: 'spp-host no respondió un resultado de cuenta SPP válido.',
    };
  }
  return result;
}
