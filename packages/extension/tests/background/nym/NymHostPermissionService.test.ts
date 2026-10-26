import { describe, expect, it, vi } from 'vitest';

import { NymHostPermissionService } from '../../../src/background/nym/NymHostPermissionService.js';

describe('NymHostPermissionService', () => {
  it('requests exact https host pattern for wss gateway', async () => {
    const request = vi.fn(async () => true);
    const svc = new NymHostPermissionService({
      contains: async () => false,
      request,
      remove: async () => true,
    });
    const status = await svc.requestForGateway('wss://gw.example:9000');
    expect(request).toHaveBeenCalledWith({
      origins: ['https://gw.example:9000/*'],
    });
    expect(status.granted).toBe(true);
    expect(status.origin).toBe('wss://gw.example:9000');
  });

  it('surfaces denial as granted:false without claiming connectivity', async () => {
    const svc = new NymHostPermissionService({
      contains: async () => false,
      request: async () => false,
      remove: async () => true,
    });
    const status = await svc.requestForGateway('wss://gw.example:9000');
    expect(status.granted).toBe(false);
  });

  it('maps missing optional_host_permissions to PERMISSION_NOT_IN_MANIFEST', async () => {
    const svc = new NymHostPermissionService({
      contains: async () => false,
      request: async () => {
        throw new Error('Optional host permission must be listed in the manifest');
      },
      remove: async () => true,
    });
    await expect(svc.requestForGateway('wss://gw.example:9000')).rejects.toMatchObject({
      code: 'PERMISSION_NOT_IN_MANIFEST',
    });
  });
});
