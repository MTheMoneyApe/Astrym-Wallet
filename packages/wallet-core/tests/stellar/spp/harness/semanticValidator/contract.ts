/**
 * Fase 2.21 — Authoritative result-contract guards (harness only).
 *
 * `classification` is the authoritative scope descriptor.
 * `status === 'verifiable_complete'` is a **deprecated legacy alias** and is
 * NEVER sufficient alone to accept a result or authorize signing.
 *
 * This module does NOT grant production signing authority.
 */

import { assertResultBoundTo, computeBindingId } from './binding.js';
import { validateSemanticConcordance } from './validate.js';
import type {
  ExpectedSemanticIntent,
  OperationEvidence,
  SafetyClaim,
  SemanticClassification,
  SemanticValidationResult,
  SemanticValidationStatus,
} from './types.js';

export const REQUIRED_SAFETY_CLAIM: SafetyClaim = 'not_full_protocol_safety';

export const SURFACE_SUCCESS_CLASSIFICATION: SemanticClassification =
  'surface_verified_with_opaque_remainder';

const KNOWN_CLASSIFICATIONS: ReadonlySet<string> = new Set([
  'rejected',
  'surface_verified_with_opaque_remainder',
]);

const KNOWN_STATUSES: ReadonlySet<string> = new Set([
  'rejected',
  'partial',
  'verifiable_complete',
]);

export type ContractAcceptOk = {
  ok: true;
  result: SemanticValidationResult;
  /** Always false — surface acceptance ≠ protocol safety / production sign-off. */
  fullProtocolSafety: false;
  /** Always false — harness must not treat this as a signing grant. */
  authorizesSigning: false;
};

export type ContractAcceptErr = { ok: false; reason: string };

/**
 * Shape + consistency check. Does not bind to intent/evidence.
 * Missing classification / safetyClaim → fail closed (never “pass by absence”).
 */
export function parseValidationResult(value: unknown): ContractAcceptOk | ContractAcceptErr {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'result is not an object' };
  }
  const r = value as Record<string, unknown>;

  if (!('classification' in r) || r.classification === undefined || r.classification === null) {
    return { ok: false, reason: 'missing authoritative classification' };
  }
  if (typeof r.classification !== 'string' || !KNOWN_CLASSIFICATIONS.has(r.classification)) {
    return { ok: false, reason: `unknown or invalid classification: ${String(r.classification)}` };
  }

  if (!('safetyClaim' in r) || r.safetyClaim === undefined || r.safetyClaim === null) {
    return { ok: false, reason: 'missing safetyClaim (absence is not a positive guarantee)' };
  }
  if (r.safetyClaim !== REQUIRED_SAFETY_CLAIM) {
    return {
      ok: false,
      reason: `safetyClaim must be "${REQUIRED_SAFETY_CLAIM}" (got ${String(r.safetyClaim)})`,
    };
  }

  if (!('status' in r) || typeof r.status !== 'string' || !KNOWN_STATUSES.has(r.status)) {
    return { ok: false, reason: `missing or unknown legacy status: ${String(r.status)}` };
  }

  if (!('bindingId' in r) || typeof r.bindingId !== 'string' || !/^[0-9a-f]{64}$/.test(r.bindingId)) {
    return { ok: false, reason: 'missing or malformed bindingId' };
  }

  if (!Array.isArray(r.verifiedFields) || !Array.isArray(r.unverifiedFields)) {
    return { ok: false, reason: 'verifiedFields/unverifiedFields must be arrays' };
  }
  if (!Array.isArray(r.rejectionReasons) || !Array.isArray(r.fieldVerdicts)) {
    return { ok: false, reason: 'rejectionReasons/fieldVerdicts must be arrays' };
  }
  if (typeof r.summary !== 'string') {
    return { ok: false, reason: 'summary must be a string' };
  }

  const classification = r.classification as SemanticClassification;
  const status = r.status as SemanticValidationStatus;

  // Consistency: legacy status must not contradict classification.
  if (classification === 'rejected') {
    if (status !== 'rejected') {
      return {
        ok: false,
        reason: 'inconsistent result: classification rejected but legacy status is not rejected',
      };
    }
  } else if (classification === 'surface_verified_with_opaque_remainder') {
    if (status !== 'verifiable_complete') {
      return {
        ok: false,
        reason:
          'inconsistent result: surface classification requires legacy status verifiable_complete (alias only)',
      };
    }
    if (!Array.isArray(r.unverifiedFields) || r.unverifiedFields.length === 0) {
      return {
        ok: false,
        reason:
          'surface_verified_with_opaque_remainder requires non-empty unverifiedFields (opaque remainder)',
      };
    }
  }

  return {
    ok: true,
    result: r as unknown as SemanticValidationResult,
    fullProtocolSafety: false,
    authorizesSigning: false,
  };
}

