/**
 * Offline tests for the isolated SPP host (Fase 4B–5D).
 * All SDK / WASM / Storage calls here are MOCKS — not evidence of real Chrome runs.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { SppHostController } from '../../src/spp-host/hostController.js';
import {
  assertExtensionOriginUrls,
  resolveSppAssetUrls,
  SPP_PACKAGE_PATHS,
  toSppSessionAssetUrls,
} from '../../src/spp-host/paths.js';
import { inspectSppSdkFacade, loadSppSdkFacade } from '../../src/spp-host/sdkLoad.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_ID = 'abcdefghijklmnopqrstuvwxyzabcdef';

function fakeGetURL(path: string): string {
  const cleaned = path.replace(/^\//, '');
  return `chrome-extension://${EXT_ID}/${cleaned}`;
}

/** Explicit mock — not the real stellar-private-payments package. */
function mockFacadeModule(initImpl?: (opts: { module_or_path: string }) => Promise<unknown>) {
  const defaultInit = vi.fn(
    initImpl ??
      (async (opts: { module_or_path: string }) => {
        expect(opts.module_or_path).toContain('stellar_private_payments_web_bg.wasm');
        return { mockWasmExports: true };
      }),
  );
  const clientNew = vi.fn(async () => ({ dispose: () => undefined }));
  const storageOpen = vi.fn(async () => ({
    fork: () => ({}),
    call: async () => null,
    free: vi.fn(),
  }));
  return {
    module: {
      default: defaultInit,
      Client: { new: clientNew },
      Storage: { open: storageOpen },
      TX_PROGRESS_EVENT: 'stellar-private-payments:tx-progress',
    } as Record<string, unknown>,
    defaultInit,
    clientNew,
    storageOpen,
  };
}

async function probedController(
  overrides?: Partial<{
    initImpl: (opts: { module_or_path: string }) => Promise<unknown>;
    importFails: boolean;
  }>,
) {
  const mock = mockFacadeModule(overrides?.initImpl);
  const controller = new SppHostController({
    getURL: fakeGetURL,
    importModule: async () => {
      if (overrides?.importFails) throw new Error('Failed to fetch dynamically imported module');
      return mock.module;
    },
    readText: async () => JSON.stringify({ version: '0.2.1' }),
  });
  await controller.probe();
  return { controller, mock };
}

describe('resolveSppAssetUrls', () => {
  it('maps package-relative paths through getURL and keeps circuits trailing slash', () => {
    const urls = resolveSppAssetUrls(fakeGetURL);
    expect(urls.facadeModuleUrl).toBe(
      `chrome-extension://${EXT_ID}/${SPP_PACKAGE_PATHS.facadeJs}`,
    );
    expect(urls.wasmUrl.endsWith('spp/dist/stellar_private_payments_web_bg.wasm')).toBe(true);
    expect(urls.circuitsBaseUrl.endsWith('/')).toBe(true);
  });

  it('rejects http(s) schemes via assertExtensionOriginUrls', () => {
    const bad = resolveSppAssetUrls((p) => `https://cdn.example/${p}`);
    expect(() => assertExtensionOriginUrls(bad)).toThrow(/non-extension/i);
  });

  it('maps into SppSession asset shape without extra fields', () => {
    const sessionAssets = toSppSessionAssetUrls(resolveSppAssetUrls(fakeGetURL));
    expect(Object.keys(sessionAssets).sort()).toEqual(
      ['circuitsBaseUrl', 'proverWorkerUrl', 'storageWorkerUrl', 'wasmUrl'].sort(),
    );
  });
});

