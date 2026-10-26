/**
 * Fase 2.25 — G8 / G9 verdict helpers (harness documentation).
 *
 * Harness tests MUST NOT elevate these to PASS.
 */

export type GateVerdict = 'PASS' | 'FAIL' | 'NO_DEMOSTRADO';

export type GateAssessment = {
  id: 'G8' | 'G9';
  title: string;
  invariant: string;
  requiredEvidence: string[];
  harnessCanProvide: string[];
  remainingGap: string[];
  verdict: GateVerdict;
  rationale: string;
};

export const G8_ASSESSMENT: GateAssessment = {
  id: 'G8',
  title: 'Read path of real integration never activates forbidden ops (FASE-2.26)',
  invariant:
    'On the real integration read path (extension host + SPP 0.2.1), RO operations do not invoke sync, prove, sign, send, or pool mutators — evidenced by instrumentation of the actual host, not only harness fakes.',
  requiredEvidence: [
    'Extension (or durable host) runs aspState/allContractsData against allowlisted RPC',
    'RPC/method logs show only getLedgerEntries (plus documented init)',
    'No sync/backgroundSync/sign/send/deposit observed on that path',
    'RO policy / ReadOnlySession (or successor) wraps all IPC to SPP',
  ],
  harnessCanProvide: [
    'SRC call graphs (2.25) + fake ReadOnlySession side-effect recorder (2.26)',
    'Historical browser OBS for aspState/allContractsData (2.9/2.12)',
  ],
  remainingGap: [
    'No packages/extension SPP host wiring',
    'Fake handlers ≠ real WASM Client in extension',
    'ReadOnlySession is not a sandbox against same-realm code',
  ],
  verdict: 'FAIL',
  rationale:
    'Harness ReadOnlySession proofs are necessary rehearsal, not real-integration evidence → FAIL.',
};

export const G9_ASSESSMENT: GateAssessment = {
  id: 'G9',
  title: 'Effective network/runtime/capability isolation of execution host (FASE-2.26)',
  invariant:
    'The execution host enforces network allowlisting, denies external transports, and confines SPP capabilities so the host cannot silently sign/send; coverage includes transports the SDK actually uses.',
  requiredEvidence: [
    'Host-level network policy (not only Vitest patches) for the SPP document',
    'Instrumented proof that SPP RPC stays on allowlisted endpoints',
    'Documented residual: WASM/worker sockets NO_DEMOSTRADO or mitigated',
    'Pinned config + no Nym-SPP privacy claim',
  ],
  harnessCanProvide: [
    'Node networkGuard for fetch/http/https (+ WS/ES if present)',
    'Literal loopback rpcUrl policy',
  ],
  remainingGap: [
    'Guard does not see WASM-native sockets',
    'Worker-internal network NO_DEMOSTRADO',
    'No extension host CSP/network policy applied',
  ],
  verdict: 'FAIL',
  rationale:
    'Partial Node instrumentation ≠ host isolation. Extension host absent → FAIL.',
};

export function assessG8G9(): { G8: GateAssessment; G9: GateAssessment } {
  return { G8: G8_ASSESSMENT, G9: G9_ASSESSMENT };
}
