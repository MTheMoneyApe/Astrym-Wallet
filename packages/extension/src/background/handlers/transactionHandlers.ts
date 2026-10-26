import type { TransactionClient } from '@solanym/wallet-core/src/solana/transaction/TransactionClient.js';
import type { StellarTransactionClient } from '@solanym/wallet-core';
import browser from 'webextension-polyfill';
import type { 
  ReviewTransferRequest, 
  ReviewTransferResponse,
  EstimateTransferRequest,
  EstimateTransferResponse,
  SendTransferRequest,
  SendTransferResponse,
  ConfirmTransferRequest,
  ConfirmTransferResponse,
  EstimateStellarTransferRequest,
  EstimateStellarTransferResponse,
  ReviewStellarTransferRequest,
  ReviewStellarTransferResponse,
  SendStellarTransferRequest,
  SendStellarTransferResponse,
  ConfirmStellarTransferRequest,
  ConfirmStellarTransferResponse,
} from '../../shared/ipcTypes.js';
import { stateCoordinator } from '../StateCoordinator.js';

type TransferReviewChain = 'solana' | 'stellar';

/** Stellar pending review payload returned by consumeReview — includes frozen approved fee. */
export type ConsumedStellarTransferReview = ReviewStellarTransferRequest & {
  approvedFeeStroops: number;
};

interface PendingInternalTransfer {
  chain: TransferReviewChain;
  request: ReviewTransferRequest | ReviewStellarTransferRequest;
  expiresAt: number;
  /** Present only for stellar reviews: fee the user approved at REVIEW, in stroops. */
  approvedFeeStroops?: number;
}

function resolveTransferReviewChain(
  request: ReviewTransferRequest | ReviewStellarTransferRequest,
): TransferReviewChain {
  if ('lamports' in request) {
    return 'solana';
  }
  if ('amountXlm' in request) {
    return 'stellar';
  }
  throw new Error('Unable to determine transfer review chain');
}

export class InternalTransferManager {
  private readonly _pendingTransfers = new Map<string, PendingInternalTransfer>();
  private static TIMEOUT_MS = 120_000; // 2 minutes

  createReview(request: ReviewTransferRequest): string;
  createReview(
    request: ReviewStellarTransferRequest,
    options: { approvedFeeStroops: number },
  ): string;
  createReview(
    request: ReviewTransferRequest | ReviewStellarTransferRequest,
    options?: { approvedFeeStroops: number },
  ): string {
    const chain = resolveTransferReviewChain(request);
    let approvedFeeStroops: number | undefined;

    if (chain === 'stellar') {
      const stroops = options?.approvedFeeStroops;
      if (stroops === undefined || !Number.isInteger(stroops) || stroops <= 0) {
        throw new Error('Stellar transfer review requires a positive integer approvedFeeStroops');
      }
      approvedFeeStroops = stroops;
    }

    const id = crypto.randomUUID();
    this._pendingTransfers.set(id, {
      chain,
      request,
      expiresAt: Date.now() + InternalTransferManager.TIMEOUT_MS,
      ...(approvedFeeStroops !== undefined ? { approvedFeeStroops } : {}),
    });
    return id;
  }

  consumeReview(id: string, chain: 'solana'): ReviewTransferRequest;
  consumeReview(id: string, chain: 'stellar'): ConsumedStellarTransferReview;
  consumeReview(
    id: string,
    chain: TransferReviewChain,
  ): ReviewTransferRequest | ConsumedStellarTransferReview {
    const pending = this._pendingTransfers.get(id);
    if (!pending) {
      throw new Error('Pending transfer review not found or already consumed');
    }

    if (pending.chain !== chain) {
      // Preserve the pending review so the correct-chain handler can still consume it.
      throw new Error(`Pending transfer review belongs to a different chain (expected ${chain})`);
    }

    if (Date.now() > pending.expiresAt) {
      this._pendingTransfers.delete(id);
      throw new Error('Pending transfer review expired');
    }

    this._pendingTransfers.delete(id); // Consume exactly once

    if (chain === 'stellar') {
      const stroops = pending.approvedFeeStroops;
      if (stroops === undefined || !Number.isInteger(stroops) || stroops <= 0) {
        throw new Error('Stellar transfer review is missing approvedFeeStroops');
      }
      const stellarRequest = pending.request as ReviewStellarTransferRequest;
      return Object.freeze({
        accountIndex: stellarRequest.accountIndex,
        destination: stellarRequest.destination,
        amountXlm: stellarRequest.amountXlm,
        ...(stellarRequest.memo !== undefined ? { memo: stellarRequest.memo } : {}),
        approvedFeeStroops: stroops,
      });
    }

    return pending.request as ReviewTransferRequest;
  }
}

