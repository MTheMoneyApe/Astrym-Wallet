import { describe, expect, it, vi, beforeEach } from 'vitest';
vi.mock('webextension-polyfill', () => { return { default: { storage: { local: {} } } }; });
import { SIGNATURE_DRAIN_TIMEOUT_MS, stateCoordinator } from '../../src/background/StateCoordinator.js';
import { createSendTransferHandler, transferManager } from '../../src/background/handlers/transactionHandlers.js';
import type { TransactionClient } from '@solanym/wallet-core/src/solana/transaction/TransactionClient.js';

describe('Signing/Reset Concurrency', () => {
  describe('StateCoordinator Barrier (Unit Test)', () => {
    beforeEach(() => {
      (stateCoordinator as any)._state = 'READY';
      (stateCoordinator as any)._resetEpoch = 1;
      (stateCoordinator as any)._isResetting = false;
      (stateCoordinator as any)._activeSignatures = new Map();
      (stateCoordinator as any)._signatureDrainResolvers = [];
      (stateCoordinator as any)._lockRequested = false;
      (stateCoordinator as any)._lockOperation = null;
    });

    it('validateExit passes if epoch is unchanged', () => {
      const authorization = stateCoordinator.authorizeSignature();
      expect(stateCoordinator.validateExit(authorization)).toBe(true);
      stateCoordinator.endSignature(authorization);
    });

    it('validateExit fails if reset begins during signing', async () => {
      const authorization = stateCoordinator.authorizeSignature();
      (stateCoordinator as any)._isResetting = true;
      (stateCoordinator as any)._resetEpoch = 2;
      expect(stateCoordinator.validateExit(authorization)).toBe(false);
      stateCoordinator.endSignature(authorization);
    });
    
    it('cannot authorize if reset has already begun', () => {
      (stateCoordinator as any)._state = 'READY_WITH_MUTATION_LOCK';
      expect(() => stateCoordinator.authorizeSignature()).toThrow(/System is in a degraded or locked state/);
    });

    it('cannot authorize while the wallet is uninitialized', () => {
      (stateCoordinator as any)._state = 'UNINITIALIZED';
      expect(() => stateCoordinator.authorizeSignature()).toThrow(/System is in a degraded or locked state/);
    });

    it('waits for active signatures and rejects new signatures while locking', async () => {
      const authorization = stateCoordinator.authorizeSignature();
      const lock = vi.fn().mockResolvedValue(undefined);
      const lockPromise = stateCoordinator.runLockOperation(lock);

      expect(() => stateCoordinator.authorizeSignature()).toThrow(/System is in a degraded or locked state/);
      expect(lock).not.toHaveBeenCalled();
      expect(authorization.signal.aborted).toBe(true);
      expect(stateCoordinator.validateExit(authorization)).toBe(false);

      stateCoordinator.endSignature(authorization);
      await lockPromise;

      expect(lock).toHaveBeenCalledTimes(1);
      expect(stateCoordinator.state).toBe('LOCKED');
      expect(stateCoordinator.activeSignatures).toBe(0);
    });

    it('times out a never-ending signature and keeps its late result unauthorized', async () => {
      vi.useFakeTimers();
      const authorization = stateCoordinator.authorizeSignature();
      const lock = vi.fn().mockResolvedValue(undefined);
      const lockPromise = stateCoordinator.runLockOperation(lock);

      await vi.advanceTimersByTimeAsync(SIGNATURE_DRAIN_TIMEOUT_MS);
      await lockPromise;

      expect(lock).toHaveBeenCalledOnce();
      expect(stateCoordinator.state).toBe('LOCKED');
      expect(stateCoordinator.validateExit(authorization)).toBe(false);
      expect(() => stateCoordinator.assertSignatureActive(authorization)).toThrow(
        'Signature authorization is no longer active',
      );

      expect(stateCoordinator.activeSignatures).toBe(0);
      stateCoordinator.endSignature(authorization);
      expect(stateCoordinator.activeSignatures).toBe(0);
      vi.useRealTimers();
    });

    it('enters ERROR_STATE after lock failure and rejects every new signature', async () => {
      await expect(
        stateCoordinator.runLockOperation(async () => {
          throw new Error('session cleanup failed');
        }),
      ).rejects.toThrow('session cleanup failed');

      expect(stateCoordinator.state).toBe('ERROR_STATE');
      expect(() => stateCoordinator.authorizeSignature()).toThrow(
        /System is in a degraded or locked state/,
      );
    });

    it('preserves the mutation lock across an auto-lock operation', async () => {
      (stateCoordinator as any)._state = 'READY_WITH_MUTATION_LOCK';
      await stateCoordinator.runLockOperation(async () => undefined);
      expect(stateCoordinator.state).toBe('READY_WITH_MUTATION_LOCK');
    });
  });

  describe('Transaction Handler Integration', () => {
    beforeEach(() => {
      (stateCoordinator as any)._state = 'READY';
      (stateCoordinator as any)._resetEpoch = 1;
      (stateCoordinator as any)._isResetting = false;
      // Clear pending transfers
      (transferManager as any)._pendingTransfers.clear();
    });

    it('throws if reset is initiated during the async signing delay', async () => {
      // Setup a mock transaction client that delays its response
      let resolveSigning: (val: any) => void;
      const signingPromise = new Promise((resolve) => {
        resolveSigning = resolve;
      });

      const mockClient = {
        sendSol: vi.fn().mockImplementation(() => signingPromise)
      } as unknown as TransactionClient;

      // Seed a pending review so consumeReview works
      const id = transferManager.createReview({
        accountIndex: 0,
        destination: 'dest',
        lamports: '1000'
      });

      const handler = createSendTransferHandler(mockClient);

      // Start the handler, it will block on sendSol (the delay)
      const handlerPromise = handler({ id });

      // Simulate a reset initiating during this delay
      (stateCoordinator as any)._isResetting = true;
      (stateCoordinator as any)._resetEpoch = 2;

      // Unblock the signing
      resolveSigning!('mock_signature');

      // The handler should intercept the exit barrier and throw
      await expect(handlerPromise).rejects.toThrow('Wallet state changed during broadcast');
    });
  });
});
