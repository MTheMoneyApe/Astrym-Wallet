import browser from 'webextension-polyfill';
import {
  LOCK_ALARM_NAME,
  LOCK_TIMEOUT_MINUTES,
  LOCK_TIMEOUT_OPTIONS_MINUTES,
} from '@solanym/wallet-core/src/vault/IAlarmService.js';
import type { IAlarmService, LockTimeoutMinutes } from '@solanym/wallet-core/src/vault/IAlarmService.js';

export class ChromeAlarmService implements IAlarmService {
  public static readonly timeoutStorageKey = 'solanym_auto_lock_timeout_minutes';
  public static readonly activityStorageKey = 'solanym_auto_lock_last_activity';
  private _callback: (() => Promise<void>) | null = null;

  constructor(
    private readonly _lockWithBarrier: ((lock: () => Promise<void>) => Promise<void>) | null = null,
  ) {
    // Register the listener once.
    browser.alarms.onAlarm.addListener(this._handleAlarm.bind(this));
  }

  public async schedule(lastActivityAt?: number): Promise<void> {
    const storage = await browser.storage.local.get([
      ChromeAlarmService.timeoutStorageKey,
      ChromeAlarmService.activityStorageKey,
    ]);
    const configuredTimeout = storage[ChromeAlarmService.timeoutStorageKey];
    const timeout = this._isAllowedTimeout(configuredTimeout)
      ? configuredTimeout
      : LOCK_TIMEOUT_MINUTES;
    const storedActivity = storage[ChromeAlarmService.activityStorageKey];
    const activityAt = lastActivityAt ?? (
      typeof storedActivity === 'number' && Number.isFinite(storedActivity)
        ? storedActivity
        : Date.now()
    );

    if (!Number.isFinite(activityAt) || activityAt <= 0 || activityAt > Date.now()) {
      throw new Error('Invalid auto-lock activity timestamp');
    }

    await browser.storage.local.set({
      [ChromeAlarmService.activityStorageKey]: activityAt,
    });
    await browser.alarms.create(LOCK_ALARM_NAME, {
      when: activityAt + timeout * 60_000,
    });
  }

  public async getTimeoutMinutes(): Promise<LockTimeoutMinutes> {
    const result = await browser.storage.local.get(ChromeAlarmService.timeoutStorageKey);
    const value = result[ChromeAlarmService.timeoutStorageKey];
    return this._isAllowedTimeout(value) ? value : LOCK_TIMEOUT_MINUTES;
  }

  public async setTimeoutMinutes(timeoutMinutes: LockTimeoutMinutes): Promise<void> {
    if (!this._isAllowedTimeout(timeoutMinutes)) {
      throw new Error('Unsupported auto-lock timeout');
    }

    await browser.storage.local.set({
      [ChromeAlarmService.timeoutStorageKey]: timeoutMinutes,
    });
    await this.schedule(Date.now());
  }

  public async isSessionExpired(now = Date.now()): Promise<boolean> {
    const storage = await browser.storage.local.get([
      ChromeAlarmService.timeoutStorageKey,
      ChromeAlarmService.activityStorageKey,
    ]);
    const timestamp = storage[ChromeAlarmService.activityStorageKey];
    if (
      typeof timestamp !== 'number' ||
      !Number.isFinite(timestamp) ||
      timestamp <= 0 ||
      timestamp > now
    ) {
      return true;
    }

    const configuredTimeout = storage[ChromeAlarmService.timeoutStorageKey];
    const timeout = this._isAllowedTimeout(configuredTimeout)
      ? configuredTimeout
      : LOCK_TIMEOUT_MINUTES;
    return now >= timestamp + timeout * 60_000;
  }

  public async cancel(): Promise<void> {
    await browser.alarms.clear(LOCK_ALARM_NAME);
  }

  public onAlarm(callback: () => Promise<void>): void {
    this._callback = callback;
  }

  private async _handleAlarm(alarm: browser.Alarms.Alarm): Promise<void> {
    if (alarm.name === LOCK_ALARM_NAME) {
      if (this._callback) {
        try {
          try {
            if (!await this.isSessionExpired()) {
              await this.schedule();
              return;
            }
          } catch {
            // If expiry cannot be verified or the alarm cannot be renewed, lock instead.
          }
          const callback = this._callback;
          await (this._lockWithBarrier
            ? this._lockWithBarrier(callback)
            : callback());
        } catch {
          // Alarm callbacks must not become unhandled service-worker errors.
        }
      }
    }
  }

  private _isAllowedTimeout(value: unknown): value is LockTimeoutMinutes {
    return LOCK_TIMEOUT_OPTIONS_MINUTES.some((option) => option === value);
  }
}