export const transferManager = new InternalTransferManager();

export class TransferConfirmationTracker {
  private readonly _tasks = new Map<string, Promise<ConfirmTransferResponse>>();
  private readonly _notified = new Set<string>();

  constructor(
    private readonly _client: TransactionClient,
    private readonly _notifications: typeof browser.notifications = browser.notifications,
  ) {}

  public start(signature: string): void {
    if (this._tasks.has(signature)) return;

    const task = Promise.resolve()
      .then(() => this._client.confirmTransaction(signature))
      .then(async (confirmation): Promise<ConfirmTransferResponse> => {
        const status = confirmation.status === 'confirmed'
          ? 'CONFIRMED'
          : confirmation.status === 'failed' || confirmation.status === 'expired'
            ? 'FAILED'
            : 'UNKNOWN';

        if (status !== 'UNKNOWN') await this._notifyOnce(signature, status);
        return { signature, status };
      })
      .catch((): ConfirmTransferResponse => ({ signature, status: 'UNKNOWN' }));

    this._tasks.set(signature, task);
  }

  public async confirm(payload: ConfirmTransferRequest): Promise<ConfirmTransferResponse> {
    const task = this._tasks.get(payload.signature);
    if (!task) throw new Error('No pending transfer confirmation is available');
    return task;
  }

  private async _notifyOnce(signature: string, status: 'CONFIRMED' | 'FAILED'): Promise<void> {
    if (this._notified.has(signature)) return;
    this._notified.add(signature);

    try {
      await this._notifications.create(`solanym-transfer-${signature}`, {
        type: 'basic',
        iconUrl: browser.runtime.getURL('icons/icon128.png'),
        title: status === 'CONFIRMED' ? 'Transfer confirmed' : 'Transfer failed',
        message: status === 'CONFIRMED'
          ? 'Your Solana transfer was confirmed on the network.'
          : 'Your Solana transfer failed on the network.',
      });
    } catch {
      // The in-wallet status remains authoritative when desktop notifications are unavailable.
    }
  }
}

export function createEstimateTransferHandler(client: TransactionClient) {
  return async (payload: EstimateTransferRequest): Promise<EstimateTransferResponse> => {
    if (
      stateCoordinator.state === 'ERROR_STATE' ||
      stateCoordinator.state === 'RESET_BLOCKED' ||
      stateCoordinator.state === 'READY_WITH_MUTATION_LOCK'
    ) {
      throw new Error('System is in a degraded state');
    }

    const summary = await client.reviewSolTransfer({
      sourceAccountIndex: payload.accountIndex,
      destination: payload.destination,
      lamports: BigInt(payload.lamports),
    });
    if (summary.feeLamports === null) throw new Error('Network fee estimate unavailable');

    return {
      sourceAddress: summary.sourceAddress,
      destinationAddress: summary.destinationAddress,
      lamports: summary.lamports.toString(),
      feeLamports: summary.feeLamports.toString(),
      balanceLamports: summary.balanceLamports.toString(),
    };
  };
}

