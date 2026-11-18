/**
 * Host-side auto-prepare: probe + WASM + real circuitLock + verified ContractConfig
 * (defaults to pinned Nethermind public Testnet) + proving-key probe + optional write pool.
 * Never marks ready without a verified write_pool_ready registration.
 * Never invents deployments, bootnodes, or labPlaceholder configs.
 * Nym mode stays fail-closed (no clearnet fallback).
 */

import {
  SPP_AUTO_PREPARE_INTENT_KEY,
  SPP_BOOTNODE_URL_KEY,
  SPP_CONTRACT_CONFIG_KEY,
  SPP_POOL_CONTRACT_KEY,
  SPP_PREPARE_STATUS_KEY,
  createIdleSppPrepareStatus,
  type SppAutoPrepareIntent,
  type SppPrepareStatus,
} from '../shared/sppPrepareStatus.js';
import type { SppHostController } from './hostController.js';
import { getSppHostWritePoolStatus } from './sppHostWritePool.js';
import { STELLAR_SOROBAN_TESTNET_RPC } from '@solanym/wallet-core/src/stellar/spp/sppNymOption.js';
import {
  findEnabledPoolContract,
  parseSppContractConfig,
  type SppContractConfigInput,
} from '@solanym/wallet-core/src/stellar/spp/sppContractConfig.js';
import {
  classifySppDeploymentOwnership,
  getNethermindPublicTestnetContractConfig,
  NETHERMIND_PUBLIC_XLM_POOL_CONTRACT,
  resolveNethermindPublicXlmPool,
} from '@solanym/wallet-core/src/stellar/spp/nethermind/nethermindPublicTestnet.js';
import {
  loadCircuitLockFromBaseUrl,
  probeSppProvingKeys,
  type SppCircuitLock,
} from '@solanym/wallet-core/src/stellar/spp/sppProvingKeys.js';

class SppPrepareSupersededError extends Error {
  constructor() {
    super('SPP prepare generation was superseded');
    this.name = 'SppPrepareSupersededError';
  }
}

async function publish(status: SppPrepareStatus): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  // The service-worker-owned intent is the generation lease. An old host must
  // never overwrite a newer prepare status, even if its async work completes late.
  const current = await chrome.storage.local.get([
    SPP_AUTO_PREPARE_INTENT_KEY,
    SPP_PREPARE_STATUS_KEY,
  ]);
  const intent = current[SPP_AUTO_PREPARE_INTENT_KEY] as SppAutoPrepareIntent | undefined;
  const currentStatus = current[SPP_PREPARE_STATUS_KEY] as SppPrepareStatus | undefined;
  if (
    intent?.autoRun !== true ||
    intent.generation !== status.generation ||
    currentStatus?.generation !== status.generation
  ) {
    throw new SppPrepareSupersededError();
  }
  await chrome.storage.local.set({ [SPP_PREPARE_STATUS_KEY]: status });
}

async function readIntent(): Promise<SppAutoPrepareIntent | null> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
  const raw = await chrome.storage.local.get(SPP_AUTO_PREPARE_INTENT_KEY);
  const value = raw[SPP_AUTO_PREPARE_INTENT_KEY] as SppAutoPrepareIntent | undefined;
  if (!value || value.autoRun !== true) return null;
  return value;
}

async function readStoredContractConfig(): Promise<unknown | null> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
  const raw = await chrome.storage.local.get(SPP_CONTRACT_CONFIG_KEY);
  return raw[SPP_CONTRACT_CONFIG_KEY] ?? null;
}

async function readStoredBootnodeUrl(): Promise<string | null> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
  const raw = await chrome.storage.local.get(SPP_BOOTNODE_URL_KEY);
  const value = raw[SPP_BOOTNODE_URL_KEY];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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

function ownershipFields(config: SppContractConfigInput, poolContract: string | null) {
  const info = classifySppDeploymentOwnership({ config, poolContract });
  return {
    deploymentOwnership: info.ownership,
    deploymentLabel: info.label,
  } as const;
}

/**
 * Consume auto-prepare intent once per host load. Safe to call after controller is constructed.
 */
