import { DappTransactionReview } from '../../shared/ipcTypes.js';

export class RequestAlreadyPendingError extends Error {
  constructor() {
    super('A request is already pending. Only one request can be processed at a time.');
    this.name = 'RequestAlreadyPendingError';
  }
}

export class UserRejectedError extends Error {
  constructor() {
    super('User rejected the request.');
    this.name = 'UserRejectedError';
  }
}

export interface PendingConnectRequest {
  internalRequestId: string;
  origin: string;
  resolve: (approved: boolean) => void;
  reject: (error: Error) => void;
}

export interface PendingSignRequest {
  internalRequestId: string;
  origin: string;
  review: DappTransactionReview;
  messageBytes: Uint8Array;
  accountIndex: number;
  expectedPublicKey: string; // The base58 expected pubkey
  resolve: (result: { signature: string, transactionBase64: string }) => void;
  reject: (error: Error) => void;
}

export class PendingRequestManager {
  private pendingConnect: PendingConnectRequest | null = null;
  private pendingSign: PendingSignRequest | null = null;
  
  // Hard timeout 2 minutes
  private static TIMEOUT_MS = 120_000;
  private connectTimeoutId: any = null;
  private signTimeoutId: any = null;

  createConnectRequest(origin: string): Promise<boolean> {
    if (this.pendingConnect) {
      return Promise.reject(new RequestAlreadyPendingError());
    }
    
    return new Promise((resolve, reject) => {
      this.pendingConnect = {
        internalRequestId: crypto.randomUUID(),
        origin,
        resolve,
        reject
      };
      
      const setTimer = (globalThis as any).setTimeout;
      this.connectTimeoutId = setTimer(() => {
        this.rejectConnect(new UserRejectedError()); // Timeout implies rejection/closed
      }, PendingRequestManager.TIMEOUT_MS);
    });
  }
  
  createSignRequest(
    origin: string, 
    review: Omit<DappTransactionReview, 'internalRequestId' | 'origin'>, 
    messageBytes: Uint8Array, 
    accountIndex: number,
    expectedPublicKey: string
  ): Promise<{ signature: string, transactionBase64: string }> {
    if (this.pendingSign) {
      return Promise.reject(new RequestAlreadyPendingError());
    }
    
    // Defensively copy the mutable Uint8Array
    const copiedMessageBytes = new Uint8Array(messageBytes);
    
    return new Promise((resolve, reject) => {
      const internalRequestId = crypto.randomUUID();
      this.pendingSign = {
        internalRequestId,
        origin,
        review: {
          ...review,
          internalRequestId,
          origin
        },
        messageBytes: copiedMessageBytes,
        accountIndex,
        expectedPublicKey,
        resolve,
        reject
      };
      
      const setTimer = (globalThis as any).setTimeout;
      this.signTimeoutId = setTimer(() => {
        this.rejectSign(new UserRejectedError()); // Timeout implies rejection
      }, PendingRequestManager.TIMEOUT_MS);
    });
  }

  getPendingConnect(): PendingConnectRequest | null {
    if (!this.pendingConnect) return null;
    return {
      ...this.pendingConnect
    };
  }

  getPendingSign(): PendingSignRequest | null {
    if (!this.pendingSign) return null;
    return {
      ...this.pendingSign,
      review: { ...this.pendingSign.review },
      messageBytes: new Uint8Array(this.pendingSign.messageBytes)
    };
  }

  approveConnect(internalRequestId: string) {
    if (this.pendingConnect && this.pendingConnect.internalRequestId === internalRequestId) {
      const clearTimer = (globalThis as any).clearTimeout;
      clearTimer(this.connectTimeoutId);
      const resolve = this.pendingConnect.resolve;
      this.pendingConnect = null;
      resolve(true);
    }
  }

  rejectConnect(error: Error = new UserRejectedError(), internalRequestId?: string) {
    if (this.pendingConnect && (!internalRequestId || this.pendingConnect.internalRequestId === internalRequestId)) {
      const clearTimer = (globalThis as any).clearTimeout;
      clearTimer(this.connectTimeoutId);
      const reject = this.pendingConnect.reject;
      this.pendingConnect = null;
      reject(error);
    }
  }

  approveSign(internalRequestId: string, result: { signature: string, transactionBase64: string }) {
    if (this.pendingSign && this.pendingSign.internalRequestId === internalRequestId) {
      const clearTimer = (globalThis as any).clearTimeout;
      clearTimer(this.signTimeoutId);
      const resolve = this.pendingSign.resolve;
      this.pendingSign = null;
      resolve(result);
    }
  }

  rejectSign(error: Error = new UserRejectedError(), internalRequestId?: string) {
    if (this.pendingSign && (!internalRequestId || this.pendingSign.internalRequestId === internalRequestId)) {
      const clearTimer = (globalThis as any).clearTimeout;
      clearTimer(this.signTimeoutId);
      const reject = this.pendingSign.reject;
      this.pendingSign = null;
      reject(error);
    }
  }
}
