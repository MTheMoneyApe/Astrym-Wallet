import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SPP_HOST_BRIDGE_CHANNEL } from '../../src/shared/sppHostBridge.js';
import { executeSppHostAccountQuery } from '../../src/spp-host/sppHostAccountQuery.js';
import * as surface from '../../src/spp-host/sppHostAccountSurface.js';

describe('executeSppHostAccountQuery', () => {
  beforeEach(() => {
    vi.spyOn(surface, 'getSppHostAccountBinding').mockReturnValue({
      ready: true,
      userAddress: 'G'.padEnd(56, 'A'),
      poolContract: 'C'.padEnd(56, 'A'),
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fail-closes when Nym is off', async () => {
    const result = await executeSppHostAccountQuery({
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_ACCOUNT_QUERY',
      id: 'q1',
      payload: {
        action: 'snapshot',
        nymMode: 'direct',
        nymConnected: false,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NYM_REQUIRED');
  });

  it('returns snapshot via Nym when bound', async () => {
    vi.spyOn(surface, 'readSppHostAccountSnapshot').mockResolvedValue({
      userAddress: 'G'.padEnd(56, 'A'),
      poolContract: 'C'.padEnd(56, 'A'),
      registered: false,
      privateBalanceStroops: '0',
      noteCount: 0,
    });
    const result = await executeSppHostAccountQuery({
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_ACCOUNT_QUERY',
      id: 'q2',
      payload: {
        action: 'snapshot',
        nymMode: 'nym',
        nymConnected: true,
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.action).toBe('snapshot');
      expect(result.snapshot?.noteCount).toBe(0);
      expect(result.rpcRoutedViaNym).toBe(true);
    }
  });

  it('looks up recipients and maps broadcast gate refusals', async () => {
    vi.spyOn(surface, 'lookupSppRecipient').mockResolvedValue({
      address: 'G'.padEnd(56, 'B'),
      found: true,
      registryFullySynced: true,
      networkTipLedger: 1,
      noteKeyPresent: true,
      encryptionKeyPresent: true,
    });
    const lookup = await executeSppHostAccountQuery({
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_ACCOUNT_QUERY',
      id: 'q3',
      payload: {
        action: 'recipient_lookup',
        recipientAddress: 'G'.padEnd(56, 'B'),
        nymMode: 'nym',
        nymConnected: true,
      },
    });
    expect(lookup.ok).toBe(true);
    if (lookup.ok) expect(lookup.lookup?.found).toBe(true);

    vi.spyOn(surface, 'registerSppHostPublicKeys').mockRejectedValue(
      new Error('SPP_BROADCAST_AWAITING_APPROVAL: blocked'),
    );
    const blocked = await executeSppHostAccountQuery({
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_ACCOUNT_QUERY',
      id: 'q4',
      payload: {
        action: 'register_public_keys',
        nymMode: 'nym',
        nymConnected: true,
      },
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe('UNAUTHORIZED');
  });
});
