import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  createEstimateTransferHandler,
  createReviewTransferHandler,
  createReviewStellarTransferHandler,
  createSendTransferHandler,
  createSendStellarTransferHandler,
  transferManager,
  TransferConfirmationTracker,
} from '../../../src/background/handlers/transactionHandlers.js';
import { stateCoordinator } from '../../../src/background/StateCoordinator.js';

const notificationCreate = vi.hoisted(() => vi.fn());

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: { id: 'test', getURL: (path: string) => `chrome-extension://test/${path}` },
    notifications: { create: notificationCreate },
    storage: { local: { get: vi.fn(), set: vi.fn(), remove: vi.fn() } }
  }
}));

describe('transactionHandlers', () => {
  const mockClient = {
    reviewSolTransfer: vi.fn(),
    sendSol: vi.fn(),
    confirmTransaction: vi.fn().mockResolvedValue({ signature: 'fake-signature', status: 'confirmed' }),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    (stateCoordinator as any)._state = 'READY';
    (stateCoordinator as any)._activeSignatures = new Map();
    (stateCoordinator as any)._lockRequested = false;
    (stateCoordinator as any)._lockOperation = null;
    notificationCreate.mockReset();
    notificationCreate.mockResolvedValue('notification-id');
  });

  it('REVIEW_TRANSFER delegates to client and returns sanitized response', async () => {
    mockClient.reviewSolTransfer.mockResolvedValue({
      sourceAddress: 'SenderAddr',
      destinationAddress: 'DestAddr',
      lamports: 1000n,
      feeLamports: 5000n,
      balanceLamports: 100_000n
    });

    const handler = createReviewTransferHandler(mockClient);
    const result = await handler({
      accountIndex: 0,
      destination: 'DestAddr',
      lamports: '1000'
    });

    expect(mockClient.reviewSolTransfer).toHaveBeenCalledWith({
      sourceAccountIndex: 0,
      destination: 'DestAddr',
      lamports: 1000n
    });

    expect(result.id).toBeDefined();
    expect(result.sourceAddress).toBe('SenderAddr');
    expect(result.destinationAddress).toBe('DestAddr');
    expect(result.lamports).toBe('1000');
    expect(result.feeLamports).toBe('5000');
    expect(result.balanceLamports).toBe('100000');
  });

  it('ESTIMATE_TRANSFER returns exact fee and balance without creating a send review', async () => {
    mockClient.reviewSolTransfer.mockResolvedValue({
      sourceAddress: 'SenderAddr', destinationAddress: 'DestAddr', lamports: 1000n,
      feeLamports: 5000n, balanceLamports: 100_000n,
    });

    const estimate = await createEstimateTransferHandler(mockClient)({
      accountIndex: 0, destination: 'DestAddr', lamports: '1000',
    });

    expect(estimate).toEqual({
      sourceAddress: 'SenderAddr', destinationAddress: 'DestAddr', lamports: '1000',
      feeLamports: '5000', balanceLamports: '100000',
    });
  });

  it('REVIEW_TRANSFER rejects amount plus fee above the verified balance', async () => {
    mockClient.reviewSolTransfer.mockResolvedValue({
      sourceAddress: 'SenderAddr', destinationAddress: 'DestAddr', lamports: 99_000n,
      feeLamports: 5000n, balanceLamports: 100_000n,
    });

    await expect(createReviewTransferHandler(mockClient)({
      accountIndex: 0, destination: 'DestAddr', lamports: '99000',
    })).rejects.toThrow('Insufficient SOL');
    expect(mockClient.sendSol).not.toHaveBeenCalled();
  });

  it('SEND_TRANSFER consumes exactly once and delegates to client', async () => {
    mockClient.reviewSolTransfer.mockResolvedValue({
      sourceAddress: 'A',
      destinationAddress: 'B',
      lamports: 10n,
      feeLamports: 5000n,
      balanceLamports: 100_000n
    });

    const reviewHandler = createReviewTransferHandler(mockClient);
    const reviewResult = await reviewHandler({
      accountIndex: 0,
      destination: 'B',
      lamports: '10'
    });

    mockClient.sendSol.mockResolvedValue('fake-signature');

    const sendHandler = createSendTransferHandler(mockClient);
    
    // First send succeeds
    const sendResult = await sendHandler({ id: reviewResult.id });
    expect(sendResult.signature).toBe('fake-signature');
    expect(sendResult.status).toBe('PENDING');

    expect(mockClient.sendSol).toHaveBeenCalledWith({
      sourceAccountIndex: 0,
      destination: 'B',
      lamports: 10n
    }, expect.any(Function));

    // Second send (replay) fails
    await expect(sendHandler({ id: reviewResult.id })).rejects.toThrow('not found or already consumed');
  });

  it('rejects expired reviews', async () => {
    vi.useFakeTimers();

    mockClient.reviewSolTransfer.mockResolvedValue({
      sourceAddress: 'A', destinationAddress: 'B', lamports: 10n, feeLamports: 5000n, balanceLamports: 100_000n
    });

    const reviewHandler = createReviewTransferHandler(mockClient);
    const reviewResult = await reviewHandler({
      accountIndex: 0, destination: 'B', lamports: '10'
    });

    // Advance beyond 2 mins
    vi.advanceTimersByTime(120_001);

    const sendHandler = createSendTransferHandler(mockClient);
    await expect(sendHandler({ id: reviewResult.id })).rejects.toThrow('expired');
    // Ensure sendSol was never called
    expect(mockClient.sendSol).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('rejects invalid UUIDs safely', async () => {
    const sendHandler = createSendTransferHandler(mockClient);
    await expect(sendHandler({ id: '00000000-0000-0000-0000-000000000000' })).rejects.toThrow('not found or already consumed');
    expect(mockClient.sendSol).not.toHaveBeenCalled();
  });

  it('no broadcast occurs during REVIEW_TRANSFER', async () => {
    mockClient.reviewSolTransfer.mockResolvedValue({
      sourceAddress: 'A', destinationAddress: 'B', lamports: 10n, feeLamports: 5000n, balanceLamports: 100_000n
    });

    const handler = createReviewTransferHandler(mockClient);
    await handler({
      accountIndex: 0,
      destination: 'DestAddr',
      lamports: '1000'
    });

    expect(mockClient.sendSol).not.toHaveBeenCalled();
  });

  it('orphaned pending review remains unbroadcast without SEND_TRANSFER', async () => {
    mockClient.reviewSolTransfer.mockResolvedValue({
      sourceAddress: 'A', destinationAddress: 'B', lamports: 10n, feeLamports: 5000n, balanceLamports: 100_000n
    });

    const handler = createReviewTransferHandler(mockClient);
    const reviewResult = await handler({
      accountIndex: 0,
      destination: 'DestAddr',
      lamports: '1000'
    });

    // Simulate popup closing by never calling SEND_TRANSFER.
    // Ensure sendSol is not called automatically.
    expect(mockClient.sendSol).not.toHaveBeenCalled();
  });

  it('Test 5 — Internal Send review binding', async () => {
    // Create review for Account 1
    mockClient.reviewSolTransfer.mockResolvedValue({
      sourceAddress: 'Account1Address', destinationAddress: 'DestAddr', lamports: 100n, feeLamports: 5000n, balanceLamports: 100_000n
    });

    const reviewHandler = createReviewTransferHandler(mockClient);
    const reviewResult = await reviewHandler({
      accountIndex: 1, // Using Account 1
      destination: 'DestAddr',
      lamports: '100'
    });

    // UI payload for confirmation only contains ID.
    // UI cannot supply account index to SEND_TRANSFER.
    const sendPayload = { id: reviewResult.id };

    const sendHandler = createSendTransferHandler(mockClient);
    mockClient.sendSol.mockResolvedValue('fake-sig');

    await sendHandler(sendPayload);

    // Ensure it was sent using Account 1, not whatever else UI might have
    expect(mockClient.sendSol).toHaveBeenCalledWith({
      sourceAccountIndex: 1, // Remains Account 1
      destination: 'DestAddr',
      lamports: 100n
    }, expect.any(Function));
  });

  it('notifies only after confirmed or definitively failed status and deduplicates tracking', async () => {
    const notifications = { create: vi.fn().mockResolvedValue('id') } as any;
    const client = {
      confirmTransaction: vi.fn().mockResolvedValue({ signature: 'chain-signature', status: 'confirmed' }),
    } as any;
    const tracker = new TransferConfirmationTracker(client, notifications);

    tracker.start('chain-signature');
    tracker.start('chain-signature');
    await expect(tracker.confirm({ signature: 'chain-signature' })).resolves.toEqual({
      signature: 'chain-signature', status: 'CONFIRMED',
    });
    await tracker.confirm({ signature: 'chain-signature' });

    expect(client.confirmTransaction).toHaveBeenCalledOnce();
    expect(notifications.create).toHaveBeenCalledOnce();
    expect(notifications.create.mock.calls[0]?.[1]).toMatchObject({
      title: 'Transfer confirmed',
      message: 'Your Solana transfer was confirmed on the network.',
    });
  });

  it('does not notify on timeout and preserves UNKNOWN status if notifications are unavailable', async () => {
    const notifications = { create: vi.fn().mockRejectedValue(new Error('permission denied')) } as any;
    const tracker = new TransferConfirmationTracker({
      confirmTransaction: vi.fn().mockResolvedValue({ signature: 'chain-signature', status: 'timeout' }),
    } as any, notifications);

    tracker.start('chain-signature');
    await expect(tracker.confirm({ signature: 'chain-signature' })).resolves.toEqual({
      signature: 'chain-signature', status: 'UNKNOWN',
    });
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('continues reporting definitive status when native notification creation fails', async () => {
    const notifications = { create: vi.fn().mockRejectedValue(new Error('permission denied')) } as any;
    const tracker = new TransferConfirmationTracker({
      confirmTransaction: vi.fn().mockResolvedValue({ signature: 'chain-signature', status: 'failed' }),
    } as any, notifications);

    tracker.start('chain-signature');
    await expect(tracker.confirm({ signature: 'chain-signature' })).resolves.toEqual({
      signature: 'chain-signature', status: 'FAILED',
    });
    expect(notifications.create).toHaveBeenCalledOnce();
    expect(notifications.create.mock.calls[0]?.[1]).toMatchObject({
      title: 'Transfer failed',
      message: 'Your Solana transfer failed on the network.',
    });
  });

  describe('transfer review chain separation', () => {
    const mockStellarClient = {
      reviewXlmTransfer: vi.fn(),
      sendXlm: vi.fn(),
      confirmTransaction: vi.fn(),
    } as any;

    beforeEach(() => {
      mockStellarClient.reviewXlmTransfer.mockReset();
      mockStellarClient.sendXlm.mockReset();
      mockStellarClient.reviewXlmTransfer.mockResolvedValue({
        sourceAddress: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
        destinationAddress: 'GCGNF2T34X56JBNM3ZMQSFQ7Z72VDFTR6J7Z3P76WJ3N7C6XZQ4Q4Q4Q',
        amountXlm: '1.0',
        feeXlm: '0.0000100',
        feeStroops: 100,
        balanceXlm: '100.0000000',
        destinationExists: true,
        operationType: 'payment',
      });
    });

    it('consumes a Solana review only via the Solana send handler', async () => {
      mockClient.reviewSolTransfer.mockResolvedValue({
        sourceAddress: 'A', destinationAddress: 'B', lamports: 10n,
        feeLamports: 5000n, balanceLamports: 100_000n,
      });
      const { id } = await createReviewTransferHandler(mockClient)({
        accountIndex: 0, destination: 'B', lamports: '10',
      });
      mockClient.sendSol.mockResolvedValue('sig');
      await expect(createSendTransferHandler(mockClient)({ id })).resolves.toMatchObject({
        signature: 'sig', status: 'PENDING',
      });
    });

    it('rejects cross-chain consumption and preserves the pending review', async () => {
      mockClient.reviewSolTransfer.mockResolvedValue({
        sourceAddress: 'A', destinationAddress: 'B', lamports: 10n,
        feeLamports: 5000n, balanceLamports: 100_000n,
      });
      const { id } = await createReviewTransferHandler(mockClient)({
        accountIndex: 0, destination: 'B', lamports: '10',
      });

      await expect(createSendStellarTransferHandler(mockStellarClient)({ id })).rejects.toThrow(
        'different chain',
      );
      expect(mockStellarClient.sendXlm).not.toHaveBeenCalled();

      // Pending Solana review must still be consumable after the wrong-chain attempt.
      mockClient.sendSol.mockResolvedValue('sig-after-cross-chain');
      await expect(createSendTransferHandler(mockClient)({ id })).resolves.toMatchObject({
        signature: 'sig-after-cross-chain',
      });
    });

    it('rejects Stellar→Solana cross-chain consumption without consuming the review', async () => {
      const { id } = await createReviewStellarTransferHandler(mockStellarClient)({
        accountIndex: 0,
        destination: 'GCGNF2T34X56JBNM3ZMQSFQ7Z72VDFTR6J7Z3P76WJ3N7C6XZQ4Q4Q4Q',
        amountXlm: '1.0',
      });

      await expect(createSendTransferHandler(mockClient)({ id })).rejects.toThrow('different chain');
      expect(mockClient.sendSol).not.toHaveBeenCalled();

      mockStellarClient.sendXlm.mockResolvedValue({ hash: 'stellar-hash', status: 'confirmed' });
      await expect(createSendStellarTransferHandler(mockStellarClient)({ id })).resolves.toMatchObject({
        txHash: 'stellar-hash', status: 'PENDING',
      });
      expect(mockStellarClient.sendXlm).toHaveBeenCalledWith(
        expect.objectContaining({ approvedFeeStroops: 100 }),
        expect.any(Function),
      );
    });

    it('F4: Solana createReview remains valid without approvedFeeStroops; Stellar requires it', () => {
      const solanaId = transferManager.createReview({
        accountIndex: 0, destination: 'B', lamports: '10',
      });
      expect(transferManager.consumeReview(solanaId, 'solana')).toEqual({
        accountIndex: 0, destination: 'B', lamports: '10',
      });

      expect(() =>
        (transferManager.createReview as (req: unknown) => string)({
          accountIndex: 0,
          destination: 'GCGNF2T34X56JBNM3ZMQSFQ7Z72VDFTR6J7Z3P76WJ3N7C6XZQ4Q4Q4Q',
          amountXlm: '1.0',
        }),
      ).toThrow('approvedFeeStroops');
    });

    it('rejects replay after successful same-chain consumption', async () => {
      const id = transferManager.createReview({
        accountIndex: 0, destination: 'B', lamports: '10',
      });
      expect(transferManager.consumeReview(id, 'solana')).toEqual({
        accountIndex: 0, destination: 'B', lamports: '10',
      });
      expect(() => transferManager.consumeReview(id, 'solana')).toThrow(
        'not found or already consumed',
      );
    });

    it('deletes expired reviews before throwing', async () => {
      vi.useFakeTimers();
      const id = transferManager.createReview({
        accountIndex: 0, destination: 'B', lamports: '10',
      });
      vi.advanceTimersByTime(120_001);
      expect(() => transferManager.consumeReview(id, 'solana')).toThrow('expired');
      expect(() => transferManager.consumeReview(id, 'solana')).toThrow(
        'not found or already consumed',
      );
      vi.useRealTimers();
    });
  });
});
