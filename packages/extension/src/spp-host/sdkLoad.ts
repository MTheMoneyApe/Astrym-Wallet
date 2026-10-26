/**
 * Safe SPP SDK module import + export inspection (Fase 3).
 *
 * Verified on stellar-private-payments@0.2.1:
 * - WASM init is the **default** export (`__wbg_init`), also re-exported from `js/index.js`.
 * - There is **no** named export `initWasm`.
 * - Facade exports: `Client`, `Storage`, `default`, …
 *
 * This module must NOT call `default()` / init, `Storage.open`, or `Client.new`.
 */

export type SppSdkFacadeInspection = {
  /** `export default` — wasm-bindgen async init (`__wbg_init`). */
  hasDefaultInit: boolean;
  hasClient: boolean;
  hasClientNew: boolean;
  hasStorage: boolean;
  hasStorageOpen: boolean;
  /** Named keys present on the module namespace (excluding `default` if non-enumerable). */
  exportKeys: string[];
  notes: string[];
};

export type DynamicImportFn = (moduleUrl: string) => Promise<Record<string, unknown>>;

export type LoadSppSdkFacadeResult = {
  moduleUrl: string;
  module: Record<string, unknown>;
  inspection: SppSdkFacadeInspection;
};

function isFunction(value: unknown): value is (...args: never[]) => unknown {
  return typeof value === 'function';
}

/**
 * Inspect a loaded facade module without invoking SDK entry points.
 */
export function inspectSppSdkFacade(module: Record<string, unknown>): SppSdkFacadeInspection {
  const notes: string[] = [];
  const exportKeys = Reflect.ownKeys(module)
    .map((k) => String(k))
    .filter((k) => k !== '__esModule')
    .sort();

  const hasDefaultInit = isFunction(module['default']);
  if (!hasDefaultInit) {
    notes.push('Missing default export (expected wasm-bindgen __wbg_init as default)');
  } else {
    notes.push('default export present — use as initWasm via (url) => default({ module_or_path: url })');
  }

  const Client = module['Client'] as { new?: unknown } | undefined;
  const hasClient = Client !== null && typeof Client === 'object';
  const hasClientNew = hasClient && isFunction(Client.new);
  if (!hasClientNew) notes.push('Client.new missing or not a function');

  const Storage = module['Storage'] as { open?: unknown } | undefined;
  const hasStorage = Storage !== null && typeof Storage === 'object';
  const hasStorageOpen = hasStorage && isFunction(Storage.open);
  if (!hasStorageOpen) notes.push('Storage.open missing or not a function');

  if ('initWasm' in module) {
    notes.push('Unexpected named export initWasm — 0.2.1 uses default export for WASM init');
  }

  return {
    hasDefaultInit,
    hasClient,
    hasClientNew,
    hasStorage,
    hasStorageOpen,
    exportKeys,
    notes,
  };
}

export function assertFacadeReadyForFutureSession(inspection: SppSdkFacadeInspection): void {
  if (!inspection.hasDefaultInit || !inspection.hasClientNew || !inspection.hasStorageOpen) {
    throw new Error(
      `SPP facade incomplete: defaultInit=${inspection.hasDefaultInit} Client.new=${inspection.hasClientNew} Storage.open=${inspection.hasStorageOpen}`,
    );
  }
}

/**
 * Dynamically import the packaged facade. Does not initialize WASM or open workers.
 */
export async function loadSppSdkFacade(options: {
  moduleUrl: string;
  importModule?: DynamicImportFn;
}): Promise<LoadSppSdkFacadeResult> {
  const moduleUrl = options.moduleUrl;
  if (typeof moduleUrl !== 'string' || moduleUrl.trim().length === 0) {
    throw new Error('moduleUrl is required');
  }
  if (moduleUrl.startsWith('http://') || moduleUrl.startsWith('https://')) {
    throw new Error('Refusing to import SPP facade from http(s) URL');
  }

  const importModule =
    options.importModule ??
    (async (url: string) => {
      // Runtime URL must stay dynamic so Vite does not rewrite to an npm chunk.
      // Packaged asset path: chrome-extension://<id>/spp/js/index.js
      const mod = await import(/* @vite-ignore */ /* webpackIgnore: true */ url);
      return mod as Record<string, unknown>;
    });

  const module = await importModule(moduleUrl);
  if (!module || typeof module !== 'object') {
    throw new Error('SPP facade import returned a non-object module');
  }

  const inspection = inspectSppSdkFacade(module);
  return { moduleUrl, module, inspection };
}

/**
 * Fase 5G.3 construction wiring lives in `./sessionConstruct.ts` (not called by
 * probe/UI). Pattern after an explicit facade load:
 *   deps = extractSppSdkRuntimeDepsFromLoadedFacade(module)
 *   runtime = buildSppSdkRuntimeFromDeps(deps)
 *   session = constructUninitializedSppSession({ …explicit config, runtime })
 *   // separate: controller.attachExistingSession(session)
 *   // NOT in 5G.3: session.initialize()
 */
