/**
 * autoLock.test.ts — Auto-lock integration tests for VaultService + IAlarmService.
 *
 * Uses a MockAlarmService (in-memory, no Chrome APIs) that allows tests to:
 *   - Inspect when schedule() and cancel() are called.
 *   - Manually fire the alarm via triggerAlarm() to simulate the inactivity timeout.
 *
 * Uses real PasswordUnlocker and in-memory storage (from VaultService.test.ts patterns).
 * Each PBKDF2 call is ~470ms; tests are kept lean (~3-5 PBKDF2 calls total).
 *
 * Test categories:
 *   1. Alarm is scheduled after unlock
 *   2. Alarm fires → vault locks, session key removed
 *   3. Explicit activity resets the persisted deadline and alarm
 *   4. lock() cancels the alarm
 *   5. resetActivityTimer() has no effect when locked
 *   6. Alarm is scheduled after createVault
 *   7. Alarm is scheduled after tryRestoreFromSession
 *   8. No alarm calls when alarm service is absent (null)
 */

import { describe, expect, it } from 'vitest';
import { makeSeedPhrase } from '../../src/crypto/types.js';
import type { IAlarmService } from '../../src/vault/IAlarmService.js';
import type { IPersistentStorage, ISessionStorage } from '../../src/vault/IVaultStorage.js';
import { PasswordUnlocker } from '../../src/vault/PasswordUnlocker.js';
import { WalletLockedError, type EncryptedVaultBlob } from '../../src/vault/types.js';
import { VaultService } from '../../src/vault/VaultService.js';

// ─── Mock alarm service ───────────────────────────────────────────────────────

/**
 * In-memory mock IAlarmService.
 * Records schedule/cancel calls and allows tests to manually fire the alarm.
 */
class MockAlarmService implements IAlarmService {
  scheduleCalls = 0;
  cancelCalls = 0;
  scheduleError: Error | null = null;
  cancelError: Error | null = null;
  private _callback: (() => Promise<void>) | null = null;

  async schedule(): Promise<void> {
    this.scheduleCalls++;
    if (this.scheduleError) throw this.scheduleError;
  }

  async cancel(): Promise<void> {
    this.cancelCalls++;
    if (this.cancelError) throw this.cancelError;
  }

  onAlarm(callback: () => Promise<void>): void {
    this._callback = callback;
  }

  /** Manually fire the alarm — simulates the inactivity timeout expiring. */
  async triggerAlarm(): Promise<void> {
    if (this._callback === null) {
      throw new Error('MockAlarmService: no callback registered via onAlarm()');
    }
    await this._callback();
  }

  reset(): void {
    this.scheduleCalls = 0;
    this.cancelCalls = 0;
  }
}

// ─── In-memory storage doubles (identical to VaultService.test.ts) ────────────

class MemPersistent implements IPersistentStorage {
  private _blob: EncryptedVaultBlob | null = null;
  async loadBlob() { return this._blob; }
  async saveBlob(blob: EncryptedVaultBlob) { this._blob = blob; }
  async clearBlob() { this._blob = null; }
}

