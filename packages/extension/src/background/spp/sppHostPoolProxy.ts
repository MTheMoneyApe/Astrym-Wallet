/**
 * SW-side proxy that implements {@link SppPrivatePool} by messaging spp-host.
 * Does not hold WASM objects. Fail-closed when the host is missing or rejects.
 */

import {
  SppPrivatePaymentError,
  type SppPrivatePool,
  type SppPrivatePoolResult,
} from '@solanym/wallet-core/src/stellar/spp/sppNymOption.js';
import {
  SPP_HOST_BRIDGE_CHANNEL,
  parseSppHostExecuteResult,
  type SppHostExecuteRequest,
} from '../../shared/sppHostBridge.js';

export type SppHostBridgeSender = (message: SppHostExecuteRequest) => Promise<unknown>;

export type SppHostPoolProxyOptions = {
  rpcUrl: string;
  nymMode: 'direct' | 'nym';
  nymConnected: boolean;
  poolContract: string;
  send: SppHostBridgeSender;
  /** Optional account-scoped sequence tracking forwarded to spp-host. */
  signingAccount?: string;
  freshSequence?: string;
  nextFreshSequence?: string;
  operationFingerprint?: string;
};

async function executeViaHost(
  options: SppHostPoolProxyOptions,
  operation: 'deposit' | 'transfer' | 'withdraw',
  amount: bigint,
  recipient: string | null,
): Promise<SppPrivatePoolResult> {
  if (options.nymMode !== 'nym' || !options.nymConnected) {
    throw new SppPrivatePaymentError(
      'NYM_REQUIRED',
      'SPP host proxy refuse: Nym must be connected (fail-closed).',
    );
  }

  const id = crypto.randomUUID();
  const payload: SppHostExecuteRequest['payload'] = {
    operation,
    poolContract: options.poolContract,
    amountStroops: amount.toString(),
    rpcUrl: options.rpcUrl,
    nymMode: options.nymMode,
    nymConnected: options.nymConnected,
    sppSelected: true,
  };
  if (recipient) payload.recipient = recipient;
  if (options.signingAccount) payload.signingAccount = options.signingAccount;
  if (options.freshSequence) payload.freshSequence = options.freshSequence;
  if (options.nextFreshSequence) payload.nextFreshSequence = options.nextFreshSequence;
  if (options.operationFingerprint) payload.operationFingerprint = options.operationFingerprint;

  const request: SppHostExecuteRequest = {
    channel: SPP_HOST_BRIDGE_CHANNEL,
    type: 'SPP_HOST_EXECUTE_PRIVATE_PAYMENT',
    id,
    payload,
  };

  let raw: unknown;
  try {
    raw = await options.send(request);
  } catch (cause) {
    throw new SppPrivatePaymentError(
      'HOST_UNAVAILABLE',
      'No se pudo contactar spp-host. Abre el host SPP con Nym conectado.',
      { cause },
    );
  }

  const result = parseSppHostExecuteResult(raw);
  if (!result || result.id !== id) {
    throw new SppPrivatePaymentError(
      'HOST_UNAVAILABLE',
      'spp-host no respondió un resultado SPP válido.',
    );
  }
  if (!result.ok) {
    throw new SppPrivatePaymentError(result.code, result.message);
  }
  return { txHash: result.txHash };
}

/**
 * Build a one-shot pool proxy bound to a specific pool contract + Nym snapshot.
 * Callers should not cache across Nym disconnects.
 */
export function createSppHostPoolProxy(options: SppHostPoolProxyOptions): SppPrivatePool {
  return {
    deposit: (amount) => executeViaHost(options, 'deposit', amount, null),
    transfer: (recipient, amount) => executeViaHost(options, 'transfer', amount, recipient),
    withdraw: (amount, recipient) => executeViaHost(options, 'withdraw', amount, recipient),
  };
}

/** Default sender: extension runtime broadcast (spp-host page must be listening). */
export function createChromeRuntimeSppHostSender(): SppHostBridgeSender {
  return async (message) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      throw new Error('chrome.runtime.sendMessage unavailable');
    }
    return chrome.runtime.sendMessage(message);
  };
}
