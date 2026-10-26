/**
 * Solanym Fase 5F — typed SPP integration status (contract only).
 *
 * Bridges wallet UI to {@link SppSession} lifecycle without importing or
 * invoking the SPP SDK package. Construction and
 * {@link SppIntegrationStatus.snapshot} perform no WASM/storage/client I/O.
 *
 * Does not duplicate SppSession; optionally mirrors an injected session handle.
 */

import type { SppSessionState } from './SppSession.js';

/** Product-facing availability for Solanym (maps onto session when bound). */
export type SppIntegrationAvailability =
  | 'unavailable'
  | 'not_initialized'
  | 'ready'
  | 'error';

/**
 * Explicit capabilities. Conservative defaults: packaging the SDK npm package
 * alone never flips these to true.
 */
export type SppIntegrationCapability =
  | 'read_only_session'
  | 'private_payments'
  | 'storage_lab_host';

export type SppIntegrationErrorCode =
  | 'FACADE_UNAVAILABLE'
  | 'SESSION_ERROR'
  | 'INTEGRATION_PROBE_FAILED'
  | 'FEATURE_DISABLED';

export type SppIntegrationError = {
  code: SppIntegrationErrorCode;
  /** Short, non-sensitive message suitable for UI. */
  message: string;
};

export type SppIntegrationCapabilities = Readonly<
  Record<SppIntegrationCapability, boolean>
>;

export type SppIntegrationSnapshot = {
  availability: SppIntegrationAvailability;
  capabilities: SppIntegrationCapabilities;
  /** Bound session state, or null when no session was provided. */
  sessionState: SppSessionState | null;
  error: SppIntegrationError | null;
  /**
   * True only when a facade packaging probe returned true.
   * Does not imply WASM/Storage/Client are initialized.
   */
  facadePackaged: boolean;
};

/** Minimal session mirror — avoids importing SppSession class into UI bundles if desired. */
export type SppSessionStatusHandle = {
  readonly state: SppSessionState;
  readonly lastErrorMessage: string | null;
};

/**
 * All probes are sync and side-effect free. Callers inject mocks in tests.
 * Default production probes must not dynamically import the SDK.
 */
export type SppIntegrationProbe = {
  /** Packaged facade / assets present for this surface (static check only). */
  isFacadePackaged: () => boolean;
  /**
   * Optional live session. Must not construct or initialize a session here —
   * return a pre-bound handle or null.
   */
  getSession?: () => SppSessionStatusHandle | null;
  /**
   * Product gate for private payments UX. Hard-off until a later authorized phase.
   * Default when omitted: false.
   */
  isPrivatePaymentsEnabled?: () => boolean;
  /**
   * Whether this surface is the isolated spp-host lab (not the popup).
   * Default when omitted: false.
   */
  isStorageLabHostSurface?: () => boolean;
};

const ALL_CAPABILITIES_OFF: SppIntegrationCapabilities = Object.freeze({
  read_only_session: false,
  private_payments: false,
  storage_lab_host: false,
});

function sanitizeMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return 'SPP integration error';
  return trimmed.length > 160 ? `${trimmed.slice(0, 160)}…` : trimmed;
}

/**
 * Typed status adapter for Solanym ↔ SPP.
 * Snapshot is pure with respect to the injected probe (no SDK I/O).
 */
export class SppIntegrationStatus {
  private readonly probe: SppIntegrationProbe;

  constructor(probe: SppIntegrationProbe) {
    if (!probe || typeof probe.isFacadePackaged !== 'function') {
      throw new Error('SppIntegrationStatus requires probe.isFacadePackaged');
    }
    this.probe = probe;
  }

