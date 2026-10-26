/**
 * Explicit input bounds for offline ApprovedIntent (Fase 2.17).
 *
 * Rationale: bound DoS/memory from narrative fields and ids while never
 * silently truncating amount, destination, asset, or digests (those fail closed).
 */

export const INTENT_LIMITS = {
  /** Min intentId length (non-trivial wallet-generated id). */
  intentIdMin: 8,
  /** Max intentId — UUID/ULID-scale, not free-form essays. */
  intentIdMax: 128,
  authorizationIdMin: 8,
  authorizationIdMax: 128,
  /** Stellar network passphrase strings are short; cap abuse. */
  networkPassphraseMax: 256,
  /** Human-readable bullets for UI — not unbounded blobs. */
  narrativeStringMax: 2_048,
  /** Cap list sizes to keep validation/plan encoding bounded. */
  maxPublicEffects: 32,
  maxPrivacyLimits: 32,
  maxFees: 8,
  maxUnknownCritical: 16,
  unknownCriticalReasonMax: 512,
  feeNoteMax: 2_048,
  /** Asset symbol/code display fields. */
  assetSymbolMax: 32,
  assetCodeMax: 12,
} as const;

export type IntentLimits = typeof INTENT_LIMITS;
