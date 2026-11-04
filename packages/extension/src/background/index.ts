import { StellarTransactionClient } from '@solanym/wallet-core';
import { Networks } from '@stellar/stellar-sdk';
import browser from 'webextension-polyfill';
import { VaultService } from '@solanym/wallet-core/src/vault/VaultService.js';
import { PasswordUnlocker } from '@solanym/wallet-core/src/vault/PasswordUnlocker.js';
import { ChromePersistentStorage } from '@solanym/wallet-core/src/vault/ChromePersistentStorage.js';
import { ChromeSessionStorage } from '@solanym/wallet-core/src/vault/ChromeSessionStorage.js';
import { KeyManager } from '@solanym/wallet-core/src/keyManager/KeyManager.js';
import { SoftwareSigner } from '@solanym/wallet-core/src/signer/SoftwareSigner.js';
import { ChromeAccountStorage } from '@solanym/wallet-core/src/keyManager/ChromeAccountStorage.js';
import { StellarAccountService } from '@solanym/wallet-core/src/stellar/accounts/StellarAccountService.js';
import {
  STELLAR_TESTNET_FRIENDBOT_URL,
  STELLAR_TESTNET_HORIZON_URL,
  StellarReadClient,
} from '@solanym/wallet-core/src/stellar/read/StellarReadClient.js';
import { ChromeAlarmService } from './alarms/ChromeAlarmService.js';
import { MessageRouter } from './MessageRouter.js';
import { stateCoordinator } from './StateCoordinator.js';
import { activeAccountManager } from './accounts/ActiveAccountManager.js';
import { getNymRuntimeController } from './nym/NymRuntimeController.js';
import {
  createNymConfigureGatewayHandler,
  createNymConnectHandler,
  createNymDisconnectHandler,
  createNymLiveSmokeHandler,
  createNymHttpSmokeHandler,
  createNymPublicDataFetchHandler,
  createNymStellarHorizonProbeHandler,
  createNymSetStellarHorizonEndpointHandler,
  createNymRemoveGatewayHandler,
  createNymRequestGatewayPermissionHandler,
  createNymSelectGatewayHandler,
  createNymSetModeHandler,
  createNymStatusHandler,
} from './handlers/nymHandlers.js';
import { isNymOffscreenChannelMessage } from '../nym-offscreen/protocol.js';
import {
  isSppHostBridgeMessage,
  parseSppHostLifecycleEvent,
  parseSppHostNymFetchRequest,
  parseSppHostSignRequest,
} from '../shared/sppHostBridge.js';
import { createSppPrivatePaymentHandler } from './handlers/sppPrivatePaymentHandler.js';
import { noteSppHostLifecycle } from './spp/sppPrivatePoolRegistry.js';
import {
  handleSppHostNymFetchRequest,
  handleSppHostSignRequest,
} from './spp/sppHostBridgeHandlers.js';

import { 
  createUnlockVaultHandler, 
  createLockVaultHandler,
  createGetWalletStateHandler,
  createCreateVaultHandler,
  createImportVaultHandler,
  createResetWalletHandler,
  createRevealRecoveryPhraseHandler
} from './handlers/vaultHandlers.js';
import {
  createGetAutoLockTimeoutHandler,
  createRecordUserActivityHandler,
  createSetAutoLockTimeoutHandler,
} from './handlers/autoLockHandlers.js';
import { 
  createGetAccountsHandler, 
  createGetActiveAccountHandler,
  createGetStellarBalanceHandler,
  createFundStellarTestnetHandler,
  createAddAccountHandler,
  createSetActiveAccountHandler,
  createRenameAccountHandler
} from './handlers/accountHandlers.js';

// Founder Decision A: Solana dApp handlers disabled in Stellar-first mode.
// Source preserved in ./handlers/dappHandlers.js but not imported or routed.
import {
  createConfirmStellarTransferHandler,
  createEstimateStellarTransferHandler,
  createReviewStellarTransferHandler,
  createSendStellarTransferHandler,
  StellarTransferConfirmationTracker,
} from './handlers/transactionHandlers.js';