  snapshot(): SppIntegrationSnapshot {
    let facadePackaged = false;
    try {
      facadePackaged = Boolean(this.probe.isFacadePackaged());
    } catch {
      return {
        availability: 'error',
        capabilities: ALL_CAPABILITIES_OFF,
        sessionState: null,
        facadePackaged: false,
        error: {
          code: 'INTEGRATION_PROBE_FAILED',
          message: 'SPP availability probe failed',
        },
      };
    }

    let session: SppSessionStatusHandle | null = null;
    try {
      session = this.probe.getSession?.() ?? null;
    } catch {
      return {
        availability: 'error',
        capabilities: ALL_CAPABILITIES_OFF,
        sessionState: null,
        facadePackaged,
        error: {
          code: 'INTEGRATION_PROBE_FAILED',
          message: 'SPP session probe failed',
        },
      };
    }

    const privatePaymentsEnabled = Boolean(this.probe.isPrivatePaymentsEnabled?.() ?? false);
    const storageLabHost = Boolean(this.probe.isStorageLabHostSurface?.() ?? false);

    if (!facadePackaged) {
      return {
        availability: 'unavailable',
        capabilities: ALL_CAPABILITIES_OFF,
        sessionState: session?.state ?? null,
        facadePackaged: false,
        error: {
          code: 'FACADE_UNAVAILABLE',
          message: 'SPP facade is not packaged for this surface',
        },
      };
    }

    if (!session) {
      return {
        availability: 'not_initialized',
        capabilities: Object.freeze({
          read_only_session: false,
          // Packaged alone never enables payments.
          private_payments: false,
          storage_lab_host: storageLabHost,
        }),
        sessionState: null,
        facadePackaged: true,
        error: null,
      };
    }

    if (session.state === 'error') {
      return {
        availability: 'error',
        capabilities: Object.freeze({
          read_only_session: false,
          private_payments: false,
          storage_lab_host: storageLabHost,
        }),
        sessionState: 'error',
        facadePackaged: true,
        error: {
          code: 'SESSION_ERROR',
          message: sanitizeMessage(session.lastErrorMessage || 'SPP session is in error state'),
        },
      };
    }

    if (session.state === 'ready') {
      // RO session ready ≠ private payments. Keep payments capability hard-off
      // until a later authorized phase (isPrivatePaymentsEnabled is reserved).
      void privatePaymentsEnabled;
      return {
        availability: 'ready',
        capabilities: Object.freeze({
          read_only_session: true,
          private_payments: false,
          storage_lab_host: storageLabHost,
        }),
        sessionState: 'ready',
        facadePackaged: true,
        error: null,
      };
    }

    // uninitialized | initializing | disposed → not ready for product use
    return {
      availability: 'not_initialized',
      capabilities: Object.freeze({
        read_only_session: false,
        private_payments: false,
        storage_lab_host: storageLabHost,
      }),
      sessionState: session.state,
      facadePackaged: true,
      error: null,
    };
  }
}

/**
 * Synchronous, side-effect-free read of an *already existing* session handle.
 * Does not construct, initialize, dispose, or call SDK I/O.
 * Returns null when no session is provided.
 */
export function readSppSessionStatusHandle(
  session: SppSessionStatusHandle | null | undefined,
): SppSessionStatusHandle | null {
  if (!session) return null;
  return {
    state: session.state,
    lastErrorMessage: session.lastErrorMessage,
  };
}

/**
 * chrome.storage.local key for an optional host-published session mirror.
 * Written only by surfaces that already hold a session handle; never invents ready.
 */
export const SPP_SESSION_STATUS_STORAGE_KEY = 'solanym_spp_session_status';

export type StoredSppSessionStatus = {
  state: SppSessionState;
  lastErrorMessage: string | null;
  /** Monotonic publish counter — popup must ignore lower generations. */
  generation: number;
  updatedAt: string;
};

export type SppSessionStatusPublishMeta = {
  generation: number;
  updatedAt?: string;
};

/** Serialize a handle for chrome.storage (null handle → null, i.e. clear). */
export function toStoredSppSessionStatus(
  handle: SppSessionStatusHandle | null | undefined,
  meta: SppSessionStatusPublishMeta,
): StoredSppSessionStatus | null {
  if (typeof meta?.generation !== 'number' || !Number.isFinite(meta.generation) || meta.generation < 1) {
    throw new Error('toStoredSppSessionStatus requires meta.generation >= 1');
  }
  const mirrored = readSppSessionStatusHandle(handle);
  if (!mirrored) return null;
  return {
    state: mirrored.state,
    lastErrorMessage: mirrored.lastErrorMessage,
    generation: meta.generation,
    updatedAt: meta.updatedAt ?? new Date().toISOString(),
  };
}

/**
 * Parse a stored session mirror. Returns null unless state is an explicit
 * SppSessionState string — never upgrades missing/unknown into ready.
 */
export function parseStoredSppSessionStatus(raw: unknown): SppSessionStatusHandle | null {
  const full = parseStoredSppSessionStatusRecord(raw);
  if (!full) return null;
  return { state: full.state, lastErrorMessage: full.lastErrorMessage };
}

/**
 * Full stored record including generation (for stale-message rejection).
 */
