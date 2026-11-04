/**
 * Opens the internal SPP host and publishes an auto-prepare intent.
 * Does not claim write-pool readiness — host verifies and reports status.
 */

import {
  SPP_AUTO_PREPARE_INTENT_KEY,
  SPP_POOL_CONTRACT_KEY,
  SPP_PREPARE_STATUS_KEY,
  createIdleSppPrepareStatus,
  type SppAutoPrepareIntent,
  type SppPrepareStatus,
} from '../../shared/sppPrepareStatus.js';
import { openSppHostInternal } from '../../spp-host/openSppHost.js';

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

/**
 * After successful Nym connect: open host in background and request auto-prepare.
 */
export async function startSppAutoPrepareAfterNymConnect(): Promise<void> {
  const poolContract = await readStoredPoolContract();
  await publishSppPrepareStatus({
    phase: 'opening_host',
    message: 'Abriendo host SPP interno…',
    poolContract,
  });

  const intent: SppAutoPrepareIntent = {
    generation: Date.now(),
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