function initBackgroundSynchronous() {
  // 1. Initialize Chrome Adapters synchronously
  const alarmService = new ChromeAlarmService((lock) => stateCoordinator.runLockOperation(lock));
  const persistentStorage = new ChromePersistentStorage(browser.storage.local);
  const sessionStorage = new ChromeSessionStorage(browser.storage.session as any);
  const accountStorage = new ChromeAccountStorage(browser.storage.local);

  // 2. Initialize Core Services synchronously
  const unlocker = new PasswordUnlocker();
  const vaultService = new VaultService(unlocker, persistentStorage, sessionStorage, alarmService);
  const signer = new SoftwareSigner(vaultService, 'stellar');
  const keyManager = new KeyManager(signer, accountStorage);
  const accountService = new StellarAccountService(keyManager);
  const nymRuntime = getNymRuntimeController();
  // CDP / live-smoke harness may call connect via this handle (no vault access).
  (globalThis as any).nymRuntime = nymRuntime;

  // Stellar Horizon/Friendbot → FailClosedTransportRouter via MixFetch-aware adapter.
  // Logical Horizon base = SDF testnet. In mode=nym, getStellarFetch() remaps to the
  // validated effective base (default Ankr) — see stellarHorizonNymConfig.ts. No silent
  // clearnet fallback. Default router mode starts as 'nym' (Nym-first). Direct requires explicit user action.
  const stellarFetch = nymRuntime.getStellarFetch();
  const stellarReadClient = new StellarReadClient(
    STELLAR_TESTNET_HORIZON_URL,
    STELLAR_TESTNET_FRIENDBOT_URL,
    90_000,
    stellarFetch,
  );

  // Both Stellar read and transaction clients use the exact same Nym-aware transport.
  // Missing transport causes immediate failure. Never silently bypasses to clearnet default.
  const stellarTxClient = new StellarTransactionClient(
    STELLAR_TESTNET_HORIZON_URL,
    keyManager,
    signer,
    Networks.TESTNET,
    stellarFetch,
  );

  // Expose globally for testing/harness access
  (globalThis as any).keyManager = keyManager;
  (globalThis as any).txClient = undefined; // Solana client disabled
  (globalThis as any).stellarTxClient = stellarTxClient;
  (globalThis as any).vaultService = vaultService;
  (globalThis as any).accountService = accountService;

  // 3. Initialize Message Router synchronously
  const router = new MessageRouter();
  router.registerHandler('GET_WALLET_STATE', createGetWalletStateHandler(vaultService));
  router.registerHandler('CREATE_VAULT', createCreateVaultHandler(vaultService, keyManager, accountService, activeAccountManager));
  router.registerHandler('IMPORT_VAULT', createImportVaultHandler(vaultService, keyManager, accountService, activeAccountManager));
  router.registerHandler('UNLOCK_VAULT', createUnlockVaultHandler(vaultService));
  router.registerHandler('LOCK_VAULT', createLockVaultHandler(vaultService));
  router.registerHandler('GET_AUTO_LOCK_TIMEOUT', createGetAutoLockTimeoutHandler(alarmService));
  router.registerHandler('SET_AUTO_LOCK_TIMEOUT', createSetAutoLockTimeoutHandler(alarmService, vaultService));
  router.registerHandler('RECORD_USER_ACTIVITY', createRecordUserActivityHandler(vaultService));
  router.registerHandler('RESET_WALLET', createResetWalletHandler(vaultService));
  router.registerHandler('REVEAL_RECOVERY_PHRASE', createRevealRecoveryPhraseHandler(vaultService));

  router.registerHandler('GET_ACCOUNTS', createGetAccountsHandler(accountService));
  router.registerHandler('GET_ACTIVE_ACCOUNT', createGetActiveAccountHandler(accountService));
  router.registerHandler('GET_STELLAR_BALANCE', createGetStellarBalanceHandler(stellarReadClient));
  router.registerHandler('FUND_STELLAR_TESTNET_ACCOUNT', createFundStellarTestnetHandler(stellarReadClient));
  router.registerHandler('ADD_ACCOUNT', createAddAccountHandler(keyManager));
  router.registerHandler('SET_ACTIVE_ACCOUNT', createSetActiveAccountHandler(accountService));
  router.registerHandler('RENAME_ACCOUNT', createRenameAccountHandler(keyManager));

  // Founder Decision A: Solana runtime is disabled; source preserved in packages/wallet-core/src/solana/.
  // Solana RPC transports, clients, and confirmation trackers are not instantiated on startup.
  const createDisabledSolanaHandler = (opName: string) => async () => {
    throw new Error(`Solana runtime is disabled (${opName}). Astrym Wallet operates in Stellar-first mode.`);
  };

  router.registerHandler('GET_BALANCE', createDisabledSolanaHandler('GET_BALANCE') as any);
  router.registerHandler('ESTIMATE_TRANSFER', createDisabledSolanaHandler('ESTIMATE_TRANSFER') as any);
  router.registerHandler('REVIEW_TRANSFER', createDisabledSolanaHandler('REVIEW_TRANSFER') as any);
  router.registerHandler('SEND_TRANSFER', createDisabledSolanaHandler('SEND_TRANSFER') as any);
  router.registerHandler('CONFIRM_TRANSFER', createDisabledSolanaHandler('CONFIRM_TRANSFER') as any);

  // Register DApp routes (Solana dApp operations disabled per Founder Decision A)
  const createDisabledDappHandler = (opName: string) => async () => {
    throw new Error(`Solana dApp operations (${opName}) are disabled. Astrym Wallet operates in Stellar-first mode.`);
  };
  router.registerHandler('DAPP_CONNECT', createDisabledDappHandler('DAPP_CONNECT') as any);
  router.registerHandler('DAPP_DISCONNECT', createDisabledDappHandler('DAPP_DISCONNECT') as any);
  router.registerHandler('DAPP_SIGN_TRANSACTION', createDisabledDappHandler('DAPP_SIGN_TRANSACTION') as any);
  
  // Register popup approval routes (Solana approval/signing disabled per Founder Decision A)
  // APPROVE_DAPP_REQUEST contains reachable Solana signTransaction code paths; disabled fail-closed.
  router.registerHandler('GET_PENDING_APPROVALS', createDisabledSolanaHandler('GET_PENDING_APPROVALS') as any);
  router.registerHandler('APPROVE_DAPP_REQUEST', createDisabledSolanaHandler('APPROVE_DAPP_REQUEST') as any);

  const stellarTransferConfirmationTracker = new StellarTransferConfirmationTracker(stellarTxClient);
  router.registerHandler('ESTIMATE_STELLAR_TRANSFER', createEstimateStellarTransferHandler(stellarTxClient) as any);
  router.registerHandler('REVIEW_STELLAR_TRANSFER', createReviewStellarTransferHandler(stellarTxClient) as any);
  router.registerHandler('SEND_STELLAR_TRANSFER', createSendStellarTransferHandler(stellarTxClient, stellarTransferConfirmationTracker) as any);
  router.registerHandler('CONFIRM_STELLAR_TRANSFER', createConfirmStellarTransferHandler(stellarTransferConfirmationTracker) as any);

  router.registerHandler('SPP_PRIVATE_PAYMENT', createSppPrivatePaymentHandler());
  router.registerHandler('NYM_CONNECT', createNymConnectHandler());
  router.registerHandler('NYM_DISCONNECT', createNymDisconnectHandler());
  router.registerHandler('NYM_STATUS', createNymStatusHandler());
  router.registerHandler('NYM_SET_MODE', createNymSetModeHandler());
  router.registerHandler('NYM_CONFIGURE_GATEWAY', createNymConfigureGatewayHandler());
  router.registerHandler('NYM_SELECT_GATEWAY', createNymSelectGatewayHandler());
  router.registerHandler('NYM_REMOVE_GATEWAY', createNymRemoveGatewayHandler());
  router.registerHandler('NYM_REQUEST_GATEWAY_PERMISSION', createNymRequestGatewayPermissionHandler());
  router.registerHandler('NYM_LIVE_SMOKE', createNymLiveSmokeHandler());
  router.registerHandler('NYM_HTTP_SMOKE', createNymHttpSmokeHandler());
  router.registerHandler('NYM_PUBLIC_DATA_FETCH', createNymPublicDataFetchHandler());
  router.registerHandler('NYM_STELLAR_HORIZON_PROBE', createNymStellarHorizonProbeHandler());
  router.registerHandler(
    'NYM_SET_STELLAR_HORIZON_ENDPOINT',
    createNymSetStellarHorizonEndpointHandler(),
  );

  // 4. Start async state initialization but DO NOT await it here
  const initPromise = (async () => {
    const hasVault = await vaultService.hasVault();
    let hasValidAccounts = false;
    let hasOrphanedIntent = false;

    try {
      const state = await accountStorage.loadState();
      hasValidAccounts = true;
      
      const _intentData = await browser.storage.local.get('solanym_add_account_intent');
      const solanym_add_account_intent = (_intentData as Record<string, string>)['solanym_add_account_intent'];
      if (solanym_add_account_intent) {
        if (state.idempotencyMap[solanym_add_account_intent] !== undefined) {
          await browser.storage.local.remove('solanym_add_account_intent');
        } else {
          hasOrphanedIntent = true;
        }
      }
    } catch (e) {
      hasValidAccounts = false;
    }

    await stateCoordinator.initializeHolistic(hasVault, hasValidAccounts, hasOrphanedIntent);
    await activeAccountManager.initialize();

    try {
      // A restarted MV3 worker always requires password unlock. Do not trust
      // a session key left behind by a failed or interrupted lock operation.
      await vaultService.lock();
    } catch {
      stateCoordinator.enterErrorState();
      throw new Error('Wallet could not be safely locked during background startup');
    }
  })();

  // 5. Bind to Chrome runtime messaging synchronously.
  // Sync early-return for Nym offscreen channel so this listener does not
  // claim the response Promise (offscreen document owns that protocol).
  browser.runtime.onMessage.addListener((message: any, sender: any) => {
    if (isNymOffscreenChannelMessage(message)) {
      return;
    }
    // spp-host ↔ SW bridge: lifecycle events update the registry; sign + Nym
    // fetch are answered here; execute requests are answered by the host page.
    if (isSppHostBridgeMessage(message)) {
      const lifecycle = parseSppHostLifecycleEvent(message);
      if (lifecycle) {
        noteSppHostLifecycle({
          state: lifecycle.state,
          ...(lifecycle.message !== undefined ? { message: lifecycle.message } : {}),
        });
        return Promise.resolve({ ok: true });
      }
      const signRequest = parseSppHostSignRequest(message);
      if (signRequest) {
        return (async () => {
          try {
            await initPromise;
          } catch {
            return {
              channel: signRequest.channel,
              type: 'SPP_HOST_SIGN_RESULT',
              id: signRequest.id,
              ok: false,
              code: 'VAULT_LOCKED',
              message: 'Wallet background initialization failed; unlock and retry.',
            };
          }
          return handleSppHostSignRequest(signRequest, {
            signer,
            keyManager,
            networkPassphrase: Networks.TESTNET,
          });
        })();
      }
      const nymFetchRequest = parseSppHostNymFetchRequest(message);
      if (nymFetchRequest) {
        return handleSppHostNymFetchRequest(nymFetchRequest);
      }
      // Execute requests: do not claim; host page owns replies.
      return;
    }
    return (async () => {
      try {
        await initPromise;
      } catch {
        const request = typeof message === 'object' && message !== null
          ? message as { id?: unknown; type?: unknown }
          : {};
        return {
          id: typeof request.id === 'string' ? request.id : 'UNKNOWN',
          type: typeof request.type === 'string' ? request.type : 'ERROR',
          error: {
            name: 'BackgroundInitializationError',
            message: 'Wallet background initialization failed; restart the extension and unlock again.',
          },
        };
      }
      return router.routeMessage(message, sender);
    })();
  });
}

// Start the background worker synchronously
initBackgroundSynchronous();
