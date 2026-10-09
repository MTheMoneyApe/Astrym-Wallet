import browser from 'webextension-polyfill';
import { IAlarmService, LOCK_ALARM_NAME, LOCK_TIMEOUT_MINUTES } from '@solanym/wallet-core/src/vault/IAlarmService.js';

export class ChromeAlarmService implements IAlarmService {
  private _callback: (() => Promise<void>) | null = null;

  constructor() {
    // Register the listener once.
    browser.alarms.onAlarm.addListener(this._handleAlarm.bind(this));
  }

  public async schedule(): Promise<void> {
    await browser.alarms.create(LOCK_ALARM_NAME, {
      delayInMinutes: LOCK_TIMEOUT_MINUTES
    });
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
          await this._callback();
        } catch (e) {
          // Expected to safely swallow. Alarm handlers shouldn't crash SW.
        }
      }
    }
  }
}
