/**
 * Opens the internal SPP host and publishes an auto-prepare intent.
 * Does not claim write-pool readiness — host verifies and reports status.
 */

import {
  SPP_AUTO_PREPARE_INTENT_KEY,
  SPP_POOL_CONTRACT_KEY,
  SPP_PREPARE_STATUS_KEY,
  createIdleSppPrepareStatus,
  isSppWriteReady,
  type SppAutoPrepareIntent,
  type SppPreparePhase,
  type SppPrepareStatus,
} from '../../shared/sppPrepareStatus.js';
import { openSppHostInternal } from '../../spp-host/openSppHost.js';
import { revokeSppSignApprovals } from '@solanym/wallet-core/src/stellar/spp/sppSignGate.js';

/** Phases that mean prepare is already running — do not start a duplicate. */
const IN_FLIGHT_PHASES: ReadonlySet<SppPreparePhase> = new Set([
  'opening_host',
  'probing_assets',
  'assets_ready',
  'initializing_session',
  'read_only',
  'initializing_write_pool',
]);

/** How long opening_host may stall before we treat it as stuck and retry. */
const OPENING_HOST_STALL_MS = 45_000;

let ensureInFlight: Promise<SppPrepareStatus | null> | null = null;

function storageLocal(): chrome.storage.LocalStorageArea | null {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
  return chrome.storage.local;
}

export async function readStoredPoolContract(): Promise<string | null> {
  const area = storageLocal();
  if (!area) return null;
  const raw = await area.get(SPP_POOL_CONTRACT_KEY);
  const value = raw[SPP_POOL_CONTRACT_KEY];
  return typeof value === 'string' && value.startsWith('C') && value.length === 56
    ? value
    : null;
}

export async function readSppPrepareStatus(): Promise<SppPrepareStatus | null> {
  const area = storageLocal();
  if (!area) return null;
  const raw = await area.get(SPP_PREPARE_STATUS_KEY);
  const value = raw[SPP_PREPARE_STATUS_KEY] as SppPrepareStatus | undefined;
  return value?.phase ? value : null;
}

export async function publishSppPrepareStatus(
  patch: Partial<SppPrepareStatus> & Pick<SppPrepareStatus, 'phase' | 'message'>,
): Promise<SppPrepareStatus> {
  const area = storageLocal();
  const prevRaw = area ? await area.get(SPP_PREPARE_STATUS_KEY) : {};
  const prev = (prevRaw[SPP_PREPARE_STATUS_KEY] as SppPrepareStatus | undefined) ??
    createIdleSppPrepareStatus();
  const next: SppPrepareStatus = {
    ...prev,
    ...patch,
    updatedAt: Date.now(),
    generation: (prev.generation ?? 0) + 1,
  };
  if (area) {
    await area.set({ [SPP_PREPARE_STATUS_KEY]: next });
  }
  return next;
}

function shouldStartPrepare(status: SppPrepareStatus | null): boolean {
  if (!status) return true;
  if (isSppWriteReady(status)) return false;
  if (status.phase === 'opening_host') {
    const age = Date.now() - (status.updatedAt || 0);
    return age > OPENING_HOST_STALL_MS;
  }
  if (IN_FLIGHT_PHASES.has(status.phase)) return false;
  // idle | failed | missing_* | awaiting_pool_config → retry when Nym is up
  return true;
}

/**
 * After successful Nym connect: open host in background and request auto-prepare.
 */
export async function startSppAutoPrepareAfterNymConnect(): Promise<void> {
  // A new prepare owns a new generation. Revoke any leftover one-shot SPP/KDF
  // approvals synchronously before publishing or opening the next host intent.
  revokeSppSignApprovals();
  const poolContract = await readStoredPoolContract();
  const openingStatus = await publishSppPrepareStatus({
    phase: 'opening_host',
    message: 'Abriendo host SPP interno…',
    poolContract,
  });

  const intent: SppAutoPrepareIntent = {
    generation: openingStatus.generation,
    requestedAt: Date.now(),
    poolContract,
    autoRun: true,
  };
  const area = storageLocal();
  if (area) {
    await area.set({ [SPP_AUTO_PREPARE_INTENT_KEY]: intent });
  }

  try {
    openSppHostInternal({ active: false });
  } catch (cause) {
    await publishSppPrepareStatus({
      phase: 'failed',
      message:
        cause instanceof Error
          ? cause.message
          : 'No se pudo abrir el host SPP interno',
      poolContract,
    });
  }
}

/**
 * Idempotent prepare entry for reload / Settings / already-connected Nym.
 * Skips when write_pool_ready or an in-flight phase is fresh.
 */
export async function ensureSppAutoPrepareIfNeeded(input: {
  nymConnected: boolean;
  nymMode: 'direct' | 'nym';
}): Promise<SppPrepareStatus | null> {
  if (!input.nymConnected || input.nymMode !== 'nym') {
    return readSppPrepareStatus();
  }
  if (ensureInFlight) return ensureInFlight;

  ensureInFlight = (async () => {
    const current = await readSppPrepareStatus();
    if (!shouldStartPrepare(current)) {
      return current;
    }
    await startSppAutoPrepareAfterNymConnect();
    return readSppPrepareStatus();
  })().finally(() => {
    ensureInFlight = null;
  });

  return ensureInFlight;
}

export async function clearSppAutoPrepareOnNymDisconnect(): Promise<void> {
  const area = storageLocal();
  if (area) {
    await area.remove(SPP_AUTO_PREPARE_INTENT_KEY);
  }
  await publishSppPrepareStatus({
    phase: 'idle',
    message: 'Nym desconectado. SPP pausado hasta la próxima conexión.',
    poolContract: await readStoredPoolContract(),
  });
}

/** Test helper */
export function resetSppAutoPrepareEnsureLockForTests(): void {
  ensureInFlight = null;
}
