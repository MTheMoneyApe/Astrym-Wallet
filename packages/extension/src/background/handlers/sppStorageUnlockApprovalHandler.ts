import browser from 'webextension-polyfill';
import type { KeyManager } from '@solanym/wallet-core/src/keyManager/KeyManager.js';
import {
  approveSppStorageUnlockRequest,
  parseSppStorageUnlockMessage,
  sppStorageUnlockOriginFromUrl,
} from '@solanym/wallet-core/src/stellar/spp/sppStorageUnlockGate.js';
import {
  SPP_AUTO_PREPARE_INTENT_KEY,
  SPP_PREPARE_STATUS_KEY,
  type SppAutoPrepareIntent,
  type SppPrepareStatus,
} from '../../shared/sppPrepareStatus.js';
import type { ValidatedRequestPayload, ValidatedResponsePayload } from '../../shared/ipcTypes.js';
import { getNymRuntimeController } from '../nym/NymRuntimeController.js';
import { resolveActiveStellarAddress } from '../spp/sppBoundAccount.js';
import { isSppHostDocumentSender } from '../trustedWalletOrigin.js';

/** Explicit one-shot consent for the encrypted OPFS database key, separate from SPP KDF approval. */
export function createSppStorageUnlockApprovalHandler(deps: { keyManager: KeyManager }) {
  return async (
    payload: ValidatedRequestPayload<'SPP_AUTHORIZE_STORAGE_UNLOCK'>,
    sender?: browser.Runtime.MessageSender,
  ): Promise<ValidatedResponsePayload<'SPP_AUTHORIZE_STORAGE_UNLOCK'>> => {
    if (!sender || sender.id !== browser.runtime.id || !isSppHostDocumentSender(sender)) {
      throw Object.assign(new Error('Storage unlock consent must originate from the Astrym SPP host.'), {
        name: 'UNAUTHORIZED',
      });
    }

    const nym = getNymRuntimeController().getSnapshot();
    if (nym.mode !== 'nym' || !nym.connected) {
      throw Object.assign(new Error('Connect Nym before unlocking SPP storage.'), { name: 'NYM_REQUIRED' });
    }

    const challenge = parseSppStorageUnlockMessage(payload.message);
    let senderOrigin: string | null = null;
    try {
      senderOrigin = sender.url ? sppStorageUnlockOriginFromUrl(sender.url) : null;
    } catch {
      senderOrigin = null;
    }
    if (!challenge || challenge.origin !== senderOrigin) {
      throw Object.assign(new Error('Storage unlock message is malformed or belongs to another origin.'), {
        name: 'INVALID_REQUEST',
      });
    }

    const [stored, storedIntent] = await Promise.all([
      browser.storage.local.get(SPP_PREPARE_STATUS_KEY),
      browser.storage.local.get(SPP_AUTO_PREPARE_INTENT_KEY),
    ]);
    const status = stored[SPP_PREPARE_STATUS_KEY] as SppPrepareStatus | undefined;
    const intent = storedIntent[SPP_AUTO_PREPARE_INTENT_KEY] as SppAutoPrepareIntent | undefined;
    if (
      status?.phase !== 'initializing_session' ||
      status.generation !== payload.prepareGeneration ||
      intent?.autoRun !== true ||
      intent.generation !== payload.prepareGeneration
    ) {
      throw Object.assign(new Error('Storage unlock belongs to a stale or inactive SPP initialization.'), {
        name: 'UNAUTHORIZED',
      });
    }

    const { address } = await resolveActiveStellarAddress(deps.keyManager);
    if (challenge.account !== address) {
      throw Object.assign(new Error('Storage unlock account does not match the active Stellar account.'), {
        name: 'UNAUTHORIZED',
      });
    }

    const approvalToken = approveSppStorageUnlockRequest({
      account: address,
      message: payload.message,
      prepareGeneration: payload.prepareGeneration,
      uses: payload.uses,
    });
    if (!approvalToken) {
      throw Object.assign(new Error('Storage unlock consent is already used or does not match this request.'), {
        name: 'UNAUTHORIZED',
      });
    }
    return { approved: true, approvalToken };
  };
}
