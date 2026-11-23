import { describe, expect, it, vi } from 'vitest';
import { MessageRouter } from '../../src/background/MessageRouter.js';
import type { MessageTypes } from '../../src/shared/ipcTypes.js';

vi.mock('webextension-polyfill', () => {
  return {
    default: {
      runtime: {
        id: 'test-extension-id',
        getURL: (path: string) => {
          const normalized = path.startsWith('/') ? path : `/${path}`;
          return `chrome-extension://test-extension-id${normalized}`;
        },
      },
    },
  };
});

const EXTENSION = 'chrome-extension://test-extension-id';

function sender(page: string, id = 'test-extension-id') {
  return { id, url: page.startsWith('chrome-extension://') ? page : `${EXTENSION}/${page}` };
}

const sppHost = sender('spp-host.html');
const offscreen = sender('nym-offscreen.html');
const popup = sender('popup.html');
const webapp = sender('webapp.html');

const TX_HASH = 'ab'.repeat(32);
const ACCOUNT = `G${'A'.repeat(55)}`;
const ID = '123e4567-e89b-12d3-a456-426614174000';

const nymSnapshot = {
  state: 'disconnected' as const,
  lastError: null,
  connected: false,
  implementation: 'test',
  mode: 'direct' as const,
  preferenceHydrated: false,
  egressBlocked: false,
  privacyPreference: null,
  preferenceDurable: false,
  documentReady: false,
};

const DENIED_FROM_UNTRUSTED_PAGES = [
  'REVIEW_TRANSFER',
  'SEND_TRANSFER',
  'REVIEW_STELLAR_TRANSFER',
  'SEND_STELLAR_TRANSFER',
  'CONFIRM_STELLAR_TRANSFER',
  'NYM_SET_MODE',
  'NYM_SET_STELLAR_HORIZON_ENDPOINT',
  'NYM_CONNECT',
  'SPP_ACCOUNT_SNAPSHOT',
  'SPP_ACCOUNT_SYNC',
  'SPP_AUTHORIZE_KEY_DERIVATION',
  'SPP_PRIVATE_PAYMENT',
  'UNLOCK_VAULT',
  'REVEAL_RECOVERY_PHRASE',
  'RESET_WALLET',
] as const satisfies readonly MessageTypes[];

const SPP_HOST_ALLOWED = [
  'NYM_STATUS',
  'GET_ACTIVE_ACCOUNT',
  'GET_ACCOUNTS',
  'SPP_AUTHORIZE_STORAGE_UNLOCK',
] as const satisfies readonly MessageTypes[];

async function expectRejected(type: MessageTypes, who: { id: string; url: string }) {
  const router = new MessageRouter();
  const handler = vi.fn();
  router.registerHandler(type, handler as never);
  const result = await router.routeMessage({ id: 'deny-1', type, payload: {} }, who as never);
  expect(result.error?.name).toBe('UnauthorizedSenderError');
  expect(handler).not.toHaveBeenCalled();
}

