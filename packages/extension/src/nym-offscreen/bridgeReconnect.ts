import { isNymOffscreenBridgeAuthenticatedSignal } from './protocol.js';

const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 250;
const MAX_RETRY_DELAY_MS = 4_000;

export type OffscreenBridgeAttemptCallbacks = {
  onAuthenticated: () => void;
  onDisconnect: () => void;
};

export type OffscreenBridgeReconnectController = {
  start: () => void;
  stop: () => void;
};

export function registerOffscreenBridgePagehideHandler(
  controller: OffscreenBridgeReconnectController,
  eventTarget: Pick<EventTarget, 'addEventListener'> = globalThis,
): void {
  eventTarget.addEventListener('pagehide', controller.stop, { once: true });
}

export function dispatchOffscreenBridgePortMessage(
  message: unknown,
  onAuthenticated: () => void,
  onRequest: (message: unknown) => void,
): void {
  if (isNymOffscreenBridgeAuthenticatedSignal(message)) {
    onAuthenticated();
    return;
  }
  onRequest(message);
}

export function createOffscreenBridgeReconnectController(
  connect: (callbacks: OffscreenBridgeAttemptCallbacks) => void,
  onRetryLimitReached: (lastConnectError?: unknown) => void,
): OffscreenBridgeReconnectController {
  let activeAttempt = false;
  let stopped = false;
  let retryCount = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let attemptGeneration = 0;
  let retryLimitReported = false;
  let lastConnectError: unknown;

  const scheduleRetry = (): void => {
    if (stopped || retryTimer !== null) return;
    if (retryCount >= MAX_RETRIES) {
      if (!retryLimitReported) {
        retryLimitReported = true;
        onRetryLimitReached(lastConnectError);
      }
      return;
    }

    const delayMs = Math.min(
      INITIAL_RETRY_DELAY_MS * 2 ** retryCount,
      MAX_RETRY_DELAY_MS,
    );
    retryCount += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      start();
    }, delayMs);
  };

  const start = (): void => {
    if (stopped || activeAttempt || retryTimer !== null || retryLimitReported) return;
    activeAttempt = true;
    const generation = ++attemptGeneration;

    const onDisconnect = (): void => {
      if (!activeAttempt || generation !== attemptGeneration) return;
      activeAttempt = false;
      scheduleRetry();
    };

    lastConnectError = undefined;
    try {
      connect({
        onAuthenticated: () => {
          if (activeAttempt && generation === attemptGeneration) {
            retryCount = 0;
            lastConnectError = undefined;
          }
        },
        onDisconnect,
      });
    } catch (error) {
      lastConnectError = error;
      onDisconnect();
    }
  };

  return {
    start,
    stop: () => {
      if (stopped) return;
      stopped = true;
      activeAttempt = false;
      attemptGeneration += 1;
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    },
  };
}