export function parseStoredSppSessionStatusRecord(
  raw: unknown,
): StoredSppSessionStatus | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const state = rec.state;
  const allowed = new Set([
    'uninitialized',
    'initializing',
    'ready',
    'error',
    'disposed',
  ]);
  if (typeof state !== 'string' || !allowed.has(state)) return null;
  const generation = rec.generation;
  if (typeof generation !== 'number' || !Number.isFinite(generation) || generation < 1) {
    return null;
  }
  const lastErrorMessage =
    rec.lastErrorMessage == null
      ? null
      : typeof rec.lastErrorMessage === 'string'
        ? rec.lastErrorMessage
        : String(rec.lastErrorMessage);
  const updatedAt =
    typeof rec.updatedAt === 'string' && rec.updatedAt.trim()
      ? rec.updatedAt
      : new Date(0).toISOString();
  return {
    state: state as SppSessionState,
    lastErrorMessage,
    generation,
    updatedAt,
  };
}

/**
 * Apply a stored record only when its generation is strictly newer.
 * Returns the next applied handle + generation, or the previous values if stale/invalid.
 */
export function applyStoredSppSessionStatusIfNewer(
  raw: unknown,
  previous: { handle: SppSessionStatusHandle | null; generation: number },
): { handle: SppSessionStatusHandle | null; generation: number; applied: boolean } {
  if (raw == null) {
    // Explicit clear only wins when accompanied by a higher generation envelope.
    // Bare null without generation cannot clobber a known newer publish.
    return { handle: previous.handle, generation: previous.generation, applied: false };
  }
  const record = parseStoredSppSessionStatusRecord(raw);
  if (!record) {
    return { handle: previous.handle, generation: previous.generation, applied: false };
  }
  if (record.generation <= previous.generation) {
    return { handle: previous.handle, generation: previous.generation, applied: false };
  }
  return {
    handle: { state: record.state, lastErrorMessage: record.lastErrorMessage },
    generation: record.generation,
    applied: true,
  };
}

/** Explicit clear envelope (host unbound the session). */
export function toStoredSppSessionClear(meta: SppSessionStatusPublishMeta): {
  clear: true;
  generation: number;
  updatedAt: string;
} {
  if (typeof meta?.generation !== 'number' || !Number.isFinite(meta.generation) || meta.generation < 1) {
    throw new Error('toStoredSppSessionClear requires meta.generation >= 1');
  }
  return {
    clear: true,
    generation: meta.generation,
    updatedAt: meta.updatedAt ?? new Date().toISOString(),
  };
}

export function applyStoredSppSessionClearIfNewer(
  raw: unknown,
  previous: { handle: SppSessionStatusHandle | null; generation: number },
): { handle: SppSessionStatusHandle | null; generation: number; applied: boolean } {
  if (!raw || typeof raw !== 'object') {
    return applyStoredSppSessionStatusIfNewer(raw, previous);
  }
  const rec = raw as Record<string, unknown>;
  if (rec.clear === true) {
    const generation = rec.generation;
    if (typeof generation !== 'number' || !Number.isFinite(generation) || generation < 1) {
      return { handle: previous.handle, generation: previous.generation, applied: false };
    }
    if (generation <= previous.generation) {
      return { handle: previous.handle, generation: previous.generation, applied: false };
    }
    return { handle: null, generation, applied: true };
  }
  return applyStoredSppSessionStatusIfNewer(raw, previous);
}

/**
 * Async packaging probe: HEAD/GET a packaged SPP asset URL.
 * Does not import the SDK. 404/network failure → not packaged.
 */
export async function probeSppFacadePackaged(
  assetUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!assetUrl || typeof assetUrl !== 'string') return false;
  try {
    const res = await fetchImpl(assetUrl, { method: 'GET', cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Default popup probe: conservative defaults — facade not assumed packaged,
 * no session, payments off. Callers must override `isFacadePackaged` after a
 * real {@link probeSppFacadePackaged} check (or inject a bound session handle).
 * Does not import or initialize the SDK.
 */
export function createPopupSppIntegrationProbe(
  overrides: Partial<SppIntegrationProbe> = {},
): SppIntegrationProbe {
  return {
    isFacadePackaged: () => false,
    getSession: () => null,
    isPrivatePaymentsEnabled: () => false,
    isStorageLabHostSurface: () => false,
    ...overrides,
  };
}

/** Human-readable labels for popup / settings (Spanish UI convention). */
export function describeSppIntegrationAvailability(
  availability: SppIntegrationAvailability,
): string {
  switch (availability) {
    case 'unavailable':
      return 'SPP no disponible';
    case 'not_initialized':
      return 'SPP instalado, pero no inicializado';
    case 'ready':
      return 'SPP listo (solo lectura)';
    case 'error':
      return 'Error de integración SPP';
    default: {
      const _exhaustive: never = availability;
      return _exhaustive;
    }
  }
}
