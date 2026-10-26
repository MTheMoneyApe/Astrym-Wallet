import { describe, expect, it, vi } from 'vitest';

import {
  isInternalMixFetchBridgeKey,
  toSetupMixFetchOps,
} from '../../src/nym/MixFetchOpts.js';
import { tryLoadOfficialMixFetchBridge } from '../../src/nym/NymMixFetchBridge.js';
import { MixFetchNymTransport } from '../../src/nym/NymTransport.js';

describe('toSetupMixFetchOps (official MixFetchOpts)', () => {
  it('forwards preferredGateway and strips gatewayAllowlist', () => {
    const ops = toSetupMixFetchOps({
      preferredGateway: 'GatewayIdFromOperator',
      gatewayAllowlist: ['wss://should-not-forward.example:9000'],
      disableCoverTraffic: false,
    });
    expect(ops).toEqual({ preferredGateway: 'GatewayIdFromOperator' });
    expect(ops && 'gatewayAllowlist' in ops).toBe(false);
    expect(ops && 'disableCoverTraffic' in ops).toBe(false);
  });

  it('maps disableCoverTraffic to official clientOverride.coverTraffic', () => {
    const ops = toSetupMixFetchOps({ disableCoverTraffic: true });
    expect(ops?.clientOverride?.coverTraffic?.disableLoopCoverTrafficStream).toBe(
      true,
    );
    expect(ops && 'disableCoverTraffic' in ops).toBe(false);
  });

  it('forwards responseBodyConfigMap for Horizon HAL+JSON via MixFetch', () => {
    const map = {
      uint8array: ['application/hal+json'],
      fallback: 'uint8array',
    };
    const ops = toSetupMixFetchOps({
      preferredGateway: 'Gw',
      responseBodyConfigMap: map,
      gatewayAllowlist: ['wss://nope.example:1'],
    });
    expect(ops?.responseBodyConfigMap).toEqual(map);
    expect(ops && 'gatewayAllowlist' in ops).toBe(false);
  });

  it('marks internal keys', () => {
    expect(isInternalMixFetchBridgeKey('gatewayAllowlist')).toBe(true);
    expect(isInternalMixFetchBridgeKey('preferredGateway')).toBe(false);
  });
});

describe('tryLoadOfficialMixFetchBridge createMixFetch args', () => {
  it('passes only filtered opts to createMixFetch', async () => {
    const createMixFetch = vi.fn(async () => ({
      mixFetch: async () => new Response('ok'),
      disconnectMixFetch: async () => undefined,
    }));
    const bridge = await tryLoadOfficialMixFetchBridge(async () => ({
      createMixFetch,
      mixFetch: async () => new Response('ok'),
      disconnectMixFetch: async () => undefined,
    }));
    expect(bridge).not.toBeNull();
    await bridge!.setup({
      preferredGateway: 'ExplicitGateway',
      gatewayAllowlist: ['wss://internal-only.example:1'],
      disableCoverTraffic: true,
    });
    expect(createMixFetch).toHaveBeenCalledWith({
      preferredGateway: 'ExplicitGateway',
      clientOverride: {
        coverTraffic: { disableLoopCoverTrafficStream: true },
      },
    });
  });
});

describe('MixFetchNymTransport connected lifecycle', () => {
  it('stays error and not connected when createMixFetch fails', async () => {
    const bridge = {
      setup: vi.fn(async () => {
        throw new Error('setupMixFetch failed');
      }),
      mixFetch: vi.fn(),
      disconnect: vi.fn(async () => undefined),
    };
    const t = new MixFetchNymTransport(bridge);
    await expect(t.connect({ gatewayUrl: 'g' })).rejects.toMatchObject({
      code: 'CONNECT_FAILED',
    });
    expect(t.getSnapshot().connected).toBe(false);
    expect(t.getSnapshot().state).toBe('error');
  });

  it('sets connected only after setup resolves', async () => {
    let resolveSetup!: () => void;
    const setupDone = new Promise<void>((r) => {
      resolveSetup = r;
    });
    const bridge = {
      setup: vi.fn(async () => {
        await setupDone;
      }),
      mixFetch: vi.fn(async () => new Response('ok')),
      disconnect: vi.fn(async () => undefined),
    };
    const t = new MixFetchNymTransport(bridge);
    const pending = t.connect({ gatewayUrl: 'g' });
    expect(t.getSnapshot().connected).toBe(false);
    expect(t.getSnapshot().state).toBe('connecting');
    resolveSetup();
    await pending;
    expect(t.getSnapshot().connected).toBe(true);
    expect(t.getSnapshot().state).toBe('connected');
  });
});
