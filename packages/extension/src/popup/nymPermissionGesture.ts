/**
 * MV3 optional host permission request that must run in a user-gesture stack.
 *
 * Chrome requires chrome.permissions.request(...) to be invoked synchronously
 * during the click handler — before any await / IPC round-trip. Calling request
 * from the service worker after sendMessage loses the gesture and fails with
 * "This function must be called during a user gesture".
 */

import { validateGatewayOrigin } from '../nym-offscreen/gatewayConfig.js';

export type NymPopupPermissionApi = {
  contains: (perm: { origins?: string[] }) => Promise<boolean>;
  request: (perm: { origins?: string[] }) => Promise<boolean>;
};

export type NymGesturePermissionResult = {
  origin: string;
  hostPermissionPattern: string;
  /** Raw boolean from permissions.request (may be optimistic). */
  requestReturned: boolean;
  /** Result of permissions.contains after the request settles. */
  containsConfirmed: boolean;
  /**
   * True only when Chrome confirms via contains().
   * Never treat requestReturned alone as granted.
   */
  granted: boolean;
  apiAvailable: boolean;
};

function getChromePermissionsApi(): NymPopupPermissionApi | null {
  if (typeof chrome === 'undefined' || !chrome?.permissions) return null;
  const p = chrome.permissions;
  if (typeof p.request !== 'function' || typeof p.contains !== 'function') {
    return null;
  }
  return {
    request: (perm) =>
      new Promise((resolve, reject) => {
        try {
          p.request(perm, (granted) => {
            const err = chrome.runtime?.lastError;
            if (err) reject(new Error(err.message));
            else resolve(Boolean(granted));
          });
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      }),
    contains: (perm) =>
      new Promise((resolve, reject) => {
        try {
          p.contains(perm, (result) => {
            const err = chrome.runtime?.lastError;
            if (err) reject(new Error(err.message));
            else resolve(Boolean(result));
          });
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      }),
  };
}

/**
 * Start an exact-origin optional host permission request.
 *
 * MUST be called synchronously from a click handler (no await before this).
 * Returns a Promise for the async request/contains completion.
 */
export function beginGatewayPermissionRequestFromUserGesture(
  rawOrigin: string,
  api: NymPopupPermissionApi | null = getChromePermissionsApi(),
): Promise<NymGesturePermissionResult> {
  const validation = validateGatewayOrigin(rawOrigin);
  if (!validation.ok) {
    throw Object.assign(new Error(validation.message), { code: validation.code });
  }
  if (!api) {
    throw Object.assign(new Error('chrome.permissions API unavailable in this context'), {
      code: 'PERMISSION_API_UNAVAILABLE',
    });
  }

  const origins = [validation.hostPermissionPattern];

  // Gesture-critical: invoke request() on this tick, before any await.
  const requestPromise = api.request({ origins });

  return settleGesturePermissionRequest({
    api,
    origins,
    origin: validation.origin,
    hostPermissionPattern: validation.hostPermissionPattern,
    requestPromise,
  });
}

async function settleGesturePermissionRequest(args: {
  api: NymPopupPermissionApi;
  origins: string[];
  origin: string;
  hostPermissionPattern: string;
  requestPromise: Promise<boolean>;
}): Promise<NymGesturePermissionResult> {
  let requestReturned = false;
  try {
    requestReturned = await args.requestPromise;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (/optional|must be listed|not permitted|cannot be requested|user gesture/i.test(message)) {
      throw Object.assign(
        new Error(
          /user gesture/i.test(message)
            ? `Host permission request lost the user gesture — Grant must call chrome.permissions.request in the click handler (not via background IPC): ${args.hostPermissionPattern}`
            : `Host permission pattern must be declared in manifest optional_host_permissions: ${args.hostPermissionPattern}`,
        ),
        {
          code: /user gesture/i.test(message)
            ? 'PERMISSION_GESTURE_REQUIRED'
            : 'PERMISSION_NOT_IN_MANIFEST',
        },
      );
    }
    throw Object.assign(new Error(message), { code: 'PERMISSION_REQUEST_FAILED' });
  }

  let containsConfirmed = false;
  try {
    containsConfirmed = await args.api.contains({ origins: args.origins });
  } catch (cause) {
    throw Object.assign(
      new Error(
        cause instanceof Error ? cause.message : 'Failed to query host permission after request',
      ),
      { code: 'PERMISSION_QUERY_FAILED' },
    );
  }

  return {
    origin: args.origin,
    hostPermissionPattern: args.hostPermissionPattern,
    requestReturned,
    containsConfirmed,
    granted: containsConfirmed === true,
    apiAvailable: true,
  };
}
