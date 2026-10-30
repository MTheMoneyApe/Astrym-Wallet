import type { SppPrivatePool } from '@solanym/wallet-core/src/stellar/spp/sppNymOption.js';

let pool: SppPrivatePool | null = null;

export function registerSppPrivatePool(next: SppPrivatePool | null): void {
  pool = next;
}

export function getSppPrivatePool(): SppPrivatePool | null {
  return pool;
}
