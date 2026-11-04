/**
 * Host-side auto-prepare: probe + WASM (+ optional write pool when pool C… is known).
 * Never marks ready without a verified write_pool_ready registration.
 */

import {
  SPP_AUTO_PREPARE_INTENT_KEY,
  SPP_POOL_CONTRACT_KEY,
  SPP_PREPARE_STATUS_KEY,
  createIdleSppPrepareStatus,
  type SppAutoPrepareIntent,
  type SppPrepareStatus,
} from '../shared/sppPrepareStatus.js';
import type { SppHostController } from './hostController.js';
import { STELLAR_SOROBAN_TESTNET_RPC } from '@solanym/wallet-core/src/stellar/spp/sppNymOption.js';

async function publish(status: SppPrepareStatus): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  await chrome.storage.local.set({ [SPP_PREPARE_STATUS_KEY]: status });
}

async function readIntent(): Promise<SppAutoPrepareIntent | null> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
  const raw = await chrome.storage.local.get(SPP_AUTO_PREPARE_INTENT_KEY);
  const value = raw[SPP_AUTO_PREPARE_INTENT_KEY] as SppAutoPrepareIntent | undefined;
  if (!value || value.autoRun !== true) return null;
  return value;
}

async function nymIsActive(): Promise<boolean> {
  try {
    const response = (await chrome.runtime.sendMessage({
      id: crypto.randomUUID(),
      type: 'NYM_STATUS',
      payload: {},
    })) as { payload?: { connected?: boolean; mode?: string } } | undefined;
    return response?.payload?.connected === true && response.payload.mode === 'nym';
  } catch {
    return false;
  }
}

async function resolveActiveStellarAddress(): Promise<string | null> {
  try {
    const active = (await chrome.runtime.sendMessage({
      id: crypto.randomUUID(),
      type: 'GET_ACTIVE_ACCOUNT',
      payload: {},
    })) as { payload?: { status?: string; index?: number | null } } | undefined;
    if (active?.payload?.status !== 'VALID' || active.payload.index == null) return null;
    const accounts = (await chrome.runtime.sendMessage({
      id: crypto.randomUUID(),
      type: 'GET_ACCOUNTS',
      payload: {},
    })) as { payload?: Array<{ index: number; publicKey: string }> } | undefined;
    const account = accounts?.payload?.find((a) => a.index === active.payload!.index);
    return account?.publicKey?.startsWith('G') ? account.publicKey : null;
  } catch {
    return null;
  }
}

/**
 * Consume auto-prepare intent once per host load. Safe to call after controller is constructed.
 */
export async function runSppHostAutoPrepareIfRequested(
  controller: SppHostController,
): Promise<void> {
  const intent = await readIntent();
  if (!intent) return;

  const poolContract =
    intent.poolContract ??
    (typeof chrome !== 'undefined' && chrome.storage?.local
      ? ((await chrome.storage.local.get(SPP_POOL_CONTRACT_KEY))[SPP_POOL_CONTRACT_KEY] as
          | string
          | undefined)
      : null) ??
    null;

  const base = (): SppPrepareStatus => ({
    ...createIdleSppPrepareStatus(),
    poolContract: poolContract && poolContract.length === 56 ? poolContract : null,
    generation: intent.generation,
  });

  if (!(await nymIsActive())) {
    await publish({
      ...base(),
      phase: 'failed',
      message: 'Auto-prepare abortado: Nym ya no está conectado.',
      updatedAt: Date.now(),
    });
    return;
  }

  try {
    await publish({
      ...base(),
      phase: 'probing_assets',
      message: 'Comprobando SDK SPP empaquetado…',
      updatedAt: Date.now(),
    });
    let snap = await controller.probe();
    if (snap.phase !== 'ready') {
      await publish({
        ...base(),
        phase: 'failed',
        message: snap.errorMessage ?? 'Probe SPP falló',
        updatedAt: Date.now(),
      });
      return;
    }

    snap = await controller.initializeWasm();
    if (snap.wasmPhase !== 'ready') {
      await publish({
        ...base(),
        phase: 'failed',
        message: snap.wasmErrorMessage ?? 'WASM SPP no inicializó',
        updatedAt: Date.now(),
      });
      return;
    }

    if (!poolContract || !poolContract.startsWith('C') || poolContract.length !== 56) {
      await publish({
        ...base(),
        phase: 'awaiting_pool_config',
        message:
          'Assets listos. Configura el contrato del pool (C…) en Ajustes para completar PrivatePool.',
        updatedAt: Date.now(),
      });
      return;
    }

    await publish({
      ...base(),
      phase: 'initializing_session',
      message: 'Construyendo e inicializando sesión SPP…',
      updatedAt: Date.now(),
    });

    // Explicit lab placeholders — same as host UI defaults; real Testnet configs must be set by operator.
    if (!controller.snapshot().sessionBound) {
      controller.constructAndAttachUninitializedSession({
        rpcUrl: STELLAR_SOROBAN_TESTNET_RPC,
        contractConfig: { labPlaceholder: true },
        circuitLock: { labPlaceholder: true },
      });
    }
    snap = await controller.initializeBoundSessionForNym(true);
    if (snap.sessionState !== 'ready') {
      await publish({
        ...base(),
        phase: 'failed',
        message: snap.sessionConstructError ?? 'La sesión SPP no quedó ready',
        updatedAt: Date.now(),
      });
      return;
    }

    const userAddress = await resolveActiveStellarAddress();
    if (!userAddress) {
      await publish({
        ...base(),
        phase: 'awaiting_pool_config',
        message: 'Sesión RO lista. Desbloquea una cuenta Stellar activa para el write pool.',
        updatedAt: Date.now(),
      });
      return;
    }

    await publish({
      ...base(),
      phase: 'initializing_write_pool',
      message: 'Creando PrivatePool con firmante remoto…',
      updatedAt: Date.now(),
    });
    await controller.initializeWritePoolForNym({
      nymActive: true,
      poolContract,
      userAddress,
      networkPassphrase: 'Test SDF Network ; September 2015',
    });

    await publish({
      ...base(),
      phase: 'ready',
      message: 'PrivatePool listo. Los pagos privados usan Nym (sin fallback clearnet).',
      updatedAt: Date.now(),
    });
  } catch (cause) {
    await publish({
      ...base(),
      phase: 'failed',
      message: cause instanceof Error ? cause.message : 'Auto-prepare SPP falló',
      updatedAt: Date.now(),
    });
  } finally {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      void chrome.storage.local.remove(SPP_AUTO_PREPARE_INTENT_KEY);
    }
  }
}