describe('MessageRouter internal sender allowlist', () => {
  describe.each([
    ['spp-host.html', sppHost],
    ['nym-offscreen.html', offscreen],
  ] as const)('%s', (_label, who) => {
    it.each(DENIED_FROM_UNTRUSTED_PAGES)('rejects %s before the handler', async (type) => {
      await expectRejected(type, who);
    });
  });

  it.each(SPP_HOST_ALLOWED)('nym-offscreen.html rejects %s', async (type) => {
    await expectRejected(type, offscreen);
  });

  it('accepts the routes spp-host.html actually sends', async () => {
    const router = new MessageRouter();
    const nym = vi.fn(async () => nymSnapshot);
    const active = vi.fn(async () => ({ status: 'NONE' as const, index: null }));
    const accounts = vi.fn(async () => []);
    const unlock = vi.fn(async () => ({ approved: true as const, approvalToken: ID }));
    router.registerHandler('NYM_STATUS', nym);
    router.registerHandler('GET_ACTIVE_ACCOUNT', active);
    router.registerHandler('GET_ACCOUNTS', accounts);
    router.registerHandler('SPP_AUTHORIZE_STORAGE_UNLOCK', unlock);

    const unlockPayload = { message: 'unlock', prepareGeneration: 1, uses: 1 as const };
    const status = await router.routeMessage(
      { id: 'ok-nym', type: 'NYM_STATUS', payload: {} },
      sppHost as never,
    );
    const activeResult = await router.routeMessage(
      { id: 'ok-active', type: 'GET_ACTIVE_ACCOUNT', payload: {} },
      sppHost as never,
    );
    const accountsResult = await router.routeMessage(
      { id: 'ok-accounts', type: 'GET_ACCOUNTS', payload: {} },
      sppHost as never,
    );
    const unlockResult = await router.routeMessage(
      { id: 'ok-unlock', type: 'SPP_AUTHORIZE_STORAGE_UNLOCK', payload: unlockPayload },
      sppHost as never,
    );

    expect(status.error).toBeUndefined();
    expect(status.payload).toEqual(nymSnapshot);
    expect(nym).toHaveBeenCalledOnce();
    expect(activeResult.error).toBeUndefined();
    expect(activeResult.payload).toEqual({ status: 'NONE', index: null });
    expect(active).toHaveBeenCalledOnce();
    expect(accountsResult.error).toBeUndefined();
    expect(accountsResult.payload).toEqual([]);
    expect(accounts).toHaveBeenCalledOnce();
    expect(unlockResult.error).toBeUndefined();
    expect(unlockResult.payload).toEqual({ approved: true, approvalToken: ID });
    expect(unlock).toHaveBeenCalledWith(unlockPayload, sppHost);
  });

  it('does not let a spp-host query string widen the allowlist', async () => {
    const queried = sender('spp-host.html?next=popup.html');
    await expectRejected('SEND_STELLAR_TRANSFER', queried);

    const router = new MessageRouter();
    router.registerHandler('NYM_STATUS', async () => nymSnapshot);
    const result = await router.routeMessage(
      { id: 'ok-query', type: 'NYM_STATUS', payload: {} },
      queried as never,
    );
    expect(result.error).toBeUndefined();
    expect(result.payload).toEqual(nymSnapshot);
  });

  it.each([
    'spp-host.html.evil',
    'not-spp-host.html',
    'spp-host.html/extra',
    'options.html',
    'nym-offscreen.html.evil',
  ])('rejects NYM_STATUS from %s', async (page) => {
    await expectRejected('NYM_STATUS', sender(page));
  });

  it('rejects spp-host.html from another extension id', async () => {
    await expectRejected('NYM_STATUS', sender('spp-host.html', 'other-extension'));
  });

  describe.each([
    ['popup.html', popup],
    ['webapp.html', webapp],
  ] as const)('%s still reaches sensitive internal routes', (_label, who) => {
    it('NYM_SET_MODE', async () => {
      const router = new MessageRouter();
      const handler = vi.fn(async () => nymSnapshot);
      router.registerHandler('NYM_SET_MODE', handler);
      const payload = { mode: 'nym' as const };
      const result = await router.routeMessage(
        { id: 'trusted-mode', type: 'NYM_SET_MODE', payload },
        who as never,
      );
      expect(handler).toHaveBeenCalledWith(payload, who);
      expect(result.error).toBeUndefined();
      expect(result.payload).toEqual(nymSnapshot);
    });

    it('NYM_SET_STELLAR_HORIZON_ENDPOINT', async () => {
      const router = new MessageRouter();
      const response = {
        testnetEffectiveBase: 'https://horizon-testnet.stellar.org',
        mainnetEffectiveBase: 'https://horizon.stellar.org',
      };
      const handler = vi.fn(async () => response);
      router.registerHandler('NYM_SET_STELLAR_HORIZON_ENDPOINT', handler);
      const payload = { testnetEffectiveBase: 'https://horizon-testnet.stellar.org' };
      const result = await router.routeMessage(
        { id: 'trusted-horizon', type: 'NYM_SET_STELLAR_HORIZON_ENDPOINT', payload },
        who as never,
      );
      expect(handler).toHaveBeenCalledWith(payload, who);
      expect(result.error).toBeUndefined();
    });

    it('REVIEW_STELLAR_TRANSFER, SEND_STELLAR_TRANSFER, and CONFIRM_STELLAR_TRANSFER', async () => {
      const router = new MessageRouter();
      const reviewResponse = {
        id: ID,
        sourceAddress: ACCOUNT,
        destinationAddress: ACCOUNT,
        amountXlm: '1.5',
        feeXlm: '0.00001',
        balanceXlm: '10',
        destinationExists: true,
        operationType: 'payment' as const,
      };
      const review = vi.fn(async () => reviewResponse);
      const send = vi.fn(async () => ({ txHash: TX_HASH, status: 'PENDING' as const }));
      const confirm = vi.fn(async () => ({ txHash: TX_HASH, status: 'CONFIRMED' as const }));
      router.registerHandler('REVIEW_STELLAR_TRANSFER', review);
      router.registerHandler('SEND_STELLAR_TRANSFER', send);
      router.registerHandler('CONFIRM_STELLAR_TRANSFER', confirm);

      const reviewResult = await router.routeMessage({
        id: 'trusted-review',
        type: 'REVIEW_STELLAR_TRANSFER',
        payload: { accountIndex: 0, destination: ACCOUNT, amountXlm: '1.5' },
      }, who as never);
      const sendResult = await router.routeMessage({
        id: 'trusted-send',
        type: 'SEND_STELLAR_TRANSFER',
        payload: { id: ID },
      }, who as never);
      const confirmResult = await router.routeMessage({
        id: 'trusted-confirm',
        type: 'CONFIRM_STELLAR_TRANSFER',
        payload: { txHash: TX_HASH },
      }, who as never);

      expect(review).toHaveBeenCalledOnce();
      expect(send).toHaveBeenCalledOnce();
      expect(confirm).toHaveBeenCalledOnce();
      expect(reviewResult.error).toBeUndefined();
      expect(sendResult.error).toBeUndefined();
      expect(confirmResult.error).toBeUndefined();
      expect(sendResult.payload).toEqual({ txHash: TX_HASH, status: 'PENDING' });
    });
  });
});
