import { address } from '@solana/kit';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { handleDappSignTransaction, handleApprovePendingRequest, permissionManager, pendingManager } from '../../src/background/handlers/dappHandlers.js';
import { activeAccountManager } from '../../src/background/accounts/ActiveAccountManager.js';
import { stateCoordinator } from '../../src/background/StateCoordinator.js';
import { TransactionValidator } from '@solanym/wallet-core/src/solana/transaction/TransactionValidator.js';

vi.mock('@solana/kit', () => {
  return {
    address: (val: string) => val as any,
    getBase58Decoder: () => ({
      decode: (bytes: Uint8Array) => bytes[0] === 1 ? 'Account0Address' : 'Account1Address'
    }),
    getBase58Encoder: () => ({
      encode: (str: string) => new Uint8Array([1,2,3])
    })
  };
});

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: {
      id: 'test-extension-id',
      getURL: () => 'popup.html'
    },
    windows: {
      getAll: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({})
    }
  }
}));

describe('dappHandlers security', () => {
  let mockSender: any;
  let mockAccountService: any;
  
  beforeEach(async () => {
    // Match signingResetConcurrency / transfer-handler convention: approve/sign
    // paths require READY. Default StateCoordinator state is INITIALIZING.
    (stateCoordinator as any)._state = 'READY';
    (stateCoordinator as any)._resetEpoch = 1;
    (stateCoordinator as any)._isResetting = false;
    (stateCoordinator as any)._activeSignatures = new Map();
    (stateCoordinator as any)._signatureDrainResolvers = [];
    (stateCoordinator as any)._lockRequested = false;
    (stateCoordinator as any)._lockOperation = null;

    mockSender = { url: 'https://dapp.com' };
    
    (globalThis as any).vaultService = {
      isLocked: false,
      hasVault: vi.fn().mockResolvedValue(true)
    };
    
    mockAccountService = {
      getAccounts: vi.fn().mockResolvedValue([
        { address: 'Account0Address', index: 0 },
        { address: 'Account1Address', index: 1 }
      ])
    };
    (globalThis as any).accountService = mockAccountService;

    (globalThis as any).keyManager = {
      getAccounts: vi.fn().mockResolvedValue([
        { publicKey: new Uint8Array([1,2,3]), index: 0, address: 'Account0Address' },
        { publicKey: new Uint8Array([4,5,6]), index: 1, address: 'Account1Address' }
      ])
    };
    
    // Initialize activeAccountManager for tests
    const browser = (await import('webextension-polyfill')).default;
    (browser.storage as any) = { local: { get: vi.fn().mockResolvedValue({ solanym_active_index: 0 }), set: vi.fn(), remove: vi.fn() } };
    await activeAccountManager.initialize();
    (globalThis as any).txClient = {
      signTransaction: vi.fn().mockResolvedValue({
        signature: 'fake-sig',
        transactionBase64: 'fake-tx'
      })
    };
    
    vi.spyOn(permissionManager, 'isTrusted').mockResolvedValue(true);
    
    // Fake the validator to avoid base64 decoding complexity in this specific test
    vi.spyOn(TransactionValidator.prototype, 'validateExternalTransaction').mockImplementation((base64: string) => {
      return {
        sourceAddress: address(base64 === 'tx-from-0' ? 'Account0Address' : 'Account1Address'),
        destinationAddress: address('DestAddress'),
        lamports: 1000n,
        messageBytes: new Uint8Array([1, 2, 3])
      };
    });

    // Reset active account by spying on the actual property used, or mocking the public methods
    vi.spyOn(activeAccountManager, 'getActiveAccountIndex').mockReturnValue(1);
    vi.spyOn(activeAccountManager, 'getActiveAccountPublicKey').mockResolvedValue('Account1Address');
  });

  it('Test 1 — Cross-account dApp signing MUST fail', async () => {
    // Wallet has Account 0 and Account 1.
    // Account 1 is the active account.
    // dApp submits transaction from Account 0.
    const createReqSpy = vi.spyOn(pendingManager, 'createSignRequest');

    await expect(handleDappSignTransaction({
      transactionBase64: 'tx-from-0'
    } as any, mockSender)).rejects.toThrow('does not match the active wallet account');

    expect(createReqSpy).not.toHaveBeenCalled();
    expect((globalThis as any).txClient.signTransaction).not.toHaveBeenCalled();
  });

  it('Test 2 — Active account signing succeeds', async () => {
    // Account 1 is active.
    // dApp submits transaction from Account 1.
    const createReqSpy = vi.spyOn(pendingManager, 'createSignRequest').mockResolvedValue({
      signature: 'fake-sig',
      transactionBase64: 'fake-tx'
    });

    const result = await handleDappSignTransaction({
      transactionBase64: 'tx-from-1'
    } as any, mockSender);

    expect(result.signature).toBe('fake-sig');
    expect(createReqSpy).toHaveBeenCalled();
  });

  it('Test 3 — TOCTOU: Account changes after request creation MUST bind to captured account', async () => {
    // 1. Account 0 is active initially.
    vi.spyOn(activeAccountManager, 'getActiveAccountIndex').mockReturnValue(0);
    vi.spyOn(activeAccountManager, 'getActiveAccountPublicKey').mockResolvedValue('Account0Address');

    // 2. A valid transaction from Account 0 creates a pending request.
    const createReqSpy = vi.spyOn(pendingManager, 'createSignRequest').mockResolvedValue({ signature: 'fake', transactionBase64: 'fake' });
    
    await handleDappSignTransaction({
      transactionBase64: 'tx-from-0'
    } as any, mockSender);

    expect(createReqSpy).toHaveBeenCalledWith(
      'https://dapp.com', 
      expect.anything(), 
      expect.anything(), 
      0, // Captured trusted index is 0
      'Account0Address' // Captured trusted public key
    );

    // 3. User opens popup, switches active account to Account 1
    vi.spyOn(activeAccountManager, 'getActiveAccountIndex').mockReturnValue(1);
    vi.spyOn(activeAccountManager, 'getActiveAccountPublicKey').mockResolvedValue('Account1Address');

    // 4. Manually mock the state inside PendingRequestManager
    vi.spyOn(pendingManager, 'getPendingSign').mockReturnValue({
      internalRequestId: 'req-1',
      origin: 'https://dapp.com',
      review: { account: 'Account0Address', destination: 'Dest', amountLamports: '10', estimatedFeeLamports: '5000', program: 'System Program (Transfer)' },
      messageBytes: new Uint8Array([1,2,3]),
      accountIndex: 0,
      expectedPublicKey: 'Account0Address',
      expiresAt: Date.now() + 1000
    } as any);

    // 5. User approves the request
    await handleApprovePendingRequest({ approved: true, id: 'req-1' } as any, mockSender);

    // 6. Outcome MUST be that Account 0 signs using the captured index, ignoring the active account change.
    // Third arg is the StateCoordinator lease assert callback (assertSignatureActive).
    expect((globalThis as any).txClient.signTransaction).toHaveBeenCalledWith(
      0,
      new Uint8Array([1, 2, 3]),
      expect.any(Function),
    );
  });

  it('Test 6 — Invalid active account fails closed', async () => {
    // Set active account to an index that doesn't exist (e.g. 999) using private accessor for testing
    (activeAccountManager as any)._activeAccountIndex = 999;
    
    // Un-mock so it actually runs its logic and fails
    vi.spyOn(activeAccountManager, 'getActiveAccountPublicKey').mockRestore();
    vi.spyOn(activeAccountManager, 'getActiveAccountIndex').mockRestore();

    await expect(handleDappSignTransaction({
      transactionBase64: 'tx-from-999'
    } as any, mockSender)).rejects.toThrow('Trusted active account index 999 not found in wallet metadata');

    // Restore for other tests if necessary
    (activeAccountManager as any)._activeAccountIndex = 0;
  });

  it('Test C — Captured account identity mismatch', async () => {
    // A pending request captures Account 0.
    vi.spyOn(pendingManager, 'getPendingSign').mockReturnValue({
      internalRequestId: 'req-1',
      origin: 'https://dapp.com',
      review: { account: 'Account0Address', destination: 'Dest', amountLamports: '10', estimatedFeeLamports: '5000', program: 'System Program (Transfer)' },
      messageBytes: new Uint8Array([1,2,3]),
      accountIndex: 0,
      expectedPublicKey: 'Account0Address',
      expiresAt: Date.now() + 1000
    } as any);

    // The metadata associated with its captured index is changed/inconsistent before approval
    (globalThis as any).keyManager.getAccounts.mockResolvedValue([
      { publicKey: new Uint8Array([9,9,9]), index: 0, address: 'ChangedAddress0' } // No longer matches Account0Address
    ]);

    const rejectSpy = vi.spyOn(pendingManager, 'rejectSign');

    // It returns success: true to the popup, but internally rejects the signing request
    await handleApprovePendingRequest({ approved: true, id: 'req-1' } as any, mockSender);
    
    expect(rejectSpy).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Identity mismatch') }), 'req-1');
    expect((globalThis as any).txClient.signTransaction).not.toHaveBeenCalled();
  });

  it('Test D — Tampered pending request (mutable byte array)', async () => {
    vi.spyOn(activeAccountManager, 'getActiveAccountIndex').mockReturnValue(0);
    vi.spyOn(activeAccountManager, 'getActiveAccountPublicKey').mockResolvedValue('Account0Address');
    vi.spyOn(pendingManager, 'getPendingSign').mockRestore(); // Restore mock from Test C

    // The dApp supplies a Uint8Array
    const mutableBytes = new Uint8Array([1, 2, 3]);
    
    vi.spyOn(TransactionValidator.prototype, 'validateExternalTransaction').mockImplementation(() => {
      return {
        sourceAddress: address('Account0Address'),
        destinationAddress: address('DestAddress'),
        lamports: 1000n,
        messageBytes: mutableBytes
      };
    });

    vi.spyOn(pendingManager, 'createSignRequest').mockRestore(); // use real implementation

    // Manually create the pending request to avoid awaiting handleDappSignTransaction which blocks
    const approvalPromise = pendingManager.createSignRequest(
      'https://dapp.com',
      { account: 'Account0Address', destination: 'Dest', amountLamports: '10', estimatedFeeLamports: '5000', program: 'System Program (Transfer)' },
      mutableBytes,
      0,
      'Account0Address'
    );

    // Now the dApp mutates the array
    mutableBytes[0] = 99;

    // Approve the request
    const pending = pendingManager.getPendingSign()!;
    await handleApprovePendingRequest({ approved: true, id: pending.internalRequestId } as any, mockSender);
    
    await approvalPromise;

    // The signed bytes must be the original, NOT the mutated one
    expect((globalThis as any).txClient.signTransaction).toHaveBeenCalledWith(
      0,
      new Uint8Array([1, 2, 3]),
      expect.any(Function),
    );
  });

  it('Test D2 — Returned object and byte-array mutation via getPendingSign', async () => {
    vi.spyOn(activeAccountManager, 'getActiveAccountIndex').mockReturnValue(0);
    vi.spyOn(activeAccountManager, 'getActiveAccountPublicKey').mockResolvedValue('Account0Address');
    vi.spyOn(pendingManager, 'getPendingSign').mockRestore();

    vi.spyOn(TransactionValidator.prototype, 'validateExternalTransaction').mockImplementation(() => {
      return {
        sourceAddress: address('Account0Address'),
        destinationAddress: address('DestAddress'),
        lamports: 1000n,
        messageBytes: new Uint8Array([1, 2, 3])
      };
    });

    // Create the request manually
    const approvalPromise = pendingManager.createSignRequest(
      'https://dapp.com',
      { account: 'Account0Address', destination: 'Dest', amountLamports: '10', estimatedFeeLamports: '5000', program: 'System Program (Transfer)' },
      new Uint8Array([1, 2, 3]),
      0,
      'Account0Address'
    );

    // Retrieve the pending request
    const pending = pendingManager.getPendingSign()!;
    
    // Mutate the returned object (Test A)
    pending.accountIndex = 999;
    
    // Mutate the returned byte array (Test B)
    pending.messageBytes[0] = 99;
    
    // Mutate the review object (Test C)
    pending.review.account = 'SpoofedAddress';
    pending.review.amountLamports = '99999999';

    // Retrieve again to assert internals are unchanged
    const pendingAgain = pendingManager.getPendingSign()!;
    expect(pendingAgain.accountIndex).toBe(0);
    expect(pendingAgain.messageBytes[0]).toBe(1);
    expect(pendingAgain.review.account).toBe('Account0Address');
    expect(pendingAgain.review.amountLamports).toBe('10');

    // Approve the request (Test D)
    await handleApprovePendingRequest({ approved: true, id: pending.internalRequestId } as any, mockSender);
    await approvalPromise;

    // Verify the signer receives the exact original validated message bytes and captured account
    expect((globalThis as any).txClient.signTransaction).toHaveBeenCalledWith(
      0,
      new Uint8Array([1, 2, 3]),
      expect.any(Function),
    );
  });
});




