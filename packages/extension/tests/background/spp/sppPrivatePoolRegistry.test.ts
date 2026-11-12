import { describe, expect, it } from 'vitest';
import {
  clearSppPrivatePool,
  getSppHostLifecycle,
  getSppPrivatePool,
  getSppPrivatePoolGeneration,
  noteSppHostLifecycle,
  registerSppPrivatePool,
} from '../../../src/background/spp/sppPrivatePoolRegistry.js';

describe('sppPrivatePoolRegistry lifecycle', () => {
  it('starts empty and tracks register/clear', () => {
    clearSppPrivatePool();
    const gen0 = getSppPrivatePoolGeneration();
    expect(getSppPrivatePool()).toBeNull();

    const pool = {
      deposit: async () => ({ txHash: 'd' }),
      transfer: async () => ({ txHash: 't' }),
      withdraw: async () => ({ txHash: 'w' }),
    };
    registerSppPrivatePool(pool);
    expect(getSppPrivatePool()).toBe(pool);
    expect(getSppPrivatePoolGeneration()).toBeGreaterThan(gen0);

    clearSppPrivatePool();
    expect(getSppPrivatePool()).toBeNull();
    expect(getSppHostLifecycle().state).toBe('cleared');
  });

  it('clears the pool when host lifecycle reports cleared/error', () => {
    clearSppPrivatePool();
    registerSppPrivatePool({
      deposit: async () => ({ txHash: 'd' }),
      transfer: async () => ({ txHash: 't' }),
      withdraw: async () => ({ txHash: 'w' }),
    });
    noteSppHostLifecycle({ state: 'write_pool_ready' });
    expect(getSppHostLifecycle().hasPool).toBe(true);

    noteSppHostLifecycle({ state: 'cleared', message: 'Nym disconnected' });
    expect(getSppPrivatePool()).toBeNull();
    expect(getSppHostLifecycle().state).toBe('cleared');

    registerSppPrivatePool({
      deposit: async () => ({ txHash: 'd' }),
      transfer: async () => ({ txHash: 't' }),
      withdraw: async () => ({ txHash: 'w' }),
    });
    noteSppHostLifecycle({ state: 'error', message: 'wasm failed' });
    expect(getSppPrivatePool()).toBeNull();
  });
});
