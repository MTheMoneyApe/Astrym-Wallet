import { describe, expect, it, vi } from 'vitest';

import {
  beginStellarDirectPermissionRequestFromUserGesture,
  STELLAR_DIRECT_HOST_PERMISSION_ORIGINS,
  type StellarDirectPermissionApi,
} from '../../src/popup/stellarDirectPermission.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('Stellar Direct host permission request', () => {
  it('starts request synchronously and confirms both origins after it resolves', async () => {
    const request = deferred<boolean>();
    const contains = deferred<boolean>();
    const events: string[] = [];
    const api: StellarDirectPermissionApi = {
      request: vi.fn((permissions) => {
        events.push(`request:${permissions.origins.join(',')}`);
        return request.promise;
      }),
      contains: vi.fn((permissions) => {
        events.push(`contains:${permissions.origins.join(',')}`);
        return contains.promise;
      }),
    };

    const result = beginStellarDirectPermissionRequestFromUserGesture(api);

    expect(api.request).toHaveBeenCalledOnce();
    expect(api.request).toHaveBeenCalledWith({
      origins: [...STELLAR_DIRECT_HOST_PERMISSION_ORIGINS],
    });
    expect(events).toEqual([
      `request:${STELLAR_DIRECT_HOST_PERMISSION_ORIGINS.join(',')}`,
    ]);

    request.resolve(true);
    await vi.waitFor(() => expect(api.contains).toHaveBeenCalledOnce());
    expect(api.contains).toHaveBeenCalledWith({
      origins: [...STELLAR_DIRECT_HOST_PERMISSION_ORIGINS],
    });
    expect(events).toEqual([
      `request:${STELLAR_DIRECT_HOST_PERMISSION_ORIGINS.join(',')}`,
      `contains:${STELLAR_DIRECT_HOST_PERMISSION_ORIGINS.join(',')}`,
    ]);

    contains.resolve(true);
    await expect(result).resolves.toBeUndefined();
  });

  it.each([
    ['denied request', false, true],
    ['partial grant', true, false],
  ])('rejects a %s without exposing permission details', async (_label, requestGranted, containsGranted) => {
    const api: StellarDirectPermissionApi = {
      request: vi.fn().mockResolvedValue(requestGranted),
      contains: vi.fn().mockResolvedValue(containsGranted),
    };

    await expect(beginStellarDirectPermissionRequestFromUserGesture(api)).rejects.toThrow(
      'Direct mode requires Chrome permissions for Stellar Testnet Horizon and Friendbot. Grant both permissions and retry.',
    );
    expect(api.request).toHaveBeenCalledOnce();
    expect(api.contains).toHaveBeenCalledOnce();
  });

  it('rejects when permission confirmation fails', async () => {
    const api: StellarDirectPermissionApi = {
      request: vi.fn().mockResolvedValue(true),
      contains: vi.fn().mockRejectedValue(new Error('private Chrome detail')),
    };

    await expect(beginStellarDirectPermissionRequestFromUserGesture(api)).rejects.toThrow(
      'Direct mode requires Chrome permissions for Stellar Testnet Horizon and Friendbot. Grant both permissions and retry.',
    );
  });

  it('rejects when the permission request fails and does not query confirmation', async () => {
    const api: StellarDirectPermissionApi = {
      request: vi.fn().mockRejectedValue(new Error('private Chrome detail')),
      contains: vi.fn(),
    };

    await expect(beginStellarDirectPermissionRequestFromUserGesture(api)).rejects.toThrow(
      'Direct mode requires Chrome permissions for Stellar Testnet Horizon and Friendbot. Grant both permissions and retry.',
    );
    expect(api.contains).not.toHaveBeenCalled();
  });
});
