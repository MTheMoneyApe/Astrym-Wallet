/**
 * Offline lifecycle tests for SppSession — mocked SDK runtime only.
 * Does not load WASM, workers, vault, or network.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { CircuitLockInput, ContractConfigInput } from 'stellar-private-payments';
import {
  createSppSdkRuntime,
  SppSession,
  SppSessionError,
  type SppAssetUrls,
  type SppCreateClientArgs,
  type SppReadOnlyClient,
  type SppSessionRuntime,
} from '../../../src/stellar/spp/SppSession.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CONTRACT_CONFIG = {
  network: 'test',
  kdf_domain: 'test',
  deployer: 'C' + 'A'.repeat(55),
  admin: 'C' + 'B'.repeat(55),
  asp_membership: 'C' + 'C'.repeat(55),
  asp_non_membership: 'C' + 'D'.repeat(55),
  verifiers: {},
  public_key_registry: 'C' + 'E'.repeat(55),
  pools: [],
} as unknown as ContractConfigInput;

const CIRCUIT_LOCK = {
  version: '0.6',
  meta: {
    repository: 'test',
    commit: 'abc',
    circom: '2.2.3',
    circomlib: 'x',
    'circom-witness-rs': '0.3.0',
  },
} as CircuitLockInput;

const ASSETS: SppAssetUrls = {
  wasmUrl: 'chrome-extension://testid/spp/dist/stellar_private_payments_web_bg.wasm',
  storageWorkerUrl: 'chrome-extension://testid/spp/dist/workers/storage-worker.js',
  proverWorkerUrl: 'chrome-extension://testid/spp/dist/workers/prover-worker.js',
  circuitsBaseUrl: 'chrome-extension://testid/spp/dist/circuits/',
};

function baseConfig(runtime: SppSessionRuntime) {
  return {
    rpcUrl: 'http://127.0.0.1:8765/rpc-ro1',
    contractConfig: CONTRACT_CONFIG,
    circuitLock: CIRCUIT_LOCK,
    assets: ASSETS,
    runtime,
  };
}

function mockClient(overrides: Partial<SppReadOnlyClient> = {}): SppReadOnlyClient {
  return {
    aspState: vi.fn(async () => ({ kind: 'asp' }) as never),
    allContractsData: vi.fn(async () => ({ kind: 'all' }) as never),
    dispose: vi.fn(() => undefined),
    ...overrides,
  };
}

function mockRuntime(
  createImpl?: (args: SppCreateClientArgs) => Promise<SppReadOnlyClient>,
): SppSessionRuntime & { createReadOnlyClient: ReturnType<typeof vi.fn> } {
  const client = mockClient();
  return {
    createReadOnlyClient: vi.fn(
      createImpl ?? (async () => client),
    ),
  };
}

describe('SppSession config validation', () => {
  it('rejects empty rpcUrl', () => {
    expect(
      () =>
        new SppSession({
          ...baseConfig(mockRuntime()),
          rpcUrl: '  ',
        }),
    ).toThrow(SppSessionError);
  });

  it('rejects missing runtime', () => {
    expect(
      () =>
        new SppSession({
          ...baseConfig(mockRuntime()),
          runtime: null as unknown as SppSessionRuntime,
        }),
    ).toThrow(/runtime/i);
  });
});

describe('SppSession lifecycle (mocked runtime)', () => {
  it('starts uninitialized and becomes ready after initialize', async () => {
    const runtime = mockRuntime();
    const session = new SppSession(baseConfig(runtime));
    expect(session.state).toBe('uninitialized');
    await session.initialize();
    expect(session.state).toBe('ready');
    expect(runtime.createReadOnlyClient).toHaveBeenCalledTimes(1);
    const args = runtime.createReadOnlyClient.mock.calls[0]![0] as SppCreateClientArgs;
    expect(args.rpcUrl).toBe('http://127.0.0.1:8765/rpc-ro1');
    expect(args.assets.wasmUrl).toBe(ASSETS.wasmUrl);
    expect(args.assets.storageWorkerUrl).toBe(ASSETS.storageWorkerUrl);
    expect(args.assets.proverWorkerUrl).toBe(ASSETS.proverWorkerUrl);
    expect(args.assets.circuitsBaseUrl).toBe(ASSETS.circuitsBaseUrl);
  });

  it('deduplicates concurrent initialize calls', async () => {
    let release!: (c: SppReadOnlyClient) => void;
    const gate = new Promise<SppReadOnlyClient>((resolve) => {
      release = resolve;
    });
    const runtime = mockRuntime(async () => gate);
    const session = new SppSession(baseConfig(runtime));
    const p1 = session.initialize();
    const p2 = session.initialize();
    expect(session.state).toBe('initializing');
    expect(runtime.createReadOnlyClient).toHaveBeenCalledTimes(1);
    release(mockClient());
    await Promise.all([p1, p2]);
    expect(session.state).toBe('ready');
  });

  it('rejects second initialize after ready', async () => {
    const session = new SppSession(baseConfig(mockRuntime()));
    await session.initialize();
    await expect(session.initialize()).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('moves to error on initialize failure and preserves message without secrets', async () => {
    const runtime = mockRuntime(async () => {
      throw new Error('RPC boom secret=should-truncate-if-very-long-' + 'x'.repeat(200));
    });
    const session = new SppSession(baseConfig(runtime));
    await expect(session.initialize()).rejects.toMatchObject({ code: 'INITIALIZE_FAILED' });
    expect(session.state).toBe('error');
    expect(session.lastErrorMessage).toBeTruthy();
    expect(session.lastErrorMessage!.length).toBeLessThanOrEqual(220);
  });

  it('reads aspState and allContractsData when ready', async () => {
    const client = mockClient();
    const runtime = mockRuntime(async () => client);
    const session = new SppSession(baseConfig(runtime));
    await session.initialize();
    await expect(session.aspState()).resolves.toEqual({ kind: 'asp' });
    await expect(session.allContractsData()).resolves.toEqual({ kind: 'all' });
    expect(client.aspState).toHaveBeenCalledTimes(1);
    expect(client.allContractsData).toHaveBeenCalledTimes(1);
  });

  it('wraps read failures as READ_FAILED', async () => {
    const client = mockClient({
      aspState: vi.fn(async () => {
        throw new Error('ledger unavailable');
      }),
    });
    const session = new SppSession(baseConfig(mockRuntime(async () => client)));
    await session.initialize();
    await expect(session.aspState()).rejects.toMatchObject({ code: 'READ_FAILED' });
  });

  it('rejects reads before initialize', async () => {
    const session = new SppSession(baseConfig(mockRuntime()));
    await expect(session.aspState()).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(session.allContractsData()).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('rejects reads and re-init after dispose', async () => {
    const client = mockClient();
    const session = new SppSession(baseConfig(mockRuntime(async () => client)));
    await session.initialize();
    session.dispose();
    expect(session.state).toBe('disposed');
    expect(client.dispose).toHaveBeenCalledTimes(1);
    await expect(session.aspState()).rejects.toMatchObject({ code: 'DISPOSED' });
    await expect(session.initialize()).rejects.toMatchObject({ code: 'DISPOSED' });
  });

  it('dispose is idempotent', async () => {
    const client = mockClient();
    const session = new SppSession(baseConfig(mockRuntime(async () => client)));
    await session.initialize();
    session.dispose();
    session.dispose();
    session.dispose();
    expect(client.dispose).toHaveBeenCalledTimes(1);
    expect(session.state).toBe('disposed');
  });

  it('dispose during initialize releases the late client', async () => {
    let finish!: (c: SppReadOnlyClient) => void;
    const pending = new Promise<SppReadOnlyClient>((resolve) => {
      finish = resolve;
    });
    const runtime = mockRuntime(async () => pending);
    const session = new SppSession(baseConfig(runtime));
    const initPromise = session.initialize();
    session.dispose();
    expect(session.state).toBe('disposed');
    const late = mockClient();
    finish(late);
    await expect(initPromise).rejects.toMatchObject({ code: 'DISPOSED' });
    expect(late.dispose).toHaveBeenCalledTimes(1);
  });
});

describe('createSppSdkRuntime (mocked SDK deps)', () => {
  it('wires initWasm, Storage.open, and Client.new with asset URLs', async () => {
    const initWasm = vi.fn(async () => undefined);
    const storage = { fork: () => storage, call: async () => null };
    const open = vi.fn(async () => storage as never);
    const dispose = vi.fn();
    const aspState = vi.fn(async () => ({ ok: true }) as never);
    const allContractsData = vi.fn(async () => ({ ok: true }) as never);
    const create = vi.fn(async () => ({
      aspState,
      allContractsData,
      dispose,
      backgroundSync: async () => undefined,
      stopBackgroundSync: () => undefined,
      sync: async () => undefined,
      operationalFeed: async () => [],
      contractConfig: () => ({}) as never,
      account: async () => ({}) as never,
      recipientLookup: async () => ({}) as never,
      verifySelectiveDisclosure: async () => ({}) as never,
    }));

    const runtime = createSppSdkRuntime({
      initWasm,
      Storage: { open },
      Client: { new: create as never },
    });

    const client = await runtime.createReadOnlyClient({
      rpcUrl: 'http://127.0.0.1:9/rpc',
      contractConfig: CONTRACT_CONFIG,
      circuitLock: CIRCUIT_LOCK,
      assets: ASSETS,
    });

    expect(initWasm).toHaveBeenCalledWith(ASSETS.wasmUrl);
    expect(open).toHaveBeenCalledWith({ workerUrl: ASSETS.storageWorkerUrl });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        rpcUrl: 'http://127.0.0.1:9/rpc',
        circuitsBaseUrl: ASSETS.circuitsBaseUrl,
        proverWorkerUrl: ASSETS.proverWorkerUrl,
        storage,
      }),
    );

    await client.aspState();
    client.dispose();
    expect(aspState).toHaveBeenCalled();
    expect(dispose).toHaveBeenCalled();
  });
});

describe('SppSession surface guarantees (static)', () => {
  it('source module does not reference vault, signing, or pool mutators', () => {
    const srcPath = join(__dirname, '../../../src/stellar/spp/SppSession.ts');
    const src = readFileSync(srcPath, 'utf8');
    const forbidden = [
      'VaultService',
      'SoftwareSigner',
      'SppWalletSignerAdapter',
      'deposit(',
      'transfer(',
      'withdraw(',
      'signTransaction',
      'signAuthEntry',
      'backgroundSync',
      'mnemonic',
      'seed',
    ];
    for (const token of forbidden) {
      expect(src.includes(token), `must not contain ${token}`).toBe(false);
    }
    // Allowed RO API mentions only
    expect(src).toContain('aspState');
    expect(src).toContain('allContractsData');
    expect(src).toContain('dispose');
  });

  it('public class prototype exposes only RO lifecycle methods', async () => {
    const session = new SppSession(baseConfig(mockRuntime()));
    const publicProto = Object.getOwnPropertyNames(Object.getPrototypeOf(session)).filter(
      (n) => n !== 'constructor' && !n.startsWith('_'),
    );
    expect(publicProto.sort()).toEqual(
      ['allContractsData', 'aspState', 'dispose', 'initialize', 'lastErrorMessage', 'state'].sort(),
    );
    expect(publicProto.includes('account')).toBe(false);
    expect(publicProto.includes('deposit')).toBe(false);
  });
});
