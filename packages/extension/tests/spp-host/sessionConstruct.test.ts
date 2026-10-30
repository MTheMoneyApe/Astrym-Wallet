/**
 * Fase 5G.3 — session construction preparation (mocked runtime deps only).
 * Must not import or initialize the real stellar-private-payments package runtime.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import { SppHostController } from '../../src/spp-host/hostController.js';
import { readHostLabSppIntegrationSnapshot } from '../../src/spp-host/sppIntegrationProbe.js';
import {
  buildSppSdkRuntimeFromDeps,
  constructUninitializedSppSession,
  extractSppSdkRuntimeDepsFromLoadedFacade,
  validateSppSessionPrepInput,
} from '../../src/spp-host/sessionConstruct.js';
import type {
  SppCreateClientArgs,
  SppReadOnlyClient,
  SppSessionRuntime,
} from '@solanym/wallet-core/src/stellar/spp/SppSession.js';
import { STORAGE_LAB_EXECUTION_AUTHORIZED } from '../../src/spp-host/storageLabPrep.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_ROOT = join(__dirname, '../..');
const EXT_ID = 'abcdefghijklmnopqrstuvwxyzabcdef';

function fakeGetURL(path: string): string {
  return `chrome-extension://${EXT_ID}/${path.replace(/^\//, '')}`;
}

const ASSETS = {
  wasmUrl: `chrome-extension://${EXT_ID}/spp/dist/stellar_private_payments_web_bg.wasm`,
  storageWorkerUrl: `chrome-extension://${EXT_ID}/spp/dist/workers/storage-worker.js`,
  proverWorkerUrl: `chrome-extension://${EXT_ID}/spp/dist/workers/prover-worker.js`,
  circuitsBaseUrl: `chrome-extension://${EXT_ID}/spp/dist/circuits/`,
};

/** Opaque stand-ins — factory must not interpret contract/circuit contents. */
const CONTRACT_CONFIG = { lab: true } as never;
const CIRCUIT_LOCK = { lab: true } as never;

function mockClient(): SppReadOnlyClient {
  return {
    aspState: vi.fn(async () => ({}) as never),
    allContractsData: vi.fn(async () => ({}) as never),
    dispose: vi.fn(),
  };
}

function mockRuntime(
  createImpl?: (args: SppCreateClientArgs) => Promise<SppReadOnlyClient>,
): SppSessionRuntime & { createReadOnlyClient: ReturnType<typeof vi.fn> } {
  return {
    createReadOnlyClient: vi.fn(createImpl ?? (async () => mockClient())),
  };
}

function explicitConfig(runtime: SppSessionRuntime) {
  return {
    rpcUrl: 'http://127.0.0.1:9/rpc-lab-only',
    contractConfig: CONTRACT_CONFIG,
    circuitLock: CIRCUIT_LOCK,
    assets: ASSETS,
    runtime,
  };
}

function integrationFrom(controller: SppHostController) {
  return readHostLabSppIntegrationSnapshot(
    () => {
      const s = controller.snapshot();
      return {
        phase: s.phase,
        wasmPhase: s.wasmPhase,
        wasmInitialized: s.wasmInitialized,
        sdkInitialized: s.sdkInitialized,
        sessionInitializeEnabled: s.sessionInitializeEnabled,
        sessionBound: s.sessionBound,
        sessionState: s.sessionState,
      };
    },
    { getSession: () => controller.readBoundSessionStatus() },
  );
}

describe('validateSppSessionPrepInput', () => {
  it('rejects missing rpcUrl and non-object contracts', () => {
    expect(() =>
      validateSppSessionPrepInput({
        rpcUrl: '',
        contractConfig: { lab: true },
        circuitLock: { lab: true },
      }),
    ).toThrow(/rpcUrl/);
    expect(() =>
      validateSppSessionPrepInput({
        rpcUrl: 'http://127.0.0.1:9/rpc',
        contractConfig: null,
        circuitLock: { lab: true },
      }),
    ).toThrow(/contractConfig/);
    expect(() =>
      validateSppSessionPrepInput({
        rpcUrl: 'http://127.0.0.1:9/rpc',
        contractConfig: { lab: true },
        circuitLock: 'nope',
      }),
    ).toThrow(/circuitLock/);
  });
});

