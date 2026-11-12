import type { SppPrivatePool } from '@solanym/wallet-core/src/stellar/spp/sppNymOption.js';
import type { SppHostPoolLifecycleState } from '../../shared/sppHostBridge.js';
import { publishSppPrepareStatus, readStoredPoolContract } from './sppAutoPrepare.js';

/**
 * In-memory registry for the background realm.
 *
 * A real WASM `PrivatePool` lives only inside the spp-host page (OPFS + workers).
 * The SW may hold:
 * - a local test double, or
 * - a HostPoolProxy that RPCs into spp-host.
 *
 * Cross-context object sharing is impossible; never attempt to assign a host
 * PrivatePool instance into this registry.
 */

let pool: SppPrivatePool | null = null;
let generation = 0;
let hostLifecycle: SppHostPoolLifecycleState = 'cleared';
let hostMessage: string | null = null;

export function registerSppPrivatePool(next: SppPrivatePool | null): void {
  pool = next;
  generation += 1;
}

export function clearSppPrivatePool(): void {
  pool = null;
  generation += 1;
  hostLifecycle = 'cleared';
  hostMessage = null;
}

export function getSppPrivatePool(): SppPrivatePool | null {
  return pool;
}

export function getSppPrivatePoolGeneration(): number {
  return generation;
}

export function noteSppHostLifecycle(input: {
  state: SppHostPoolLifecycleState;
  message?: string;
}): void {
  hostLifecycle = input.state;
  hostMessage = input.message ?? null;
  generation += 1;
  if (input.state === 'cleared' || input.state === 'error') {
    pool = null;
  }
  // Mirror verified host lifecycle into wallet prepare status (no invented ready).
  void readStoredPoolContract()
    .then((poolContract) => {
      if (input.state === 'write_pool_ready') {
        return publishSppPrepareStatus({
          phase: 'ready',
          message: input.message ?? 'PrivatePool verificado en el host.',
          poolContract,
        });
      }
      if (input.state === 'cleared') {
        return publishSppPrepareStatus({
          phase: 'idle',
          message: input.message ?? 'Host SPP limpiado.',
          poolContract,
        });
      }
      if (input.state === 'error') {
        return publishSppPrepareStatus({
          phase: 'failed',
          message: input.message ?? 'Error en el host SPP.',
          poolContract,
        });
      }
      return undefined;
    })
    .catch(() => {
      /* prepare status is best-effort */
    });
}

export function getSppHostLifecycle(): {
  state: SppHostPoolLifecycleState;
  message: string | null;
  generation: number;
  hasPool: boolean;
} {
  return {
    state: hostLifecycle,
    message: hostMessage,
    generation,
    hasPool: pool !== null,
  };
}
