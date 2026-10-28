import { describe, expect, it } from 'vitest';

import {
  NymGatewayConfigService,
  NYM_GATEWAY_CONFIG_STORAGE_KEY,
} from '../../../src/background/nym/NymGatewayConfigService.js';
import { NYM_VERIFIED_GATEWAY } from '../../../src/nym-offscreen/verifiedGateway.js';

function memoryStorage() {
  const mem = new Map<string, unknown>();
  return {
    get: async (keys?: string | string[] | null) => {
      const list = keys == null ? [...mem.keys()] : Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const k of list) {
        if (mem.has(k)) out[k] = mem.get(k);
      }
      return out;
    },
    set: async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) mem.set(k, v);
    },
    _mem: mem,
  };
}

describe('NymGatewayConfigService', () => {
  it('starts empty with no silent gateway', async () => {
    const svc = new NymGatewayConfigService(memoryStorage());
    const cfg = await svc.load();
    expect(cfg.gatewayOrigins).toEqual([]);
    expect(cfg.selectedGateway).toBeNull();
    expect(cfg.identityKey).toBeNull();
  });

  it('ensureVerifiedDefault seeds the DevRel gateway only when config is incomplete', async () => {
    const svc = new NymGatewayConfigService(memoryStorage());
    const seeded = await svc.ensureVerifiedDefault();
    expect(seeded.selectedGateway).toBe(NYM_VERIFIED_GATEWAY.wssOrigin);
    expect(seeded.identityKey).toBe(NYM_VERIFIED_GATEWAY.identityKey);
    const again = await svc.ensureVerifiedDefault();
    expect(again.updatedAt).toBe(seeded.updatedAt);
  });

  it('adds validated WSS + identity and selects WSS', async () => {
    const store = memoryStorage();
    const svc = new NymGatewayConfigService(store);
    const { config, validation, identity } = await svc.addGateway(
      'wss://gw.example:9000',
      'q2A2cbooyC16YJzvdYaSMH9X3cSiieZNtfBr8cE8Fi1',
    );
    expect(validation.origin).toBe('wss://gw.example:9000');
    expect(identity?.identityKey).toBe('q2A2cbooyC16YJzvdYaSMH9X3cSiieZNtfBr8cE8Fi1');
    expect(config.gatewayOrigins).toEqual(['wss://gw.example:9000']);
    expect(config.selectedGateway).toBe('wss://gw.example:9000');
    expect(config.identityKey).toBe('q2A2cbooyC16YJzvdYaSMH9X3cSiieZNtfBr8cE8Fi1');
    expect(store._mem.has(NYM_GATEWAY_CONFIG_STORAGE_KEY)).toBe(true);
  });

  it('rejects WSS URL used as identity key', async () => {
    const svc = new NymGatewayConfigService(memoryStorage());
    await expect(
      svc.addGateway('wss://gw.example:9000', 'wss://gw.example:9000'),
    ).rejects.toMatchObject({ code: 'BAD_IDENTITY' });
  });

  it('rejects malformed gateway without mutating storage', async () => {
    const store = memoryStorage();
    const svc = new NymGatewayConfigService(store);
    await expect(svc.addGateway('wss://*.bad:9000')).rejects.toMatchObject({
      code: 'WILDCARD',
    });
    expect(store._mem.size).toBe(0);
  });

  it('selectGateway refuses origins not on allowlist', async () => {
    const svc = new NymGatewayConfigService(memoryStorage());
    await svc.addGateway('wss://gw.example:9000');
    await expect(svc.selectGateway('wss://other.example:9000')).rejects.toMatchObject({
      code: 'GATEWAY_NOT_ALLOWLISTED',
    });
  });

  it('persists verified DevRel identity and WSS separately', async () => {
    const store = memoryStorage();
    const svc = new NymGatewayConfigService(store);
    const { config } = await svc.addGateway(
      NYM_VERIFIED_GATEWAY.wssOrigin,
      NYM_VERIFIED_GATEWAY.identityKey,
    );
    expect(config.gatewayOrigins).toEqual([NYM_VERIFIED_GATEWAY.wssOrigin]);
    expect(config.selectedGateway).toBe(NYM_VERIFIED_GATEWAY.wssOrigin);
    expect(config.identityKey).toBe(NYM_VERIFIED_GATEWAY.identityKey);

    const reloaded = await svc.load();
    expect(reloaded.identityKey).toBe(NYM_VERIFIED_GATEWAY.identityKey);
    expect(reloaded.gatewayOrigins).toEqual([NYM_VERIFIED_GATEWAY.wssOrigin]);

    const allowlist = await svc.toAllowlistConfig();
    expect(allowlist.gatewayOrigins).toEqual([NYM_VERIFIED_GATEWAY.wssOrigin]);
  });
});
