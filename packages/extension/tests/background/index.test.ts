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

  it('routes the production balance handler through the configured HTTP transport', async () => {
    const transportResponse = {
      jsonrpc: '2.0',
      id: 1,
      result: { context: { slot: 1 }, value: 42n },
    };
    const httpTransport = vi.fn(async ({ payload }) => ({
      ...transportResponse,
      id: payload.id,
    }));
    mocks.createHttpTransport.mockReturnValue(httpTransport);

    await import('../../src/background/index.js');

    const balanceHandler = mocks.handlers.get('GET_BALANCE');
    expect(balanceHandler).toBeDefined();
    await expect(
      balanceHandler!({ address: '83astBRguLMdt2h5U1Tpdq5tjFoJ6noeGwaY3mDLVcri' }),
    ).resolves.toEqual({ lamports: '42' });

    expect(mocks.createHttpTransport).toHaveBeenCalledWith({
      network: 'devnet',
      rpcUrl: 'https://api.devnet.solana.com',
    });
    expect(httpTransport).toHaveBeenCalledOnce();
    const transportCall = httpTransport.mock.calls[0];
    if (!transportCall) throw new Error('expected HTTP transport invocation');
    expect(transportCall[0].payload).toEqual(
      expect.objectContaining({
        jsonrpc: '2.0',
        method: 'getBalance',
        params: [
          '83astBRguLMdt2h5U1Tpdq5tjFoJ6noeGwaY3mDLVcri',
          { commitment: 'confirmed' },
        ],
      }),
    );
  });

  it('propagates a transport error from the registered balance handler without fallback', async () => {
    const transportError = new Error('HTTP transport unavailable');
    const httpTransport = vi.fn().mockRejectedValue(transportError);
    const directFetch = vi.fn();
    vi.stubGlobal('fetch', directFetch);
    mocks.createHttpTransport.mockReturnValue(httpTransport);

    try {
      await import('../../src/background/index.js');
      const balanceHandler = mocks.handlers.get('GET_BALANCE');
      expect(balanceHandler).toBeDefined();
      await expect(
        balanceHandler!({ address: '83astBRguLMdt2h5U1Tpdq5tjFoJ6noeGwaY3mDLVcri' }),
      ).rejects.toThrow('Failed to fetch SOL balance');

      expect(httpTransport).toHaveBeenCalledOnce();
      expect(directFetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  }, 20_000);
});
