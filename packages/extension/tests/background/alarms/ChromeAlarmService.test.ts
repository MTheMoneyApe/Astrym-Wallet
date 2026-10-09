import { describe, expect, it, vi, beforeEach } from 'vitest';
import browser from 'webextension-polyfill';
import { ChromeAlarmService } from '../../../src/background/alarms/ChromeAlarmService.js';
import { LOCK_ALARM_NAME, LOCK_TIMEOUT_MINUTES } from '@solanym/wallet-core/src/vault/IAlarmService.js';

vi.mock('webextension-polyfill', () => {
  return {
    default: {
      alarms: {
        create: vi.fn(),
        clear: vi.fn(),
        onAlarm: {
          addListener: vi.fn(),
        }
      }
    }
  };
});

describe('ChromeAlarmService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers listener on instantiation', () => {
    new ChromeAlarmService();
    expect(browser.alarms.onAlarm.addListener).toHaveBeenCalledTimes(1);
  });

  it('schedules alarm with correct constants', async () => {
    const service = new ChromeAlarmService();
    await service.schedule();
    expect(browser.alarms.create).toHaveBeenCalledWith(LOCK_ALARM_NAME, {
      delayInMinutes: LOCK_TIMEOUT_MINUTES
    });
  });

  it('cancels alarm with correct constants', async () => {
    const service = new ChromeAlarmService();
    await service.cancel();
    expect(browser.alarms.clear).toHaveBeenCalledWith(LOCK_ALARM_NAME);
  });

  it('triggers callback only for the target alarm name', async () => {
    const service = new ChromeAlarmService();
    const callback = vi.fn().mockResolvedValue(undefined);
    service.onAlarm(callback);

    // Extract the listener that was registered in constructor
    const listener = vi.mocked(browser.alarms.onAlarm.addListener).mock.calls[0]![0];

    // Wrong name
    await listener({ name: 'other_alarm' } as browser.Alarms.Alarm);
    expect(callback).not.toHaveBeenCalled();

    // Correct name
    await listener({ name: LOCK_ALARM_NAME } as browser.Alarms.Alarm);
    expect(callback).toHaveBeenCalledTimes(1);
  });
});