export function createReviewTransferHandler(client: TransactionClient) {
  return async (payload: ReviewTransferRequest): Promise<ReviewTransferResponse> => {
    if (
      stateCoordinator.state === 'ERROR_STATE' || 
      stateCoordinator.state === 'RESET_BLOCKED' ||
      stateCoordinator.state === 'READY_WITH_MUTATION_LOCK'
    ) {
      throw new Error('System is in a degraded state');
    }
    const summary = await client.reviewSolTransfer({
      sourceAccountIndex: payload.accountIndex,
      destination: payload.destination,
      lamports: BigInt(payload.lamports)
    });

    if (summary.feeLamports === null) throw new Error('Network fee estimate unavailable');
    if (summary.lamports + summary.feeLamports > summary.balanceLamports) {
      throw new Error('Insufficient SOL to cover the transfer and network fee');
    }

    const id = transferManager.createReview(payload);

    return {
      id,
      sourceAddress: summary.sourceAddress,
      destinationAddress: summary.destinationAddress,
      lamports: summary.lamports.toString(),
      feeLamports: summary.feeLamports.toString(),
      balanceLamports: summary.balanceLamports.toString(),
    };
  };
}

export function createSendTransferHandler(client: TransactionClient, tracker = new TransferConfirmationTracker(client)) {
  return async (payload: SendTransferRequest): Promise<SendTransferResponse> => {
    const originalRequest = transferManager.consumeReview(payload.id, 'solana');

    const authorization = stateCoordinator.authorizeSignature();

    try {
      // Broadcast using exactly the reviewed parameters
      const signature = await client.sendSol({
        sourceAccountIndex: originalRequest.accountIndex,
        destination: originalRequest.destination,
        lamports: BigInt(originalRequest.lamports)
      }, () => stateCoordinator.assertSignatureActive(authorization));

      // Synchronous Exit Barrier check
      if (!stateCoordinator.validateExit(authorization)) {
        // Technically sendSol already broadcasted to the RPC, we cannot unsign or un-broadcast it here.
        // But we must respect the exit barrier for consistency.
        throw new Error('Wallet state changed during broadcast. Signature delivered but local state invalidated.');
      }

      tracker.start(signature);
      return { signature, status: 'PENDING' };
    } finally {
      stateCoordinator.endSignature(authorization);
    }
  };
}

export function createConfirmTransferHandler(tracker: TransferConfirmationTracker) {
  return async (payload: ConfirmTransferRequest): Promise<ConfirmTransferResponse> => tracker.confirm(payload);
}

export class StellarTransferConfirmationTracker {
  private readonly _tasks = new Map<string, Promise<ConfirmStellarTransferResponse>>();
  private readonly _notified = new Set<string>();

  constructor(
    private readonly _client: StellarTransactionClient,
    private readonly _notifications: typeof browser.notifications = browser.notifications,
  ) {}

  public start(txHash: string): void {
    if (this._tasks.has(txHash)) return;

    const task = Promise.resolve()
      .then(() => this._client.confirmTransaction(txHash))
      .then(async (confirmation): Promise<ConfirmStellarTransferResponse> => {
        const status = confirmation.status === 'confirmed'
          ? 'CONFIRMED'
          : confirmation.status === 'failed'
            ? 'FAILED'
            : 'UNKNOWN';

        if (status !== 'UNKNOWN') await this._notifyOnce(txHash, status);
        return { txHash, status, ledger: confirmation.ledger };
      })
      .catch((): ConfirmStellarTransferResponse => ({ txHash, status: 'UNKNOWN' }));

    this._tasks.set(txHash, task);
  }

  public async confirm(payload: ConfirmStellarTransferRequest): Promise<ConfirmStellarTransferResponse> {
    const task = this._tasks.get(payload.txHash);
    if (!task) {
      const confirmation = await this._client.confirmTransaction(payload.txHash);
      const status = confirmation.status === 'confirmed'
        ? 'CONFIRMED'
        : confirmation.status === 'failed'
          ? 'FAILED'
          : 'UNKNOWN';
      return { txHash: payload.txHash, status, ledger: confirmation.ledger };
    }
    return task;
  }

