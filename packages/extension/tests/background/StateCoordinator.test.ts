import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StateCoordinator } from '../../src/background/StateCoordinator.js';

vi.mock('webextension-polyfill', () => ({
  default: {
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
      },
    },
  },
}));

describe('StateCoordinator — Module 1B Stage 0 (UNCERTAIN_TRANSACTION & Context)', () => {
  let coordinator: StateCoordinator;

  beforeEach(async () => {
    coordinator = new StateCoordinator();
    // Simulate holistic initialization into LOCKED state
    await coordinator.initializeHolistic(true, true, false);
  });

  describe('1. State transitions: READY -> UNCERTAIN_TRANSACTION', () => {
    it('transitions from READY to UNCERTAIN_TRANSACTION and records context', () => {
      coordinator.setUnlocked();
      expect(coordinator.state).toBe('READY');
      expect(coordinator.getUncertainContext()).toBeNull();

      coordinator.enterUncertainTransaction(0, '0xabc123');

      expect(coordinator.state).toBe('UNCERTAIN_TRANSACTION');
      expect(coordinator.getUncertainContext()).toEqual({
        accountIndex: 0,
        txHash: '0xabc123',
      });
      expect(coordinator.uncertainContext).toEqual({
        accountIndex: 0,
        txHash: '0xabc123',
      });
    });

    it('transitions from READY_WITH_MUTATION_LOCK to UNCERTAIN_TRANSACTION', async () => {
      const lockCoordinator = new StateCoordinator();
      await lockCoordinator.initializeHolistic(true, true, true);
      expect(lockCoordinator.state).toBe('READY_WITH_MUTATION_LOCK');

      lockCoordinator.enterUncertainTransaction(1, '0xdef456');

      expect(lockCoordinator.state).toBe('UNCERTAIN_TRANSACTION');
      expect(lockCoordinator.getUncertainContext()).toEqual({
        accountIndex: 1,
        txHash: '0xdef456',
      });
    });
  });

  describe('2. Signature authorization rejection while uncertain', () => {
    it('rejects new signature authorizations when in UNCERTAIN_TRANSACTION state', () => {
      coordinator.setUnlocked();
      coordinator.enterUncertainTransaction(0, '0xtx1');

      expect(() => coordinator.authorizeSignature()).toThrow(
        /System is in a degraded or locked state \(UNCERTAIN_TRANSACTION\) and cannot sign/,
      );
    });

    it('assertSignatureActive rejects existing lease once state becomes UNCERTAIN_TRANSACTION', () => {
      coordinator.setUnlocked();
      const auth = coordinator.authorizeSignature();

      // State is READY, authorization active
      expect(() => coordinator.assertSignatureActive(auth)).not.toThrow();

      // Enter uncertain transaction
      coordinator.enterUncertainTransaction(0, '0xtx1');

      // assertSignatureActive must now reject
      expect(() => coordinator.assertSignatureActive(auth)).toThrow(
        /Signature authorization is no longer active/,
      );
    });
  });

  describe('3. Separation of signature lease cleanup and uncertain lock', () => {
    it('calling endSignature() does not release the uncertain lock or clear context', () => {
      coordinator.setUnlocked();
      const auth = coordinator.authorizeSignature();
      expect(coordinator.activeSignatures).toBe(1);

      // Transition to uncertain during broadcast
      coordinator.enterUncertainTransaction(0, '0xtx_broadcast');
      expect(coordinator.state).toBe('UNCERTAIN_TRANSACTION');

      // Finally block cleans up signature lease
      coordinator.endSignature(auth);
      expect(coordinator.activeSignatures).toBe(0);

      // Lock and context MUST remain intact
      expect(coordinator.state).toBe('UNCERTAIN_TRANSACTION');
      expect(coordinator.getUncertainContext()).toEqual({
        accountIndex: 0,
        txHash: '0xtx_broadcast',
      });

      // Subsequent signature authorization MUST still be rejected
      expect(() => coordinator.authorizeSignature()).toThrow(/UNCERTAIN_TRANSACTION/);
    });
  });

  describe('4. Resolution restores READY or preserves LOCKED', () => {
    it('resolveUncertainTransaction() restores READY when resolved from UNCERTAIN_TRANSACTION', () => {
      coordinator.setUnlocked();
      coordinator.enterUncertainTransaction(0, '0xtx_resolved');
      expect(coordinator.state).toBe('UNCERTAIN_TRANSACTION');

      coordinator.resolveUncertainTransaction();

      expect(coordinator.state).toBe('READY');
      expect(coordinator.getUncertainContext()).toBeNull();

      // Signing is now permitted again
      expect(() => coordinator.authorizeSignature()).not.toThrow();
    });

    it('resolveUncertainTransaction() clears context but preserves LOCKED if wallet is locked', () => {
      coordinator.setUnlocked();
      coordinator.enterUncertainTransaction(0, '0xtx_locked_resolve');
      coordinator.setLocked();
      expect(coordinator.state).toBe('LOCKED');
      expect(coordinator.getUncertainContext()).not.toBeNull();

      coordinator.resolveUncertainTransaction();

      // State must remain LOCKED
      expect(coordinator.state).toBe('LOCKED');
      expect(coordinator.getUncertainContext()).toBeNull();

      // Next unlock goes to READY (not UNCERTAIN_TRANSACTION)
      coordinator.setUnlocked();
      expect(coordinator.state).toBe('READY');
    });
  });

  describe('5. Context preservation across LOCKING -> LOCKED -> Unlock', () => {
    it('survives setLocked() -> setUnlocked() cycle without clearing uncertain state', () => {
      coordinator.setUnlocked();
      coordinator.enterUncertainTransaction(2, '0xtx_survive');
      expect(coordinator.state).toBe('UNCERTAIN_TRANSACTION');

      // Wallet auto-locks or user locks
      coordinator.setLocked();
      expect(coordinator.state).toBe('LOCKED');
      expect(coordinator.getUncertainContext()).toEqual({
        accountIndex: 2,
        txHash: '0xtx_survive',
      });

      // User unlocks wallet
      coordinator.setUnlocked();
      // MUST NOT return to READY; MUST return to UNCERTAIN_TRANSACTION
      expect(coordinator.state).toBe('UNCERTAIN_TRANSACTION');
      expect(coordinator.getUncertainContext()).toEqual({
        accountIndex: 2,
        txHash: '0xtx_survive',
      });

      // Signing must still be blocked
      expect(() => coordinator.authorizeSignature()).toThrow(/UNCERTAIN_TRANSACTION/);
    });

    it('survives runLockOperation() workflow and restores UNCERTAIN_TRANSACTION on unlock', async () => {
      coordinator.setUnlocked();
      coordinator.enterUncertainTransaction(0, '0xtx_mutex_lock');

      const mockLockAction = vi.fn().mockResolvedValue(undefined);
      await coordinator.runLockOperation(mockLockAction);

      expect(mockLockAction).toHaveBeenCalledOnce();
      expect(coordinator.state).toBe('LOCKED');
      expect(coordinator.getUncertainContext()).toEqual({
        accountIndex: 0,
        txHash: '0xtx_mutex_lock',
      });

      // Unlock restores UNCERTAIN_TRANSACTION
      coordinator.setUnlocked();
      expect(coordinator.state).toBe('UNCERTAIN_TRANSACTION');
      expect(() => coordinator.authorizeSignature()).toThrow(/UNCERTAIN_TRANSACTION/);
    });
  });

  describe('6. Module 1B Invariant: Single uncertain transaction & no overwrite', () => {
    it('rejects a second uncertain transaction with a different hash', () => {
      coordinator.setUnlocked();
      coordinator.enterUncertainTransaction(0, '0xfirst_hash');

      expect(() => coordinator.enterUncertainTransaction(1, '0xsecond_hash')).toThrow(
        /An uncertain transaction is already active in the wallet \(0xfirst_hash\)\. Overwriting is not permitted\./,
      );

      // Context must remain the original
      expect(coordinator.getUncertainContext()).toEqual({
        accountIndex: 0,
        txHash: '0xfirst_hash',
      });
    });

    it('allows idempotent re-entry with identical accountIndex and txHash', () => {
      coordinator.setUnlocked();
      coordinator.enterUncertainTransaction(0, '0xidempotent_hash');

      expect(() => coordinator.enterUncertainTransaction(0, '0xidempotent_hash')).not.toThrow();
      expect(coordinator.state).toBe('UNCERTAIN_TRANSACTION');
      expect(coordinator.getUncertainContext()).toEqual({
        accountIndex: 0,
        txHash: '0xidempotent_hash',
      });
    });
  });

  describe('7. Invalid state transitions & reset uncertainty safety', () => {
    it('throws when resolveUncertainTransaction() is called without active context', () => {
      coordinator.setUnlocked();
      expect(coordinator.getUncertainContext()).toBeNull();

      expect(() => coordinator.resolveUncertainTransaction()).toThrow(
        /No active uncertain transaction to resolve/,
      );
    });

    it('throws when enterUncertainTransaction() is called while ERROR_STATE', () => {
      coordinator.enterErrorState();
      expect(coordinator.state).toBe('ERROR_STATE');

      expect(() => coordinator.enterUncertainTransaction(0, '0xerr_hash')).toThrow(
        /System is in a degraded state \(ERROR_STATE\)/,
      );
    });

    it('throws when enterUncertainTransaction() is called while resetting', () => {
      coordinator.setUnlocked();
      coordinator.beginReset();
      expect(coordinator.isResetting).toBe(true);

      expect(() => coordinator.enterUncertainTransaction(0, '0xreset_hash')).toThrow(
        /Wallet reset in progress/,
      );
    });

    it('rejects beginReset() while an uncertain transaction exists and preserves context', () => {
      coordinator.setUnlocked();
      coordinator.enterUncertainTransaction(0, '0xto_be_protected');
      expect(coordinator.getUncertainContext()).not.toBeNull();
      expect(coordinator.state).toBe('UNCERTAIN_TRANSACTION');

      // Attempting to begin reset must be rejected
      expect(() => coordinator.beginReset()).toThrow(
        /Cannot reset wallet while an uncertain transaction is unresolved \(0xto_be_protected\)/,
      );

      // Verify reset was blocked and uncertain protection is fully preserved
      expect(coordinator.isResetting).toBe(false);
      expect(coordinator.state).toBe('UNCERTAIN_TRANSACTION');
      expect(coordinator.getUncertainContext()).toEqual({
        accountIndex: 0,
        txHash: '0xto_be_protected',
      });
      expect(() => coordinator.authorizeSignature()).toThrow(/UNCERTAIN_TRANSACTION/);
    });

    it('finishReset() throws fail-closed and cannot silently clear an unresolved context', () => {
      coordinator.setUnlocked();
      coordinator.enterUncertainTransaction(0, '0xcannot_clear');

      // If finishReset() is invoked while context is active, it must reject
      expect(() => coordinator.finishReset()).toThrow(
        /Cannot complete reset while an uncertain transaction is unresolved \(0xcannot_clear\)/,
      );

      // Context must remain intact and not silently cleared
      expect(coordinator.getUncertainContext()).toEqual({
        accountIndex: 0,
        txHash: '0xcannot_clear',
      });
      expect(coordinator.state).toBe('UNCERTAIN_TRANSACTION');
    });

    it('normal reset without uncertainty reaches UNINITIALIZED successfully', () => {
      coordinator.setUnlocked();
      expect(coordinator.state).toBe('READY');
      expect(coordinator.getUncertainContext()).toBeNull();

      coordinator.beginReset();
      expect(coordinator.isResetting).toBe(true);

      coordinator.finishReset();
      expect(coordinator.isResetting).toBe(false);
      expect(coordinator.state).toBe('UNINITIALIZED');
      expect(coordinator.getUncertainContext()).toBeNull();
    });
  });

  describe('8. Wallet lock/unlock cycles do not accidentally permit signing while uncertainty remains', () => {
    it('blocks signing across multiple lock and unlock cycles until explicitly resolved', () => {
      coordinator.setUnlocked();
      coordinator.enterUncertainTransaction(3, '0xcycle_hash');

      // Cycle 1: Lock -> attempt signing
      coordinator.setLocked();
      expect(coordinator.state).toBe('LOCKED');
      expect(() => coordinator.authorizeSignature()).toThrow(/LOCKED/);

      // Cycle 1: Unlock -> attempt signing
      coordinator.setUnlocked();
      expect(coordinator.state).toBe('UNCERTAIN_TRANSACTION');
      expect(() => coordinator.authorizeSignature()).toThrow(/UNCERTAIN_TRANSACTION/);

      // Cycle 2: Lock again -> attempt signing
      coordinator.setLocked();
      expect(coordinator.state).toBe('LOCKED');
      expect(() => coordinator.authorizeSignature()).toThrow(/LOCKED/);

      // Cycle 2: Unlock again -> attempt signing
      coordinator.setUnlocked();
      expect(coordinator.state).toBe('UNCERTAIN_TRANSACTION');
      expect(() => coordinator.authorizeSignature()).toThrow(/UNCERTAIN_TRANSACTION/);

      // Only explicit resolution unblocks signing
      coordinator.resolveUncertainTransaction();
      expect(coordinator.state).toBe('READY');
      expect(() => coordinator.authorizeSignature()).not.toThrow();
    });

    it('enterUncertainTransaction while in LOCKED records context and prevents unlock to READY', () => {
      expect(coordinator.state).toBe('LOCKED');

      // An uncertain outcome reported while wallet was already locked
      coordinator.enterUncertainTransaction(0, '0xlate_lock');
      expect(coordinator.state).toBe('LOCKED'); // Retains locked
      expect(coordinator.getUncertainContext()).toEqual({
        accountIndex: 0,
        txHash: '0xlate_lock',
      });

      // When user enters password and unlocks:
      coordinator.setUnlocked();
      expect(coordinator.state).toBe('UNCERTAIN_TRANSACTION');
      expect(() => coordinator.authorizeSignature()).toThrow(/UNCERTAIN_TRANSACTION/);
    });
  });
});
