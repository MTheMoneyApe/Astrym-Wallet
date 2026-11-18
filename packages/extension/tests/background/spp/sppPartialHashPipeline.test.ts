import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: {
      id: 'test-extension-id',
      getURL: (path: string) => `chrome-extension://test-extension-id${path.startsWith('/') ? path : `/${path}`}`,
    },
  },
}));
import { StrKey, Keypair } from '@stellar/stellar-sdk';
import { SppPrivatePaymentError } from '@solanym/wallet-core/src/stellar/spp/sppNymOption.js';
import { SPP_HOST_BRIDGE_CHANNEL } from '../../../src/shared/sppHostBridge.js';
import { createSppHostPoolProxy } from '../../../src/background/spp/sppHostPoolProxy.js';
import { MessageRouter } from '../../../src/background/MessageRouter.js';

const POOL = StrKey.encodeContract(Keypair.random().rawPublicKey());

describe('partial hash pipeline', () => {
  it('keeps completed hashes and the error code from host through the proxy', async () => {
    const pool = createSppHostPoolProxy({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      nymMode: 'nym',
      nymConnected: true,
      poolContract: POOL,
      send: async (request) => ({
        channel: SPP_HOST_BRIDGE_CHANNEL,
        type: 'SPP_HOST_EXECUTE_PRIVATE_PAYMENT_RESULT',
        id: request.id,
        ok: false,
        code: 'EXECUTION_FAILED',
        message: 'partial',
        txHashes: ['hash-1', 'hash-2'],
      }),
    });
    await expect(pool.deposit(10n)).rejects.toMatchObject({
      code: 'EXECUTION_FAILED',
      txHashes: ['hash-1', 'hash-2'],
    });
  });

  it('keeps code and hashes on the router error', async () => {
    const router = new MessageRouter();
    router.registerHandler('SPP_PRIVATE_PAYMENT', async () => {
      throw Object.assign(new SppPrivatePaymentError('SUBMISSION_UNKNOWN', 'partial', {
        txHashes: ['hash-1', 'hash-2'],
      }), { code: 'SUBMISSION_UNKNOWN' });
    });
    const result = await router.routeMessage({
      id: 'm1',
      type: 'SPP_PRIVATE_PAYMENT',
      payload: {
        enabled: true,
        operation: 'deposit',
        poolContract: POOL,
        amountStroops: '10',
        authorizationFingerprint: 'deposit|' + POOL + '|10|',
      },
    }, {
      id: 'test-extension-id',
      url: 'chrome-extension://test-extension-id/popup.html',
    });
    expect(result.error).toMatchObject({
      code: 'SUBMISSION_UNKNOWN',
      txHashes: ['hash-1', 'hash-2'],
    });
  });
});
