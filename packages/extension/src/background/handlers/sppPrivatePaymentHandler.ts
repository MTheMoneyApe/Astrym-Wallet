import {
  STELLAR_SOROBAN_TESTNET_RPC,
  executeSppPrivatePayment,
} from '@solanym/wallet-core/src/stellar/spp/sppNymOption.js';
import type { ValidatedRequestPayload, ValidatedResponsePayload } from '../../shared/ipcTypes.js';
import { getNymRuntimeController } from '../nym/NymRuntimeController.js';
import {
  createChromeRuntimeSppHostSender,
  createSppHostPoolProxy,
} from '../spp/sppHostPoolProxy.js';
import { getSppPrivatePool, getSppHostLifecycle } from '../spp/sppPrivatePoolRegistry.js';

export function createSppPrivatePaymentHandler() {
  return async (
    payload: ValidatedRequestPayload<'SPP_PRIVATE_PAYMENT'>,
  ): Promise<ValidatedResponsePayload<'SPP_PRIVATE_PAYMENT'>> => {
    const ctrl = getNymRuntimeController();
    const snap = ctrl.getSnapshot();
    const rpcUrl = payload.rpcUrl ?? STELLAR_SOROBAN_TESTNET_RPC;
    const request: {
      operation: typeof payload.operation;
      poolContract: string;
      amountStroops: string;
      recipient?: string;
    } = {
      operation: payload.operation,
      poolContract: payload.poolContract,
      amountStroops: payload.amountStroops,
    };
    if (payload.recipient) request.recipient = payload.recipient;

    const gate = {
      mode: snap.mode,
      connected: snap.connected,
      selected: payload.enabled,
    };

    // Prefer an explicitly registered local/test pool; otherwise proxy only when
    // the host announced write_pool_ready (RO session alone cannot execute).
    let pool = getSppPrivatePool();
    if (!pool) {
      const host = getSppHostLifecycle();
      if (host.state === 'write_pool_ready') {
        pool = createSppHostPoolProxy({
          rpcUrl,
          nymMode: snap.mode,
          nymConnected: snap.connected,
          poolContract: payload.poolContract,
          send: createChromeRuntimeSppHostSender(),
        });
      }
    }

    return executeSppPrivatePayment({
      gate,
      request,
      rpcUrl,
      nymFetch: ctrl.getStellarFetch(),
      pool,
      preferInjectedTransport: true,
    });
  };
}
