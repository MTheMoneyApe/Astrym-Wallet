/**
 * Fase 2.36 — Validate exported evidence JSON (structure + consistency + gates).
 */
import { evaluateGates, normalizeEgressAttempts } from './evaluateGates.mjs';

/**
 * @param {any} evidence
 * @returns {{ ok: boolean, errors: string[], warnings: string[], gates: object, checks: object }}
 */
export function validateEvidence(evidence) {
  const errors = [];
  const warnings = [];
  const checks = {};

  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return {
      ok: false,
      errors: ['evidence must be a plain object'],
      warnings: [],
      gates: null,
      checks: { structure: 'FAIL' },
    };
  }

  const reqTop = ['phase', 'artifactVersion', 'sessionId', 'rpc', 'workers', 'gates', 'startedAt'];
  for (const k of reqTop) {
    if (!(k in evidence)) errors.push(`missing field: ${k}`);
  }
  checks.structure = errors.length ? 'FAIL' : 'PASS';

  if (evidence.phase !== '2.36') warnings.push(`phase=${evidence.phase} (expected 2.36)`);

  // Empty-session detection (reload / new boot without RO-1)
  const emptyRo1 =
    (!evidence.workers?.registered || evidence.workers.registered.length === 0) &&
    (!evidence.rpc?.observed || evidence.rpc.observed.length === 0);
  if (emptyRo1) {
    checks.sessionContent = 'NOT_EXECUTED';
    warnings.push(
      'workers.registered and rpc.observed empty — likely new/reloaded host session, not worker termination',
    );
  } else {
    checks.sessionContent = 'PASS';
  }

  // Consistency: ok true implies RO-1 fields
  if (evidence.ok === true && emptyRo1) {
    errors.push('ok===true but workers/rpc empty (inconsistent; possible mixed/corrupt export)');
    checks.consistency = 'FAIL';
  } else if (
    evidence.ok === true &&
    evidence.rpc?.onlyGetLedgerEntries !== true
  ) {
    errors.push('ok===true but rpc.onlyGetLedgerEntries is not true');
    checks.consistency = 'FAIL';
  } else {
    checks.consistency = errors.some((x) => x.includes('ok===')) ? 'FAIL' : 'PASS';
  }

  // Do not merge previous session into current — flag if looks mixed
  if (evidence.previousSessionId && evidence.previousSessionRecoverable === false) {
    warnings.push(
      `previousSessionId=${evidence.previousSessionId} not recoverable; do not infer prior RO-1 into this export`,
    );
  }

  const egressNorm = normalizeEgressAttempts(evidence);
  const dups = egressNorm.filter((a) => a.duplicateOf !== null);
  checks.duplicateEgress =
    dups.length === 0 ? 'PASS' : 'INSUFFICIENT_EVIDENCE';
  if (dups.length) {
    warnings.push(
      `duplicate egress rows (not counted independently): ${dups
        .map((d) => `${d.index}->${d.duplicateOf}`)
        .join(', ')}`,
    );
  }

  const gates = evaluateGates(evidence);
  checks.gatesEvaluated = 'PASS';

  // Recompute expected FAIL reasons presence
  if (!evidence.gates || evidence.gates.G8 !== gates.G8 || evidence.gates.G9 !== gates.G9) {
    warnings.push(
      `export gates G8=${evidence.gates?.G8}/G9=${evidence.gates?.G9} differ from evaluator G8=${gates.G8}/G9=${gates.G9} — prefer evaluator output`,
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    gates,
    checks,
  };
}

/**
 * CLI-friendly: validate and print JSON.
 * @param {any} evidence
 */
export function validateEvidenceReport(evidence) {
  const result = validateEvidence(evidence);
  return {
    ...result,
    summary: {
      ok: result.ok,
      G8: result.gates?.G8,
      G9: result.gates?.G9,
      emptySession: result.checks.sessionContent === 'NOT_EXECUTED',
      duplicateEgressCount: result.gates?.egressDedup?.duplicates?.length ?? 0,
    },
  };
}
