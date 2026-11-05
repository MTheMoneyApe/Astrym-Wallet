import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: {
      id: 'test-extension-id',
      getURL: (path: string) => `chrome-extension://test-extension-id${path.startsWith('/') ? path : `/${path}`}`,
    },
  },
}));

vi.mock('../../../src/background/nym/NymRuntimeController.js', () => ({
  getNymRuntimeController: () => ({
    getSnapshot: () => ({ mode: 'nym', connected: true }),
  }),
}));

vi.mock('../../../src/background/spp/sppPrivatePoolRegistry.js', () => ({
  getSppHostLifecycle: () => ({ state: 'write_pool_ready' }),
}));

const queryMock = vi.fn();
vi.mock('../../../src/background/spp/sppHostAccountProxy.js', () => ({
  querySppHostAccount: (...args: unknown[]) => queryMock(...args),
}));

import {
  createSppAccountSnapshotHandler,
  createSppRecipientLookupHandler,
  createSppRegisterPublicKeysHandler,
} from '../../../src/background/handlers/sppAccountHandlers.js';

afterEach(() => {
  queryMock.mockReset();
});

describe('sppAccountHandlers IPC', () => {
  it('returns real snapshot payload from host proxy', async () => {
    queryMock.mockResolvedValue({
      ok: true,
      action: 'snapshot',
      snapshot: {
        userAddress: 'G'.padEnd(56, 'A'),
        poolContract: 'C'.padEnd(56, 'A'),
        registered: false,
        privateBalanceStroops: '0',
        noteCount: 0,
      },
      rpcRoutedViaNym: true,
      id: '1',
      channel: 'astrym-spp-host-bridge',
      type: 'SPP_HOST_ACCOUNT_QUERY_RESULT',
    });
    const result = await createSppAccountSnapshotHandler()({});
    expect(result.rpcRoutedViaNym).toBe(true);
    expect(result.registered).toBe(false);
    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'snapshot', nymConnected: true }),
    );
  });

  it('looks up recipients via host proxy', async () => {
    queryMock.mockResolvedValue({
      ok: true,
      action: 'recipient_lookup',
      lookup: {
        address: 'G'.padEnd(56, 'B'),
        found: false,
        registryFullySynced: true,
        networkTipLedger: 1,
        noteKeyPresent: false,
        encryptionKeyPresent: false,
      },
      rpcRoutedViaNym: true,
      id: '2',
      channel: 'astrym-spp-host-bridge',
      type: 'SPP_HOST_ACCOUNT_QUERY_RESULT',
    });
    const result = await createSppRecipientLookupHandler()({ address: 'G'.padEnd(56, 'B') });
    expect(result.found).toBe(false);
    expect(result.rpcRoutedViaNym).toBe(true);
  });

  it('propagates broadcast-gate refusal from register_public_keys', async () => {
    queryMock.mockResolvedValue({
      ok: false,
      code: 'UNAUTHORIZED',
      message: 'SPP_BROADCAST_AWAITING_APPROVAL: blocked',
      id: '3',
      channel: 'astrym-spp-host-bridge',
      type: 'SPP_HOST_ACCOUNT_QUERY_RESULT',
    });
    const trusted = {
      id: 'test-extension-id',
      url: 'chrome-extension://test-extension-id/popup.html',
    };
    await expect(
      createSppRegisterPublicKeysHandler({
        resolveAccount: async () => 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6',
      })({ acknowledgeBroadcast: true }, trusted as never),
    ).rejects.toMatchObject({
      name: 'UNAUTHORIZED',
      message: expect.stringContaining('SPP_BROADCAST_AWAITING_APPROVAL'),
    });
  });

  it('does not register without an explicit acknowledgement or a trusted sender', async () => {
    const handler = createSppRegisterPublicKeysHandler({
      resolveAccount: async () => 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6',
    });
    await expect(
      handler({ acknowledgeBroadcast: false } as never, {
        id: 'test-extension-id',
        url: 'chrome-extension://test-extension-id/popup.html',
      } as never),
    ).rejects.toMatchObject({ name: 'UNAUTHORIZED' });
    await expect(
      handler({ acknowledgeBroadcast: true }, undefined),
    ).rejects.toMatchObject({ name: 'UNAUTHORIZED' });
    expect(queryMock).not.toHaveBeenCalled();
  });
});