describe('sdkLoad inspection (mocked module)', () => {
  it('detects default init without invoking it', () => {
    const defaultInit = vi.fn(async () => undefined);
    const inspection = inspectSppSdkFacade({
      default: defaultInit,
      Client: { new: vi.fn() },
      Storage: { open: vi.fn() },
    });
    expect(inspection.hasDefaultInit).toBe(true);
    expect(defaultInit).not.toHaveBeenCalled();
  });

  it('loadSppSdkFacade refuses http URLs', async () => {
    await expect(
      loadSppSdkFacade({
        moduleUrl: 'https://evil.example/spp.js',
        importModule: async () => mockFacadeModule().module,
      }),
    ).rejects.toThrow(/http/i);
  });
});

describe('SppHostController probe (mocked)', () => {
  it('stays uninitialized and wasm not-started until probe()', () => {
    const importModule = vi.fn(async () => mockFacadeModule().module);
    const controller = new SppHostController({
      getURL: fakeGetURL,
      importModule,
      readText: async () => JSON.stringify({ version: '0.2.1' }),
    });
    expect(controller.phase).toBe('uninitialized');
    expect(controller.wasmPhase).toBe('not-started');
    expect(importModule).not.toHaveBeenCalled();
  });

  it('probe reaches ready without calling default init', async () => {
    const { controller, mock } = await probedController();
    expect(controller.phase).toBe('ready');
    expect(controller.wasmPhase).toBe('not-started');
    expect(mock.defaultInit).not.toHaveBeenCalled();
    expect(mock.clientNew).not.toHaveBeenCalled();
    expect(mock.storageOpen).not.toHaveBeenCalled();
  });
});

