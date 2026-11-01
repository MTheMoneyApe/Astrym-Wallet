import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createHttpTransport: vi.fn(),
  handlers: new Map<string, (...args: any[]) => unknown>(),
  addRuntimeListener: vi.fn(),
  storageGet: vi.fn(),
  storageRemove: vi.fn(),
  initializeHolistic: vi.fn(),
  enterErrorState: vi.fn(),
  setUnlocked: vi.fn(),
  initializeActiveAccountManager: vi.fn(),
  vaultLock: vi.fn(),
  tryRestoreFromSession: vi.fn(),
  stellarFetch: vi.fn(),
  StellarTransactionClient: vi.fn(),
}));

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: { onMessage: { addListener: mocks.addRuntimeListener } },
    storage: {
      local: { get: mocks.storageGet, remove: mocks.storageRemove },
      session: {},
    },
  },
}));

vi.mock('@solanym/wallet-core/src/vault/VaultService.js', () => ({
  VaultService: class {
    async hasVault() {
      return false;
    }
    async lock() {
      return mocks.vaultLock();
    }
    async tryRestoreFromSession() {
      return mocks.tryRestoreFromSession();
    }
  },
}));

vi.mock('@solanym/wallet-core/src/vault/PasswordUnlocker.js', () => ({
  PasswordUnlocker: class {},
}));

vi.mock('@solanym/wallet-core/src/vault/ChromePersistentStorage.js', () => ({
  ChromePersistentStorage: class {},
}));

vi.mock('@solanym/wallet-core/src/vault/ChromeSessionStorage.js', () => ({
  ChromeSessionStorage: class {},
}));

vi.mock('@solanym/wallet-core/src/keyManager/KeyManager.js', () => ({
  KeyManager: class {},
}));

vi.mock('@solanym/wallet-core/src/signer/SoftwareSigner.js', () => ({
  SoftwareSigner: class {
    async signTransaction() {}
  },
}));

vi.mock('@solanym/wallet-core/src/keyManager/ChromeAccountStorage.js', () => ({
  ChromeAccountStorage: class {
    async loadState() {
      return { idempotencyMap: {} };
    }
  },
}));

vi.mock('@solanym/wallet-core/src/solana/accounts/AccountService.js', () => ({
  AccountService: class {},
}));

vi.mock('@solanym/wallet-core/src/solana/transaction/TransactionClient.js', () => ({
  TransactionClient: class {},
}));

vi.mock('@solanym/wallet-core/src/solana/transport/HttpTransport.js', () => ({
  createHttpTransport: mocks.createHttpTransport,
}));

vi.mock('@solanym/wallet-core', () => ({
  StellarTransactionClient: mocks.StellarTransactionClient,
  StrKey: {
    isValidEd25519PublicKey: vi.fn(),
  },
}));

vi.mock('@solana/kit', () => ({
  getBase58Decoder: vi.fn(() => ({
    decode: vi.fn(),
  })),
}));

vi.mock('@solanym/wallet-core/src/stellar/accounts/StellarAccountService.js', () => ({
  StellarAccountService: class {},
}));

vi.mock('@solanym/wallet-core/src/stellar/read/StellarReadClient.js', () => ({
  STELLAR_TESTNET_HORIZON_URL: 'https://horizon-testnet.stellar.org',
  STELLAR_TESTNET_FRIENDBOT_URL: 'https://friendbot.stellar.org',
  StellarReadClient: class {},
}));

vi.mock('@stellar/stellar-sdk', () => ({
  Networks: {
    TESTNET: 'Test SDF Network ; September 2015',
    PUBLIC: 'Public Global Stellar Network ; September 2015',
  },
}));

vi.mock('../../src/background/nym/NymRuntimeController.js', () => ({
  getNymRuntimeController: () => ({
    getStellarFetch: () => mocks.stellarFetch,
  }),
}));

vi.mock('../../src/background/alarms/ChromeAlarmService.js', () => ({
  ChromeAlarmService: class {},
}));

vi.mock('../../src/background/MessageRouter.js', () => ({
  MessageRouter: class {
    registerHandler(type: string, handler: (...args: any[]) => unknown) {
      mocks.handlers.set(type, handler);
    }
    async routeMessage() {}
  },
}));

vi.mock('../../src/background/StateCoordinator.js', () => ({
  stateCoordinator: {
    initializeHolistic: mocks.initializeHolistic,
    enterErrorState: mocks.enterErrorState,
    setUnlocked: mocks.setUnlocked,
  },
}));

vi.mock('../../src/background/accounts/ActiveAccountManager.js', () => ({
  activeAccountManager: {
    initialize: mocks.initializeActiveAccountManager,
  },
}));

vi.mock('../../src/background/handlers/vaultHandlers.js', () => ({
  createUnlockVaultHandler: vi.fn(() => vi.fn()),
  createLockVaultHandler: vi.fn(() => vi.fn()),
  createGetWalletStateHandler: vi.fn(() => vi.fn()),
  createCreateVaultHandler: vi.fn(() => vi.fn()),
  createImportVaultHandler: vi.fn(() => vi.fn()),
  createResetWalletHandler: vi.fn(() => vi.fn()),
  createRevealRecoveryPhraseHandler: vi.fn(() => vi.fn()),
}));

