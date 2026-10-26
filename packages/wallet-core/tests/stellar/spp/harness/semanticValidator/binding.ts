/**
 * Binding helpers — prevent treating a validation result as portable proof
 * for a different intent or evidence blob (Fase 2.20).
 */

import { sha256 } from '@noble/hashes/sha2.js';
import type {
  ExpectedSemanticIntent,
  OperationEvidence,
  SemanticValidationResult,
} from './types.js';

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

function stableIntentPayload(intent: ExpectedSemanticIntent): string {
  return [
    intent.op,
    intent.account,
    intent.networkPassphrase,
    intent.poolContractId,
    intent.tokenContractId,
    intent.amountUnits,
    String(intent.planTxCount),
    JSON.stringify(intent.destination),
  ].join('|');
}

function stableEvidencePayload(evidence: OperationEvidence): string {
  return [
    evidence.networkPassphrase,
    evidence.transactionXdr,
    evidence.authEntryXdrs.join(','),
  ].join('|');
}

/** Deterministic binding id for (intent, evidence). Not a MAC — harness only. */
export function computeBindingId(
  intent: ExpectedSemanticIntent,
  evidence: OperationEvidence,
): string {
  const material = `${stableIntentPayload(intent)}::${stableEvidencePayload(evidence)}`;
  return hex(sha256(new TextEncoder().encode(material)));
}

/**
 * Returns true only if `result.bindingId` matches this intent+evidence pair.
 * Binding alone does NOT authorize signing — use {@link acceptSurfaceVerification}.
 */
export function assertResultBoundTo(
  result: SemanticValidationResult,
  intent: ExpectedSemanticIntent,
  evidence: OperationEvidence,
): { ok: true } | { ok: false; reason: string } {
  if (typeof result.bindingId !== 'string' || result.bindingId.length === 0) {
    return { ok: false, reason: 'result has no bindingId (cannot prove binding)' };
  }
  const expected = computeBindingId(intent, evidence);
  if (result.bindingId !== expected) {
    return {
      ok: false,
      reason: 'result.bindingId does not match this intent+evidence (reuse / mix detected)',
    };
  }
  return { ok: true };
}
