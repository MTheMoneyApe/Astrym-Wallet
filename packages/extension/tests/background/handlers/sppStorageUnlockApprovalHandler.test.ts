import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  storageGet: vi.fn(),
  nymSnapshot: vi.fn(),
  activeAddress: vi.fn(),
  trustedHost: vi.fn(),
}));

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: { id: 'peanjgnchnfcfaclipankhfkligmlklc' },
    storage: { local: { get: mocks.storageGet } },
  },
}));
vi.mock('../../../src/background/nym/NymRuntimeController.js', () => ({
  getNymRuntimeController: () => ({ getSnapshot: mocks.nymSnapshot }),
}));
vi.mock('../../../src/background/spp/sppBoundAccount.js', () => ({
  resolveActiveStellarAddress: mocks.activeAddress,
}));
vi.mock('../../../src/background/trustedWalletOrigin.js', () => ({
  isSppHostDocumentSender: mocks.trustedHost,
}));

import {
  createSppStorageUnlockMessage,
  resetSppStorageUnlockApprovalsForTests,
} from '@solanym/wallet-core/src/stellar/spp/sppStorageUnlockGate.js';
import { createSppStorageUnlockApprovalHandler } from '../../../src/background/handlers/sppStorageUnlockApprovalHandler.js';
import {
  SPP_AUTO_PREPARE_INTENT_KEY,
  SPP_PREPARE_STATUS_KEY,
} from '../../../src/shared/sppPrepareStatus.js';

const ACCOUNT = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';
const ORIGIN = 'chrome-extension://peanjgnchnfcfaclipankhfkligmlklc';
const GENERATION = 24;
const SALT = Buffer.alloc(32, 12).toString('base64');

describe('SPP storage unlock approval handler', () => {
  afterEach(() => resetSppStorageUnlockApprovalsForTests());

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.nymSnapshot.mockReturnValue({ mode: 'nym', connected: true });
    mocks.trustedHost.mockReturnValue(true);
    mocks.activeAddress.mockResolvedValue({ index: 0, address: ACCOUNT });
    mocks.storageGet.mockImplementation(async (key: string) => {
      if (key === SPP_PREPARE_STATUS_KEY) {
        return {
          [SPP_PREPARE_STATUS_KEY]: {
            phase: 'initializing_session',
            generation: GENERATION,
          },
        };
      }
      if (key === SPP_AUTO_PREPARE_INTENT_KEY) {
        return {
          [SPP_AUTO_PREPARE_INTENT_KEY]: {
            autoRun: true,
            generation: GENERATION,
          },
        };
      }
      return {};
    });
  });

  it('mints approval only for trusted active Nym session and exact account/origin/generation', async () => {
    const message = createSppStorageUnlockMessage({
      origin: ORIGIN,
      account: ACCOUNT,
      salt: SALT,
    });
    const handler = createSppStorageUnlockApprovalHandler({ keyManager: {} as never });
    await expect(handler({
      message,
      prepareGeneration: GENERATION,
      uses: 2,
    } as never, {
      id: 'peanjgnchnfcfaclipankhfkligmlklc',
      url: `${ORIGIN}/spp-host.html`,
    } as never)).resolves.toMatchObject({
      approved: true,
      approvalToken: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(mocks.activeAddress).toHaveBeenCalledOnce();
    expect(mocks.trustedHost).toHaveBeenCalledOnce();
  });

  it('rejects stale generations, wrong origins, and mismatched active accounts', async () => {
    const handler = createSppStorageUnlockApprovalHandler({ keyManager: {} as never });
    const message = createSppStorageUnlockMessage({
      origin: ORIGIN,
      account: ACCOUNT,
      salt: SALT,
    });
    await expect(handler({
      message,
      prepareGeneration: GENERATION + 1,
      uses: 1,
    } as never, {
      id: 'peanjgnchnfcfaclipankhfkligmlklc',
      url: `${ORIGIN}/spp-host.html`,
    } as never)).rejects.toThrow(/stale or inactive/);

    await expect(handler({
      message: createSppStorageUnlockMessage({
        origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
        account: ACCOUNT,
        salt: SALT,
      }),
      prepareGeneration: GENERATION,
      uses: 1,
    } as never, {
      id: 'peanjgnchnfcfaclipankhfkligmlklc',
      url: `${ORIGIN}/spp-host.html`,
    } as never)).rejects.toThrow(/another origin/);

    mocks.activeAddress.mockResolvedValueOnce({
      index: 0,
      address: 'G' + 'A'.repeat(55),
    });
    await expect(handler({
      message,
      prepareGeneration: GENERATION,
      uses: 1,
    } as never, {
      id: 'peanjgnchnfcfaclipankhfkligmlklc',
      url: `${ORIGIN}/spp-host.html`,
    } as never)).rejects.toThrow(/active Stellar account/);
  });

  it('refuses when Nym is not connected or the sender is not the host document', async () => {
    const handler = createSppStorageUnlockApprovalHandler({ keyManager: {} as never });
    const message = createSppStorageUnlockMessage({
      origin: ORIGIN,
      account: ACCOUNT,
      salt: SALT,
    });
    mocks.nymSnapshot.mockReturnValue({ mode: 'direct', connected: false });
    await expect(handler({
      message,
      prepareGeneration: GENERATION,
      uses: 1,
    } as never, {
      id: 'peanjgnchnfcfaclipankhfkligmlklc',
      url: `${ORIGIN}/spp-host.html`,
    } as never)).rejects.toThrow(/Connect Nym/);

    mocks.nymSnapshot.mockReturnValue({ mode: 'nym', connected: true });
    mocks.trustedHost.mockReturnValue(false);
    await expect(handler({
      message,
      prepareGeneration: GENERATION,
      uses: 1,
    } as never, {
      id: 'peanjgnchnfcfaclipankhfkligmlklc',
      url: `${ORIGIN}/popup.html`,
    } as never)).rejects.toThrow(/Astrym SPP host/);
  });
});
