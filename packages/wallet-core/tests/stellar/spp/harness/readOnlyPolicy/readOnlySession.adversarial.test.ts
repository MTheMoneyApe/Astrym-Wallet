/**
 * Fase 2.26 — ReadOnlySession + network guard adversarial tests (offline).
 */
import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createFakeReadOnlyHandlers,
  createSideEffectRecorder,
  createReadOnlySession,
  installNetworkGuard,
  classifyNetworkTarget,
  assessG8G9,
} from './index.js';

const syntheticConfig = {
  network: 'Test SDF Network ; September 2015',
  kdf_domain: 'harness',
  deployer: 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6',
  admin: 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6',
  asp_membership: 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526',
  asp_non_membership: 'CABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAFNSZ',
  verifiers: {},
  public_key_registry: 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW',
  pools: [],
};

function baseConfig(over: Record<string, unknown> = {}) {
  return {
    rpcUrl: 'http://127.0.0.1:18765/rpc',
    contractConfig: syntheticConfig,
    circuitsBaseUrl: './circuits/',
    ...over,
  };
}

describe('2.26 ReadOnlySession — RO-1 surface', () => {
  let guard = installNetworkGuard();

  afterEach(() => {
    guard.uninstall();
    guard = installNetworkGuard();
  });

  it('four allowed ops succeed via session-bound handle', async () => {
    const created = createReadOnlySession({ ...baseConfig(), networkGuard: guard });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const { session } = created;

    expect((await session.openStorage()).ok).toBe(true);
    const client = await session.createClient();
    expect(client.ok).toBe(true);
    expect(client.handle).toBeDefined();
    expect((await client.handle!.aspState()).ok).toBe(true);
    expect((await client.handle!.allContractsData()).ok).toBe(true);

    const apis = session.sideEffects().calls.map((c) => c.api);
    expect(apis).toEqual(['Storage.open', 'Client.new', 'getLedgerEntries', 'getLedgerEntries']);
    expect(apis).not.toContain('Client.sync');
    expect(apis).not.toContain('sendTransaction');
    expect(apis).not.toContain('signTransaction');
    expect(apis).not.toContain('prove_next');
    guard.assertNoExternal();
    session.close();
  });

  it('unknown methods and mutators denied; no blocked side effects', async () => {
    const created = createReadOnlySession({ ...baseConfig(), networkGuard: guard });
    if (!created.ok) throw new Error('session');
    const { session } = created;
    await session.openStorage();
    await session.createClient();

    for (const method of [
      'Client.sync',
      'PrivatePool.deposit',
      'signTransaction',
      'sendTransaction',
      'prove_next',
      'execute_plan',
      'Client.operationalFeed',
    ]) {
      const r = await session.tryInvoke(method);
      expect(r.ok, method).toBe(false);
    }
    expect(session.sideEffects().calls.some((c) => c.api === 'Client.sync')).toBe(false);
    expect(session.state).toBe('open');
    session.close();
  });

  it('rejects external / malformed rpcUrl at session create', () => {
    expect(createReadOnlySession(baseConfig({ rpcUrl: 'https://horizon.example/rpc' })).ok).toBe(
      false,
    );
    expect(createReadOnlySession(baseConfig({ rpcUrl: 'http://127.1/rpc' })).ok).toBe(false);
    expect(createReadOnlySession(baseConfig({ rpcUrl: 'http://user:x@127.0.0.1/rpc' })).ok).toBe(
      false,
    );
    expect(createReadOnlySession(baseConfig({ rpcUrl: 'not-a-url' })).ok).toBe(false);
  });

  it('closed session cannot be reused; handle dies with session', async () => {
    const created = createReadOnlySession({ ...baseConfig(), networkGuard: guard });
    if (!created.ok) throw new Error('session');
    const { session } = created;
    await session.openStorage();
    const client = await session.createClient();
    session.close('done');
    expect(session.state).toBe('closed');
    expect((await session.openStorage()).ok).toBe(false);
    expect((await client.handle!.aspState()).ok).toBe(false);
    expect((await session.tryInvoke('Client.aspState')).ok).toBe(false);
  });

  it('createClient before openStorage fails', async () => {
    const created = createReadOnlySession(baseConfig());
    if (!created.ok) throw new Error('session');
    expect((await created.session.createClient()).ok).toBe(false);
  });

  it('SDK handler error closes session without fallback', async () => {
    const recorder = createSideEffectRecorder();
    const handlers = createFakeReadOnlyHandlers(recorder, {
      throwOn: 'Client.aspState',
      throwError: new Error('unexpected RPC'),
    });
    const created = createReadOnlySession({
      ...baseConfig(),
      handlers,
      recorder,
      networkGuard: guard,
    });
    if (!created.ok) throw new Error('session');
    const { session } = created;
    await session.openStorage();
    const client = await session.createClient();
    const r = await client.handle!.aspState();
    expect(r.ok).toBe(false);
    expect(session.state).toBe('closed');
    expect(recorder.calls.some((c) => c.api === 'Client.sync')).toBe(false);
    expect(recorder.calls.some((c) => c.api === 'sendTransaction')).toBe(false);
  });

  it('does not leak raw SDK-like objects from createClient', async () => {
    const created = createReadOnlySession(baseConfig());
    if (!created.ok) throw new Error('session');
    await created.session.openStorage();
    const client = await created.session.createClient();
    expect(client.handle).toBeDefined();
    expect(client.handle).not.toHaveProperty('sync');
    expect(client.handle).not.toHaveProperty('backgroundSync');
    expect(client.handle).not.toHaveProperty('account');
    expect(Object.keys(client.handle!).sort()).toEqual([
      'allContractsData',
      'aspState',
      'sessionId',
    ]);
  });
});