  private async _notifyOnce(txHash: string, status: 'CONFIRMED' | 'FAILED'): Promise<void> {
    if (this._notified.has(txHash)) return;
    this._notified.add(txHash);

    try {
      await this._notifications.create(`stellar-transfer-${txHash}`, {
        type: 'basic',
        iconUrl: browser.runtime.getURL('icons/icon128.png'),
        title: status === 'CONFIRMED' ? 'Stellar transfer confirmed' : 'Stellar transfer failed',
        message: status === 'CONFIRMED'
          ? 'Your XLM transfer was confirmed on Stellar Testnet.'
          : 'Your XLM transfer failed on Stellar Testnet.',
      });
    } catch {
      // In-wallet status is authoritative
    }
  }
}

export function createEstimateStellarTransferHandler(client: StellarTransactionClient) {
  return async (payload: EstimateStellarTransferRequest): Promise<EstimateStellarTransferResponse> => {
    if (
      stateCoordinator.state === 'ERROR_STATE' ||
      stateCoordinator.state === 'RESET_BLOCKED' ||
      stateCoordinator.state === 'READY_WITH_MUTATION_LOCK'
    ) {
      throw new Error('System is in a degraded state');
    }

    const summary = await client.reviewXlmTransfer({
      sourceAccountIndex: payload.accountIndex,
      destination: payload.destination,
      amountXlm: payload.amountXlm,
      memo: payload.memo,
    });

    return {
      sourceAddress: summary.sourceAddress,
      destinationAddress: summary.destinationAddress,
      amountXlm: summary.amountXlm,
      feeXlm: summary.feeXlm,
      balanceXlm: summary.balanceXlm,
      destinationExists: summary.destinationExists,
      operationType: summary.operationType,
    };
  };
}

export function createReviewStellarTransferHandler(client: StellarTransactionClient) {
  return async (payload: ReviewStellarTransferRequest): Promise<ReviewStellarTransferResponse> => {
    if (
      stateCoordinator.state === 'ERROR_STATE' ||
      stateCoordinator.state === 'RESET_BLOCKED' ||
      stateCoordinator.state === 'READY_WITH_MUTATION_LOCK'
    ) {
      throw new Error('System is in a degraded state');
    }

    const summary = await client.reviewXlmTransfer({
      sourceAccountIndex: payload.accountIndex,
      destination: payload.destination,
      amountXlm: payload.amountXlm,
      memo: payload.memo,
    });

    // Freeze the reviewed fee into the pending review — SEND must use this exact value.
    const id = transferManager.createReview(payload, {
      approvedFeeStroops: summary.feeStroops,
    });

    return {
      id,
      sourceAddress: summary.sourceAddress,
      destinationAddress: summary.destinationAddress,
      amountXlm: summary.amountXlm,
      feeXlm: summary.feeXlm,
      balanceXlm: summary.balanceXlm,
      destinationExists: summary.destinationExists,
      operationType: summary.operationType,
      memo: summary.memo,
    };
  };
}

export function createSendStellarTransferHandler(
  client: StellarTransactionClient,
  tracker = new StellarTransferConfirmationTracker(client),
) {
  return async (payload: SendStellarTransferRequest): Promise<SendStellarTransferResponse> => {
    const originalRequest = transferManager.consumeReview(payload.id, 'stellar');

    const authorization = stateCoordinator.authorizeSignature();

    try {
      const result = await client.sendXlm(
        {
          sourceAccountIndex: originalRequest.accountIndex,
          destination: originalRequest.destination,
          amountXlm: originalRequest.amountXlm,
          memo: originalRequest.memo,
          approvedFeeStroops: originalRequest.approvedFeeStroops,
        },
        () => stateCoordinator.assertSignatureActive(authorization),
      );

      if (!stateCoordinator.validateExit(authorization)) {
        throw new Error('Wallet state changed during broadcast. Signature delivered but local state invalidated.');
      }

      tracker.start(result.hash);
      return { txHash: result.hash, status: 'PENDING' };
    } finally {
      stateCoordinator.endSignature(authorization);
    }
  };
}

export function createConfirmStellarTransferHandler(tracker: StellarTransferConfirmationTracker) {
  return async (payload: ConfirmStellarTransferRequest): Promise<ConfirmStellarTransferResponse> => tracker.confirm(payload);
}
