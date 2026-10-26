/**
 * Harness-only barrel for Fase 2.15–2.17 ApprovedIntent offline model.
 * Do NOT re-export from packages/wallet-core/src.
 */

export {
  APPROVED_INTENT_SCHEMA_VERSION,
  IntentTransitionError,
  type ApprovedIntent,
  type AssetRef,
  type Clock,
  type DestinationRef,
  type DigestFn,
  type DigestHex,
  type ExactAmount,
  type FeeLine,
  type IntentDigests,
  type IntentStatus,
  type IntentTerminalStatus,
  type SppIntentOp,
  type TransitionErrorCode,
  type UnknownCritical,
} from './types.js';

export {
  assertAmountShape,
  assertDecimals,
  assertExactUnits,
  unitsEqual,
} from './amount.js';

export {
  computeOperationDigest,
  computePlanDigest,
  encodePlanPayload,
  isDigestHex,
} from './planDigest.js';

export {
  assertAuthorizationId,
  assertNoUnknownCritical,
  assertOperationDigestConcordance,
  assertPlanDigestConcordance,
  freezeIntent,
  intentFingerprint,
  validateApprovedIntentStructure,
  type ValidationResult,
} from './validate.js';

export { INTENT_LIMITS, type IntentLimits } from './limits.js';

export {
  IntentStore,
  allowedTransitions,
  createIntentStore,
  createMemoryIntentIdRegistry,
  type ConsumeAttemptResult,
  type CreateInStoreArgs,
  type IntentIdRegistry,
  type IntentRecord,
} from './stateMachine.js';

export {
  asDigestFn,
  assertTrustedDigestFn,
  probeDigestFnNotConstant,
  wrapSha256AsTrusted,
  type DigestFnProbeResult,
  type TrustedDigestCheck,
  type TrustedDigestFn,
  type TrustedDigestHex,
} from './digestSecurity.js';
