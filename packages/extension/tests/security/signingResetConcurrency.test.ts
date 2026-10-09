import { describe, expect, it, vi, beforeEach } from 'vitest';
vi.mock('webextension-polyfill', () => { return { default: { storage: { local: {} } } }; });
import { stateCoordinator } from '../../src/background/StateCoordinator.js';
import { createSendTransferHandler, transferManager } from '../../src/background/handlers/transactionHandlers.js';
import type { TransactionClient } from '@solanym/wallet-core/src/solana/transaction/TransactionClient.js';

describe('Signing/Reset Concurrency', () => {
  describe('StateCoordinator Barrier (Unit Test)', () => {
    beforeEach(() => {
      (stateCoordinator as any)._state = 'READY';
      (stateCoordinator as any)._resetEpoch = 1;
      (stateCoordinator as any)._isResetting = false;
    });

    it('validateExit passes if epoch is unchanged', () => {
      const epoch = stateCoordinator.authorizeSignature();
      expect(stateCoordinator.validateExit(epoch)).toBe(true);
    });

    it('validateExit fails if reset begins during signing', async () => {
      const epoch = stateCoordinator.authorizeSignature();
      (stateCoordinator as any)._isResetting = true;
      (stateCoordinator as any)._resetEpoch = 2;
      expect(stateCoordinator.validateExit(epoch)).toBe(false);
    });
    
    it('cannot authorize if reset has already begun', () => {
      (stateCoordinator as any)._state = 'READY_WITH_MUTATION_LOCK';
      expect(() => stateCoordinator.authorizeSignature()).toThrow(/System is in a degraded or locked state/);
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
