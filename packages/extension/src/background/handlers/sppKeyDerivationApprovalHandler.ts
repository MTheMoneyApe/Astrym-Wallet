/**
 * One-shot user approval for the exact SPP v3 privacy-key derivation signature.
 * This does not enable Testnet broadcasts or approve any Soroban transaction.
 */

import browser from 'webextension-polyfill';
import type { KeyManager } from '@solanym/wallet-core/src/keyManager/KeyManager.js';
import {
  approveSppKeyDerivationRequest,
} from '@solanym/wallet-core/src/stellar/spp/sppSignGate.js';
import {
  getNethermindPublicTestnetContractConfig,
} from '@solanym/wallet-core/src/stellar/spp/nethermind/nethermindPublicTestnet.js';
import {
  parseSppContractConfig,
} from '@solanym/wallet-core/src/stellar/spp/sppContractConfig.js';
import {
  SPP_AUTO_PREPARE_INTENT_KEY,
  SPP_CONTRACT_CONFIG_KEY,
  SPP_PREPARE_STATUS_KEY,
  type SppAutoPrepareIntent,
  type SppPrepareStatus,
} from '../../shared/sppPrepareStatus.js';
import type {
  ValidatedRequestPayload,
  ValidatedResponsePayload,
} from '../../shared/ipcTypes.js';
import { getNymRuntimeController } from '../nym/NymRuntimeController.js';
import { resolveActiveStellarAddress } from '../spp/sppBoundAccount.js';
import { isTrustedWalletPageUrl } from '../trustedWalletOrigin.js';

export function createSppKeyDerivationApprovalHandler(deps: {
  keyManager: KeyManager;
}) {
  return async (
    payload: ValidatedRequestPayload<'SPP_AUTHORIZE_KEY_DERIVATION'>,
    sender?: browser.Runtime.MessageSender,
  ): Promise<ValidatedResponsePayload<'SPP_AUTHORIZE_KEY_DERIVATION'>> => {
    if (
      !sender ||
      sender.id !== browser.runtime.id ||
      !isTrustedWalletPageUrl(sender.url)
    ) {
      throw Object.assign(
        new Error('KDF approval must originate from the trusted Astrym wallet UI.'),
        { name: 'UNAUTHORIZED' },
      );
    }

    const nym = getNymRuntimeController().getSnapshot();
    if (nym.mode !== 'nym' || !nym.connected) {
      throw Object.assign(
        new Error('Connect Nym before approving SPP key derivation.'),
        { name: 'NYM_REQUIRED' },
      );
    }

    const [storedStatus, storedIntent] = await Promise.all([
      browser.storage.local.get(SPP_PREPARE_STATUS_KEY),
      browser.storage.local.get(SPP_AUTO_PREPARE_INTENT_KEY),
    ]);
    const status = storedStatus[SPP_PREPARE_STATUS_KEY] as SppPrepareStatus | undefined;
    const intent = storedIntent[SPP_AUTO_PREPARE_INTENT_KEY] as SppAutoPrepareIntent | undefined;
    if (
      payload.prepareGeneration !== status?.generation ||
      intent?.autoRun !== true ||
      intent.generation !== payload.prepareGeneration
    ) {
      throw Object.assign(new Error('KDF approval belongs to a stale SPP preparation.'), { name: 'UNAUTHORIZED' });
    }
    if (status?.phase !== 'initializing_write_pool' || !Number.isSafeInteger(status.generation) || status.generation <= 0) {
      throw Object.assign(
        new Error('No active SPP key-derivation request is waiting for approval.'),
        { name: 'UNAUTHORIZED' },
      );
    }

    const storedConfig = await browser.storage.local.get(SPP_CONTRACT_CONFIG_KEY);
    const rawConfig = storedConfig[SPP_CONTRACT_CONFIG_KEY];
    const config = rawConfig
      ? parseSppContractConfig(rawConfig)
      : getNethermindPublicTestnetContractConfig();
    const kdfDomain = config.kdf_domain;
    if (payload.kdfDomain !== kdfDomain) {
      throw Object.assign(
        new Error('KDF domain does not match the currently selected Testnet deployment.'),
        { name: 'INVALID_REQUEST' },
      );
    }

    const { address } = await resolveActiveStellarAddress(deps.keyManager);
    const [latest, latestIntent, latestNym, latestAccount] = await Promise.all([
      browser.storage.local.get(SPP_PREPARE_STATUS_KEY),
      browser.storage.local.get(SPP_AUTO_PREPARE_INTENT_KEY),
      Promise.resolve(getNymRuntimeController().getSnapshot()),
      resolveActiveStellarAddress(deps.keyManager),
    ]);
    const latestStatus = latest[SPP_PREPARE_STATUS_KEY] as SppPrepareStatus | undefined;
    const activeIntent = latestIntent[SPP_AUTO_PREPARE_INTENT_KEY] as SppAutoPrepareIntent | undefined;
    if (
      latestStatus?.phase !== 'initializing_write_pool' ||
      latestStatus.generation !== status.generation ||
      activeIntent?.autoRun !== true ||
      activeIntent.generation !== status.generation ||
      latestNym.mode !== 'nym' ||
      !latestNym.connected ||
      latestAccount.address !== address
    ) {
      throw Object.assign(new Error('SPP preparation or active account changed before KDF approval.'), {
        name: 'UNAUTHORIZED',
      });
    }
    const accepted = approveSppKeyDerivationRequest(address, kdfDomain, status.generation);
    if (!accepted) {
      throw Object.assign(
        new Error('A key-derivation approval is already pending or was just submitted.'),
        { name: 'UNAUTHORIZED' },
      );
    }

    return { approved: true };
  };
}