describe('SppHostController initializeWasm (mocked — not real WASM)', () => {
  it('rejects WASM init when facade is not ready', async () => {
    const controller = new SppHostController({
      getURL: fakeGetURL,
      importModule: async () => mockFacadeModule().module,
      readText: async () => JSON.stringify({ version: '0.2.1' }),
    });
    const snap = await controller.initializeWasm();
    expect(snap.wasmPhase).toBe('error');
    expect(snap.wasmErrorMessage).toMatch(/Facade probe must succeed/i);
    expect(snap.wasmInitialized).toBe(false);
  });

  it('initializes WASM on demand with module_or_path = packaged wasm URL', async () => {
    const { controller, mock } = await probedController();
    const snap = await controller.initializeWasm();
    expect(snap.wasmPhase).toBe('ready');
    expect(snap.wasmInitialized).toBe(true);
    expect(snap.sdkInitialized).toBe(false);
    expect(snap.sessionInitializeEnabled).toBe(false);
    expect(snap.wasmUrlUsed).toBe(fakeGetURL(SPP_PACKAGE_PATHS.wasmBinary));
    expect(mock.defaultInit).toHaveBeenCalledTimes(1);
    expect(mock.defaultInit).toHaveBeenCalledWith({
      module_or_path: fakeGetURL(SPP_PACKAGE_PATHS.wasmBinary),
    });
    expect(mock.clientNew).not.toHaveBeenCalled();
    expect(mock.storageOpen).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent initializeWasm calls', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { controller, mock } = await probedController({
      initImpl: async () => {
        await gate;
        return {};
      },
    });
    const p1 = controller.initializeWasm();
    const p2 = controller.initializeWasm();
    expect(controller.wasmPhase).toBe('initializing');
    release();
    const [a, b] = await Promise.all([p1, p2]);
    expect(a.wasmPhase).toBe('ready');
    expect(b.wasmPhase).toBe('ready');
    expect(mock.defaultInit).toHaveBeenCalledTimes(1);
  });

  it('is idempotent after ready without re-calling init', async () => {
    const { controller, mock } = await probedController();
    await controller.initializeWasm();
    await controller.initializeWasm();
    expect(mock.defaultInit).toHaveBeenCalledTimes(1);
    expect(controller.wasmPhase).toBe('ready');
  });

  it('records wasm error without calling Client/Storage', async () => {
    const { controller, mock } = await probedController({
      initImpl: async () => {
        throw new Error('CompileError: wasm validation failed');
      },
    });
    const snap = await controller.initializeWasm();
    expect(snap.wasmPhase).toBe('error');
    expect(snap.wasmErrorMessage).toMatch(/CompileError|validation/i);
    expect(snap.wasmInitialized).toBe(false);
    expect(mock.clientNew).not.toHaveBeenCalled();
    expect(mock.storageOpen).not.toHaveBeenCalled();
  });

  it('initializeSession remains disabled and mentions no RPC/payments path', async () => {
    const { controller } = await probedController();
    await expect(controller.initializeSession()).rejects.toThrow(/disabled in Fase 5D/i);
    await expect(controller.initializeSession()).rejects.toThrow(/RPC/i);
  });

  it('does not perform http(s) network calls during probe or wasm init (mocked init)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('http://') || url.startsWith('https://')) {
        throw new Error(`Unexpected network fetch: ${url}`);
      }
      return new Response('{}', { status: 200 });
    });
    const { controller } = await probedController();
    await controller.initializeWasm();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('SppHostController Storage lab (Fase 5D — mocked openFn only)', () => {
  const allGates = {
    dedicatedLabProfileConfirmed: true,
    opfsPersistenceRiskAccepted: true,
    phaseDiffReviewedAndAuthorized: true,
  } as const;

  async function readyLab(authorized: boolean) {
    const mock = mockFacadeModule();
    const controller = new SppHostController({
      getURL: fakeGetURL,
      importModule: async () => mock.module,
      readText: async () => JSON.stringify({ version: '0.2.1' }),
      storageLabExecutionAuthorized: authorized,
    });
    await controller.probe();
    await controller.initializeWasm();
    controller.setStorageLabGates({ ...allGates });
    controller.evaluateStorageLabPrep();
    return { controller, mock };
  }

  it('starts storage lab as not-run; unobserved flags stay null', () => {
    const mock = mockFacadeModule();
    const controller = new SppHostController({
      getURL: fakeGetURL,
      importModule: async () => mock.module,
      readText: async () => JSON.stringify({ version: '0.2.1' }),
    });
    const snap = controller.snapshot();
    expect(snap.storageLabPhase).toBe('not-run');
    expect(snap.storageLabExecutionAuthorized).toBe(false);
    expect(snap.storageLabRunEnabled).toBe(false);
    expect(snap.storageLabEvidence.storageOpenAttempted).toBeNull();
    expect(snap.storageLabEvidence.storageOpenResolved).toBeNull();
    expect(snap.storageLabEvidence.workerProcessObserved).toBeNull();
    expect(snap.storageLabEvidence.opfsWipedAfterFree).toBeNull();
    expect(snap.storageLabEvidence.storageOpenInvocationCount).toBe(0);
    expect(mock.storageOpen).not.toHaveBeenCalled();
  });

  it('without phase authorization: zero Storage open calls even with gates', async () => {
    const WorkerSpy = vi.fn();
    vi.stubGlobal('Worker', WorkerSpy);
    const { controller, mock } = await readyLab(false);
    expect(controller.snapshot().storageLabPhase).toBe('ready-for-lab');
    expect(controller.snapshot().storageLabRunEnabled).toBe(false);

    const refused = await controller.requestStorageLabRun();
    expect(refused.storageLabPhase).toBe('error');
    expect(refused.storageLabErrorMessage).toMatch(/STORAGE_LAB_EXECUTION_AUTHORIZED/i);
    expect(refused.storageLabEvidence.storageOpenAttempted).toBe(false);
    expect(refused.storageLabEvidence.storageOpenInvocationCount).toBe(0);
    expect(mock.storageOpen).not.toHaveBeenCalled();
    expect(mock.clientNew).not.toHaveBeenCalled();
    expect(WorkerSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('gates without phase authorization never enable run', async () => {
    const { controller, mock } = await readyLab(false);
    expect(controller.snapshot().storageLabRunEnabled).toBe(false);
    expect(mock.storageOpen).not.toHaveBeenCalled();
  });

  it('does not auto-promote to ready-for-lab after facade + WASM alone', async () => {
    const { controller, mock } = await probedController();
    await controller.initializeWasm();
    expect(controller.snapshot().storageLabPhase).toBe('not-run');
    expect(mock.storageOpen).not.toHaveBeenCalled();
  });

  it('evaluate without gates stays blocked', async () => {
    const { controller, mock } = await probedController();
    await controller.initializeWasm();
    const snap = controller.evaluateStorageLabPrep();
    expect(snap.storageLabPhase).toBe('blocked');
    expect(snap.storageLabEvidence.blockReasons.some((r) => /lab Chrome profile/i.test(r))).toBe(
      true,
    );
    expect(mock.storageOpen).not.toHaveBeenCalled();
  });

  it('authorized + ready-for-lab: exactly one open on explicit run', async () => {
    const { controller, mock } = await readyLab(true);
    expect(controller.snapshot().storageLabRunEnabled).toBe(true);
    const snap = await controller.requestStorageLabRun();
    expect(snap.storageLabPhase).toBe('success');
    expect(snap.storageLabEvidence.storageOpenAttempted).toBe(true);
    expect(snap.storageLabEvidence.storageOpenInvocationCount).toBe(1);
    expect(snap.storageLabEvidence.storageOpenResolved).toBe(true);
    expect(snap.storageLabEvidence.storageHandleObtained).toBe(true);
    expect(mock.storageOpen).toHaveBeenCalledTimes(1);
    expect(mock.storageOpen).toHaveBeenCalledWith({
      workerUrl: fakeGetURL(SPP_PACKAGE_PATHS.storageWorker),
    });
    expect(mock.clientNew).not.toHaveBeenCalled();
  });

  it('double concurrent run coalesces to a single open invocation', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const mock = mockFacadeModule();
    mock.storageOpen.mockImplementation(async () => {
      await gate;
      return { fork: () => ({}), call: async () => null, free: vi.fn() };
    });
    const controller = new SppHostController({
      getURL: fakeGetURL,
      importModule: async () => mock.module,
      readText: async () => JSON.stringify({ version: '0.2.1' }),
      storageLabExecutionAuthorized: true,
    });
    await controller.probe();
    await controller.initializeWasm();
    controller.setStorageLabGates({ ...allGates });
    controller.evaluateStorageLabPrep();

    const p1 = controller.requestStorageLabRun();
    const p2 = controller.requestStorageLabRun();
    release();
    const [a, b] = await Promise.all([p1, p2]);
    expect(a.storageLabEvidence.storageOpenInvocationCount).toBe(1);
    expect(b.storageLabEvidence.storageOpenInvocationCount).toBe(1);
    expect(mock.storageOpen).toHaveBeenCalledTimes(1);
    expect(mock.clientNew).not.toHaveBeenCalled();
  });

  it('rejected open sanitizes error and does not auto-retry', async () => {
    const mock = mockFacadeModule();
    mock.storageOpen.mockRejectedValue(new Error('worker Failed to fetch storage-worker.js'));
    const controller = new SppHostController({
      getURL: fakeGetURL,
      importModule: async () => mock.module,
      readText: async () => JSON.stringify({ version: '0.2.1' }),
      storageLabExecutionAuthorized: true,
    });
    await controller.probe();
    await controller.initializeWasm();
    controller.setStorageLabGates({ ...allGates });
    controller.evaluateStorageLabPrep();

    const snap = await controller.requestStorageLabRun();
    expect(snap.storageLabPhase).toBe('error');
    expect(snap.storageLabEvidence.storageOpenRejected).toBe(true);
    expect(snap.storageLabEvidence.workerLoadErrorSuspected).toBe(true);
    expect(snap.storageLabErrorMessage?.length ?? 0).toBeLessThanOrEqual(241);
    expect(snap.storageLabRunEnabled).toBe(false);

    await controller.requestStorageLabRun();
    expect(mock.storageOpen).toHaveBeenCalledTimes(1);
  });

  it('never invokes Client.new, and records null worker process observation', async () => {
    const { controller, mock } = await readyLab(true);
    const snap = await controller.requestStorageLabRun();
    expect(mock.clientNew).not.toHaveBeenCalled();
    expect(snap.storageLabEvidence.workerProcessObserved).toBeNull();
    expect(snap.storageLabEvidence.opfsContentRead).toBe(false);
  });

  it('free() failure keeps handle, allows free retry, never re-enables open', async () => {
    const mock = mockFacadeModule();
    const freeFn = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('free failed unexpectedly');
      })
      .mockImplementationOnce(() => undefined);
    mock.storageOpen.mockResolvedValue({
      fork: () => ({}),
      call: async () => null,
      free: freeFn,
    });
    const controller = new SppHostController({
      getURL: fakeGetURL,
      importModule: async () => mock.module,
      readText: async () => JSON.stringify({ version: '0.2.1' }),
      storageLabExecutionAuthorized: true,
    });
    await controller.probe();
    await controller.initializeWasm();
    controller.setStorageLabGates({ ...allGates });
    controller.evaluateStorageLabPrep();
    await controller.requestStorageLabRun();
    const failed = await controller.requestStorageLabFree();
    expect(failed.storageLabEvidence.storageFreeAttempted).toBe(true);
    expect(failed.storageLabEvidence.storageFreeSucceeded).toBe(false);
    expect(failed.storageLabEvidence.opfsWipedAfterFree).toBeNull();
    expect(failed.storageLabEvidence.workerProcessObserved).toBeNull();
    expect(failed.storageLabFreeEnabled).toBe(true);
    expect(failed.storageLabRunEnabled).toBe(false);
    expect(failed.storageLabErrorMessage).toMatch(/free failed/i);

    const retried = await controller.requestStorageLabFree();
    expect(retried.storageLabEvidence.storageFreeSucceeded).toBe(true);
    expect(retried.storageLabFreeEnabled).toBe(false);
    expect(retried.storageLabRunEnabled).toBe(false);
    expect(freeFn).toHaveBeenCalledTimes(2);
    expect(mock.storageOpen).toHaveBeenCalledTimes(1);
  });

  it('watchdog flags pending open without cancelling or allowing a second open', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const mock = mockFacadeModule();
    mock.storageOpen.mockImplementation(async () => {
      await gate;
      return { fork: () => ({}), call: async () => null, free: vi.fn() };
    });
    const controller = new SppHostController({
      getURL: fakeGetURL,
      importModule: async () => mock.module,
      readText: async () => JSON.stringify({ version: '0.2.1' }),
      storageLabExecutionAuthorized: true,
      storageOpenWatchdogMs: 20,
    });
    await controller.probe();
    await controller.initializeWasm();
    controller.setStorageLabGates({ ...allGates });
    controller.evaluateStorageLabPrep();

    const runPromise = controller.requestStorageLabRun();
    await new Promise((r) => setTimeout(r, 40));
    const mid = controller.snapshot();
    expect(mid.storageLabPhase).toBe('running');
    expect(mid.storageLabEvidence.storageOpenWatchdogFiredWhilePending).toBe(true);
    expect(mid.storageLabEvidence.storageOpenCancellationSupported).toBe(false);
    expect(mid.storageLabEvidence.storageOpenLimitScope).toBe('per-controller-instance');
    expect(mid.storageLabEvidence.profileScopedOpenLimitImplemented).toBe(false);
    expect(mid.storageLabRunEnabled).toBe(false);

    const second = controller.requestStorageLabRun();
    release();
    const [first, coalesced] = await Promise.all([runPromise, second]);
    expect(mock.storageOpen).toHaveBeenCalledTimes(1);
    expect(first.storageLabEvidence.storageOpenInvocationCount).toBe(1);
    expect(coalesced.storageLabEvidence.storageOpenInvocationCount).toBe(1);
    expect(first.storageLabEvidence.storageOpenExceededWatchdog).toBe(true);
  });

  it('documents fetch-wrap semantics: false is not proof of zero network', async () => {
    const { controller } = await readyLab(true);
    const snap = await controller.requestStorageLabRun();
    expect(snap.storageLabEvidence.externalNetworkObserved).toBe(false);
    expect(
      snap.storageLabEvidence.notes.some((n) => /fetch wrap|not proof of zero network/i.test(n)),
    ).toBe(true);
  });

  it('rejects storage lab actions while probe is in progress', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const mock = mockFacadeModule();
    const controller = new SppHostController({
      getURL: fakeGetURL,
      importModule: async () => {
        await gate;
        return mock.module;
      },
      readText: async () => JSON.stringify({ version: '0.2.1' }),
    });
    const probePromise = controller.probe();
    expect(controller.phase).toBe('loading');
    expect(() => controller.setStorageLabGates({ ...allGates })).toThrow(/already in progress/i);
    expect(() => controller.evaluateStorageLabPrep()).toThrow(/already in progress/i);
    await expect(controller.requestStorageLabRun()).rejects.toThrow(/already in progress/i);
    release();
    await probePromise;
    expect(mock.storageOpen).not.toHaveBeenCalled();
  });

  it('does not perform http(s) network during unauthorized refuse', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('http://') || url.startsWith('https://')) {
        throw new Error(`Unexpected network fetch: ${url}`);
      }
      return new Response('{}', { status: 200 });
    });
    const { controller } = await readyLab(false);
    await controller.requestStorageLabRun();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('host UI wiring (source)', () => {
  it('main.ts wires probe, wasm, storage prep/run/free only on buttons', () => {
    const mainSrc = readFileSync(join(__dirname, '../../src/spp-host/main.ts'), 'utf8');
    expect(mainSrc).toContain('spp-probe-btn');
    expect(mainSrc).toContain('spp-wasm-btn');
    expect(mainSrc).toContain('spp-storage-eval-btn');
    expect(mainSrc).toContain('spp-storage-run-btn');
    expect(mainSrc).toContain('spp-storage-free-btn');
    expect(mainSrc).toContain('initializeWasm');
    expect(mainSrc).toContain('evaluateStorageLabPrep');
    expect(mainSrc).toContain('storageLabRunEnabled');
    expect(mainSrc).toContain("addEventListener('click'");
    expect(mainSrc).toMatch(/Nothing runs on load/);
  });

  it('default phase constant is false so production host stays blocked', () => {
    const prepSrc = readFileSync(join(__dirname, '../../src/spp-host/storageLabPrep.ts'), 'utf8');
    expect(prepSrc).toMatch(/export const STORAGE_LAB_EXECUTION_AUTHORIZED = false/);
    expect(prepSrc).toMatch(/export const STORAGE_OPEN_CANCELLATION_SUPPORTED = false/);
    expect(prepSrc).toMatch(/STORAGE_OPEN_LIMIT_SCOPE = 'per-controller-instance'/);
  });

  it('host sources avoid vault/signing/mutators and do not invoke Client.new/Storage.open', () => {
    const root = join(__dirname, '../../src/spp-host');
    const files = ['main.ts', 'hostController.ts', 'sdkLoad.ts', 'paths.ts', 'storageLabPrep.ts'];
    const forbidden = [
      'VaultService',
      'SoftwareSigner',
      'Client.new(',
      'Storage.open(',
      'SppSession.initialize',
      'ProverBridge',
      'deposit(',
      'transfer(',
      'withdraw(',
      'signTransaction',
      'mnemonic',
      'mv3-spike',
      'prepare-vendor',
      'horizon',
      'rpc-ro1',
    ];
    for (const file of files) {
      const src = readFileSync(join(root, file), 'utf8');
      for (const token of forbidden) {
        expect(src.includes(token), `${file} must not contain ${token}`).toBe(false);
      }
    }
  });
});
