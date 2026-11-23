import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: { id: 'test-extension-id' },
    storage: { local: { get: async () => ({}), set: async () => {} } },
  },
}));

import {
  beginPrivatePaymentExecution,
  hydrateUnresolvedSubmissions,
  persistUnresolvedSubmission,
  resetPrivatePaymentExecutionGuardForTests,
  resetUnresolvedSubmissionStoreForTests,
} from '@solanym/wallet-core/src/stellar/spp/sppExecutionGuard.js';
import { allowlistedSorobanReadBody } from '../../../src/background/spp/sppHostBridgeHandlers.js';
import {
  SPP_UNRESOLVED_SUBMISSIONS_KEY,
  confirmationFromAllowlistedGetTransaction,
  installChromeUnresolvedSubmissionStore,
  reconcileFingerprintThroughReadAllowlist,
} from '../../../src/background/spp/sppSubmissionReconcile.js';

type ChromeLocal = {
  get: (
    key: string,
    callback?: (items: Record<string, unknown>) => void,
  ) => Promise<Record<string, unknown>>;
  set: (
    items: Record<string, unknown>,
    callback?: () => void,
  ) => Promise<void>;
};

function installChromeLocal() {
  const data = new Map<string, unknown>();
  const local: ChromeLocal = {
    get(key, callback) {
      const items = { [key]: data.get(key) };
      callback?.(items);
      return Promise.resolve(items);
    },
    set(items, callback) {
      for (const [key, value] of Object.entries(items)) data.set(key, value);
      callback?.();
      return Promise.resolve();
    },
  };
  (globalThis as { chrome?: { storage?: { local?: ChromeLocal } } }).chrome = {
    storage: { local },
  };
  installChromeUnresolvedSubmissionStore();
  return data;
}

describe('SPP submission reconcile', () => {
  afterEach(() => {
    resetPrivatePaymentExecutionGuardForTests();
    resetUnresolvedSubmissionStoreForTests();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it('persists {fingerprint, hashes, at} in chrome.storage.local across reload', async () => {
    const data = installChromeLocal();
    await persistUnresolvedSubmission({
      fingerprint: 'fp-reload-01',
      hashes: ['hash-1', 'hash-2'],
      at: 42,
    });
    expect(data.get(SPP_UNRESOLVED_SUBMISSIONS_KEY)).toEqual([
      { fingerprint: 'fp-reload-01', hashes: ['hash-1', 'hash-2'], at: 42 },
    ]);
    resetPrivatePaymentExecutionGuardForTests();
    await hydrateUnresolvedSubmissions();
    expect(() => beginPrivatePaymentExecution('fp-reload-01')).toThrow(/reconcil/);
  });

  it('blocks re-authorization until getTransaction succeeds through the read allowlist', async () => {
    installChromeLocal();
    const fingerprint = 'fp-reconcile-1';
    await persistUnresolvedSubmission({
      fingerprint,
      hashes: ['hash-1', 'hash-2'],
      at: 7,
    });
    resetPrivatePaymentExecutionGuardForTests();
    await hydrateUnresolvedSubmissions();
    expect(() => beginPrivatePaymentExecution(fingerprint)).toThrow(/getTransaction/);

    const sendBody = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendTransaction',
      params: { transaction: 'AAAA' },
    });
    expect(allowlistedSorobanReadBody(sendBody)).toBeNull();

    const bodies: string[] = [];
    const cleared = await reconcileFingerprintThroughReadAllowlist({
      fingerprint,
      fetchRead: async (_url, init) => {
        const body = String(init?.body ?? '');
        bodies.push(body);
        const parsed = JSON.parse(body) as { method?: string; id?: string };
        expect(parsed.method).toBe('getTransaction');
        return new Response(
          JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: { status: 'SUCCESS' } }),
          { status: 200 },
        );
      },
    });
    expect(cleared).toBe(true);
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(JSON.parse(body).method).toBe('getTransaction');
      expect(body).not.toContain('sendTransaction');
    }
    const release = beginPrivatePaymentExecution(fingerprint);
    release.release();
  });

  it('stays submitted until allowlisted getTransaction SUCCESS and only then confirmed', async () => {
    const fetchRead = async (_url: string, init?: RequestInit) => {
      const parsed = JSON.parse(String(init?.body ?? '')) as {
        method?: string;
        params?: { hash?: string };
      };
      expect(parsed.method).toBe('getTransaction');
      const status = parsed.params?.hash === 'ok-hash' ? 'SUCCESS' : 'NOT_FOUND';
      return new Response(JSON.stringify({ result: { status } }), { status: 200 });
    };
    await expect(confirmationFromAllowlistedGetTransaction('pending-hash', fetchRead)).resolves.toBe(
      'submitted',
    );
    await expect(confirmationFromAllowlistedGetTransaction('ok-hash', fetchRead)).resolves.toBe(
      'confirmed',
    );
  });
});
