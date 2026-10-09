import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createReviewTransferHandler, createSendTransferHandler, transferManager } from '../../../src/background/handlers/transactionHandlers.js';

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: { id: 'test' },
    storage: { local: { get: vi.fn(), set: vi.fn(), remove: vi.fn() } }
  }
}));

describe('transactionHandlers', () => {
  const mockClient = {
    reviewSolTransfer: vi.fn(),
    sendSol: vi.fn()
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('REVIEW_TRANSFER delegates to client and returns sanitized response', async () => {
    mockClient.reviewSolTransfer.mockResolvedValue({
      sourceAddress: 'SenderAddr',
      destinationAddress: 'DestAddr',
      lamports: 1000n,
      feeLamports: 5000n
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
  });

  it('SEND_TRANSFER consumes exactly once and delegates to client', async () => {
    mockClient.reviewSolTransfer.mockResolvedValue({
      sourceAddress: 'A',
      destinationAddress: 'B',
      lamports: 10n,
      feeLamports: 5000n
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

    expect(mockClient.sendSol).toHaveBeenCalledWith({
      sourceAccountIndex: 0,
      destination: 'B',
      lamports: 10n
    });

    // Second send (replay) fails
    await expect(sendHandler({ id: reviewResult.id })).rejects.toThrow('not found or already consumed');
  });

  it('rejects expired reviews', async () => {
    vi.useFakeTimers();

    mockClient.reviewSolTransfer.mockResolvedValue({
      sourceAddress: 'A', destinationAddress: 'B', lamports: 10n, feeLamports: 5000n
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
      sourceAddress: 'A', destinationAddress: 'B', lamports: 10n, feeLamports: 5000n
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
      sourceAddress: 'A', destinationAddress: 'B', lamports: 10n, feeLamports: 5000n
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
      sourceAddress: 'Account1Address', destinationAddress: 'DestAddr', lamports: 100n, feeLamports: 5000n
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
    });
  });
});
