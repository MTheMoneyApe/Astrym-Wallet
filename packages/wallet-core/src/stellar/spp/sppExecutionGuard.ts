/**
 * Fail-closed guards for private payment execution:
 * authorization fingerprint binding + single-flight / duplicate rejection.
 */

import type { SppPrivateOperation } from './sppNymOption.js';

export type PrivatePaymentAuthMaterial = {
  operation: SppPrivateOperation;
  poolContract: string;
  amountStroops: string;
  recipient?: string | null;
};

/** Deterministic fingerprint of the exact private payment the user authorized. */
export function privatePaymentFingerprint(material: PrivatePaymentAuthMaterial): string {
  const recipient = material.recipient?.trim() ?? '';
  return [
    material.operation,
    material.poolContract.trim(),
    material.amountStroops.trim(),
    recipient,
  ].join('|');
}

export function assertAuthorizationFingerprint(
  material: PrivatePaymentAuthMaterial,
  provided: string | undefined | null,
): void {
  const expected = privatePaymentFingerprint(material);
  if (!provided || provided !== expected) {
    throw new Error(
      'Autorización inválida o desactualizada: los detalles no coinciden con lo autorizado.',
    );
  }
}

type GuardState = {
  inFlight: Set<string>;
  recent: Map<string, number>;
};

const globalGuard: GuardState = {
  inFlight: new Set(),
  recent: new Map(),
};

const RECENT_TTL_MS = 15_000;

/**
 * Acquire exclusive execution for a fingerprint. Rejects duplicates while in-flight
 * or within a short post-success window (stale double-submit).
 */
export function beginPrivatePaymentExecution(
  fingerprint: string,
  now = Date.now(),
  state: GuardState = globalGuard,
): { release: (opts?: { completed?: boolean; reconcile?: boolean }) => void } {
  for (const [key, at] of state.recent) {
    if (now - at > RECENT_TTL_MS) state.recent.delete(key);
  }
  if (state.inFlight.has(fingerprint)) {
    throw new Error('Ya hay un pago privado en curso con los mismos detalles (duplicado).');
  }
  const recentAt = state.recent.get(fingerprint);
  if (recentAt !== undefined && now - recentAt < RECENT_TTL_MS) {
    throw new Error(
      'Pago privado duplicado rechazado: la misma operación se envió hace unos segundos.',
    );
  }
  state.inFlight.add(fingerprint);
  return {
    release: (opts) => {
      state.inFlight.delete(fingerprint);
      if (opts?.completed || opts?.reconcile) state.recent.set(fingerprint, Date.now());
    },
  };
}

/** Test helper — clears process-local guard state. */
export function resetPrivatePaymentExecutionGuardForTests(state: GuardState = globalGuard): void {
  state.inFlight.clear();
  state.recent.clear();
}