describe('2.26 network guard', () => {
  it('classifies local vs external targets', () => {
    expect(classifyNetworkTarget('http://127.0.0.1:9/rpc')).toBe('local_allowed');
    expect(classifyNetworkTarget('https://horizon-testnet.stellar.org')).toBe('external_blocked');
    expect(classifyNetworkTarget('(unknown)')).toBe('not_demonstrated');
  });

  it('blocks external fetch and records attempt', async () => {
    const guard = installNetworkGuard();
    try {
      await expect(fetch('https://example.com/')).rejects.toThrow(/blocked external fetch/i);
      expect(guard.snapshot().externalCount).toBeGreaterThanOrEqual(1);
      expect(() => guard.assertNoExternal()).toThrow();
    } finally {
      guard.uninstall();
    }
  });

  it('blocks external http.request', () => {
    const guard = installNetworkGuard();
    try {
      expect(() =>
        http.request({ hostname: 'example.com', path: '/', method: 'GET' }, () => undefined),
      ).toThrow(/blocked external http/i);
      expect(guard.snapshot().instrumented).toEqual(
        expect.arrayContaining(['fetch', 'http', 'https']),
      );
      expect(guard.snapshot().notDemonstrated.length).toBeGreaterThan(0);
    } finally {
      guard.uninstall();
    }
  });

  it('allows recording local_allowed without throwing assertNoExternal', async () => {
    const guard = installNetworkGuard();
    try {
      // Do not actually connect — record synthetic local
      guard.record('fetch', 'http://127.0.0.1:18765/rpc', 'local_allowed');
      guard.assertNoExternal();
    } finally {
      guard.uninstall();
    }
  });
});

describe('2.26 G8/G9 remain FAIL', () => {
  it('session and assessG8G9 do not elevate gates', () => {
    const created = createReadOnlySession(baseConfig());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.session.gateStatus()).toEqual({ G8: 'FAIL', G9: 'FAIL' });
    const { G8, G9 } = assessG8G9();
    expect(G8.verdict).toBe('FAIL');
    expect(G9.verdict).toBe('FAIL');
    created.session.close();
  });
});
