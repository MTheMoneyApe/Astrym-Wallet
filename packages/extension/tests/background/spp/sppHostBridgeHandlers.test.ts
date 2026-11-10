import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Networks } from '@stellar/stellar-sdk';
import {
  isSppTestnetBroadcastAuthorized,
  resetSppBroadcastGateForTests,
  setSppTestnetBroadcastAuthorized,
} from '@solanym/wallet-core/src/stellar/spp/sppBroadcastGate.js';
import { STELLAR_SOROBAN_TESTNET_RPC } from '@solanym/wallet-core/src/stellar/spp/sppNymOption.js';
import {
  mintSppSignApproval,
  resetSppSignApprovalsForTests,
  setSppPaymentIdentityChecksForTests,
  sppSignApprovalCount,
  type SppSignIntent,
} from '@solanym/wallet-core/src/stellar/spp/sppSignGate.js';

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: {
      id: 'test-extension-id',
      getURL: (path: string) => `chrome-extension://test-extension-id${path.startsWith('/') ? path : `/${path}`}`,
    },
  },
}));

import { SPP_HOST_BRIDGE_CHANNEL } from '../../../src/shared/sppHostBridge.js';

vi.mock('../../../src/background/accounts/ActiveAccountManager.js', () => ({
  activeAccountManager: {
    getActiveAccountIndex: () => 0,
  },
}));

vi.mock('../../../src/background/nym/NymRuntimeController.js', () => {
  const fetchImpl = vi.fn(async () => new Response('ok-body', {
    status: 200,
    statusText: 'OK',
    headers: { 'x-test': '1' },
  }));
  return {
    getNymRuntimeController: () => ({
      getSnapshot: () => ({ mode: 'nym', connected: true }),
      getStellarFetch: () => fetchImpl,
    }),
  };
});

const HOST_SENDER = {
  id: 'test-extension-id',
  url: 'chrome-extension://test-extension-id/spp-host.html',
};

const ACCOUNT = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';
const OTHER = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const POOL = 'CCSI25UI6P42ZZWFPHAJ44BIYFLZV2QLMJ3BBT3XHDKNM5RRHXOLB5TW';

function transferIntent(): SppSignIntent {
  return {
    operation: 'transfer',
    amountStroops: '25',
    recipient: OTHER,
    networkPassphrase: Networks.TESTNET,
    poolContractId: POOL,
    registryContractId: null,
    tokenContractId: null,
    registerNoteKeyHex: null,
    registerEncryptionKeyHex: null,
    registerNoteKeyProofHex: null,
    registerEncryptionKeySignatureHex: null,
    registerOwnerSignatureHex: null,
    maxFeeStroops: '8000000',
    minResourceFeeStroops: null,
    account: ACCOUNT,
    exactMessage: null,
  };
}

describe('handleSppHostNymFetchRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSppBroadcastGateForTests();
    resetSppSignApprovalsForTests();
    setSppPaymentIdentityChecksForTests(true);
    setSppTestnetBroadcastAuthorized(false);
  });

  it('fetches configured reads and refuses submit, unknown, and mixed bodies before fetch', async () => {
    expect(isSppTestnetBroadcastAuthorized()).toBe(false);
    const { handleSppHostNymFetchRequest } = await import(
      '../../../src/background/spp/sppHostBridgeHandlers.js'
    );
    const { getNymRuntimeController } = await import(
      '../../../src/background/nym/NymRuntimeController.js'
    );
    const fetchImpl = getNymRuntimeController().getStellarFetch() as ReturnType<typeof vi.fn>;
    const call = (body: string) => handleSppHostNymFetchRequest({
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_NYM_FETCH',
      id: 'req-read',
      payload: {
        rpcUrl: STELLAR_SOROBAN_TESTNET_RPC,
        url: STELLAR_SOROBAN_TESTNET_RPC,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      },
    }, HOST_SENDER);

    for (const method of ['getHealth', 'getLatestLedger', 'getLedgerEntries', 'getEvents', 'getTransaction', 'simulateTransaction']) {
      fetchImpl.mockClear();
      const result = await call(JSON.stringify({ jsonrpc: '2.0', id: 1, method }));
      expect(result.ok).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(fetchImpl.mock.calls[0]?.[0]).toBe(STELLAR_SOROBAN_TESTNET_RPC);
    }

    mintSppSignApproval(transferIntent());
    fetchImpl.mockClear();
    const sent = await call(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sendTransaction' }));
    expect(sent.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(sppSignApprovalCount()).toBe(0);

    const mixed = await call(JSON.stringify([
      { jsonrpc: '2.0', id: 1, method: 'getHealth' },
      { jsonrpc: '2.0', id: 2, method: 'sendTransaction' },
    ]));
    expect(mixed.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(sppSignApprovalCount()).toBe(0);

    const hostile = await handleSppHostNymFetchRequest({
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_NYM_FETCH',
      id: 'req-host',
      payload: {
        rpcUrl: 'https://evil.example',
        url: 'https://evil.example',
        method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
      },
    }, HOST_SENDER);
    expect(hostile.ok).toBe(false);
    if (!hostile.ok) expect(hostile.code).toBe('ORIGIN_BLOCKED');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not fetch an unclassified JSON body', async () => {
    const { handleSppHostNymFetchRequest } = await import(
      '../../../src/background/spp/sppHostBridgeHandlers.js'
    );
    const { getNymRuntimeController } = await import(
      '../../../src/background/nym/NymRuntimeController.js'
    );
    const fetchImpl = getNymRuntimeController().getStellarFetch() as ReturnType<typeof vi.fn>;
    const result = await handleSppHostNymFetchRequest({
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_NYM_FETCH',
      id: 'req-1',
      payload: {
        rpcUrl: 'https://soroban-testnet.stellar.org',
        url: 'https://soroban-testnet.stellar.org',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      },
    }, HOST_SENDER);
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('blocks non-Soroban origins', async () => {
    const { handleSppHostNymFetchRequest } = await import(
      '../../../src/background/spp/sppHostBridgeHandlers.js'
    );
    const result = await handleSppHostNymFetchRequest({
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_NYM_FETCH',
      id: 'req-2',
      payload: {
        rpcUrl: 'https://soroban-testnet.stellar.org',
        url: 'https://evil.example/',
        method: 'GET',
      },
    }, HOST_SENDER);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('ORIGIN_BLOCKED');
    }
  });

  it('rejects Nym fetch from a sender other than spp-host', async () => {
    const { handleSppHostNymFetchRequest } = await import(
      '../../../src/background/spp/sppHostBridgeHandlers.js'
    );
    const result = await handleSppHostNymFetchRequest({
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_NYM_FETCH',
      id: 'req-3',
      payload: {
        rpcUrl: 'https://soroban-testnet.stellar.org',
        url: 'https://soroban-testnet.stellar.org',
        method: 'POST',
        body: '{}',
      },
    }, {
      id: 'test-extension-id',
      url: 'chrome-extension://test-extension-id/popup.html',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('UNAUTHORIZED');
  });
});
