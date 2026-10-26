/**
 * Fase 2.25 — adversarial isolation vs SDK call-graph evidence + hardened rpcUrl.
 * Offline only. Does not load WASM / contact network.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DecisionLog,
  authorizeReadOnlyCall,
  createFakeReadOnlyHandlers,
  createSideEffectRecorder,
  executeReadOnlyCall,
  isHarnessLoopbackRpcUrl,
  listExplicitDenials,
  readOnlyGateStatus,
} from './index.js';
import { assessG8G9 } from './gates.js';
import {
  BLOCKED_DUE_TO_TRANSITIVE_EFFECTS,
  RO1_SDK_CALL_GRAPHS,
} from './sdkCallGraph.js';

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

describe('2.25 rpcUrl adversarial (literal loopback)', () => {
  const log = new DecisionLog();
  afterEach(() => log.clear());

  it('accepts only literal loopback http(s) forms', () => {
    const ok = [
      'http://127.0.0.1/rpc',
      'http://127.0.0.1:18765/rpc',
      'http://localhost:8765/rpc',
      'http://[::1]:8765/rpc',
      'https://127.0.0.1/rpc',
    ];
    for (const rpcUrl of ok) {
      expect(isHarnessLoopbackRpcUrl(rpcUrl), rpcUrl).toBe(true);
      expect(
        authorizeReadOnlyCall(
          { method: 'Client.new', args: { rpcUrl, contractConfig: syntheticConfig } },
          log,
        ).ok,
        rpcUrl,
      ).toBe(true);
    }
  });

  it('rejects malformed, credentials, schemes, and hostname aliases', () => {
    const bad = [
      '',
      'not-a-url',
      'file:///tmp/rpc',
      'ws://127.0.0.1/rpc',
      'http://user:pass@127.0.0.1/rpc',
      'http://127.0.0.1:443@evil.com/',
      'http://127.0.0.1.evil.com/rpc',
      'http://127.1/rpc', // WHATWG → 127.0.0.1 but not literal — reject
      'http://0x7f000001/rpc',
      'http://2130706433/rpc',
      'http://localhost.evil.com/rpc',
      'https://horizon-testnet.stellar.org',
      'http://[::ffff:127.0.0.1]/rpc',
      'http://127.0.0.1%2eevil.com/rpc',
    ];
    for (const rpcUrl of bad) {
      expect(isHarnessLoopbackRpcUrl(rpcUrl), rpcUrl).toBe(false);
      if (rpcUrl === '' || rpcUrl === 'not-a-url') continue;
      expect(
        authorizeReadOnlyCall(
          {
            method: 'Client.new',
            args: { rpcUrl, contractConfig: syntheticConfig },
          },
          log,
        ).ok,
        rpcUrl,
      ).toBe(false);
    }
  });
});

describe('2.25 transitive / blocked alignment with SRC audit', () => {
  it('every SRC-dangerous method is denied by policy', () => {
    for (const row of BLOCKED_DUE_TO_TRANSITIVE_EFFECTS) {
      expect(authorizeReadOnlyCall({ method: row.method }).ok, row.method).toBe(false);
      expect(listExplicitDenials()).toContain(row.method);
    }
  });

  it('RO-1 graphs claim only getLedgerEntries for read methods', () => {
    const asp = RO1_SDK_CALL_GRAPHS.find((g) => g.method === 'Client.aspState');
    const all = RO1_SDK_CALL_GRAPHS.find((g) => g.method === 'Client.allContractsData');
    expect(asp?.rpcMethods).toEqual(['getLedgerEntries']);
    expect(all?.rpcMethods).toEqual(['getLedgerEntries']);
    expect(asp?.syncProverSignSend).toMatchObject({
      sync: false,
      prove: false,
      sign: false,
      send: false,
      evidence: 'COMPROBADO_EN_FUENTE',
    });
  });

  it('fake RO traverse never records blocked side effects', async () => {
    const recorder = createSideEffectRecorder();
    const handlers = createFakeReadOnlyHandlers(recorder);
    const log = new DecisionLog();

    await executeReadOnlyCall({ method: 'Storage.open' }, handlers, log);
    await executeReadOnlyCall(
      {
        method: 'Client.new',
        args: {
          rpcUrl: 'http://127.0.0.1:9/rpc',
          contractConfig: syntheticConfig,
          circuitsBaseUrl: './circuits/',
        },
      },
      handlers,
      log,
    );
    await executeReadOnlyCall({ method: 'Client.aspState' }, handlers, log);
    await executeReadOnlyCall({ method: 'Client.allContractsData' }, handlers, log);

    const apis = recorder.calls.map((c) => c.api);
    expect(apis).toEqual([
      'Storage.open',
      'Client.new',
      'getLedgerEntries',
      'getLedgerEntries',
    ]);
    for (const blocked of [
      'Client.sync',
      'prove_next',
      'signTransaction',
      'sendTransaction',
      'execute_plan',
      'PrivatePool.deposit',
    ]) {
      expect(apis).not.toContain(blocked);
    }
  });

  it('unexpected handler error stays fail-closed (no retry to sync)', async () => {
    const recorder = createSideEffectRecorder();
    const result = await executeReadOnlyCall(
      { method: 'Client.allContractsData' },
      createFakeReadOnlyHandlers(recorder, {
        throwOn: 'Client.allContractsData',
        throwError: new Error('unexpected RPC shape'),
      }),
    );
    expect(result.ok).toBe(false);
    expect(recorder.calls.map((c) => c.api)).toEqual(['getLedgerEntries']);
    expect(recorder.calls.some((c) => c.api === 'Client.sync')).toBe(false);
  });

  it('unclassified methods remain denied', () => {
    for (const method of ['Client.foo', 'storage.open', 'getLedgerEntries', 'RpcClient.get_events']) {
      expect(authorizeReadOnlyCall({ method }).ok).toBe(false);
    }
  });
});

describe('2.25 G8/G9 verdicts — harness must not elevate', () => {
  it('G8 and G9 are FAIL; status helpers agree', () => {
    const { G8, G9 } = assessG8G9();
    expect(G8.verdict).toBe('FAIL');
    expect(G9.verdict).toBe('FAIL');
    expect(G8.verdict).not.toBe('PASS');
    expect(G9.verdict).not.toBe('PASS');
    const status = readOnlyGateStatus();
    expect(status.G8_host).toBe('FAIL');
    expect(status.G9_config).toBe('FAIL');
    expect(status.productionIntegration).toBe('prohibited');
  });

  it('documents NO_DEMOSTRADO items for WASM runtime isolation', () => {
    // Policy + call-graph data cannot substitute for browser network guard.
    const clientNew = RO1_SDK_CALL_GRAPHS.find((g) => g.method === 'Client.new');
    expect(clientNew?.limitations.some((l) => /network|telemetry|NO_DEMOSTRADO/i.test(l))).toBe(
      true,
    );
  });
});

describe('2.25 offline fetch guard', () => {
  it('suite does not call fetch', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('unexpected fetch');
    });
    try {
      await executeReadOnlyCall(
        { method: 'Client.aspState' },
        createFakeReadOnlyHandlers(createSideEffectRecorder()),
      );
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
