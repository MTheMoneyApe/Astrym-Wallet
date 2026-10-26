/**
 * Boundary for official `@nymproject/mix-fetch` (HTTP over Nym mixnet via IPR exit).
 *
 * Official 1.4.x surface: `createMixFetch`, `mixFetch`, `disconnectMixFetch`.
 * Options forwarded to createMixFetch are filtered through {@link toSetupMixFetchOps}
 * (MixFetchOpts from mix-fetch-wasm@1.4.2). Internal keys are never forwarded.
 *
 * Production loads via dynamic import. Unit tests inject a mock bridge.
 * This module never calls clearnet `fetch` and never fabricates a connected tunnel.
 */

import {
  toSetupMixFetchOps,
  type NymMixFetchSetupOptions,
  type SetupMixFetchOps,
} from './MixFetchOpts.js';

export type { NymMixFetchSetupOptions, SetupMixFetchOps } from './MixFetchOpts.js';
export { toSetupMixFetchOps } from './MixFetchOpts.js';

/**
 * Minimal surface we require from `@nymproject/mix-fetch`.
 */
export type NymMixFetchBridge = {
  setup(options?: NymMixFetchSetupOptions): Promise<void>;
  mixFetch(url: string, init?: RequestInit): Promise<Response>;
  disconnect(): Promise<void>;
};

type MixFetchInstance = {
  mixFetch: (url: string, init?: RequestInit) => Promise<Response>;
  setupMixFetch?: (opts?: SetupMixFetchOps) => Promise<void>;
  disconnectMixFetch?: () => Promise<void>;
};

type MixFetchModule = {
  createMixFetch?: (opts?: SetupMixFetchOps) => Promise<MixFetchInstance>;
  mixFetch?: (url: string, init?: RequestInit) => Promise<Response>;
  disconnectMixFetch?: () => Promise<unknown>;
  setupMixTunnel?: (opts?: SetupMixFetchOps) => Promise<unknown>;
  disconnectMixTunnel?: () => Promise<unknown>;
};

/**
 * Dynamically import `@nymproject/mix-fetch` and adapt it to {@link NymMixFetchBridge}.
 * Returns null when the package is not installed or the export surface is incomplete.
 * Does not connect to the mixnet by itself (caller must invoke `setup`).
 */
export async function tryLoadOfficialMixFetchBridge(
  importer: (specifier: string) => Promise<unknown> = (s) => import(s),
): Promise<NymMixFetchBridge | null> {
  let mod: MixFetchModule;
  try {
    mod = (await importer('@nymproject/mix-fetch')) as MixFetchModule;
  } catch {
    return null;
  }

  if (typeof mod.createMixFetch === 'function') {
    const createMixFetch = mod.createMixFetch.bind(mod);
    const moduleMixFetch =
      typeof mod.mixFetch === 'function' ? mod.mixFetch.bind(mod) : null;
    const moduleDisconnect =
      typeof mod.disconnectMixFetch === 'function'
        ? mod.disconnectMixFetch.bind(mod)
        : null;

    let instance: MixFetchInstance | null = null;

    return {
      setup: async (options) => {
        const official = toSetupMixFetchOps(options);
        instance = await createMixFetch(official);
      },
      mixFetch: async (url, init) => {
        if (instance && typeof instance.mixFetch === 'function') {
          return instance.mixFetch(url, init);
        }
        if (moduleMixFetch) {
          return moduleMixFetch(url, init);
        }
        throw new Error('mix-fetch bridge not set up (createMixFetch)');
      },
      disconnect: async () => {
        try {
          if (instance && typeof instance.disconnectMixFetch === 'function') {
            await instance.disconnectMixFetch();
          } else if (moduleDisconnect) {
            await moduleDisconnect();
          }
        } finally {
          instance = null;
        }
      },
    };
  }

  if (
    typeof mod.setupMixTunnel === 'function' &&
    typeof mod.mixFetch === 'function' &&
    typeof mod.disconnectMixTunnel === 'function'
  ) {
    const setupMixTunnel = mod.setupMixTunnel.bind(mod);
    const mixFetch = mod.mixFetch.bind(mod);
    const disconnectMixTunnel = mod.disconnectMixTunnel.bind(mod);
    return {
      setup: async (options) => {
        await setupMixTunnel(toSetupMixFetchOps(options));
      },
      mixFetch: (url, init) => mixFetch(url, init),
      disconnect: async () => {
        await disconnectMixTunnel();
      },
    };
  }

  return null;
}
