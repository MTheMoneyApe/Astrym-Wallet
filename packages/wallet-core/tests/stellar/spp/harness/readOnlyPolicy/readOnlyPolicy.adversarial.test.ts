/**
 * Fase 2.24 — adversarial offline tests for read-only allowlist.
 * No Horizon / RPC / bootnode / external services. Fake handlers only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DecisionLog,
  G8_HOST_STATUS,
  G9_CONFIG_STATUS,
  authorizeReadOnlyCall,
  createFakeReadOnlyHandlers,
  createSideEffectRecorder,
  executeReadOnlyCall,
  isHarnessLoopbackRpcUrl,
  listAllowedMethods,
  listExplicitDenials,
  readOnlyGateStatus,
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

function validClientNew() {
  return {
    method: 'Client.new' as const,
    args: {
      rpcUrl: 'http://127.0.0.1:18765/rpc',
      contractConfig: syntheticConfig,
      circuitsBaseUrl: './circuits/',
      circuitLock: { fingerprint: 'synthetic' },
    },
  };
}

describe('2.24 read-only allowlist — authorize', () => {
  const log = new DecisionLog();

  afterEach(() => {
    log.clear();
  });

  it('1. authorized APIs pass only with valid args', () => {
    expect(authorizeReadOnlyCall({ method: 'Storage.open' }, log).ok).toBe(true);
    expect(
      authorizeReadOnlyCall({ method: 'Storage.open', args: { workerUrl: './storage-worker.js' } }, log)
        .ok,
    ).toBe(true);
    expect(authorizeReadOnlyCall(validClientNew(), log).ok).toBe(true);
    expect(authorizeReadOnlyCall({ method: 'Client.aspState' }, log).ok).toBe(true);
    expect(authorizeReadOnlyCall({ method: 'Client.allContractsData' }, log).ok).toBe(true);
    expect(listAllowedMethods()).toEqual([
      'Storage.open',
      'Client.new',
      'Client.aspState',
      'Client.allContractsData',
    ]);
    expect(log.allows().length).toBeGreaterThanOrEqual(5);
  });

  it('2. unknown methods fail closed', () => {
    const d = authorizeReadOnlyCall({ method: 'Client.somethingElse' }, log);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toMatch(/default deny|not on read-only/i);
  });

  it('3. explicit denial list all rejected', () => {
    for (const method of listExplicitDenials()) {
      const d = authorizeReadOnlyCall({ method }, log);
      expect(d.ok, method).toBe(false);
    }
    const critical = [
      'Client.sync',
      'Client.backgroundSync',
      'ensure_synced',
      'Client.operationalFeed',
      'Client.recipientLookup',
      'Client.verifySelectiveDisclosure',
      'verifySelectiveDisclosure',
      'prove_next',
      'PrivatePool.deposit',
      'PrivatePool.transfer',
      'PrivatePool.withdraw',
      'execute_plan',
      'signTransaction',
      'signAuthEntry',
      'signMessage',
      'sendTransaction',
    ];
    for (const method of critical) {
      expect(authorizeReadOnlyCall({ method }, log).ok, method).toBe(false);
    }
  });

  it('4. casing / similar names do not bypass', () => {
    const variants = [
      'aspState',
      'Client.AspState',
      'CLIENT.ASPSTATE',
      'client.aspState',
      'Client.asp_state',
      'Client.aspState ',
      ' Client.aspState',
      'Storage.Open',
      'storage.open',
      'Client.New',
      'allContractsData',
      'Client.allcontractsdata',
      'sendtransaction',
      'SendTransaction',
    ];
    for (const method of variants) {
      expect(authorizeReadOnlyCall({ method }, log).ok, method).toBe(false);
    }
  });

  it('5. extra / malformed args rejected (no silent accept)', () => {
    expect(
      authorizeReadOnlyCall({ method: 'Client.aspState', args: { unexpected: true } as never }, log)
        .ok,
    ).toBe(false);
    expect(
      authorizeReadOnlyCall(
        { method: 'Client.allContractsData', args: { foo: 1 } as never },
        log,
      ).ok,
    ).toBe(false);
    expect(
      authorizeReadOnlyCall(
        {
          method: 'Client.new',
          args: {
            rpcUrl: 'http://127.0.0.1:9/rpc',
            contractConfig: syntheticConfig,
            bootnodeUrl: 'http://127.0.0.1:9/boot',
          } as never,
        },
        log,
      ).ok,
    ).toBe(false);
    expect(
      authorizeReadOnlyCall(
        {
          method: 'Client.new',
          args: {
            rpcUrl: 'https://horizon-testnet.stellar.org',
            contractConfig: syntheticConfig,
          },
        },
        log,
      ).ok,
    ).toBe(false);
    expect(
      authorizeReadOnlyCall(
        {
          method: 'Client.new',
          args: { rpcUrl: 'http://127.0.0.1:9/rpc' } as never,
        },
        log,
      ).ok,
    ).toBe(false);
    expect(
      authorizeReadOnlyCall(
        {
          method: 'Storage.open',
          args: { workerUrl: 'https://evil.example/worker.js' },
        },
        log,
      ).ok,
    ).toBe(false);
    expect(isHarnessLoopbackRpcUrl('http://127.0.0.1/rpc')).toBe(true);
    expect(isHarnessLoopbackRpcUrl('https://mainnet.example/rpc')).toBe(false);
  });
});

describe('2.24 read-only execute — no fallback / no write', () => {
  const log = new DecisionLog();
  let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;

  afterEach(() => {
    log.clear();
    fetchSpy?.mockRestore();
    fetchSpy = undefined;
  });

  it('6. authorized method does not activate blocked path via fallback', async () => {
    const recorder = createSideEffectRecorder();
    const handlers = createFakeReadOnlyHandlers(recorder);
    const deniedApis = [
      'Client.sync',
      'sendTransaction',
      'signTransaction',
      'prove_next',
      'execute_plan',
    ];

    // Wrap handlers: if any denied API were somehow invoked, fail
    const guarded = {
      ...handlers,
      'Client.aspState': async () => {
        for (const api of deniedApis) {
          // Ensure we never call them as "recovery"
          expect(recorder.calls.some((c) => c.api === api)).toBe(false);
        }
        return handlers['Client.aspState']();
      },
    };

    const ok = await executeReadOnlyCall({ method: 'Client.aspState' }, guarded, log);
    expect(ok.ok).toBe(true);
    expect(recorder.calls.map((c) => c.api)).toEqual(['getLedgerEntries']);
    expect(recorder.calls.some((c) => deniedApis.includes(c.api))).toBe(false);
  });

  it('7. SDK exception does not trigger alternate blocked operation', async () => {
    const recorder = createSideEffectRecorder();
    const handlers = createFakeReadOnlyHandlers(recorder, {
      throwOn: 'Client.aspState',
      throwError: new Error('MissingRequiredContractKeys'),
    });

    // Hostile handler set that would "recover" via sync if execute fell through incorrectly
    let syncAttempted = false;
    const hostile = {
      ...handlers,
      'Client.aspState': async () => {
        try {
          return await handlers['Client.aspState']();
        } catch (e) {
          // Simulate what a bad integration might do — executeReadOnlyCall must NOT do this
          syncAttempted = true;
          recorder.record('Client.sync', 'bad-fallback');
          throw e;
        }
      },
    };

    // Our execute path: use throwing handlers WITHOUT the bad catch fallback inside execute
    const result = await executeReadOnlyCall(
      { method: 'Client.aspState' },
      createFakeReadOnlyHandlers(recorder, { throwOn: 'Client.aspState' }),
      log,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect('handlerError' in result && result.handlerError).toBeTruthy();
    expect(recorder.calls.map((c) => c.api)).toEqual(['getLedgerEntries']);
    expect(recorder.calls.some((c) => c.api === 'Client.sync')).toBe(false);
    expect(recorder.calls.some((c) => c.api === 'sendTransaction')).toBe(false);

    // Document that a naive caller fallback is a separate bug — policy execute itself didn't sync
    void hostile;
    void syncAttempted;
  });

  it('8. no sign* / sendTransaction through policy surface', async () => {
    const recorder = createSideEffectRecorder();
    const handlers = createFakeReadOnlyHandlers(recorder);

    for (const method of [
      'signTransaction',
      'signAuthEntry',
      'signMessage',
      'sendTransaction',
      'PrivatePool.deposit',
    ]) {
      const r = await executeReadOnlyCall({ method }, handlers, log);
      expect(r.ok).toBe(false);
    }
    expect(recorder.calls.length).toBe(0);

    await executeReadOnlyCall(validClientNew(), handlers, log);
    await executeReadOnlyCall({ method: 'Client.allContractsData' }, handlers, log);
    expect(recorder.calls.some((c) => c.api === 'sendTransaction')).toBe(false);
    expect(recorder.calls.some((c) => c.api.startsWith('sign'))).toBe(false);
  });

  it('9. tests do not require external services (fetch unused)', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('unexpected fetch — tests must stay offline');
    });

    const recorder = createSideEffectRecorder();
    const handlers = createFakeReadOnlyHandlers(recorder);
    await executeReadOnlyCall({ method: 'Storage.open' }, handlers, log);
    await executeReadOnlyCall(validClientNew(), handlers, log);
    await executeReadOnlyCall({ method: 'Client.aspState' }, handlers, log);
    await executeReadOnlyCall({ method: 'Client.allContractsData' }, handlers, log);

    expect(fetchSpy).not.toHaveBeenCalled();
    // Limitation: absence of fetch calls in this unit suite ≠ browser E2E network proof.
    // Browser harness uses installNetworkGuard (FASE-2.7/2.9); not re-run here.
  });

  it('10. policy does not claim G8/G9 PASS', () => {
    const status = readOnlyGateStatus();
    expect(status.G8_host).toBe('FAIL');
    expect(status.G9_config).toBe('FAIL');
    expect(status.productionIntegration).toBe('prohibited');
    expect(G8_HOST_STATUS).toBe('FAIL');
    expect(G9_CONFIG_STATUS).toBe('FAIL');
    expect(status.G8_host).not.toBe('PASS');
    expect(status.G9_config).not.toBe('PASS');
  });
});

describe('2.24 decision log — no secrets', () => {
  it('denial log records method + reason only', () => {
    const log = new DecisionLog();
    authorizeReadOnlyCall(
      {
        method: 'Client.new',
        args: {
          rpcUrl: 'https://secret-horizon.example/rpc',
          contractConfig: { ...syntheticConfig, admin: 'GSECRETADMIN' },
        },
      },
      log,
    );
    const snap = log.snapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0]?.outcome).toBe('deny');
    const json = JSON.stringify(snap);
    expect(json).not.toMatch(/GSECRETADMIN/);
    expect(json).not.toMatch(/secret-horizon/);
    expect(snap[0]?.reason).toMatch(/loopback/i);
  });
});