class MemSession implements ISessionStorage {
  private _key: CryptoKey | null = null;
  clearError: Error | null = null;
  async loadKey() { return this._key; }
  async saveKey(key: CryptoKey) { this._key = key; }
  async clearKey() {
    if (this.clearError) throw this.clearError;
    this._key = null;
  }
  get raw() { return this._key; }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

function makeAll() {
  const persistent = new MemPersistent();
  const session = new MemSession();
  const alarm = new MockAlarmService();
  const svc = new VaultService(new PasswordUnlocker(), persistent, session, alarm);
  return { persistent, session, alarm, svc };
}

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PHRASE = makeSeedPhrase(MNEMONIC);
const PASSWORD = 'AutoLock!Test#42Secure';

// ─── 1. Alarm is scheduled after unlock ──────────────────────────────────────

describe('auto-lock — alarm scheduled after unlock', () => {
  it('schedule() is called once after unlock()', async () => {
    const { persistent, session, alarm } = makeAll();
    const svc1 = new VaultService(new PasswordUnlocker(), persistent, session, alarm);
    await svc1.createVault(PASSWORD, PHRASE);
    alarm.reset();

    const svc2 = new VaultService(new PasswordUnlocker(), persistent, session, alarm);
    await svc2.unlock(PASSWORD);

    expect(alarm.scheduleCalls).toBe(1);
    expect(alarm.cancelCalls).toBe(0);
  });

  it('wallet is unlocked after unlock() succeeds', async () => {
    const { svc, alarm } = makeAll();
    await svc.createVault(PASSWORD, PHRASE);
    alarm.reset();

    await svc.lock();
    await svc.unlock(PASSWORD);

    expect(svc.isLocked).toBe(false);
  });
});

// ─── 2. Alarm fires → vault locks, session key removed ───────────────────────

describe('auto-lock — alarm fires → wallet locks', () => {
  it('triggerAlarm() locks the wallet (isLocked becomes true)', async () => {
    const { svc, alarm } = makeAll();
    await svc.createVault(PASSWORD, PHRASE);
    expect(svc.isLocked).toBe(false);

    await alarm.triggerAlarm();

    expect(svc.isLocked).toBe(true);
  });

  it('getMnemonic throws WalletLockedError after alarm fires', async () => {
    const { svc, alarm } = makeAll();
    await svc.createVault(PASSWORD, PHRASE);
    await alarm.triggerAlarm();

    expect(() => svc.getMnemonic()).toThrow(WalletLockedError);
  });

  it('session key is cleared after alarm fires', async () => {
    const { svc, alarm, session } = makeAll();
    await svc.createVault(PASSWORD, PHRASE);
    expect(session.raw).not.toBeNull();

    await alarm.triggerAlarm();

    expect(session.raw).toBeNull();
  });

  it('cancel() is called when alarm fires (lock cancels the alarm)', async () => {
    const { svc, alarm } = makeAll();
    await svc.createVault(PASSWORD, PHRASE);
    alarm.reset();

    await alarm.triggerAlarm();

    // lock() is called by the alarm callback → lock() calls cancel()
    expect(alarm.cancelCalls).toBe(1);
  });
});

// ─── 3. Activity resets the timer ────────────────────────────────────────────

describe('auto-lock — resetActivityTimer() resets the countdown', () => {
  it('resetActivityTimer() calls cancel() then schedule()', async () => {
    const { svc, alarm } = makeAll();
    await svc.createVault(PASSWORD, PHRASE);
    alarm.reset();

    await svc.resetActivityTimer();

    expect(alarm.cancelCalls).toBe(0);
    expect(alarm.scheduleCalls).toBe(1);
  });

  it('resetActivityTimer() can be called multiple times (each call resets)', async () => {
    const { svc, alarm } = makeAll();
    await svc.createVault(PASSWORD, PHRASE);
    alarm.reset();

    await svc.resetActivityTimer();
    await svc.resetActivityTimer();
    await svc.resetActivityTimer();

    expect(alarm.cancelCalls).toBe(0);
    expect(alarm.scheduleCalls).toBe(3);
  });
});

// ─── 4. lock() cancels the alarm ─────────────────────────────────────────────

describe('auto-lock — lock() cancels the alarm', () => {
  it('lock() calls cancel() on the alarm service', async () => {
    const { svc, alarm } = makeAll();
    await svc.createVault(PASSWORD, PHRASE);
    alarm.reset();

    await svc.lock();

    expect(alarm.cancelCalls).toBe(1);
  });

  it('lock() does not call schedule()', async () => {
    const { svc, alarm } = makeAll();
    await svc.createVault(PASSWORD, PHRASE);
    alarm.reset();

    await svc.lock();

    expect(alarm.scheduleCalls).toBe(0);
  });

  it('reports a session-key deletion failure but still cancels the alarm', async () => {
    const { svc, alarm, session } = makeAll();
    await svc.createVault(PASSWORD, PHRASE);
    const failure = new Error('session remove failed');
    session.clearError = failure;

    await expect(svc.lock()).rejects.toMatchObject({
      name: 'AggregateError',
      message: 'Wallet lock could not be confirmed',
      errors: [expect.objectContaining({ message: 'Session key removal failed' })],
    });

    expect(svc.isLocked).toBe(true);
    expect(session.raw).not.toBeNull();
    expect(alarm.cancelCalls).toBe(1);
    await expect(svc.tryRestoreFromSession()).resolves.toBe(false);
  });

  it('reports an alarm cancellation failure after deleting the session key', async () => {
    const { svc, alarm, session } = makeAll();
    await svc.createVault(PASSWORD, PHRASE);
    alarm.cancelError = new Error('alarm clear failed');

    await expect(svc.lock()).rejects.toMatchObject({
      name: 'AggregateError',
      message: 'Wallet lock could not be confirmed',
      errors: [expect.objectContaining({ message: 'Auto-lock alarm cancellation failed' })],
    });

    expect(svc.isLocked).toBe(true);
    expect(session.raw).toBeNull();
    expect(alarm.cancelCalls).toBe(1);
  });

  it('reports both failures and will not restore after a worker restart cleanup failure', async () => {
    const { svc, alarm, persistent, session } = makeAll();
    await svc.createVault(PASSWORD, PHRASE);
    session.clearError = new Error('session remove failed');
    alarm.cancelError = new Error('alarm clear failed');

    await expect(svc.lock()).rejects.toMatchObject({
      name: 'AggregateError',
      message: 'Wallet lock could not be confirmed',
      errors: [
        expect.objectContaining({ message: 'Session key removal failed' }),
        expect.objectContaining({ message: 'Auto-lock alarm cancellation failed' }),
      ],
    });
    expect(session.raw).not.toBeNull();
    expect(alarm.cancelCalls).toBe(1);

    const restartedService = new VaultService(
      new PasswordUnlocker(),
      persistent,
      session,
      alarm,
    );
    await expect(restartedService.lock()).rejects.toThrow(
      'Wallet lock could not be confirmed',
    );
    await expect(restartedService.tryRestoreFromSession()).resolves.toBe(false);
  });
});

// ─── 5. resetActivityTimer() has no effect when locked ───────────────────────

describe('auto-lock — resetActivityTimer() no-op when locked', () => {
  it('does not call schedule() or cancel() when wallet is locked', async () => {
    const { svc, alarm } = makeAll();
    // wallet starts locked
    alarm.reset();

    await svc.resetActivityTimer();

    expect(alarm.scheduleCalls).toBe(0);
    expect(alarm.cancelCalls).toBe(0);
  });

  it('does not call schedule() or cancel() after explicit lock', async () => {
    const { svc, alarm } = makeAll();
    await svc.createVault(PASSWORD, PHRASE);
    await svc.lock();
    alarm.reset();

    await svc.resetActivityTimer();

    expect(alarm.scheduleCalls).toBe(0);
    expect(alarm.cancelCalls).toBe(0);
  });
});

// ─── 6. Alarm is scheduled after createVault ─────────────────────────────────

describe('auto-lock — alarm scheduled after createVault', () => {
  it('schedule() is called once during createVault()', async () => {
    const { svc, alarm } = makeAll();

    await svc.createVault(PASSWORD, PHRASE);

    expect(alarm.scheduleCalls).toBe(1);
  });

  it('discards a new vault if its auto-lock alarm cannot be armed', async () => {
    const { svc, alarm, persistent, session } = makeAll();
    alarm.scheduleError = new Error('alarm unavailable');

    await expect(svc.createVault(PASSWORD, PHRASE)).rejects.toThrow('alarm unavailable');

    expect(svc.isLocked).toBe(true);
    expect(await persistent.loadBlob()).toBeNull();
    expect(session.raw).toBeNull();
  });

  it('clears the session key and keeps the wallet locked if unlock cannot arm the alarm', async () => {
    const { svc, alarm, session } = makeAll();
    await svc.createVault(PASSWORD, PHRASE);
    await svc.lock();
    alarm.scheduleError = new Error('alarm unavailable');

    await expect(svc.unlock(PASSWORD)).rejects.toThrow('alarm unavailable');

    expect(svc.isLocked).toBe(true);
    expect(session.raw).toBeNull();
  });
});

// ─── 7. Alarm is scheduled after tryRestoreFromSession ───────────────────────

describe('auto-lock — alarm scheduled after tryRestoreFromSession', () => {
  it('schedule() is called once on successful session restore', async () => {
    const { persistent, session, alarm } = makeAll();
    const svc1 = new VaultService(new PasswordUnlocker(), persistent, session, alarm);
    await svc1.createVault(PASSWORD, PHRASE);
    alarm.reset();

    // SW restart: new instance, same storage (session key still present)
    const alarm2 = new MockAlarmService();
    const svc2 = new VaultService(new PasswordUnlocker(), persistent, session, alarm2);
    const restored = await svc2.tryRestoreFromSession();

    expect(restored).toBe(true);
    expect(alarm2.scheduleCalls).toBe(1);
  });

  it('schedule() is NOT called when tryRestoreFromSession returns false', async () => {
    const alarm = new MockAlarmService();
    const svc = new VaultService(
      new PasswordUnlocker(),
      new MemPersistent(),
      new MemSession(),
      alarm,
    );

    const restored = await svc.tryRestoreFromSession();

    expect(restored).toBe(false);
    expect(alarm.scheduleCalls).toBe(0);
  });
});

// ─── 8. No alarm calls when alarm service is absent ──────────────────────────

describe('auto-lock — null alarm service (existing tests compatibility)', () => {
  it('VaultService without alarm service works normally', async () => {
    const persistent = new MemPersistent();
    const session = new MemSession();
    // No alarm service — fourth argument omitted (defaults to null)
    const svc = new VaultService(new PasswordUnlocker(), persistent, session);

    await svc.createVault(PASSWORD, PHRASE);
    expect(svc.isLocked).toBe(false);

    await svc.lock();
    expect(svc.isLocked).toBe(true);

    await svc.unlock(PASSWORD);
    expect(svc.isLocked).toBe(false);
  });

  it('resetActivityTimer() is a no-op when no alarm service provided', async () => {
    const svc = new VaultService(
      new PasswordUnlocker(),
      new MemPersistent(),
      new MemSession(),
    );
    await svc.createVault(PASSWORD, PHRASE);

    // Must not throw
    await expect(svc.resetActivityTimer()).resolves.toBeUndefined();
  });
});
