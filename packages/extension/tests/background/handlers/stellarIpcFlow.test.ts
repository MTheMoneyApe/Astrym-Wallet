import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MessageRouter } from '../../../src/background/MessageRouter.js';
import {
  createEstimateStellarTransferHandler,
  createReviewStellarTransferHandler,
  createSendStellarTransferHandler,
  createConfirmStellarTransferHandler,
  StellarTransferConfirmationTracker,
} from '../../../src/background/handlers/transactionHandlers.js';
import { stateCoordinator } from '../../../src/background/StateCoordinator.js';

const notificationCreate = vi.hoisted(() => vi.fn());

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: { id: 'test', getURL: (path: string) => `chrome-extension://test/${path}` },
    notifications: { create: notificationCreate },
    storage: { local: { get: vi.fn(), set: vi.fn(), remove: vi.fn() } },
  },
}));

describe('Stellar Transfer End-to-End IPC Flow (Mocked Network)', () => {
  const SOURCE_ADDRESS = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
  const DEST_ADDRESS = 'GDOOZOX54XD7PAOHO6EXLH4OZC4JRBU4HLRM5RBD7A2DRBZJFDPFPBRE';

  const mockStellarTxClient = {
    reviewXlmTransfer: vi.fn(),
    sendXlm: vi.fn(),
    confirmTransaction: vi.fn(),
  } as any;

  let router: MessageRouter;
  let tracker: StellarTransferConfirmationTracker;

  beforeEach(() => {
    vi.clearAllMocks();
    (stateCoordinator as any)._state = 'READY';
    (stateCoordinator as any)._activeSignatures = new Map();
    (stateCoordinator as any)._lockRequested = false;
    (stateCoordinator as any)._lockOperation = null;
    notificationCreate.mockResolvedValue('test-notif-id');

    router = new MessageRouter();
    tracker = new StellarTransferConfirmationTracker(mockStellarTxClient);

    router.registerHandler(
      'ESTIMATE_STELLAR_TRANSFER',
      createEstimateStellarTransferHandler(mockStellarTxClient) as any,
    );
    router.registerHandler(
      'REVIEW_STELLAR_TRANSFER',
      createReviewStellarTransferHandler(mockStellarTxClient) as any,
    );
    router.registerHandler(
      'SEND_STELLAR_TRANSFER',
      createSendStellarTransferHandler(mockStellarTxClient, tracker) as any,
    );
    router.registerHandler(
      'CONFIRM_STELLAR_TRANSFER',
      createConfirmStellarTransferHandler(tracker) as any,
    );
  });

  const INTERNAL_SENDER = {
    id: 'test',
    url: 'chrome-extension://test/popup.html',
  };

  it('completes the entire Estimate -> Review -> Send -> Confirm IPC flow', async () => {
    // 1. ESTIMATE_STELLAR_TRANSFER
    mockStellarTxClient.reviewXlmTransfer.mockResolvedValueOnce({
      sourceAddress: SOURCE_ADDRESS,
      destinationAddress: DEST_ADDRESS,
      amountXlm: '25.0',
      feeXlm: '0.0000100',
      feeStroops: 100,
      balanceXlm: '100.0000000',
      destinationExists: true,
      operationType: 'payment',
      memo: 'Test transfer',
    });

    const estimateResponse = await router.routeMessage({
      id: 'req-1',
      type: 'ESTIMATE_STELLAR_TRANSFER',
      payload: {
        accountIndex: 0,
        destination: DEST_ADDRESS,
        amountXlm: '25.0',
        memo: 'Test transfer',
      },
    }, INTERNAL_SENDER);

    expect(estimateResponse.error).toBeUndefined();
    expect(estimateResponse.payload).toEqual({
      sourceAddress: SOURCE_ADDRESS,
      destinationAddress: DEST_ADDRESS,
      amountXlm: '25.0',
      feeXlm: '0.0000100',
      balanceXlm: '100.0000000',
      destinationExists: true,
      operationType: 'payment',
    });

    // 2. REVIEW_STELLAR_TRANSFER
    mockStellarTxClient.reviewXlmTransfer.mockResolvedValueOnce({
      sourceAddress: SOURCE_ADDRESS,
      destinationAddress: DEST_ADDRESS,
      amountXlm: '25.0',
      feeXlm: '0.0000100',
      feeStroops: 100,
      balanceXlm: '100.0000000',
      destinationExists: true,
      operationType: 'payment',
      memo: 'Test transfer',
    });

    const reviewResponse = await router.routeMessage({
      id: 'req-2',
      type: 'REVIEW_STELLAR_TRANSFER',
      payload: {
        accountIndex: 0,
        destination: DEST_ADDRESS,
        amountXlm: '25.0',
        memo: 'Test transfer',
      },
    }, INTERNAL_SENDER);

    expect(reviewResponse.error).toBeUndefined();
    const reviewData = reviewResponse.payload as any;
    expect(reviewData.id).toBeDefined();
    expect(typeof reviewData.id).toBe('string');
    expect(reviewData.amountXlm).toBe('25.0');
    expect(reviewData.memo).toBe('Test transfer');

    // 3. SEND_STELLAR_TRANSFER
    mockStellarTxClient.sendXlm.mockResolvedValueOnce({
      hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      ledger: 5383375,
      status: 'confirmed',
    });
    mockStellarTxClient.confirmTransaction.mockResolvedValue({
      hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      status: 'confirmed',
      ledger: 5383375,
    });

    const sendResponse = await router.routeMessage({
      id: 'req-3',
      type: 'SEND_STELLAR_TRANSFER',
      payload: {
        id: reviewData.id,
      },
    }, INTERNAL_SENDER);

    expect(sendResponse.error).toBeUndefined();
    const sendData = sendResponse.payload as any;
    expect(sendData.txHash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sendData.status).toBe('PENDING');
    expect(mockStellarTxClient.sendXlm).toHaveBeenCalledWith(
      expect.objectContaining({
        approvedFeeStroops: 100,
        amountXlm: '25.0',
        destination: DEST_ADDRESS,
      }),
      expect.any(Function),
    );

    // 4. Single-use guarantee: Replay attempt must fail
    const replayResponse = await router.routeMessage({
      id: 'req-4',
      type: 'SEND_STELLAR_TRANSFER',
      payload: {
        id: reviewData.id,
      },
    }, INTERNAL_SENDER);
    expect(replayResponse.error).toBeDefined();
    expect(replayResponse.error?.message).toContain('not found or already consumed');

    // 5. CONFIRM_STELLAR_TRANSFER
    const confirmResponse = await router.routeMessage({
      id: 'req-5',
      type: 'CONFIRM_STELLAR_TRANSFER',
      payload: {
        txHash: sendData.txHash,
      },
    }, INTERNAL_SENDER);

    expect(confirmResponse.error).toBeUndefined();
    expect(confirmResponse.payload).toEqual({
      txHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      status: 'CONFIRMED',
      ledger: 5383375,
    });
  });

  it('rejects schema-violating requests at the MessageRouter boundary', async () => {
    // Missing destination
    const missingDest = await router.routeMessage({
      id: 'invalid-1',
      type: 'ESTIMATE_STELLAR_TRANSFER',
      payload: {
        accountIndex: 0,
        amountXlm: '10',
      },
    }, INTERNAL_SENDER);
    expect(missingDest.error).toBeDefined();

    // Negative account index
    const negativeIndex = await router.routeMessage({
      id: 'invalid-2',
      type: 'REVIEW_STELLAR_TRANSFER',
      payload: {
        accountIndex: -1,
        destination: DEST_ADDRESS,
        amountXlm: '10',
      },
    }, INTERNAL_SENDER);
    expect(negativeIndex.error).toBeDefined();

    // Empty send ID
    const emptyId = await router.routeMessage({
      id: 'invalid-3',
      type: 'SEND_STELLAR_TRANSFER',
      payload: {
        id: '',
      },
    }, INTERNAL_SENDER);
    expect(emptyId.error).toBeDefined();
  });
});
