import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addRuntimeListener: vi.fn(),
  createHttpTransport: vi.fn(),
  storageLocalGet: vi.fn(async (key: string) =>
    mocks.localStorage.has(key) ? { [key]: mocks.localStorage.get(key) } : {},
  ),
  localStorage: new Map<string, unknown>(),
  sendXlm: vi.fn(),
  reviewXlmTransfer: vi.fn(),
  confirmTransaction: vi.fn(),
  stellarFetch: vi.fn(),
}));

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: {
      id: 'test-extension',
      getURL: (path: string) => `chrome-extension://test-extension${path}`,
      onMessage: { addListener: mocks.addRuntimeListener },
    },
    notifications: { create: vi.fn() },
    storage: {
      local: {
        get: mocks.storageLocalGet,
        set: vi.fn(async (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) mocks.localStorage.set(key, value);
        }),
        remove: vi.fn(async (key: string) => {
          mocks.localStorage.delete(key);
        }),
      },
      session: {
        get: vi.fn(async () => ({})),
        remove: vi.fn(async () => undefined),
      },
    },
  },
}));

vi.mock('@solanym/wallet-core', () => ({
  StellarTransactionClient: class {
    reviewXlmTransfer = mocks.reviewXlmTransfer;
    sendXlm = mocks.sendXlm;
    confirmTransaction = mocks.confirmTransaction;
  },
  SESSION_UNCERTAIN_KEY: 'solanym_uncertain_tx_v1',
  StrKey: { isValidEd25519PublicKey: vi.fn(() => true) },
}));

vi.mock('@stellar/stellar-sdk', () => ({
  Networks: {
    TESTNET: 'Test SDF Network ; September 2015',
    PUBLIC: 'Public Global Stellar Network ; September 2015',
  },
}));

