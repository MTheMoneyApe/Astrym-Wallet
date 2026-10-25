import { TransactionClient } from '@solanym/wallet-core/src/solana/transaction/TransactionClient.js';
import browser from 'webextension-polyfill';
import { VaultService } from '@solanym/wallet-core/src/vault/VaultService.js';
import { PasswordUnlocker } from '@solanym/wallet-core/src/vault/PasswordUnlocker.js';
import { ChromePersistentStorage } from '@solanym/wallet-core/src/vault/ChromePersistentStorage.js';
import { ChromeSessionStorage } from '@solanym/wallet-core/src/vault/ChromeSessionStorage.js';
import { KeyManager } from '@solanym/wallet-core/src/keyManager/KeyManager.js';
import { SoftwareSigner } from '@solanym/wallet-core/src/signer/SoftwareSigner.js';
import { ChromeAccountStorage } from '@solanym/wallet-core/src/keyManager/ChromeAccountStorage.js';
import { AccountService } from '@solanym/wallet-core/src/solana/accounts/AccountService.js';
import { createOffscreenNymTransport } from './transport/OffscreenNymTransport.js';
import { resolveNetworkConfig } from '@solanym/wallet-core/src/solana/rpc/endpoints.js';
import { createRpcClient } from '@solanym/wallet-core/src/solana/rpc/RpcClient.js';
import { SolanaReadClient } from '@solanym/wallet-core/src/solana/read/SolanaReadClient.js';
import { ChromeAlarmService } from './alarms/ChromeAlarmService.js';
import { MessageRouter } from './MessageRouter.js';
import { stateCoordinator } from './StateCoordinator.js';
import { activeAccountManager } from './accounts/ActiveAccountManager.js';

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
  createGetAccountsHandler, 
  createGetBalanceHandler,
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
import { createReviewTransferHandler, createSendTransferHandler } from './handlers/transactionHandlers.js';

function initBackgroundSynchronous() {
  // 1. Initialize Chrome Adapters synchronously
  const alarmService = new ChromeAlarmService();
  const persistentStorage = new ChromePersistentStorage(browser.storage.local);
  const sessionStorage = new ChromeSessionStorage(browser.storage.session as any);
  const accountStorage = new ChromeAccountStorage(browser.storage.local);

  // 2. Initialize Core Services synchronously
  const unlocker = new PasswordUnlocker();
  const vaultService = new VaultService(unlocker, persistentStorage, sessionStorage, alarmService);
  const signer = new SoftwareSigner(vaultService);
  const keyManager = new KeyManager(signer, accountStorage);
  const accountService = new AccountService(keyManager);
  
  const config = resolveNetworkConfig('https://api.devnet.solana.com');
  const transport = createOffscreenNymTransport(config);
  const rpcClient = createRpcClient(transport);
  const readClient = new SolanaReadClient(rpcClient);

  // Expose globally for dappHandlers
  (globalThis as any).keyManager = keyManager;

  const txClient = new TransactionClient(rpcClient, keyManager, { sign: (index, data) => signer.signTransaction(data, index) });
  (globalThis as any).txClient = txClient;
  (globalThis as any).vaultService = vaultService;
  (globalThis as any).accountService = accountService;

  // 3. Initialize Message Router synchronously
  const router = new MessageRouter();
  router.registerHandler('GET_WALLET_STATE', createGetWalletStateHandler(vaultService));
  router.registerHandler('CREATE_VAULT', createCreateVaultHandler(vaultService, keyManager));
  router.registerHandler('IMPORT_VAULT', createImportVaultHandler(vaultService, keyManager));
  router.registerHandler('UNLOCK_VAULT', createUnlockVaultHandler(vaultService));
  router.registerHandler('LOCK_VAULT', createLockVaultHandler(vaultService));
  router.registerHandler('RESET_WALLET', createResetWalletHandler(vaultService));
  router.registerHandler('REVEAL_RECOVERY_PHRASE', createRevealRecoveryPhraseHandler(vaultService));

  router.registerHandler('GET_ACCOUNTS', createGetAccountsHandler(accountService));
  router.registerHandler('GET_BALANCE', createGetBalanceHandler(readClient));
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

  router.registerHandler('REVIEW_TRANSFER', createReviewTransferHandler(txClient) as any);
  router.registerHandler('SEND_TRANSFER', createSendTransferHandler(txClient) as any);

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
      await vaultService.tryRestoreFromSession();
      stateCoordinator.setUnlocked(); 
    } catch (e) {}
  })();

  // 5. Bind to Chrome runtime messaging synchronously
  browser.runtime.onMessage.addListener(async (message: any, sender: any) => {
    try {
      await initPromise;
    } catch (e) {
      // Safe guard against unhandled init exceptions crashing routing
    }
    return router.routeMessage(message, sender);
  });
}

// Start the background worker synchronously
initBackgroundSynchronous();
