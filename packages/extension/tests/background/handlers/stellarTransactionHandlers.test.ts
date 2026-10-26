import { describe, expect, it, vi, beforeEach } from 'vitest';
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
    storage: { local: { get: vi.fn(), set: vi.fn(), remove: vi.fn() } }
  }
}));

describe('Stellar transactionHandlers', () => {
  const mockStellarClient = {
    reviewXlmTransfer: vi.fn(),
    sendXlm: vi.fn(),
    confirmTransaction: vi.fn().mockResolvedValue({ hash: 'fake-hash', status: 'confirmed', ledger: 12345 }),
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

  it('ESTIMATE_STELLAR_TRANSFER calls client and returns estimate without creating review id', async () => {
    mockStellarClient.reviewXlmTransfer.mockResolvedValue({
      sourceAddress: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
      destinationAddress: 'GCGNF2T34X56JBNM3ZMQSFQ7Z72VDFTR6J7Z3P76WJ3N7C6XZQ4Q4Q4Q',
      amountXlm: '10.5',
      feeXlm: '0.0000100',
      feeStroops: 100,
      balanceXlm: '100.0000000',
      destinationExists: true,
      operationType: 'payment',
    });

    const handler = createEstimateStellarTransferHandler(mockStellarClient);
    const result = await handler({
      accountIndex: 0,
      destination: 'GCGNF2T34X56JBNM3ZMQSFQ7Z72VDFTR6J7Z3P76WJ3N7C6XZQ4Q4Q4Q',
      amountXlm: '10.5',
      memo: 'Test memo',
    });

    expect(mockStellarClient.reviewXlmTransfer).toHaveBeenCalledWith({
      sourceAccountIndex: 0,
      destination: 'GCGNF2T34X56JBNM3ZMQSFQ7Z72VDFTR6J7Z3P76WJ3N7C6XZQ4Q4Q4Q',
      amountXlm: '10.5',
      memo: 'Test memo',
    });

    expect(result).toEqual({
      sourceAddress: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
      destinationAddress: 'GCGNF2T34X56JBNM3ZMQSFQ7Z72VDFTR6J7Z3P76WJ3N7C6XZQ4Q4Q4Q',
      amountXlm: '10.5',
      feeXlm: '0.0000100',
      balanceXlm: '100.0000000',
      destinationExists: true,
      operationType: 'payment',
    });
  });

  it('REVIEW_STELLAR_TRANSFER creates review and returns id', async () => {
    mockStellarClient.reviewXlmTransfer.mockResolvedValue({
      sourceAddress: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
      destinationAddress: 'GCGNF2T34X56JBNM3ZMQSFQ7Z72VDFTR6J7Z3P76WJ3N7C6XZQ4Q4Q4Q',
      amountXlm: '5.0',
      feeXlm: '0.0000100',
      feeStroops: 100,
      balanceXlm: '50.0000000',
      destinationExists: false,
      operationType: 'createAccount',
      memo: 'Funding',
    });

    const handler = createReviewStellarTransferHandler(mockStellarClient);
    const result = await handler({
      accountIndex: 1,
      destination: 'GCGNF2T34X56JBNM3ZMQSFQ7Z72VDFTR6J7Z3P76WJ3N7C6XZQ4Q4Q4Q',
      amountXlm: '5.0',
      memo: 'Funding',
    });

    expect(result.id).toBeDefined();
    expect(result.amountXlm).toBe('5.0');
    expect(result.destinationExists).toBe(false);
    expect(result.operationType).toBe('createAccount');
    expect(result.memo).toBe('Funding');
  });

  it('SEND_STELLAR_TRANSFER consumes review exactly once and delegates to client', async () => {
    mockStellarClient.reviewXlmTransfer.mockResolvedValue({
      sourceAddress: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
      destinationAddress: 'GCGNF2T34X56JBNM3ZMQSFQ7Z72VDFTR6J7Z3P76WJ3N7C6XZQ4Q4Q4Q',
      amountXlm: '2.5',
      feeXlm: '0.0000100',
      feeStroops: 100,
      balanceXlm: '50.0000000',
      destinationExists: true,
      operationType: 'payment',
      memo: 'Payment',
    });

    const reviewHandler = createReviewStellarTransferHandler(mockStellarClient);
    const reviewResult = await reviewHandler({
      accountIndex: 0,
      destination: 'GCGNF2T34X56JBNM3ZMQSFQ7Z72VDFTR6J7Z3P76WJ3N7C6XZQ4Q4Q4Q',
      amountXlm: '2.5',
      memo: 'Payment',
    });

    mockStellarClient.sendXlm.mockResolvedValue({
      hash: 'abc123hash',
      ledger: 5678,
      status: 'confirmed',
    });

    const sendHandler = createSendStellarTransferHandler(mockStellarClient);
    const sendResult = await sendHandler({ id: reviewResult.id });

    expect(sendResult.txHash).toBe('abc123hash');
    expect(sendResult.status).toBe('PENDING');

    // F3: approved fee from REVIEW is propagated; SEND IPC cannot substitute it.
    expect(mockStellarClient.sendXlm).toHaveBeenCalledWith({
      sourceAccountIndex: 0,
      destination: 'GCGNF2T34X56JBNM3ZMQSFQ7Z72VDFTR6J7Z3P76WJ3N7C6XZQ4Q4Q4Q',
      amountXlm: '2.5',
      memo: 'Payment',
      approvedFeeStroops: 100,
    }, expect.any(Function));

    // Replay attempt throws error
    await expect(sendHandler({ id: reviewResult.id })).rejects.toThrow('not found or already consumed');
  });

  it('StellarTransferConfirmationTracker confirms and notifies on testnet result', async () => {
    const notifications = { create: vi.fn().mockResolvedValue('notif-id') } as any;
    const client = {
      confirmTransaction: vi.fn().mockResolvedValue({ hash: 'tx-hash-789', status: 'confirmed', ledger: 999 }),
    } as any;
    const tracker = new StellarTransferConfirmationTracker(client, notifications);

    tracker.start('tx-hash-789');
    const result = await tracker.confirm({ txHash: 'tx-hash-789' });

    expect(result).toEqual({
      txHash: 'tx-hash-789',
      status: 'CONFIRMED',
      ledger: 999,
    });
    expect(client.confirmTransaction).toHaveBeenCalledOnce();
    expect(notifications.create).toHaveBeenCalledWith('stellar-transfer-tx-hash-789', expect.objectContaining({
      title: 'Stellar transfer confirmed',
    }));
  });

  it('StellarTransferConfirmationTracker maps Horizon failed to IPC FAILED (not CONFIRMED/UNKNOWN)', async () => {
    const notifications = { create: vi.fn().mockResolvedValue('notif-id') } as any;
    const client = {
      confirmTransaction: vi.fn().mockResolvedValue({ hash: 'tx-hash-fail', status: 'failed', ledger: 777 }),
    } as any;
    const tracker = new StellarTransferConfirmationTracker(client, notifications);

    tracker.start('tx-hash-fail');
    const result = await tracker.confirm({ txHash: 'tx-hash-fail' });

    expect(result).toEqual({
      txHash: 'tx-hash-fail',
      status: 'FAILED',
      ledger: 777,
    });
    expect(result.status).not.toBe('CONFIRMED');
    expect(result.status).not.toBe('UNKNOWN');
    expect(notifications.create).toHaveBeenCalledWith('stellar-transfer-tx-hash-fail', expect.objectContaining({
      title: 'Stellar transfer failed',
    }));
  });

  it('createConfirmStellarTransferHandler propagates FAILED from tracker', async () => {
    const tracker = {
      confirm: vi.fn().mockResolvedValue({ txHash: 'tx-fail', status: 'FAILED', ledger: 50 }),
    } as any;
    const handler = createConfirmStellarTransferHandler(tracker);
    const res = await handler({ txHash: 'tx-fail' });
    expect(res).toEqual({ txHash: 'tx-fail', status: 'FAILED', ledger: 50 });
    expect(res.status).not.toBe('CONFIRMED');
    expect(res.status).not.toBe('UNKNOWN');
    expect(tracker.confirm).toHaveBeenCalledWith({ txHash: 'tx-fail' });
  });

  it('createConfirmStellarTransferHandler calls tracker.confirm', async () => {
    const tracker = {
      confirm: vi.fn().mockResolvedValue({ txHash: 'tx-123', status: 'CONFIRMED', ledger: 100 }),
    } as any;
    const handler = createConfirmStellarTransferHandler(tracker);
    const res = await handler({ txHash: 'tx-123' });
    expect(res).toEqual({ txHash: 'tx-123', status: 'CONFIRMED', ledger: 100 });
    expect(tracker.confirm).toHaveBeenCalledWith({ txHash: 'tx-123' });
  });
});
