/**
 * Fase 5G.1–5G.2 — host-lab probe for {@link SppIntegrationStatus}.
 *
 * Reads only in-memory host controller state via injected sync getters.
 * Does not create/open/initialize/free Storage, Client, WASM, prover, or SppSession.
 *
 * Host `phase === 'ready'` means facade probe succeeded — NOT SppSession.ready
 * and NOT private payments. Session availability comes only from an optional
 * bound handle exposed via {@link SppHostController.readBoundSessionStatus}.
 */

import {
  SppIntegrationStatus,
  type SppIntegrationProbe,
  type SppIntegrationSnapshot,
  type SppSessionStatusHandle,
} from '@solanym/wallet-core/src/stellar/spp/SppIntegrationStatus.js';

/** Minimal sync fields needed from {@link SppHostSnapshot} (avoid circular imports). */
export type SppHostStatusView = {
  phase: string;
  wasmPhase: string;
  wasmInitialized: boolean;
  sdkInitialized: boolean;
  sessionInitializeEnabled: boolean;
  sessionBound?: boolean;
  sessionState?: string | null;
};

export type HostLabProbeOptions = {
  /**
   * Sync getter for an already-bound session handle (or null).
   * Must not construct or initialize a session.
   */
  getSession?: () => SppSessionStatusHandle | null;
  overrides?: Partial<SppIntegrationProbe>;
};

/**
 * Build a probe for the isolated spp-host surface.
 * `getHostStatus` must be a pure/sync read of already-held controller state.
 */
export function createHostLabSppIntegrationProbe(
  getHostStatus: () => SppHostStatusView,
  options: HostLabProbeOptions = {},
): SppIntegrationProbe {
  const { getSession, overrides = {} } = options;
  return {
    // Lab page ships packaged spp assets; packaging ≠ session ready.
    // Reading getHostStatus() keeps the probe tied to live controller memory
    // without treating facade/wasm phase as SppSession.ready.
    isFacadePackaged: () => {
      getHostStatus();
      return true;
    },
    getSession: () => (getSession ? getSession() : null),
    isPrivatePaymentsEnabled: () => false,
    isStorageLabHostSurface: () => true,
    ...overrides,
  };
}

/**
 * Snapshot helper for diagnostics (`__SOLANYM_SPP_HOST__.integrationSnapshot`).
 * Invoking this only reads injected getters then maps through SppIntegrationStatus.
 */
export function readHostLabSppIntegrationSnapshot(
  getHostStatus: () => SppHostStatusView,
  options: HostLabProbeOptions = {},
): SppIntegrationSnapshot {
  return new SppIntegrationStatus(
    createHostLabSppIntegrationProbe(getHostStatus, options),
  ).snapshot();
}
