import {
  STELLAR_SOROBAN_TESTNET_RPC,
  executeSppPrivatePayment,
} from '@solanym/wallet-core/src/stellar/spp/sppNymOption.js';
import type { ValidatedRequestPayload, ValidatedResponsePayload } from '../../shared/ipcTypes.js';
import { getNymRuntimeController } from '../nym/NymRuntimeController.js';
import { getSppPrivatePool } from '../spp/sppPrivatePoolRegistry.js';

export function createSppPrivatePaymentHandler() {
  return async (
    payload: ValidatedRequestPayload<'SPP_PRIVATE_PAYMENT'>,
  ): Promise<ValidatedResponsePayload<'SPP_PRIVATE_PAYMENT'>> => {
    const ctrl = getNymRuntimeController();
    const snap = ctrl.getSnapshot();
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
    return executeSppPrivatePayment({
      gate: {
        mode: snap.mode,
        connected: snap.connected,
        selected: payload.enabled,
      },
      request,
      rpcUrl: payload.rpcUrl ?? STELLAR_SOROBAN_TESTNET_RPC,
      nymFetch: ctrl.getStellarFetch(),
      pool: getSppPrivatePool(),
    });
  };
}
