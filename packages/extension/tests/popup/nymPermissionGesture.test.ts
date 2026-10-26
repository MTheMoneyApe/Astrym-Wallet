import { describe, expect, it, vi } from 'vitest';

import { beginGatewayPermissionRequestFromUserGesture } from '../../src/popup/nymPermissionGesture.js';
import { NYM_VERIFIED_GATEWAY } from '../../src/nym-offscreen/verifiedGateway.js';

describe('beginGatewayPermissionRequestFromUserGesture', () => {
  it('invokes permissions.request synchronously before any await', async () => {
    const order: string[] = [];
    let resolveRequest!: (v: boolean) => void;
    const request = vi.fn(() => {
      order.push('request-called');
      return new Promise<boolean>((resolve) => {
        resolveRequest = resolve;
      });
    });
    const contains = vi.fn(async () => {
      order.push('contains-called');
      return true;
    });

    const pending = beginGatewayPermissionRequestFromUserGesture(
      NYM_VERIFIED_GATEWAY.wssOrigin,
      { request, contains },
    );
    // Request must already have been invoked on this tick (gesture stack).
    expect(order).toEqual(['request-called']);
    expect(request).toHaveBeenCalledWith({
      origins: [NYM_VERIFIED_GATEWAY.hostPermissionPattern],
    });

    resolveRequest(true);
    const result = await pending;
    expect(order).toEqual(['request-called', 'contains-called']);
    expect(result.granted).toBe(true);
    expect(result.containsConfirmed).toBe(true);
    expect(result.requestReturned).toBe(true);
    expect(result.hostPermissionPattern).toBe(NYM_VERIFIED_GATEWAY.hostPermissionPattern);
  });

  it('does not claim granted when contains() is false after request true', async () => {
    const result = await beginGatewayPermissionRequestFromUserGesture(
      NYM_VERIFIED_GATEWAY.wssOrigin,
      {
        request: async () => true,
        contains: async () => false,
      },
    );
    expect(result.requestReturned).toBe(true);
    expect(result.containsConfirmed).toBe(false);
    expect(result.granted).toBe(false);
  });

  it('surfaces denial without inventing connectivity', async () => {
    const result = await beginGatewayPermissionRequestFromUserGesture(
      NYM_VERIFIED_GATEWAY.wssOrigin,
      {
        request: async () => false,
        contains: async () => false,
      },
    );
    expect(result.granted).toBe(false);
  });

  it('maps missing optional_host_permissions to PERMISSION_NOT_IN_MANIFEST', async () => {
    await expect(
      beginGatewayPermissionRequestFromUserGesture(NYM_VERIFIED_GATEWAY.wssOrigin, {
        request: async () => {
          throw new Error('Optional host permission must be listed in the manifest');
        },
        contains: async () => false,
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_NOT_IN_MANIFEST' });
  });

  it('maps lost user-gesture errors to PERMISSION_GESTURE_REQUIRED', async () => {
    await expect(
      beginGatewayPermissionRequestFromUserGesture(NYM_VERIFIED_GATEWAY.wssOrigin, {
        request: async () => {
          throw new Error('This function must be called during a user gesture');
        },
        contains: async () => false,
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_GESTURE_REQUIRED' });
  });
});