vi.mock('@solanym/wallet-core/src/vault/VaultService.js', () => ({
  VaultService: class {
    isLocked = true;
    async hasVault() {
      return true;
    }
    async lock() {}
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
  SoftwareSigner: class {},
}));

vi.mock('@solanym/wallet-core/src/keyManager/ChromeAccountStorage.js', () => ({
  ChromeAccountStorage: class {
    async loadState() {
      return { idempotencyMap: {} };
    }
  },
}));

vi.mock('@solanym/wallet-core/src/stellar/accounts/StellarAccountService.js', () => ({
  StellarAccountService: class {},
}));

vi.mock('@solanym/wallet-core/src/stellar/read/StellarReadClient.js', () => ({
  STELLAR_TESTNET_HORIZON_URL: 'https://horizon-testnet.stellar.org',
  STELLAR_TESTNET_FRIENDBOT_URL: 'https://friendbot.stellar.org',
  StellarReadClient: class {},
}));

vi.mock('@solanym/wallet-core/src/solana/transport/HttpTransport.js', () => ({
  createHttpTransport: mocks.createHttpTransport,
}));

vi.mock('../../src/background/alarms/ChromeAlarmService.js', () => ({
  ChromeAlarmService: class {},
}));

vi.mock('../../src/background/nym/NymRuntimeController.js', () => ({
  getNymRuntimeController: () => ({
    getStellarFetch: () => mocks.stellarFetch,
    restorePreference: async () => undefined,
  }),
}));

vi.mock('../../src/background/accounts/ActiveAccountManager.js', () => ({
  activeAccountManager: { initialize: vi.fn(async () => undefined) },
}));

vi.mock('../../src/background/handlers/vaultHandlers.js', () => ({
  createGetWalletStateHandler: () => async () => ({ hasVault: true, isLocked: true }),
  createUnlockVaultHandler: vi.fn(() => vi.fn()),
  createLockVaultHandler: vi.fn(() => vi.fn()),
  createCreateVaultHandler: vi.fn(() => vi.fn()),
  createImportVaultHandler: vi.fn(() => vi.fn()),
  createResetWalletHandler: vi.fn(() => vi.fn()),
  createRevealRecoveryPhraseHandler: vi.fn(() => vi.fn()),
}));

vi.mock('../../src/background/handlers/autoLockHandlers.js', () => ({
  createGetAutoLockTimeoutHandler: vi.fn(() => vi.fn()),
  createRecordUserActivityHandler: vi.fn(() => vi.fn()),
  createSetAutoLockTimeoutHandler: vi.fn(() => vi.fn()),
}));

vi.mock('../../src/background/handlers/accountHandlers.js', () => ({
  createGetAccountsHandler: vi.fn(() => vi.fn()),
  createGetActiveAccountHandler: vi.fn(() => vi.fn()),
  createGetStellarBalanceHandler: vi.fn(() => vi.fn()),
  createFundStellarTestnetHandler: vi.fn(() => vi.fn()),
  createAddAccountHandler: vi.fn(() => vi.fn()),
  createSetActiveAccountHandler: vi.fn(() => vi.fn()),
  createRenameAccountHandler: vi.fn(() => vi.fn()),
}));

vi.mock('../../src/background/handlers/nymHandlers.js', () => ({
  createNymConfigureGatewayHandler: vi.fn(() => vi.fn()),
  createNymConnectHandler: vi.fn(() => vi.fn()),
  createNymDisconnectHandler: vi.fn(() => vi.fn()),
  createNymLiveSmokeHandler: vi.fn(() => vi.fn()),
  createNymHttpSmokeHandler: vi.fn(() => vi.fn()),
  createNymPublicDataFetchHandler: vi.fn(() => vi.fn()),
  createNymStellarHorizonProbeHandler: vi.fn(() => vi.fn()),
  createNymSetStellarHorizonEndpointHandler: vi.fn(() => vi.fn()),
  createNymRemoveGatewayHandler: vi.fn(() => vi.fn()),
  createNymRequestGatewayPermissionHandler: vi.fn(() => vi.fn()),
  createNymSelectGatewayHandler: vi.fn(() => vi.fn()),
  createNymSetModeHandler: vi.fn(() => vi.fn()),
  createNymStatusHandler: vi.fn(() => vi.fn()),
}));

describe('durable uncertain submission startup integration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.localStorage.clear();
    mocks.storageLocalGet.mockClear();
    mocks.sendXlm.mockReset();
    mocks.reviewXlmTransfer.mockReset();
    mocks.confirmTransaction.mockReset();
    mocks.stellarFetch.mockReset();
    mocks.createHttpTransport.mockReturnValue(vi.fn());
  });

  it('restores a durable record before IPC, rejects a new submission, and makes no network request', async () => {
    const record = {
      schemaVersion: 1,
      txHash: 'a'.repeat(64),
      accountIndex: 0,
      sourceAddress: 'G'.padEnd(56, 'A'),
      destinationAddress: 'G'.padEnd(56, 'B'),
      amountXlm: '1.0000000',
      approvedFeeStroops: 100,
      expectedSequence: '123',
      maxTime: 0,
      submittedAt: 1,
      lastProbeAt: 1,
      status: 'SUBMISSION_UNKNOWN',
    } as const;
    mocks.localStorage.set('solanym_uncertain_tx_v1', record);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await import('../../src/background/index.js');

    const listenerCall = mocks.addRuntimeListener.mock.calls[0];
    if (!listenerCall) throw new Error('expected runtime onMessage listener registration');
    const onMessage = listenerCall[0];
    const sender = {
      id: 'test-extension',
      url: 'chrome-extension://test-extension/popup.html',
    };

    const statusResponse = await onMessage(
      { id: 'startup-state', type: 'GET_WALLET_STATE', payload: {} },
      sender,
    );
    expect(statusResponse).toMatchObject({
      id: 'startup-state',
      type: 'GET_WALLET_STATE',
      payload: { hasVault: true, isLocked: true },
    });

    const { stateCoordinator } = await import('../../src/background/StateCoordinator.js');
    expect(mocks.storageLocalGet).toHaveBeenCalledWith('solanym_uncertain_tx_v1');
    expect(await Promise.all(mocks.storageLocalGet.mock.results.map((result) => result.value))).toContainEqual({
      'solanym_uncertain_tx_v1': record,
    });
    expect(stateCoordinator.state).toBe('LOCKED');
    expect(stateCoordinator.getUncertainContext()).toEqual({
      accountIndex: record.accountIndex,
      txHash: record.txHash,
    });
    stateCoordinator.setUnlocked();
    expect(stateCoordinator.state).toBe('UNCERTAIN_TRANSACTION');

    const { transferManager } = await import('../../src/background/handlers/transactionHandlers.js');
    const reviewId = transferManager.createReview(
      {
        accountIndex: record.accountIndex,
        destination: record.destinationAddress,
        amountXlm: record.amountXlm,
      },
      { approvedFeeStroops: record.approvedFeeStroops },
    );
    const sendResponse = await onMessage(
      {
        id: 'blocked-stellar-send',
        type: 'SEND_STELLAR_TRANSFER',
        payload: { id: reviewId },
      },
      sender,
    );

    expect(sendResponse).toMatchObject({
      id: 'blocked-stellar-send',
      type: 'SEND_STELLAR_TRANSFER',
      error: {
        name: 'Error',
        message: expect.stringContaining('UNCERTAIN_TRANSACTION'),
      },
    });
    expect(mocks.sendXlm).not.toHaveBeenCalled();
    expect(mocks.reviewXlmTransfer).not.toHaveBeenCalled();
    expect(mocks.confirmTransaction).not.toHaveBeenCalled();
    expect(mocks.stellarFetch).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocks.localStorage.get('solanym_uncertain_tx_v1')).toEqual(record);
    expect(stateCoordinator.state).toBe('UNCERTAIN_TRANSACTION');
    expect(stateCoordinator.getUncertainContext()?.txHash).toBe(record.txHash);
    expect(JSON.stringify({ statusResponse, sendResponse, record })).not.toMatch(
      /signedXdr|privateKey|seedPhrase|secret seed/i,
    );
    fetchSpy.mockRestore();
  });
});