describe('constructUninitializedSppSession', () => {
  it('builds an uninitialized session without calling initialize or runtime', () => {
    const runtime = mockRuntime();
    const session = constructUninitializedSppSession(explicitConfig(runtime));
    expect(session.state).toBe('uninitialized');
    expect(session.lastErrorMessage).toBeNull();
    expect(runtime.createReadOnlyClient).not.toHaveBeenCalled();
  });

  it('rejects incomplete config (no invented endpoints)', () => {
    expect(() =>
      constructUninitializedSppSession({
        ...explicitConfig(mockRuntime()),
        rpcUrl: '',
      }),
    ).toThrow(/rpcUrl/);
  });

  it('construction and controller attach are independent steps', () => {
    const controller = new SppHostController({ getURL: fakeGetURL });
    const runtime = mockRuntime();
    const session = constructUninitializedSppSession(explicitConfig(runtime));

    expect(controller.hasBoundSession).toBe(false);
    expect(integrationFrom(controller).availability).toBe('not_initialized');

    controller.attachExistingSession(session);
    expect(controller.getBoundSessionForHost()).toBe(session);
    expect(controller.snapshot().sessionState).toBe('uninitialized');
    expect(controller.snapshot().sdkInitialized).toBe(false);
    expect(controller.snapshot().sessionInitializeEnabled).toBe(false);
    expect(runtime.createReadOnlyClient).not.toHaveBeenCalled();

    const integration = integrationFrom(controller);
    expect(integration.availability).toBe('not_initialized');
    expect(integration.capabilities.private_payments).toBe(false);
  });

  it('construction failure leaves the controller unbound (no partial handle)', () => {
    const controller = new SppHostController({ getURL: fakeGetURL });
    expect(() =>
      constructUninitializedSppSession({
        ...explicitConfig(mockRuntime()),
        runtime: null as unknown as SppSessionRuntime,
      }),
    ).toThrow();
    expect(controller.hasBoundSession).toBe(false);
    expect(controller.readBoundSessionStatus()).toBeNull();
  });

  it('does not silently replace an already-bound session', () => {
    const controller = new SppHostController({ getURL: fakeGetURL });
    const first = constructUninitializedSppSession(explicitConfig(mockRuntime()));
    const second = constructUninitializedSppSession(explicitConfig(mockRuntime()));
    controller.attachExistingSession(first);
    expect(() => controller.attachExistingSession(second)).toThrow(/already holds/);
    expect(controller.getBoundSessionForHost()).toBe(first);
  });

  it('publishes generation on attach and clear', () => {
    const publishes: Array<{ state: string | null; generation: number }> = [];
    const controller = new SppHostController({
      getURL: fakeGetURL,
      onBoundSessionChange: (h, meta) => {
        publishes.push({ state: h?.state ?? null, generation: meta.generation });
      },
    });
    const session = constructUninitializedSppSession(explicitConfig(mockRuntime()));
    controller.attachExistingSession(session);
    controller.clearBoundSession();
    expect(publishes).toEqual([
      { state: 'uninitialized', generation: 1 },
      { state: null, generation: 2 },
    ]);
    expect(controller.snapshot().sessionStatusGeneration).toBe(2);
  });

  it('constructAndAttachUninitializedSession after probe does not initialize', async () => {
    const defaultInit = vi.fn(async () => undefined);
    const storageOpen = vi.fn(async () => ({ free: vi.fn() }));
    const clientNew = vi.fn(async () => ({ dispose: () => undefined }));
    const publishes: Array<{ state: string | null; generation: number }> = [];
    const controller = new SppHostController({
      getURL: fakeGetURL,
      readText: async () => JSON.stringify({ version: '0.2.1' }),
      importModule: async () =>
        ({
          default: defaultInit,
          Storage: { open: storageOpen },
          Client: { new: clientNew },
          TX_PROGRESS_EVENT: 'x',
        }) as Record<string, unknown>,
      onBoundSessionChange: (h, meta) => {
        publishes.push({ state: h?.state ?? null, generation: meta.generation });
      },
    });
    await controller.probe();
    expect(controller.snapshot().phase).toBe('ready');

    const snap = controller.constructAndAttachUninitializedSession({
      rpcUrl: 'http://127.0.0.1:9/rpc-lab-only',
      contractConfig: { lab: true },
      circuitLock: { lab: true },
    });
    expect(snap.sessionBound).toBe(true);
    expect(snap.sessionState).toBe('uninitialized');
    expect(snap.sdkInitialized).toBe(false);
    expect(snap.sessionInitializeEnabled).toBe(false);
    expect(defaultInit).not.toHaveBeenCalled();
    expect(storageOpen).not.toHaveBeenCalled();
    expect(clientNew).not.toHaveBeenCalled();
    expect(publishes.at(-1)).toEqual({ state: 'uninitialized', generation: 1 });

    const integration = integrationFrom(controller);
    expect(integration.availability).toBe('not_initialized');
    expect(integration.capabilities.private_payments).toBe(false);
    expect(integration.sessionState).toBe('uninitialized');
  });

  it('constructAndAttach rejects invalid prep and double construct', async () => {
    const controller = new SppHostController({
      getURL: fakeGetURL,
      readText: async () => JSON.stringify({ version: '0.2.1' }),
      importModule: async () =>
        ({
          default: vi.fn(async () => undefined),
          Storage: { open: vi.fn(async () => ({})) },
          Client: { new: vi.fn(async () => ({ dispose: () => undefined })) },
          TX_PROGRESS_EVENT: 'x',
        }) as Record<string, unknown>,
    });
    await controller.probe();

    expect(() =>
      controller.constructAndAttachUninitializedSession({
        rpcUrl: '',
        contractConfig: { lab: true },
        circuitLock: { lab: true },
      }),
    ).toThrow(/rpcUrl/);
    expect(controller.snapshot().sessionBound).toBe(false);
    expect(controller.snapshot().sessionConstructError).toMatch(/rpcUrl/);

    controller.constructAndAttachUninitializedSession({
      rpcUrl: 'http://127.0.0.1:9/rpc-lab-only',
      contractConfig: { lab: true },
      circuitLock: { lab: true },
    });
    expect(() =>
      controller.constructAndAttachUninitializedSession({
        rpcUrl: 'http://127.0.0.1:9/rpc-lab-only',
        contractConfig: { lab: true },
        circuitLock: { lab: true },
      }),
    ).toThrow(/already holds/);
  });

  it('status read after construct+attach never calls initialize/dispose/runtime', () => {
    const runtime = mockRuntime();
    const session = constructUninitializedSppSession(explicitConfig(runtime));
    const initialize = vi.spyOn(session, 'initialize');
    const dispose = vi.spyOn(session, 'dispose');
    const controller = new SppHostController({ getURL: fakeGetURL });
    controller.attachExistingSession(session);

    void controller.readBoundSessionStatus();
    void controller.snapshot();
    void integrationFrom(controller);

    expect(initialize).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
    expect(runtime.createReadOnlyClient).not.toHaveBeenCalled();
  });
});

