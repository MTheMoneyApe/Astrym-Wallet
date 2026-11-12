/**
 * Shared SPP preparation status for wallet UI (popup) and spp-host auto-prepare.
 * Does not invent write-pool readiness — only mirrors verified host/SW state.
 */

export const SPP_PREPARE_STATUS_KEY = 'astrym_spp_prepare_status' as const;
export const SPP_POOL_CONTRACT_KEY = 'astrym_spp_pool_contract' as const;
export const SPP_CONTRACT_CONFIG_KEY = 'astrym_spp_contract_config' as const;
/** Optional operator-supplied historical-sync bootnode URL (never invented). */
export const SPP_BOOTNODE_URL_KEY = 'astrym_spp_bootnode_url' as const;
export const SPP_AUTO_PREPARE_INTENT_KEY = 'astrym_spp_auto_prepare_intent' as const;

export type SppPreparePhase =
  | 'idle'
  | 'opening_host'
  | 'probing_assets'
  | 'assets_ready'
  | 'missing_configuration'
  | 'missing_proving_keys'
  | 'awaiting_pool_config'
  | 'initializing_session'
  | 'read_only'
  | 'initializing_write_pool'
  | 'ready'
  | 'failed';

export type SppPrepareStatus = {
  phase: SppPreparePhase;
  message: string;
  poolContract: string | null;
  updatedAt: number;
  generation: number;
  /** Deployment ownership label for UI (Nethermind public vs Astrym-owned vs custom). */
  deploymentOwnership?: 'nethermind_public' | 'astrym_owned' | 'custom' | 'unknown';
  deploymentLabel?: string;
};

export type SppAutoPrepareIntent = {
  generation: number;
  requestedAt: number;
  poolContract: string | null;
  /** When true, host should run probe+wasm (+ session/write pool if config present). */
  autoRun: true;
};

export function createIdleSppPrepareStatus(
  overrides?: Partial<SppPrepareStatus>,
): SppPrepareStatus {
  return {
    phase: 'idle',
    message: 'SPP en espera. Conecta Nym para preparar pagos privados.',
    poolContract: null,
    updatedAt: Date.now(),
    generation: 0,
    ...overrides,
  };
}

export function describeSppPreparePhase(phase: SppPreparePhase): string {
  switch (phase) {
    case 'idle':
      return 'En espera';
    case 'opening_host':
      return 'Abriendo host SPP…';
    case 'probing_assets':
      return 'Comprobando SDK / assets…';
    case 'assets_ready':
      return 'Assets listos';
    case 'missing_configuration':
      return 'Falta deployments.json (ContractConfig)';
    case 'missing_proving_keys':
      return 'Faltan proving keys empaquetadas';
    case 'awaiting_pool_config':
      return 'Falta contrato del pool (C…)';
    case 'initializing_session':
      return 'Inicializando sesión SPP…';
    case 'read_only':
      return 'Sesión solo lectura lista';
    case 'initializing_write_pool':
      return 'Preparando PrivatePool…';
    case 'ready':
      return 'Listo para pagos privados (write)';
    case 'failed':
      return 'Preparación fallida';
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}

export function isSppWriteReady(status: SppPrepareStatus | null | undefined): boolean {
  return status?.phase === 'ready';
}
