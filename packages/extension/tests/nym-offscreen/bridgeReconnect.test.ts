import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createOffscreenBridgeReconnectController,
  dispatchOffscreenBridgePortMessage,
  registerOffscreenBridgePagehideHandler,
  type OffscreenBridgeAttemptCallbacks,
} from '../../src/nym-offscreen/bridgeReconnect.js';
import { NYM_OFFSCREEN_BRIDGE_AUTHENTICATED_SIGNAL } from '../../src/nym-offscreen/protocol.js';

describe('Offscreen bridge reconnect policy', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows only one active connection attempt and bounds retries with exponential backoff', () => {
    vi.useFakeTimers();
    const attempts: OffscreenBridgeAttemptCallbacks[] = [];
    const onRetryLimitReached = vi.fn();
    const controller = createOffscreenBridgeReconnectController(
      (callbacks) => attempts.push(callbacks),
      onRetryLimitReached,
    );

    controller.start();
    controller.start();
    expect(attempts).toHaveLength(1);

    const delays = [250, 500, 1_000, 2_000, 4_000];
    const firstAttempt = attempts.at(0);
    if (!firstAttempt) throw new Error('Expected initial connection attempt');
    firstAttempt.onDisconnect();
    firstAttempt.onDisconnect();
    for (let index = 0; index < delays.length; index += 1) {
      const delay = delays.at(index);
      if (delay === undefined) throw new Error('Expected configured retry delay');
      vi.advanceTimersByTime(delay - 1);
      expect(attempts).toHaveLength(index + 1);
      vi.advanceTimersByTime(1);
      expect(attempts).toHaveLength(index + 2);
      const attempt = attempts.at(index + 1);
      if (!attempt) throw new Error('Expected scheduled retry attempt');
      attempt.onDisconnect();
    }

    expect(onRetryLimitReached).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(60_000);
    expect(attempts).toHaveLength(6);
    expect(onRetryLimitReached).toHaveBeenCalledOnce();
  });

  it('resets the retry backoff only for the explicit authenticated signal', () => {
    vi.useFakeTimers();
    const attempts: OffscreenBridgeAttemptCallbacks[] = [];
    const controller = createOffscreenBridgeReconnectController(
      (callbacks) => attempts.push(callbacks),
      vi.fn(),
    );

    controller.start();
    const firstAttempt = attempts.at(0);
    if (!firstAttempt) throw new Error('Expected initial connection attempt');
    firstAttempt.onDisconnect();
    vi.advanceTimersByTime(250);
    expect(attempts).toHaveLength(2);

    const authenticatedAttempt = attempts.at(1);
    if (!authenticatedAttempt) throw new Error('Expected retry connection attempt');
    dispatchOffscreenBridgePortMessage(
      NYM_OFFSCREEN_BRIDGE_AUTHENTICATED_SIGNAL,
      authenticatedAttempt.onAuthenticated,
      vi.fn(),
    );
    authenticatedAttempt.onDisconnect();
    vi.advanceTimersByTime(249);
    expect(attempts).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(attempts).toHaveLength(3);
  });

  it.each([
    ['normal request', { channel: 'nym-offscreen', target: 'nym-runtime', type: 'ping', id: '1' }],
    ['diagnostic message', { event: 'connect_received', portNameMatches: true }],
    ['unknown message', { channel: 'nym-offscreen', target: 'nym-runtime', type: 'unknown' }],
    ['malformed authentication signal', {
      channel: 'nym-offscreen',
      target: 'nym-runtime',
      type: 'bridgeAuthenticated',
      unexpected: true,
    }],
    ['authentication signal missing a field', {
      channel: 'nym-offscreen',
      target: 'nym-runtime',
    }],
    ['authentication signal with an incorrect channel', {
      channel: 'other-channel',
      target: 'nym-runtime',
      type: 'bridgeAuthenticated',
    }],
    ['authentication signal with an incorrect target', {
      channel: 'nym-offscreen',
      target: 'other-target',
      type: 'bridgeAuthenticated',
    }],
    ['MixFetch response', { channel: 'nym-offscreen', id: '1', ok: true, payload: {} }],
  ])('does not reset the retry budget for a %s', (_label, message) => {
    vi.useFakeTimers();
    const attempts: OffscreenBridgeAttemptCallbacks[] = [];
    const onRequest = vi.fn();
    const controller = createOffscreenBridgeReconnectController(
      (callbacks) => attempts.push(callbacks),
      vi.fn(),
    );

    controller.start();
    attempts.at(0)?.onDisconnect();
    vi.advanceTimersByTime(250);
    const activeAttempt = attempts.at(1);
    if (!activeAttempt) throw new Error('Expected retry connection attempt');

    dispatchOffscreenBridgePortMessage(
      message,
      activeAttempt.onAuthenticated,
      onRequest,
    );
    activeAttempt.onDisconnect();

    expect(onRequest).toHaveBeenCalledWith(message);
    vi.advanceTimersByTime(499);
    expect(attempts).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(attempts).toHaveLength(3);
  });

  it('allows successive authenticated disconnect cycles without overlapping timers', () => {
    vi.useFakeTimers();
    const attempts: OffscreenBridgeAttemptCallbacks[] = [];
    const controller = createOffscreenBridgeReconnectController(
      (callbacks) => attempts.push(callbacks),
      vi.fn(),
    );
    const authenticate = (index: number): void => {
      const attempt = attempts.at(index);
      if (!attempt) throw new Error('Expected connection attempt');
      dispatchOffscreenBridgePortMessage(
        NYM_OFFSCREEN_BRIDGE_AUTHENTICATED_SIGNAL,
        attempt.onAuthenticated,
        vi.fn(),
      );
      attempt.onDisconnect();
      attempt.onDisconnect();
    };

    controller.start();
    authenticate(0);
    vi.advanceTimersByTime(249);
    expect(attempts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(attempts).toHaveLength(2);

    authenticate(1);
    vi.advanceTimersByTime(249);
    expect(attempts).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(attempts).toHaveLength(3);

    authenticate(2);
    vi.advanceTimersByTime(249);
    expect(attempts).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(attempts).toHaveLength(4);
  });

  it('ignores callbacks from an older attempt after a newer attempt starts', () => {
    vi.useFakeTimers();
    const attempts: OffscreenBridgeAttemptCallbacks[] = [];
    const controller = createOffscreenBridgeReconnectController(
      (callbacks) => attempts.push(callbacks),
      vi.fn(),
    );

    controller.start();
    const oldAttempt = attempts.at(0);
    if (!oldAttempt) throw new Error('Expected initial attempt');
    oldAttempt.onDisconnect();
    vi.advanceTimersByTime(250);
    const newAttempt = attempts.at(1);
    if (!newAttempt) throw new Error('Expected scheduled retry');

    oldAttempt.onAuthenticated();
    newAttempt.onDisconnect();
    vi.advanceTimersByTime(499);
    expect(attempts).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(attempts).toHaveLength(3);
  });

  it('cancels the pending retry when pagehide fires', () => {
    vi.useFakeTimers();
    const attempts: OffscreenBridgeAttemptCallbacks[] = [];
    const onRetryLimitReached = vi.fn();
    const controller = createOffscreenBridgeReconnectController(
      (callbacks) => attempts.push(callbacks),
      onRetryLimitReached,
    );

    controller.start();
    const firstAttempt = attempts.at(0);
    if (!firstAttempt) throw new Error('Expected initial connection attempt');
    firstAttempt.onDisconnect();
    const eventTarget = new EventTarget();
    registerOffscreenBridgePagehideHandler(controller, eventTarget);
    eventTarget.dispatchEvent(new Event('pagehide'));
    vi.advanceTimersByTime(60_000);

    expect(attempts).toHaveLength(1);
    expect(onRetryLimitReached).not.toHaveBeenCalled();
  });

  it('bounds synchronous runtime.connect failures as well', () => {
    vi.useFakeTimers();
    const failure = new Error('connection failed');
    const connect = vi.fn(() => {
      throw failure;
    });
    const onRetryLimitReached = vi.fn();
    const controller = createOffscreenBridgeReconnectController(
      connect,
      onRetryLimitReached,
    );

    controller.start();
    for (const delay of [250, 500, 1_000, 2_000, 4_000]) {
      vi.advanceTimersByTime(delay);
    }

    expect(connect).toHaveBeenCalledTimes(6);
    expect(onRetryLimitReached).toHaveBeenCalledOnce();
    expect(onRetryLimitReached).toHaveBeenCalledWith(failure);
  });

  it('does not report a synchronous failure from an earlier attempt after a later connection', () => {
    vi.useFakeTimers();
    const callbacks: OffscreenBridgeAttemptCallbacks[] = [];
    const onRetryLimitReached = vi.fn();
    const failure = new Error('initial connection failed');
    let connectCount = 0;
    const controller = createOffscreenBridgeReconnectController(
      (attemptCallbacks) => {
        connectCount += 1;
        if (connectCount === 1) throw failure;
        callbacks.push(attemptCallbacks);
      },
      onRetryLimitReached,
    );

    controller.start();
    for (const delay of [250, 500, 1_000, 2_000, 4_000]) {
      vi.advanceTimersByTime(delay);
      callbacks.at(-1)?.onDisconnect();
    }

    expect(connectCount).toBe(6);
    expect(onRetryLimitReached).toHaveBeenCalledOnce();
    expect(onRetryLimitReached).toHaveBeenCalledWith(undefined);
  });
});