async function runSppHostAutoPrepareForIntent(
  controller: SppHostController,
  intent: SppAutoPrepareIntent,
): Promise<void> {
  const storedStatusRaw = await chrome.storage.local.get(SPP_PREPARE_STATUS_KEY);
  let storedStatus = storedStatusRaw[SPP_PREPARE_STATUS_KEY] as SppPrepareStatus | undefined;
  if (!storedStatus || storedStatus.generation > intent.generation) {
    // The service worker owns the intent key; a stale host never deletes it.
    return;
  }
  // A newer service-worker intent is authoritative. Repair a status overwritten
  // by a late older host before beginning the new generation.
  if (storedStatus.generation < intent.generation) {
    storedStatus = {
      ...createIdleSppPrepareStatus(),
      phase: 'opening_host',
      message: 'Recuperando preparación SPP vigente…',
      poolContract: intent.poolContract ?? null,
      generation: intent.generation,
      updatedAt: Date.now(),
    };
    await chrome.storage.local.set({ [SPP_PREPARE_STATUS_KEY]: storedStatus });
  } else if (
    storedStatus.phase === 'idle' ||
    storedStatus.phase === 'failed' ||
    storedStatus.phase === 'ready'
  ) {
    // Terminal/current state remains as a generation record until the worker
    // replaces or removes it. The host never mutates the SW-owned intent key.
    return;
  }

  const storedPool =
    intent.poolContract ??
    (typeof chrome !== 'undefined' && chrome.storage?.local
      ? ((await chrome.storage.local.get(SPP_POOL_CONTRACT_KEY))[SPP_POOL_CONTRACT_KEY] as
          | string
          | undefined)
      : null) ??
    null;

  const base = (
    poolContract: string | null = null,
    ownership?: ReturnType<typeof ownershipFields>,
  ): SppPrepareStatus => ({
    ...createIdleSppPrepareStatus(),
    poolContract:
      poolContract && poolContract.length === 56
        ? poolContract
        : storedPool && storedPool.length === 56
          ? storedPool
          : null,
    generation: intent.generation,
    ...(ownership
      ? {
          deploymentOwnership: ownership.deploymentOwnership,
          deploymentLabel: ownership.deploymentLabel,
        }
      : {}),
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

    const circuitsBaseUrl = snap.assets?.circuitsBaseUrl;
    if (!circuitsBaseUrl) {
      await publish({
        ...base(),
        phase: 'failed',
        message: 'circuitsBaseUrl ausente tras el probe',
        updatedAt: Date.now(),
      });
      return;
    }

    let circuitLock: SppCircuitLock;
    try {
      circuitLock = await loadCircuitLockFromBaseUrl(circuitsBaseUrl);
    } catch (cause) {
      await publish({
        ...base(),
        phase: 'failed',
        message:
          cause instanceof Error
            ? `circuitLock: ${cause.message}`
            : 'No se pudo cargar circuits.json empaquetado',
        updatedAt: Date.now(),
      });
      return;
    }

    const proving = await probeSppProvingKeys({ circuitsBaseUrl, lock: circuitLock });
    if (!proving.ok) {
      await publish({
        ...base(),
        phase: 'missing_proving_keys',
        message: `${proving.message} Ej.: ${proving.missing.slice(0, 3).join(', ')}`,
        updatedAt: Date.now(),
      });
      return;
    }

    await publish({
      ...base(),
      phase: 'assets_ready',
      message: `Assets + ${proving.circuitIds.length} circuitos con proving keys verificados.`,
      updatedAt: Date.now(),
    });

    let rawConfig = await readStoredContractConfig();
    let contractConfig: SppContractConfigInput;
    if (!rawConfig) {
      // Default to pinned Nethermind public Testnet — do not invent Astrym-owned addresses.
      contractConfig = getNethermindPublicTestnetContractConfig();
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.set({ [SPP_CONTRACT_CONFIG_KEY]: contractConfig });
      }
    } else {
      try {
        contractConfig = parseSppContractConfig(rawConfig);
      } catch (cause) {
        await publish({
          ...base(),
          phase: 'missing_configuration',
          message:
            cause instanceof Error
              ? cause.message
              : 'ContractConfig inválido — corrige deployments.json',
          updatedAt: Date.now(),
        });
        return;
      }
    }

    const ownershipForPreferred = ownershipFields(
      contractConfig,
      storedPool && storedPool.length === 56 ? storedPool : NETHERMIND_PUBLIC_XLM_POOL_CONTRACT,
    );

    const poolContract =
      findEnabledPoolContract(
        contractConfig,
        storedPool && storedPool.length === 56
          ? storedPool
          : resolveNethermindPublicXlmPool(contractConfig),
      ) ?? findEnabledPoolContract(contractConfig);

    if (!poolContract) {
      await publish({
        ...base(null, ownershipForPreferred),
        phase: 'awaiting_pool_config',
        message:
          'ContractConfig sin pool habilitado (C…). Añade pools[].enabled=true o elige un C… válido.',
        updatedAt: Date.now(),
      });
      return;
    }

    const ownership = ownershipFields(contractConfig, poolContract);

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ [SPP_POOL_CONTRACT_KEY]: poolContract });
    }

    const rpcUrl =
      (typeof contractConfig.rpcUrl === 'string' && contractConfig.rpcUrl.trim()) ||
      STELLAR_SOROBAN_TESTNET_RPC;
    const networkPassphrase =
      (typeof contractConfig.networkPassphrase === 'string' &&
        contractConfig.networkPassphrase.trim()) ||
      'Test SDF Network ; September 2015';
    const bootnodeUrl = await readStoredBootnodeUrl();
    const userAddress = await resolveActiveStellarAddress();
    if (!userAddress) {
      await publish({
        ...base(poolContract, ownership),
        phase: 'failed',
        message: 'Desbloquea una cuenta Stellar activa en Astrym antes de inicializar el almacenamiento SPP.',
        updatedAt: Date.now(),
      });
      return;
    }

    await publish({
      ...base(poolContract, ownership),
      phase: 'initializing_session',
      message: `Construyendo sesión SPP (${ownership.deploymentLabel})…`,
      updatedAt: Date.now(),
    });

    const previousSession = controller.snapshot();
    // A failed or merely constructed session owns a signer bound to the old
    // preparation generation. Rebuild it before retrying so the storage
    // unlock permit can only be minted for the current generation.
    if (
      previousSession.sessionBound &&
      (previousSession.sessionState === 'error' || previousSession.sessionState === 'uninitialized')
    ) {
      controller.clearBoundSession();
    }

    if (!controller.snapshot().sessionBound) {
      controller.constructAndAttachUninitializedSession({
        rpcUrl,
        contractConfig,
        circuitLock,
        ...(bootnodeUrl ? { bootnodeUrl } : {}),
        storageUnlock: {
          userAddress,
          prepareGeneration: intent.generation,
        },
      });
    }
    snap = await controller.initializeBoundSessionForNym(true);
    if (snap.sessionState !== 'ready') {
      await publish({
        ...base(poolContract, ownership),
        phase: 'failed',
        message: snap.sessionConstructError ?? 'La sesión SPP no quedó ready',
        updatedAt: Date.now(),
      });
      return;
    }

    await publish({
      ...base(poolContract, ownership),
      phase: 'read_only',
      message: 'Sesión solo lectura lista. Preparando PrivatePool de escritura…',
      updatedAt: Date.now(),
    });

    await publish({
      ...base(poolContract, ownership),
      phase: 'initializing_write_pool',
      message: 'Creando PrivatePool con firmante remoto vía Nym…',
      updatedAt: Date.now(),
    });
    await controller.initializeWritePoolForNym({
      nymActive: true,
      poolContract,
      userAddress,
      networkPassphrase,
      prepareGeneration: intent.generation,
    });

    const writeStatus = getSppHostWritePoolStatus();
    if (!writeStatus.hasWritePool || writeStatus.poolContract !== poolContract) {
      await publish({
        ...base(poolContract, ownership),
        phase: 'failed',
        message: 'Write pool no quedó registrado tras initializeWritePoolForNym (fail-closed).',
        updatedAt: Date.now(),
      });
      return;
    }

    await publish({
      ...base(poolContract, ownership),
      phase: 'ready',
      message:
        `SESSION write_pool_ready (${ownership.deploymentLabel}). Deposit/transfer/withdraw en el mismo pool vía Nym (sin fallback clearnet).`,
      updatedAt: Date.now(),
    });
  } catch (cause) {
    if (!(cause instanceof SppPrepareSupersededError)) {
      await publish({
        ...base(),
        phase: 'failed',
        message: cause instanceof Error ? cause.message : 'Auto-prepare SPP falló',
        updatedAt: Date.now(),
      }).catch((publishCause: unknown) => {
        if (!(publishCause instanceof SppPrepareSupersededError)) throw publishCause;
      });
    }
  }
}

let activePrepareGeneration: number | null = null;
let activePreparePromise: Promise<void> | null = null;

/**
 * Process one host intent at a time. If a newer generation arrives while the
 * previous async run is unwinding, re-read storage and run the latest intent.
 */
export async function runSppHostAutoPrepareIfRequested(
  controller: SppHostController,
): Promise<void> {
  const intent = await readIntent();
  if (!intent) return;
  if (activePrepareGeneration === intent.generation) return;

  if (activePreparePromise) {
    await activePreparePromise.catch(() => undefined);
    const latest = await readIntent();
    if (latest && latest.generation !== intent.generation) {
      return runSppHostAutoPrepareIfRequested(controller);
    }
    return;
  }

  activePrepareGeneration = intent.generation;
  const running = runSppHostAutoPrepareForIntent(controller, intent);
  activePreparePromise = running;
  try {
    await running;
  } finally {
    if (activePreparePromise === running) {
      activePreparePromise = null;
      activePrepareGeneration = null;
    }
    const latest = await readIntent();
    if (latest && latest.generation !== intent.generation) {
      void runSppHostAutoPrepareIfRequested(controller).catch(() => {
        /* host status publisher records non-superseded failures */
      });
    }
  }
}
