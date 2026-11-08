/**
 * Service-worker sign gate: foreign senders never reach the signer.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Networks } from '@stellar/stellar-sdk';
import {
  isSppTestnetBroadcastAuthorized,
  resetSppBroadcastGateForTests,
  setSppTestnetBroadcastAuthorized,
} from '@solanym/wallet-core/src/stellar/spp/sppBroadcastGate.js';
import {
  mintSppSignApproval,
  resetSppSignApprovalsForTests,
  sppKeyDerivationMessage,
  sppSignApprovalCount,
  type SppSignIntent,
} from '@solanym/wallet-core/src/stellar/spp/sppSignGate.js';
import { NETHERMIND_PUBLIC_KDF_DOMAIN } from '@solanym/wallet-core/src/stellar/spp/nethermind/nethermindPublicTestnet.js';

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: {
      id: 'test-extension-id',
      getURL: (path: string) => `chrome-extension://test-extension-id${path.startsWith('/') ? path : `/${path}`}`,
    },
  },
}));

vi.mock('../../../src/background/accounts/ActiveAccountManager.js', () => ({
  activeAccountManager: {
    getActiveAccountIndex: () => 0,
  },
}));

vi.mock('../../../src/background/nym/NymRuntimeController.js', () => ({
  getNymRuntimeController: () => ({
    getSnapshot: () => ({ mode: 'nym', connected: true }),
    getStellarFetch: () => vi.fn(),
  }),
}));

import { SPP_HOST_BRIDGE_CHANNEL } from '../../../src/shared/sppHostBridge.js';
import { handleSppHostSignRequest } from '../../../src/background/spp/sppHostBridgeHandlers.js';
import { isSppHostDocumentSender } from '../../../src/background/trustedWalletOrigin.js';

const HOST = {
  id: 'test-extension-id',
  url: 'chrome-extension://test-extension-id/spp-host.html',
};
const POPUP = {
  id: 'test-extension-id',
  url: 'chrome-extension://test-extension-id/popup.html',
};

function signRequest(networkPassphrase?: string) {
  return {
    channel: SPP_HOST_BRIDGE_CHANNEL,
    type: 'SPP_HOST_SIGN' as const,
    id: 'sign-1',
    payload: {
      kind: 'transaction' as const,
      input: 'AAAA',
      address: 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6',
      ...(networkPassphrase !== undefined ? { networkPassphrase } : {}),
    },
  };
}

describe('SPP host sign sender gate', () => {
  const signTransaction = vi.fn();

  beforeEach(() => {
    signTransaction.mockReset();
  });

  it('recognises only the extension spp-host document', () => {
    expect(isSppHostDocumentSender(HOST)).toBe(true);
    expect(isSppHostDocumentSender(POPUP)).toBe(false);
    expect(isSppHostDocumentSender({
      id: 'test-extension-id',
      url: 'chrome-extension://test-extension-id/webapp.html',
    })).toBe(false);
    expect(isSppHostDocumentSender({
      id: 'test-extension-id',
      url: 'https://evil.example/spp-host.html',
    })).toBe(false);
    expect(isSppHostDocumentSender({
      id: 'other-extension',
      url: 'chrome-extension://other-extension/spp-host.html',
    })).toBe(false);
    expect(isSppHostDocumentSender(undefined)).toBe(false);
  });

  it('rejects a foreign sender before any signing', async () => {
    const result = await handleSppHostSignRequest(
      signRequest(Networks.TESTNET),
      {
        signer: { chain: 'stellar', signTransaction } as never,
        keyManager: { getAccounts: async () => [] } as never,
      },
      POPUP,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('UNAUTHORIZED');
    expect(signTransaction).not.toHaveBeenCalled();
  });

  it('rejects a missing sender', async () => {
    const result = await handleSppHostSignRequest(
      signRequest(Networks.TESTNET),
      {
        signer: { chain: 'stellar', signTransaction } as never,
        keyManager: { getAccounts: async () => [] } as never,
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('UNAUTHORIZED');
    expect(signTransaction).not.toHaveBeenCalled();
  });

  it('rejects the Public passphrase from the spp-host document', async () => {
    const result = await handleSppHostSignRequest(
      signRequest(Networks.PUBLIC),
      {
        signer: { chain: 'stellar', signTransaction } as never,
        keyManager: { getAccounts: async () => [] } as never,
      },
      HOST,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('UNAUTHORIZED');
    expect(signTransaction).not.toHaveBeenCalled();
  });

  it('rejects signing before the signer when the broadcast fixture is off and revokes the intent', async () => {
    setSppTestnetBroadcastAuthorized(false);
    expect(isSppTestnetBroadcastAuthorized()).toBe(false);
    const intent: SppSignIntent = {
      operation: 'register_public_keys',
      amountStroops: null,
      recipient: null,
      networkPassphrase: Networks.TESTNET,
      poolContractId: null,
      registryContractId: 'CA5MA3LDXS4TQKBQ7SY57IHO3VMYV7G3ZJH45CWCX4QVP25IDFMZWZ3E',
      tokenContractId: null,
      registerNoteKeyHex: '11'.repeat(32),
      registerEncryptionKeyHex: '22'.repeat(32),
      registerNoteKeyProofHex: 'aa',
      registerEncryptionKeySignatureHex: 'cd'.repeat(64),
      registerOwnerSignatureHex: 'ab'.repeat(64),
      maxFeeStroops: '5000000',
      minResourceFeeStroops: null,
      account: 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6',
      exactMessage: sppKeyDerivationMessage(NETHERMIND_PUBLIC_KDF_DOMAIN),
    };
    mintSppSignApproval(intent);
    expect(sppSignApprovalCount()).toBe(1);
    const signMessage = vi.fn();
    const result = await handleSppHostSignRequest(
      {
        ...signRequest(Networks.TESTNET),
        payload: { ...signRequest(Networks.TESTNET).payload, kind: 'message' },
      },
      {
        signer: { chain: 'stellar', signTransaction, signMessage } as never,
        keyManager: { getAccounts: async () => [] } as never,
      },
      HOST,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('UNAUTHORIZED');
      expect(result.message).toMatch(/SPP_BROADCAST_AWAITING_APPROVAL/);
    }
    expect(signTransaction).not.toHaveBeenCalled();
    expect(signMessage).not.toHaveBeenCalled();
    expect(sppSignApprovalCount()).toBe(0);
    resetSppBroadcastGateForTests();
    resetSppSignApprovalsForTests();
  });

  it('rejects an omitted passphrase', async () => {
    const result = await handleSppHostSignRequest(
      signRequest(),
      {
        signer: { chain: 'stellar', signTransaction } as never,
        keyManager: { getAccounts: async () => [] } as never,
      },
      HOST,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('UNAUTHORIZED');
    expect(signTransaction).not.toHaveBeenCalled();
  });
});
