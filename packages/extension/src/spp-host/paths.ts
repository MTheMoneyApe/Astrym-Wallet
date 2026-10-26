/**
 * Resolve packaged SPP asset URLs for the extension host (Fase 3).
 * Paths are relative to the extension package root (Vite copies public/spp → dist/spp).
 * Always use chrome.runtime.getURL (or an injected equivalent) — never filesystem paths.
 */

/** Relative paths under the extension root (must match Fase 1 copy layout). */
export const SPP_PACKAGE_PATHS = Object.freeze({
  meta: 'spp/SPP_ASSET_META.json',
  facadeJs: 'spp/js/index.js',
  wasmGlueJs: 'spp/dist/stellar_private_payments_web.js',
  wasmBinary: 'spp/dist/stellar_private_payments_web_bg.wasm',
  storageWorker: 'spp/dist/workers/storage-worker.js',
  proverWorker: 'spp/dist/workers/prover-worker.js',
  /** Directory URL — trailing slash required for SDK circuitsBaseUrl. */
  circuitsBase: 'spp/dist/circuits/',
});

export type SppHostAssetUrls = {
  metaUrl: string;
  facadeModuleUrl: string;
  wasmGlueModuleUrl: string;
  wasmUrl: string;
  storageWorkerUrl: string;
  proverWorkerUrl: string;
  circuitsBaseUrl: string;
};

export type ExtensionGetURL = (path: string) => string;

/**
 * Build absolute chrome-extension:// (or test) URLs for all SPP assets.
 * Ensures circuitsBaseUrl ends with `/`.
 */
export function resolveSppAssetUrls(getURL: ExtensionGetURL): SppHostAssetUrls {
  if (typeof getURL !== 'function') {
    throw new Error('resolveSppAssetUrls requires a getURL function');
  }

  const circuitsRaw = getURL(SPP_PACKAGE_PATHS.circuitsBase);
  const circuitsBaseUrl = circuitsRaw.endsWith('/') ? circuitsRaw : `${circuitsRaw}/`;

  return {
    metaUrl: getURL(SPP_PACKAGE_PATHS.meta),
    facadeModuleUrl: getURL(SPP_PACKAGE_PATHS.facadeJs),
    wasmGlueModuleUrl: getURL(SPP_PACKAGE_PATHS.wasmGlueJs),
    wasmUrl: getURL(SPP_PACKAGE_PATHS.wasmBinary),
    storageWorkerUrl: getURL(SPP_PACKAGE_PATHS.storageWorker),
    proverWorkerUrl: getURL(SPP_PACKAGE_PATHS.proverWorker),
    circuitsBaseUrl,
  };
}

/** Map host URLs into the shape expected by wallet-core SppSession assets (future Fase). */
export function toSppSessionAssetUrls(urls: SppHostAssetUrls): {
  wasmUrl: string;
  storageWorkerUrl: string;
  proverWorkerUrl: string;
  circuitsBaseUrl: string;
} {
  return {
    wasmUrl: urls.wasmUrl,
    storageWorkerUrl: urls.storageWorkerUrl,
    proverWorkerUrl: urls.proverWorkerUrl,
    circuitsBaseUrl: urls.circuitsBaseUrl,
  };
}

export function assertExtensionOriginUrls(urls: SppHostAssetUrls): void {
  const values = Object.values(urls);
  for (const value of values) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error('SPP asset URL is empty');
    }
    if (value.startsWith('http://') || value.startsWith('https://')) {
      throw new Error(`Refusing non-extension SPP URL scheme: ${value.slice(0, 32)}…`);
    }
    if (value.startsWith('file:') || value.startsWith('C:') || value.startsWith('/Users/')) {
      throw new Error('Refusing filesystem SPP asset paths');
    }
  }
}