vi.mock('../../src/background/handlers/dappHandlers.js', () => ({
  handleDappConnect: vi.fn(),
  handleDappDisconnect: vi.fn(),
  handleDappSignTransaction: vi.fn(),
  handleGetPendingApprovals: vi.fn(),
  handleApprovePendingRequest: vi.fn(),
}));

vi.mock('../../src/background/handlers/transactionHandlers.js', () => ({
  createConfirmTransferHandler: vi.fn(() => vi.fn()),
  createEstimateTransferHandler: vi.fn(() => vi.fn()),
  createReviewTransferHandler: vi.fn(() => vi.fn()),
  createSendTransferHandler: vi.fn(() => vi.fn()),
  TransferConfirmationTracker: class {},
  createEstimateStellarTransferHandler: vi.fn(() => vi.fn()),
  createReviewStellarTransferHandler: vi.fn(() => vi.fn()),
  createSendStellarTransferHandler: vi.fn(() => vi.fn()),
  createConfirmStellarTransferHandler: vi.fn(() => vi.fn()),
  StellarTransferConfirmationTracker: class {},
}));

describe('background RPC composition', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.storageGet.mockResolvedValue({});
    mocks.initializeHolistic.mockResolvedValue(undefined);
    mocks.enterErrorState.mockReturnValue(undefined);
    mocks.initializeActiveAccountManager.mockResolvedValue(undefined);
    mocks.vaultLock.mockResolvedValue(undefined);
    mocks.tryRestoreFromSession.mockResolvedValue(true);
    mocks.setUnlocked.mockReturnValue(undefined);
  });

  it('clears any prior session key on startup and never restores it automatically', async () => {
    mocks.createHttpTransport.mockReturnValue(vi.fn());
    await import('../../src/background/index.js');

    const listenerCall = mocks.addRuntimeListener.mock.calls[0];
    if (!listenerCall) throw new Error('expected runtime onMessage listener registration');
    const onMessage = listenerCall[0];
    await onMessage({ id: 'startup-test', type: 'GET_WALLET_STATE' }, {});

    expect(mocks.vaultLock).toHaveBeenCalledOnce();
    expect(mocks.tryRestoreFromSession).not.toHaveBeenCalled();
    expect(mocks.setUnlocked).not.toHaveBeenCalled();
  });

  it('keeps startup in error state if session cleanup fails without attempting restoration', async () => {
    mocks.vaultLock.mockRejectedValueOnce(new Error('session cleanup failed'));
    mocks.createHttpTransport.mockReturnValue(vi.fn());
    await import('../../src/background/index.js');

    const listenerCall = mocks.addRuntimeListener.mock.calls[0];
    if (!listenerCall) throw new Error('expected runtime onMessage listener registration');
    const onMessage = listenerCall[0];
    const response = await onMessage({ id: 'startup-test', type: 'GET_WALLET_STATE' }, {});

    expect(response.error.name).toBe('BackgroundInitializationError');
    expect(mocks.enterErrorState).toHaveBeenCalledOnce();
    expect(mocks.tryRestoreFromSession).not.toHaveBeenCalled();
  });

  it('does NOT initialize active Solana runtime and HTTP transport on startup', async () => {
    await import('../../src/background/index.js');

    expect(mocks.createHttpTransport).not.toHaveBeenCalled();
  });

  it('wires nymRuntime.getStellarFetch() to StellarTransactionClient', async () => {
    await import('../../src/background/index.js');

    expect(mocks.StellarTransactionClient).toHaveBeenCalledWith(
      'https://horizon-testnet.stellar.org',
      expect.anything(),
      expect.anything(),
      'Test SDF Network ; September 2015',
      mocks.stellarFetch,
    );
  });

  it('rejects Solana IPC transfer endpoints with typed disabled runtime error', async () => {
    await import('../../src/background/index.js');

    const solanaEndpoints = [
      'GET_BALANCE',
      'ESTIMATE_TRANSFER',
      'REVIEW_TRANSFER',
      'SEND_TRANSFER',
      'CONFIRM_TRANSFER',
      'GET_PENDING_APPROVALS',
      'APPROVE_DAPP_REQUEST',
    ];

    for (const endpoint of solanaEndpoints) {
      const handler = mocks.handlers.get(endpoint);
      expect(handler, `Expected handler registered for ${endpoint}`).toBeDefined();
      await expect(handler!({})).rejects.toThrow(
        `Solana runtime is disabled (${endpoint}). Astrym Wallet operates in Stellar-first mode.`,
      );
    }
  });

  it('rejects Solana dApp endpoints with typed disabled dApp error', async () => {
    await import('../../src/background/index.js');

    const dappEndpoints = [
      'DAPP_CONNECT',
      'DAPP_DISCONNECT',
      'DAPP_SIGN_TRANSACTION',
    ];

    for (const endpoint of dappEndpoints) {
      const handler = mocks.handlers.get(endpoint);
      expect(handler, `Expected handler registered for ${endpoint}`).toBeDefined();
      await expect(handler!({})).rejects.toThrow(
        `Solana dApp operations (${endpoint}) are disabled. Astrym Wallet operates in Stellar-first mode.`,
      );
    }
  });
});
