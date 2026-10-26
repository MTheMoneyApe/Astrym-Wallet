/**
 * vault/IAlarmService.ts — Alarm abstraction for auto-lock.
 *
 * Decouples VaultService from chrome.alarms so that:
 *   1. wallet-core has no direct dependency on Chrome extension APIs.
 *   2. Tests can use an in-memory mock (MockAlarmService) without the Chrome runtime.
 *
 * The production implementation (ChromeAlarmService) lives in packages/extension.
 *
 * SECURITY:
 *   - The alarm is the ONLY mechanism for inactivity-based auto-lock in wallet-core.
 *   - setTimeout is NOT used — it does not survive SW suspension.
 *   - Only one named alarm is used (LOCK_ALARM_NAME). Any implementation
 *     that fires the alarm MUST result in VaultService.lock() being called.
 */

/** The name of the alarm used for auto-lock. */
export const LOCK_ALARM_NAME = 'solanym_auto_lock' as const;

/** Auto-lock inactivity timeout in minutes (matches plan constant). */
export const LOCK_TIMEOUT_MINUTES = 5 as const;

export const LOCK_TIMEOUT_OPTIONS_MINUTES = [1, 5, 10, 15, 30] as const;
export type LockTimeoutMinutes = (typeof LOCK_TIMEOUT_OPTIONS_MINUTES)[number];

export interface IAlarmService {
  /**
   * Schedule the auto-lock alarm from the last real user-activity timestamp.
   * Omitting the timestamp preserves the persisted activity time.
   */
  schedule(lastActivityAt?: number): Promise<void>;

  /**
   * Cancel any pending auto-lock alarm.
   *
   * Called by VaultService.lock() so a manual lock does not leave a
   * ghost alarm that fires after an already-locked wallet.
   */
  cancel(): Promise<void>;

  /**
   * Register a one-time callback to invoke when the alarm fires.
   *
   * The callback must call VaultService.lock() (or equivalent).
   * Implementations should ensure the callback is called at most once
   * per alarm event — not buffered across SW restarts.
   *
   * @param callback - Async handler; errors must not propagate to the alarm system.
   */
  onAlarm(callback: () => Promise<void>): void;
}
