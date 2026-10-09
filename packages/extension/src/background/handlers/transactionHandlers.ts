import type { TransactionClient } from '@solanym/wallet-core/src/solana/transaction/TransactionClient.js';
import type { 
  ReviewTransferRequest, 
  ReviewTransferResponse,
  SendTransferRequest,
  SendTransferResponse
} from '../../shared/ipcTypes.js';
import { stateCoordinator } from '../StateCoordinator.js';

interface PendingInternalTransfer {
  request: ReviewTransferRequest;
  expiresAt: number;
}

export class InternalTransferManager {
  private readonly _pendingTransfers = new Map<string, PendingInternalTransfer>();
  private static TIMEOUT_MS = 120_000; // 2 minutes

  createReview(request: ReviewTransferRequest): string {
    const id = crypto.randomUUID();
    this._pendingTransfers.set(id, {
      request,
      expiresAt: Date.now() + InternalTransferManager.TIMEOUT_MS
    });
    return id;
  }

  consumeReview(id: string): ReviewTransferRequest {
    const pending = this._pendingTransfers.get(id);
    if (!pending) {
      throw new Error('Pending transfer review not found or already consumed');
    }
    
    this._pendingTransfers.delete(id); // Consume exactly once
    
    if (Date.now() > pending.expiresAt) {
      throw new Error('Pending transfer review expired');
    }
    
    return pending.request;
  }
}

export const transferManager = new InternalTransferManager();

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

    const id = transferManager.createReview(payload);

    return {
      id,
      sourceAddress: summary.sourceAddress,
      destinationAddress: summary.destinationAddress,
      lamports: summary.lamports.toString(),
      feeLamports: summary.feeLamports?.toString() ?? '5000'
    };
  };
}

export function createSendTransferHandler(client: TransactionClient) {
  return async (payload: SendTransferRequest): Promise<SendTransferResponse> => {
    const originalRequest = transferManager.consumeReview(payload.id);

    let startEpoch: number;
    try {
      startEpoch = stateCoordinator.authorizeSignature();
    } catch (e: any) {
      throw e;
    }

    try {
      // Broadcast using exactly the reviewed parameters
      const signature = await client.sendSol({
        sourceAccountIndex: originalRequest.accountIndex,
        destination: originalRequest.destination,
        lamports: BigInt(originalRequest.lamports)
      });

      // Synchronous Exit Barrier check
      if (!stateCoordinator.validateExit(startEpoch)) {
        // Technically sendSol already broadcasted to the RPC, we cannot unsign or un-broadcast it here.
        // But we must respect the exit barrier for consistency.
        throw new Error('Wallet state changed during broadcast. Signature delivered but local state invalidated.');
      }

      return { signature };
    } finally {
      stateCoordinator.endSignature();
    }
  };
}