/**
 * Anti-pattern: accepting solely because `status === 'verifiable_complete'`.
 * Always returns not-ok — legacy status is never an authorization condition.
 */
export function acceptByLegacyStatusAlone(status: unknown): ContractAcceptErr {
  void status;
  return {
    ok: false,
    reason:
      'legacy status alone is not authoritative (verifiable_complete is a deprecated alias; use acceptSurfaceVerification)',
  };
}

/**
 * Anti-pattern: treating surface verification as full protocol safety.
 */
export function acceptAsFullProtocolSafety(_result: unknown): ContractAcceptErr {
  void _result;
  return {
    ok: false,
    reason:
      'prototype never attests full protocol safety (proof/ciphertext/transfer-to-keys/multi-tx remain out of scope)',
  };
}

/**
 * Sole harness helper that may treat a result as “surface verified for further
 * offline harness steps”. Still sets authorizesSigning: false.
 *
 * Requires: parseValidationResult + classification surface + binding + op match
 * + live re-validation (rejects forged success / post-hoc mutation).
 */
export function acceptSurfaceVerification(
  value: unknown,
  intent: ExpectedSemanticIntent,
  evidence: OperationEvidence,
): ContractAcceptOk | ContractAcceptErr {
  const parsed = parseValidationResult(value);
  if (!parsed.ok) return parsed;

  const { result } = parsed;

  if (result.classification === 'rejected') {
    return { ok: false, reason: 'rejected results cannot be accepted as surface verification' };
  }

  if (result.classification !== SURFACE_SUCCESS_CLASSIFICATION) {
    return {
      ok: false,
      reason: `classification ${result.classification} is not surface success`,
    };
  }

  if (result.safetyClaim !== REQUIRED_SAFETY_CLAIM) {
    return { ok: false, reason: 'safetyClaim missing or not not_full_protocol_safety' };
  }

  if (result.rejectionReasons.length > 0) {
    return {
      ok: false,
      reason: 'rejectionReasons non-empty: cannot accept as surface verification',
    };
  }

  const bound = assertResultBoundTo(result, intent, evidence);
  if (!bound.ok) return bound;

  // Defense in depth: binding includes op, but state mismatch explicitly.
  if (intent.op !== 'deposit' && intent.op !== 'withdraw') {
    return { ok: false, reason: 'intent op is not a verifiable surface op' };
  }
  // Cross-op misuse: deposit result object presented with withdraw intent (binding fails),
  // or extracted facts contradict intent op sign of amount when present.
  if (result.extracted) {
    if (intent.op === 'deposit' && result.extracted.extAmount <= 0n) {
      return { ok: false, reason: 'extracted extAmount incompatible with deposit intent' };
    }
    if (intent.op === 'withdraw' && result.extracted.extAmount >= 0n) {
      return { ok: false, reason: 'extracted extAmount incompatible with withdraw intent' };
    }
  }

  if (result.bindingId !== computeBindingId(intent, evidence)) {
    return { ok: false, reason: 'bindingId mismatch after parse' };
  }

  // Live re-validation: a forged "success" for a failing pair (or mutated clone)
  // must not pass merely because bindingId matches intent+evidence identity.
  const live = validateSemanticConcordance(intent, evidence);
  if (live.classification !== SURFACE_SUCCESS_CLASSIFICATION) {
    return {
      ok: false,
      reason: 'live re-validation is not surface success (forged or stale success rejected)',
    };
  }
  if (live.bindingId !== result.bindingId) {
    return { ok: false, reason: 'presented bindingId diverges from live re-validation' };
  }
  if (live.safetyClaim !== result.safetyClaim) {
    return { ok: false, reason: 'presented safetyClaim diverges from live re-validation' };
  }

  return {
    ok: true,
    result,
    fullProtocolSafety: false,
    authorizesSigning: false,
  };
}

/**
 * Document that `verifiable_complete` is non-authoritative.
 */
export function legacyVerifiableCompleteMeaning(): {
  authoritative: false;
  aliasOf: typeof SURFACE_SUCCESS_CLASSIFICATION;
  authorizesSigning: false;
  fullProtocolSafety: false;
} {
  return {
    authoritative: false,
    aliasOf: SURFACE_SUCCESS_CLASSIFICATION,
    authorizesSigning: false,
    fullProtocolSafety: false,
  };
}
