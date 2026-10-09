import { describe, expect, it, beforeEach, vi } from 'vitest';
import { DappPermissionManager } from '../../src/background/dapp/DappPermissionManager.js';

describe('DappPermissionManager', () => {
  let manager: DappPermissionManager;
  let mockStorage: any;

  beforeEach(() => {
    mockStorage = {};
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: vi.fn().mockImplementation(async (key) => ({ [key]: mockStorage[key] })),
          set: vi.fn().mockImplementation(async (data) => {
            Object.assign(mockStorage, data);
          })
        }
      }
    };
    manager = new DappPermissionManager();
  });

  it('unknown origin requires approval (isTrusted = false)', async () => {
    expect(await manager.isTrusted('https://example.com')).toBe(false);
  });

  it('granting permission persists it', async () => {
    await manager.grantPermission('https://example.com');
    expect(await manager.isTrusted('https://example.com')).toBe(true);
    
    // Check storage directly
    expect(mockStorage['dapp_permissions']).toBeDefined();
    expect(mockStorage['dapp_permissions'][0].origin).toBe('https://example.com');
  });

  it('disconnect revokes permission', async () => {
    await manager.grantPermission('https://example.com');
    expect(await manager.isTrusted('https://example.com')).toBe(true);
    
    await manager.revokePermission('https://example.com');
    expect(await manager.isTrusted('https://example.com')).toBe(false);
  });
});
