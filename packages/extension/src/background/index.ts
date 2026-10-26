import { TransactionClient } from '@solanym/wallet-core/src/solana/transaction/TransactionClient.js';
import { StellarTransactionClient } from '@solanym/wallet-core';
import browser from 'webextension-polyfill';
import { VaultService } from '@solanym/wallet-core/src/vault/VaultService.js';
import { PasswordUnlocker } from '@solanym/wallet-core/src/vault/PasswordUnlocker.js';
import { ChromePersistentStorage } from '@solanym/wallet-core/src/vault/ChromePersistentStorage.js';
import { ChromeSessionStorage } from '@solanym/wallet-core/src/vault/ChromeSessionStorage.js';
import { KeyManager } from '@solanym/wallet-core/src/keyManager/KeyManager.js';
import { SoftwareSigner } from '@solanym/wallet-core/src/signer/SoftwareSigner.js';
import { ChromeAccountStorage } from '@solanym/wallet-core/src/keyManager/ChromeAccountStorage.js';
import { AccountService } from '@solanym/wallet-core/src/solana/accounts/AccountService.js';
import { StellarAccountService } from '@solanym/wallet-core/src/stellar/accounts/StellarAccountService.js';
import {
  STELLAR_TESTNET_FRIENDBOT_URL,
  STELLAR_TESTNET_HORIZON_URL,
  StellarReadClient,
} from '@solanym/wallet-core/src/stellar/read/StellarReadClient.js';
import { createHttpTransport } from '@solanym/wallet-core/src/solana/transport/HttpTransport.js';
import { resolveNetworkConfig } from '@solanym/wallet-core/src/solana/rpc/endpoints.js';
import { createRpcClient } from '@solanym/wallet-core/src/solana/rpc/RpcClient.js';
import { SolanaReadClient } from '@solanym/wallet-core/src/solana/read/SolanaReadClient.js';
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
  createGetBalanceHandler,
  createGetStellarBalanceHandler,
  createFundStellarTestnetHandler,
  createAddAccountHandler,
  createSetActiveAccountHandler,
  createRenameAccountHandler
} from './handlers/accountHandlers.js';

import { 
  handleDappConnect, 
  handleDappDisconnect, 
  handleDappSignTransaction,
  handleGetPendingApprovals,
  handleApprovePendingRequest
} from './handlers/dappHandlers.js';
import {
  createConfirmTransferHandler,
  createEstimateTransferHandler,
  createReviewTransferHandler,
  createSendTransferHandler,
  TransferConfirmationTracker,
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
  // clearnet fallback. Default router mode stays 'direct' until Connect / setMode('nym').
  const stellarReadClient = new StellarReadClient(
    STELLAR_TESTNET_HORIZON_URL,
    STELLAR_TESTNET_FRIENDBOT_URL,
    90_000,
    nymRuntime.getStellarFetch(),
  );
  
  const config = resolveNetworkConfig('https://api.devnet.solana.com');
  const transport = createHttpTransport(config);
  const rpcClient = createRpcClient(transport);
  const readClient = new SolanaReadClient(rpcClient);

  // Expose globally for dappHandlers
  (globalThis as any).keyManager = keyManager;

  const txClient = new TransactionClient(rpcClient, keyManager, { sign: (index, data) => signer.signTransaction(data, index) });
  const stellarTxClient = new StellarTransactionClient(undefined, keyManager, signer);
  (globalThis as any).txClient = txClient;
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
  router.registerHandler('GET_BALANCE', createGetBalanceHandler(readClient));
  router.registerHandler('GET_STELLAR_BALANCE', createGetStellarBalanceHandler(stellarReadClient));
  router.registerHandler('FUND_STELLAR_TESTNET_ACCOUNT', createFundStellarTestnetHandler(stellarReadClient));
  router.registerHandler('ADD_ACCOUNT', createAddAccountHandler(keyManager));
  router.registerHandler('SET_ACTIVE_ACCOUNT', createSetActiveAccountHandler(accountService));
  router.registerHandler('RENAME_ACCOUNT', createRenameAccountHandler(keyManager));

  // Register DApp routes
  router.registerHandler('DAPP_CONNECT', handleDappConnect as any);
  router.registerHandler('DAPP_DISCONNECT', handleDappDisconnect as any);
  router.registerHandler('DAPP_SIGN_TRANSACTION', handleDappSignTransaction as any);
  
  // Register popup approval routes
  router.registerHandler('GET_PENDING_APPROVALS', handleGetPendingApprovals as any);
  router.registerHandler('APPROVE_DAPP_REQUEST', handleApprovePendingRequest as any);

  const transferConfirmationTracker = new TransferConfirmationTracker(txClient);
  router.registerHandler('ESTIMATE_TRANSFER', createEstimateTransferHandler(txClient) as any);
  router.registerHandler('REVIEW_TRANSFER', createReviewTransferHandler(txClient) as any);
  router.registerHandler('SEND_TRANSFER', createSendTransferHandler(txClient, transferConfirmationTracker) as any);
  router.registerHandler('CONFIRM_TRANSFER', createConfirmTransferHandler(transferConfirmationTracker) as any);

  const stellarTransferConfirmationTracker = new StellarTransferConfirmationTracker(stellarTxClient);
  router.registerHandler('ESTIMATE_STELLAR_TRANSFER', createEstimateStellarTransferHandler(stellarTxClient) as any);
  router.registerHandler('REVIEW_STELLAR_TRANSFER', createReviewStellarTransferHandler(stellarTxClient) as any);
  router.registerHandler('SEND_STELLAR_TRANSFER', createSendStellarTransferHandler(stellarTxClient, stellarTransferConfirmationTracker) as any);
  router.registerHandler('CONFIRM_STELLAR_TRANSFER', createConfirmStellarTransferHandler(stellarTransferConfirmationTracker) as any);

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
