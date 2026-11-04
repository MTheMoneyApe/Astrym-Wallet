import type { SppPrivatePool } from '@solanym/wallet-core/src/stellar/spp/sppNymOption.js';
import type { SppHostPoolLifecycleState } from '../../shared/sppHostBridge.js';

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
