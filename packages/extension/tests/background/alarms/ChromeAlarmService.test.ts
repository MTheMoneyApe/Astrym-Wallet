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
      },
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined),
        },
      },
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

  it('schedules from the current activity time using the default timeout', async () => {
    const service = new ChromeAlarmService();
    const lastActivityAt = Date.now();
    await service.schedule(lastActivityAt);
    expect(browser.alarms.create).toHaveBeenCalledWith(LOCK_ALARM_NAME, {
      when: lastActivityAt + LOCK_TIMEOUT_MINUTES * 60_000,
    });
  });

  it('preserves the configured timeout and persisted activity time when rescheduling', async () => {
    const lastActivityAt = Date.now() - 1_000;
    vi.mocked(browser.storage.local.get).mockResolvedValueOnce({
      [ChromeAlarmService.timeoutStorageKey]: 10,
      [ChromeAlarmService.activityStorageKey]: lastActivityAt,
    } as never);
    const service = new ChromeAlarmService();

    await service.schedule();

    expect(browser.alarms.create).toHaveBeenCalledWith(LOCK_ALARM_NAME, { when: lastActivityAt + 10 * 60_000 });
    expect(browser.storage.local.set).toHaveBeenCalledWith({
      [ChromeAlarmService.activityStorageKey]: lastActivityAt,
    });
  });

  it('validates session expiry against the persisted timeout and timestamp', async () => {
    vi.mocked(browser.storage.local.get).mockResolvedValueOnce({
      [ChromeAlarmService.timeoutStorageKey]: 1,
      [ChromeAlarmService.activityStorageKey]: 1_000,
    } as never);
    const service = new ChromeAlarmService();

    await expect(service.isSessionExpired(60_999)).resolves.toBe(false);
    vi.mocked(browser.storage.local.get).mockResolvedValueOnce({
      [ChromeAlarmService.timeoutStorageKey]: 1,
      [ChromeAlarmService.activityStorageKey]: 1_000,
    } as never);
    await expect(service.isSessionExpired(61_000)).resolves.toBe(true);
  });

  it('fails closed when there is no persisted activity timestamp', async () => {
    const service = new ChromeAlarmService();
    await expect(service.isSessionExpired()).resolves.toBe(true);
  });

  it('does not lock on a stale alarm if persisted activity moved the deadline', async () => {
    const lastActivityAt = Date.now();
    vi.mocked(browser.storage.local.get)
      .mockResolvedValueOnce({
        [ChromeAlarmService.timeoutStorageKey]: 5,
        [ChromeAlarmService.activityStorageKey]: lastActivityAt,
      } as never)
      .mockResolvedValueOnce({
        [ChromeAlarmService.timeoutStorageKey]: 5,
        [ChromeAlarmService.activityStorageKey]: lastActivityAt,
      } as never);
    const service = new ChromeAlarmService();
    const callback = vi.fn().mockResolvedValue(undefined);
    service.onAlarm(callback);
    const listener = vi.mocked(browser.alarms.onAlarm.addListener).mock.calls[0]![0];

    await listener({ name: LOCK_ALARM_NAME } as browser.Alarms.Alarm);

    expect(callback).not.toHaveBeenCalled();
    expect(browser.alarms.create).toHaveBeenCalledWith(LOCK_ALARM_NAME, {
      when: lastActivityAt + 5 * 60_000,
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
