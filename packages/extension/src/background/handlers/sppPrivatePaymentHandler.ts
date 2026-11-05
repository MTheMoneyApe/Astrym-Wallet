import { Networks } from '@stellar/stellar-sdk';
import browser from 'webextension-polyfill';
import {
  STELLAR_SOROBAN_TESTNET_RPC,
  executeSppPrivatePayment,
} from '@solanym/wallet-core/src/stellar/spp/sppNymOption.js';
import { maxFeeStroopsForOperation } from '@solanym/wallet-core/src/stellar/spp/sppFeePolicy.js';
import { mintSppSignApproval } from '@solanym/wallet-core/src/stellar/spp/sppSignGate.js';
import type { KeyManager } from '@solanym/wallet-core/src/keyManager/KeyManager.js';
import type { ValidatedRequestPayload, ValidatedResponsePayload } from '../../shared/ipcTypes.js';
import { getNymRuntimeController } from '../nym/NymRuntimeController.js';
import { isTrustedWalletPageUrl } from '../trustedWalletOrigin.js';
import { resolveActiveStellarAddress } from '../spp/sppBoundAccount.js';
import {
  createChromeRuntimeSppHostSender,
  createSppHostPoolProxy,
} from '../spp/sppHostPoolProxy.js';
import { getSppPrivatePool, getSppHostLifecycle } from '../spp/sppPrivatePoolRegistry.js';

export function createSppPrivatePaymentHandler(deps: { keyManager: KeyManager }) {
  return async (
    payload: ValidatedRequestPayload<'SPP_PRIVATE_PAYMENT'>,
    sender?: browser.Runtime.MessageSender,
  ): Promise<ValidatedResponsePayload<'SPP_PRIVATE_PAYMENT'>> => {
    if (!sender || sender.id !== browser.runtime.id || !isTrustedWalletPageUrl(sender.url)) {
      throw Object.assign(
        new Error('SPP payment approval must originate from trusted wallet UI'),
        { name: 'UNAUTHORIZED' },
      );
    }
    const { address } = await resolveActiveStellarAddress(deps.keyManager);
    const maxFeeStroops = payload.maxFeeStroops ?? maxFeeStroopsForOperation(payload.operation);
    mintSppSignApproval({
      operation: payload.operation,
      amountStroops: payload.amountStroops,
      recipient: payload.operation === 'deposit' ? null : (payload.recipient ?? null),
      networkPassphrase: Networks.TESTNET,
      poolContractId: payload.poolContract,
      registryContractId: null,
      tokenContractId: null,
      maxFeeStroops,
      minResourceFeeStroops: null,
      account: address,
      exactMessage: null,
    });
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
          ...(payload.signingAccount ? { signingAccount: payload.signingAccount } : {}),
          ...(payload.freshSequence ? { freshSequence: payload.freshSequence } : {}),
          ...(payload.nextFreshSequence
            ? { nextFreshSequence: payload.nextFreshSequence }
            : {}),
          operationFingerprint: payload.authorizationFingerprint,
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
      authorizationFingerprint: payload.authorizationFingerprint,
      maxFeeStroops,
    });
  };
}
