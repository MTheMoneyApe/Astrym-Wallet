/**
 * Official MixFetch option shapes from `@nymproject/mix-fetch-wasm@1.4.2`
 * (`mix_fetch_wasm.d.ts`), consumed by `@nymproject/mix-fetch@1.4.2`
 * as `SetupMixFetchOps = MixFetchOpts & { responseBodyConfigMap? }`.
 *
 * Evidence: npm pack of mix-fetch-wasm@1.4.2. Do not invent gateway hosts.
 * `disableCoverTraffic` is NOT a MixFetchOpts field — map via clientOverride.
 */

export type MixFetchOptsSimple = {
  /**
   * Entry gateway identity key (base58 Ed25519), NOT a `wss://` URL.
   * Official mix-fetch v1 docs example: `q2A2cbooyC16YJzvdYaSMH9X3cSiieZNtfBr8cE8Fi1`.
   */
  preferredGateway?: string;
  preferredNetworkRequester?: string;
  forceTls?: boolean;
  storagePassphrase?: string;
};

export type CoverTrafficWasmOverride = {
  loopCoverTrafficAverageDelayMs?: number;
  coverTrafficPrimarySizeRatio?: number;
  disableLoopCoverTrafficStream?: boolean;
};

export type MixFetchDebugOverride = {
  requestTimeoutMs?: number;
};

/** Subset of DebugWasmOverride we may set from Solanym (official field names only). */
export type DebugWasmOverride = {
  coverTraffic?: CoverTrafficWasmOverride;
  [key: string]: unknown;
};

export type MixFetchOpts = MixFetchOptsSimple & {
  clientId?: string;
  nymApiUrl?: string;
  nyxdUrl?: string;
  clientOverride?: DebugWasmOverride;
  mixFetchOverride?: MixFetchDebugOverride;
};

export type SetupMixFetchOps = MixFetchOpts & {
  responseBodyConfigMap?: unknown;
};

/**
 * Solanym bridge input: official MixFetchOpts plus internal-only flags that must
 * never be forwarded raw to createMixFetch.
 */
export type NymMixFetchSetupOptions = MixFetchOpts & {
  /**
   * Solanym convenience — mapped to
   * `clientOverride.coverTraffic.disableLoopCoverTrafficStream`.
   * Not an official MixFetchOpts key.
   */
  disableCoverTraffic?: boolean;
  /**
   * Internal allowlist for offscreen policy only — never passed to createMixFetch.
   */
  gatewayAllowlist?: string[];
};

const OFFICIAL_TOP_LEVEL_KEYS = new Set([
  'preferredGateway',
  'preferredNetworkRequester',
  'forceTls',
  'storagePassphrase',
  'clientId',
  'nymApiUrl',
  'nyxdUrl',
  'clientOverride',
  'mixFetchOverride',
  'responseBodyConfigMap',
]);

/**
 * Strip internal Solanym fields and map `disableCoverTraffic` to official overrides.
 */
export function toSetupMixFetchOps(
  options?: NymMixFetchSetupOptions | null,
): SetupMixFetchOps | undefined {
  if (!options) return undefined;

  const out: SetupMixFetchOps = {};

  for (const key of OFFICIAL_TOP_LEVEL_KEYS) {
    if (key in options && options[key as keyof NymMixFetchSetupOptions] !== undefined) {
      (out as Record<string, unknown>)[key] =
        options[key as keyof NymMixFetchSetupOptions];
    }
  }

  if (options.disableCoverTraffic === true) {
    const prev = (out.clientOverride ?? {}) as DebugWasmOverride;
    const cover = (prev.coverTraffic ?? {}) as CoverTrafficWasmOverride;
    out.clientOverride = {
      ...prev,
      coverTraffic: {
        ...cover,
        disableLoopCoverTrafficStream: true,
      },
    };
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

/** True if a key would be illegal/unknown if forwarded to createMixFetch. */
export function isInternalMixFetchBridgeKey(key: string): boolean {
  return key === 'disableCoverTraffic' || key === 'gatewayAllowlist';
}
