import browser from 'webextension-polyfill';
import { VaultService } from '@solanym/wallet-core/src/vault/VaultService.js';
import { PasswordUnlocker } from '@solanym/wallet-core/src/vault/PasswordUnlocker.js';
import { ChromePersistentStorage } from '@solanym/wallet-core/src/vault/ChromePersistentStorage.js';
import { ChromeSessionStorage } from '@solanym/wallet-core/src/vault/ChromeSessionStorage.js';
import { KeyManager } from '@solanym/wallet-core/src/keyManager/KeyManager.js';
import { SoftwareSigner } from '@solanym/wallet-core/src/signer/SoftwareSigner.js';
import { ChromeAccountStorage } from '@solanym/wallet-core/src/keyManager/ChromeAccountStorage.js';

import { AccountService } from '@solanym/wallet-core/src/solana/accounts/AccountService.js';
import { createHttpTransport } from '@solanym/wallet-core/src/solana/transport/HttpTransport.js';
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
  createResetWalletHandler
} from './handlers/vaultHandlers.js';
import { 
  createGetAccountsHandler, 
  createGetBalanceHandler,
  createAddAccountHandler,
  createSetActiveAccountHandler,
  createRenameAccountHandler
} from './handlers/accountHandlers.js';

async function initBackground() {
  // 1. Initialize Chrome Adapters
  const alarmService = new ChromeAlarmService();
  const persistentStorage = new ChromePersistentStorage(browser.storage.local);
  const sessionStorage = new ChromeSessionStorage(browser.storage.session as any);
  const accountStorage = new ChromeAccountStorage(browser.storage.local);

  // 2. Initialize Core Services
  const unlocker = new PasswordUnlocker();
  const vaultService = new VaultService(unlocker, persistentStorage, sessionStorage, alarmService);
  const signer = new SoftwareSigner(vaultService);
  const keyManager = new KeyManager(signer, accountStorage);
  const accountService = new AccountService(keyManager);
  
  const config = resolveNetworkConfig('https://api.devnet.solana.com');
  const transport = createHttpTransport(config);
  const rpcClient = createRpcClient(transport);
  const readClient = new SolanaReadClient(rpcClient);

  // Expose globally for dappHandlers
  (globalThis as any).keyManager = keyManager;

  const { TransactionClient } = await import('@solanym/wallet-core/src/solana/transaction/TransactionClient.js');
  const txClient = new TransactionClient(rpcClient, keyManager, { sign: (index, data) => signer.signTransaction(data, index) });
  (globalThis as any).txClient = txClient;
  (globalThis as any).vaultService = vaultService;
  (globalThis as any).accountService = accountService;

  // Perform Holistic Validation
  const hasVault = await vaultService.hasVault();
  let hasValidAccounts = false;
  let hasOrphanedIntent = false;

  try {
    const state = await accountStorage.loadState();
    hasValidAccounts = true; // Schema is valid if loadState didn't throw
    
    // Check if there is an orphaned intent
    const _intentData = await browser.storage.local.get('solanym_add_account_intent');
    const solanym_add_account_intent = (_intentData as Record<string, string>)['solanym_add_account_intent'];
    if (solanym_add_account_intent) {
      if (state.idempotencyMap[solanym_add_account_intent] !== undefined) {
        // Not orphaned, final commit succeeded, just the intent cleanup failed
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

  // Import dapp handlers
  const { 
    handleDappConnect, 
    handleDappDisconnect, 
    handleDappSignTransaction,
    handleGetPendingApprovals,
    handleApprovePendingRequest
  } = await import('./handlers/dappHandlers.js');

  // 3. Initialize Message Router
  const router = new MessageRouter();
  router.registerHandler('GET_WALLET_STATE', createGetWalletStateHandler(vaultService));
  router.registerHandler('CREATE_VAULT', createCreateVaultHandler(vaultService, keyManager));
  router.registerHandler('IMPORT_VAULT', createImportVaultHandler(vaultService, keyManager));
  router.registerHandler('UNLOCK_VAULT', createUnlockVaultHandler(vaultService));
  router.registerHandler('LOCK_VAULT', createLockVaultHandler(vaultService));
  router.registerHandler('RESET_WALLET', createResetWalletHandler(vaultService));

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

  const { createReviewTransferHandler, createSendTransferHandler } = await import('./handlers/transactionHandlers.js');
  router.registerHandler('REVIEW_TRANSFER', createReviewTransferHandler(txClient) as any);
  router.registerHandler('SEND_TRANSFER', createSendTransferHandler(txClient) as any);

  // 4. Bind to Chrome runtime messaging
  browser.runtime.onMessage.addListener(async (message: any, sender: any) => {
    return router.routeMessage(message, sender);
  });

  // 5. Attempt session restoration on SW startup
  try {
    await vaultService.tryRestoreFromSession();
    stateCoordinator.setUnlocked(); // Only set unlocked if restoration works and state is locked
  } catch (e) {
    // Ignore errors for session restoration
  }
}

// Start the background worker
initBackground().catch(() => {
  // Silent fail - service worker shouldn't crash unhandled.
});