describe('buildSppSdkRuntimeFromDeps / extractSppSdkRuntimeDepsFromLoadedFacade', () => {
  it('buildSppSdkRuntimeFromDeps does not invoke initWasm, Storage.open, or Client.new', () => {
    const initWasm = vi.fn(async () => undefined);
    const open = vi.fn(async () => ({}) as never);
    const create = vi.fn(async () => mockClient() as never);
    const runtime = buildSppSdkRuntimeFromDeps({
      initWasm,
      Storage: { open },
      Client: { new: create },
    });
    expect(typeof runtime.createReadOnlyClient).toBe('function');
    expect(initWasm).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('extract captures facade refs without calling them', () => {
    const initFn = vi.fn(async () => undefined);
    const open = vi.fn(async () => ({}) as never);
    const create = vi.fn(async () => mockClient() as never);
    const facade = {
      default: initFn,
      Storage: { open },
      Client: { new: create },
    };
    const deps = extractSppSdkRuntimeDepsFromLoadedFacade(facade);
    expect(initFn).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();

    const runtime = buildSppSdkRuntimeFromDeps(deps);
    const session = constructUninitializedSppSession(explicitConfig(runtime));
    expect(session.state).toBe('uninitialized');
    expect(initFn).not.toHaveBeenCalled();
  });
});

describe('Fase 5G.3 surface guarantees (static)', () => {
  it('sessionConstruct never calls initialize and never loads facade by itself', () => {
    const src = readFileSync(join(EXT_ROOT, 'src/spp-host/sessionConstruct.ts'), 'utf8');
    // Strip block comments so documentation of forbidden paths cannot false-positive.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).toMatch(/constructUninitializedSppSession/);
    expect(src).toMatch(/createSppSdkRuntime/);
    expect(code).not.toMatch(/\.initialize\s*\(/);
    expect(code).not.toMatch(/loadSppSdkFacade/);
    expect(code).not.toMatch(/Storage\.open\s*\(/);
    expect(code).not.toMatch(/Client\.new\s*\(/);
    expect(code).not.toMatch(/attachExistingSession/);
    expect(code).not.toMatch(/from ['"]stellar-private-payments['"]/);
  });

  it('host wires construct+attach explicitly without auto initialize/dispose', () => {
    const main = readFileSync(join(EXT_ROOT, 'src/spp-host/main.ts'), 'utf8');
    const controller = readFileSync(join(EXT_ROOT, 'src/spp-host/hostController.ts'), 'utf8');
    const mainCode = main.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const controllerCode = controller
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(main).toMatch(/constructAndAttachUninitializedSession/);
    expect(controller).toMatch(/constructAndAttachUninitializedSession/);
    expect(controller).toMatch(/constructUninitializedSppSession/);
    expect(controller).toMatch(/_sessionInitializeEnabled = false/);
    expect(controller).toMatch(/initializeBoundSessionForNym/);
    expect(mainCode).not.toMatch(/\.initialize\s*\(/);
    expect(mainCode).not.toMatch(/\.dispose\s*\(/);
    expect(controllerCode).not.toMatch(/session\.initialize\s*\(/);
    expect(controllerCode).not.toMatch(/\.dispose\s*\(/);
  });

  it('keeps STORAGE_LAB_EXECUTION_AUTHORIZED false', () => {
    expect(STORAGE_LAB_EXECUTION_AUTHORIZED).toBe(false);
  });
});
