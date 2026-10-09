import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { PendingRequestManager, RequestAlreadyPendingError, UserRejectedError } from '../../src/background/dapp/PendingRequestManager.js';

describe('PendingRequestManager', () => {
  let manager: PendingRequestManager;

  beforeEach(() => {
    manager = new PendingRequestManager();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('first signing request becomes pending', async () => {
    const promise = manager.createSignRequest('https://example.com', {
      account: 'A', destination: 'B', amountLamports: '1', estimatedFeeLamports: '1', program: 'System Program (Transfer)'
    }, new Uint8Array(), 0, 'mock-pubkey');
    
    expect(manager.getPendingSign()).toBeDefined();
    expect(manager.getPendingSign()?.origin).toBe('https://example.com');
  });

  it('second signing request immediately rejected', async () => {
    manager.createSignRequest('https://example.com', {
      account: 'A', destination: 'B', amountLamports: '1', estimatedFeeLamports: '1', program: 'System Program (Transfer)'
    }, new Uint8Array(), 0, 'mock-pubkey');
    
    await expect(manager.createSignRequest('https://evil.com', {
      account: 'A', destination: 'B', amountLamports: '1', estimatedFeeLamports: '1', program: 'System Program (Transfer)'
    }, new Uint8Array(), 0, 'mock-pubkey')).rejects.toThrow(RequestAlreadyPendingError);
  });

  it('2-minute timeout rejects pending request', async () => {
    const promise = manager.createSignRequest('https://example.com', {
      account: 'A', destination: 'B', amountLamports: '1', estimatedFeeLamports: '1', program: 'System Program (Transfer)'
    }, new Uint8Array(), 0, 'mock-pubkey');
    
    expect(manager.getPendingSign()).toBeDefined();
    
    // Advance timers by 2 mins
    vi.advanceTimersByTime(120_000);
    
    await expect(promise).rejects.toThrow(UserRejectedError);
    expect(manager.getPendingSign()).toBeNull();
  });
  
  it('popup rejection clears pending state', async () => {
    const promise = manager.createSignRequest('https://example.com', {
      account: 'A', destination: 'B', amountLamports: '1', estimatedFeeLamports: '1', program: 'System Program (Transfer)'
    }, new Uint8Array(), 0, 'mock-pubkey');
    
    const req = manager.getPendingSign()!;
    manager.rejectSign(new UserRejectedError(), req.internalRequestId);
    
    await expect(promise).rejects.toThrow(UserRejectedError);
    expect(manager.getPendingSign()).toBeNull();
  });
  
  it('popup approval resolves with signature', async () => {
    const promise = manager.createSignRequest('https://example.com', {
      account: 'A', destination: 'B', amountLamports: '1', estimatedFeeLamports: '1', program: 'System Program (Transfer)'
    }, new Uint8Array(), 0, 'mock-pubkey');
    
    const req = manager.getPendingSign()!;
    const mockResult = { signature: 'sig', transactionBase64: 'b64' };
    manager.approveSign(req.internalRequestId, mockResult);
    
    const result = await promise;
    expect(result).toBe(mockResult);
    expect(manager.getPendingSign()).toBeNull();
  });

  it('Test E — Duplicate approval (Double resolve)', async () => {
    const promise = manager.createSignRequest('https://example.com', {
      account: 'A', destination: 'B', amountLamports: '1', estimatedFeeLamports: '1', program: 'System Program (Transfer)'
    }, new Uint8Array(), 0, 'mock-pubkey');
    
    const req = manager.getPendingSign()!;
    const mockResult = { signature: 'sig', transactionBase64: 'b64' };
    
    // First approval resolves
    manager.approveSign(req.internalRequestId, mockResult);
    
    // Attempt second approval
    manager.approveSign(req.internalRequestId, { signature: 'sig2', transactionBase64: 'b64-2' });
    
    const result = await promise;
    expect(result.signature).toBe('sig');
    
    // State is null, no second request gets resolved
    expect(manager.getPendingSign()).toBeNull();
  });

  it('Test F — Expired request cannot be approved', async () => {
    const promise = manager.createSignRequest('https://example.com', {
      account: 'A', destination: 'B', amountLamports: '1', estimatedFeeLamports: '1', program: 'System Program (Transfer)'
    }, new Uint8Array(), 0, 'mock-pubkey');
    
    const req = manager.getPendingSign()!;
    
    // Advance timers by 2 mins to expire it
    vi.advanceTimersByTime(120_000);
    
    await expect(promise).rejects.toThrow(UserRejectedError);
    
    // Attempt to approve it afterward
    manager.approveSign(req.internalRequestId, { signature: 'sig', transactionBase64: 'b64' });
    
    // State is null, and promise already rejected
    expect(manager.getPendingSign()).toBeNull();
  });

  // CONNECT Single-Flight Tests
  it('connect single-flight: rejects second request and preserves first request', async () => {
    // 1. First CONNECT request remains pending.
    const promise1 = manager.createConnectRequest('https://first.com');
    
    const pendingReq1 = manager.getPendingConnect();
    expect(pendingReq1).toBeDefined();
    expect(pendingReq1?.origin).toBe('https://first.com');
    const firstReqId = pendingReq1?.internalRequestId;

    // 2. Second CONNECT request is rejected immediately with RequestAlreadyPendingError.
    await expect(manager.createConnectRequest('https://second.com')).rejects.toThrow(RequestAlreadyPendingError);
    
    // 4. The second request cannot replace or interfere with the first request.
    const pendingReqAfter = manager.getPendingConnect();
    expect(pendingReqAfter?.origin).toBe('https://first.com');
    expect(pendingReqAfter?.internalRequestId).toBe(firstReqId);
    // 6. No queue is created (pendingConnect is exactly the first one, there's no queue array).
    
    // 3. The first request can still resolve normally.
    manager.approveConnect(firstReqId!);
    await expect(promise1).resolves.toBe(true);
    
    expect(manager.getPendingConnect()).toBeNull();
  });

  it('connect single-flight: original timeout remains associated with first request', async () => {
    const promise1 = manager.createConnectRequest('https://first.com');
    
    // Attempt second request, which fails immediately
    await expect(manager.createConnectRequest('https://second.com')).rejects.toThrow(RequestAlreadyPendingError);

    // 5. The original timeout remains associated with the first request.
    // Advance timers by 2 mins (120,000 ms)
    vi.advanceTimersByTime(120_000);
    
    // First request should reject due to timeout
    await expect(promise1).rejects.toThrow(UserRejectedError);
    expect(manager.getPendingConnect()).toBeNull();
  });
});


