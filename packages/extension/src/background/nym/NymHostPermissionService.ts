/**
 * Chrome MV3 optional host permissions for exact gateway origins.
 *
 * Mechanism: chrome.permissions.request/contains/remove with a single
 * `https://host:port/*` pattern derived from the validated gateway.
 * Patterns must appear in manifest optional_host_permissions (exact entries
 * for authorized smoke builds). Permission grant ≠ Mixnet connected.
 */

import { validateGatewayOrigin } from '../../nym-offscreen/gatewayConfig.js';

export type NymPermissionApi = {
  contains: (perm: { origins?: string[] }) => Promise<boolean>;
  request: (perm: { origins?: string[] }) => Promise<boolean>;
  remove: (perm: { origins?: string[] }) => Promise<boolean>;
  getAll?: () => Promise<{ origins?: string[] }>;
};

export type NymHostPermissionStatus = {
  origin: string;
  hostPermissionPattern: string;
  granted: boolean;
  /** True when permissions API is missing (tests / non-extension). */
  apiAvailable: boolean;
};

function getChromePermissions(): NymPermissionApi | null {
  if (typeof chrome === 'undefined' || !chrome?.permissions) return null;
  const p = chrome.permissions;
  if (typeof p.contains !== 'function' || typeof p.request !== 'function') {
    return null;
  }
  return {
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
    remove: (perm) =>
      new Promise((resolve, reject) => {
        try {
          p.remove(perm, (removed) => {
            const err = chrome.runtime?.lastError;
            if (err) reject(new Error(err.message));
            else resolve(Boolean(removed));
          });
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      }),
  };
}

export class NymHostPermissionService {
  constructor(private readonly _api: NymPermissionApi | null = getChromePermissions()) {}

  isApiAvailable(): boolean {
    return this._api != null;
  }

  async getStatus(rawOrigin: string): Promise<NymHostPermissionStatus> {
    const validation = validateGatewayOrigin(rawOrigin);
    if (!validation.ok) {
      throw Object.assign(new Error(validation.message), { code: validation.code });
    }
    if (!this._api) {
      return {
        origin: validation.origin,
        hostPermissionPattern: validation.hostPermissionPattern,
        granted: false,
        apiAvailable: false,
      };
    }
    let granted = false;
    try {
      granted = await this._api.contains({
        origins: [validation.hostPermissionPattern],
      });
    } catch (cause) {
      throw Object.assign(
        new Error(
          cause instanceof Error
            ? cause.message
            : 'Failed to query host permission',
        ),
        { code: 'PERMISSION_QUERY_FAILED' },
      );
    }
    return {
      origin: validation.origin,
      hostPermissionPattern: validation.hostPermissionPattern,
      granted,
      apiAvailable: true,
    };
  }

  /**
   * Request exact origin — for unit tests / non-UI harnesses only.
   * Production popup must use popup/nymPermissionGesture.ts so request() stays
   * on the click stack. Background IPC must not call this.
   * Denial → granted:false (not an exception). API/manifest errors throw typed codes.
   * Never claims Mixnet connectivity.
   */
  async requestForGateway(rawOrigin: string): Promise<NymHostPermissionStatus> {
    const validation = validateGatewayOrigin(rawOrigin);
    if (!validation.ok) {
      throw Object.assign(new Error(validation.message), { code: validation.code });
    }
    if (!this._api) {
      throw Object.assign(new Error('chrome.permissions API unavailable'), {
        code: 'PERMISSION_API_UNAVAILABLE',
      });
    }
    try {
      const granted = await this._api.request({
        origins: [validation.hostPermissionPattern],
      });
      return {
        origin: validation.origin,
        hostPermissionPattern: validation.hostPermissionPattern,
        granted,
        apiAvailable: true,
      };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      // Chrome rejects origins not listed under optional_host_permissions.
      if (/optional|must be listed|not permitted|cannot be requested/i.test(message)) {
        throw Object.assign(
          new Error(
            `Host permission pattern must be declared in manifest optional_host_permissions for this smoke build: ${validation.hostPermissionPattern}`,
          ),
          { code: 'PERMISSION_NOT_IN_MANIFEST' },
        );
      }
      throw Object.assign(new Error(message), { code: 'PERMISSION_REQUEST_FAILED' });
    }
  }

  async revokeForGateway(rawOrigin: string): Promise<NymHostPermissionStatus> {
    const status = await this.getStatus(rawOrigin);
    if (!this._api || !status.granted) return status;
    await this._api.remove({ origins: [status.hostPermissionPattern] });
    return this.getStatus(rawOrigin);
  }
}
