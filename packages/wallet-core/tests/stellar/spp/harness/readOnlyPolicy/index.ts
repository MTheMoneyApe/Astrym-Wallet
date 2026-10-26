/**
 * Harness-only barrel — Fase 2.24 read-only allowlist.
 * Do NOT re-export from packages/wallet-core/src.
 */

export { DecisionLog, type DecisionLogEntry } from './decisionLog.js';
export {
  authorizeReadOnlyCall,
  isAllowedMethod,
  isHarnessLoopbackRpcUrl,
  listAllowedMethods,
  listExplicitDenials,
  readOnlyGateStatus,
} from './policy.js';
export {
  createFakeReadOnlyHandlers,
  createSideEffectRecorder,
  executeReadOnlyCall,
  type ExecuteResult,
  type ReadOnlyHandlers,
  type SideEffectRecorder,
} from './execute.js';
export {
  G8_HOST_STATUS,
  G9_CONFIG_STATUS,
  type PolicyDecision,
  type ReadOnlyAllowedMethod,
  type ReadOnlyCallRequest,
  type ReadOnlyClientNewArgs,
  type ReadOnlyDeniedMethod,
  type ReadOnlyMethod,
  type ReadOnlyStorageOpenArgs,
} from './types.js';

export {
  assessG8G9,
  G8_ASSESSMENT,
  G9_ASSESSMENT,
  type GateAssessment,
  type GateVerdict,
} from './gates.js';

export {
  BLOCKED_DUE_TO_TRANSITIVE_EFFECTS,
  RO1_SDK_CALL_GRAPHS,
  type CallGraphNode,
  type EvidenceClass,
  type Ro1MethodAudit,
} from './sdkCallGraph.js';

export {
  classifyNetworkTarget,
  installNetworkGuard,
  type NetworkAttempt,
  type NetworkAttemptKind,
  type NetworkGuard,
  type NetworkGuardSnapshot,
} from './networkGuard.js';

export {
  createReadOnlySession,
  type CreateSessionResult,
  type ReadOnlyClientHandle,
  type ReadOnlySession,
  type ReadOnlySessionConfig,
  type SessionOpResult,
  type SessionState,
} from './readOnlySession.js';
