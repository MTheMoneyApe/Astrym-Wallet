/**
 * Harness-only barrel — Fase 2.19 partial semantic validator.
 * Do NOT re-export from packages/wallet-core/src.
 */

export type {
  BlockedSppOp,
  ExpectedDestination,
  ExpectedSemanticIntent,
  ExtractedTransactFacts,
  FieldVerdict,
  OperationEvidence,
  SafetyClaim,
  SemanticClassification,
  SemanticValidationResult,
  SemanticValidationStatus,
  VerifiableSppOp,
} from './types.js';

export {
  ExtractError,
  extractTransactFacts,
  i128PartsToBigInt,
  i256PartsToBigInt,
  scValToXdrBase64,
  type ExtractErrorCode,
} from './extract.js';

export {
  validateSemanticConcordance,
  type ValidateSemanticOptions,
} from './validate.js';

export { assertResultBoundTo, computeBindingId } from './binding.js';

export {
  REQUIRED_SAFETY_CLAIM,
  SURFACE_SUCCESS_CLASSIFICATION,
  acceptAsFullProtocolSafety,
  acceptByLegacyStatusAlone,
  acceptSurfaceVerification,
  legacyVerifiableCompleteMeaning,
  parseValidationResult,
  type ContractAcceptErr,
  type ContractAcceptOk,
} from './contract.js';

export {
  FIXTURE_ACCOUNT,
  FIXTURE_ACCOUNT_2,
  FIXTURE_NETWORK,
  FIXTURE_POOL,
  FIXTURE_TOKEN,
  buildAuthEntryXdr,
  buildDepositEvidence,
  buildExtDataScVal,
  buildTransactTxXdr,
  buildTransactTxXdrWithExtraOp,
  buildWithdrawEvidence,
  dummyProofScVal,
} from './fixtures.js';
