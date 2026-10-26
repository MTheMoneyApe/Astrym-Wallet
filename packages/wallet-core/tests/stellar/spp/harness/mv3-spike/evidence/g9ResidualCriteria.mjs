/**
 * Fase 2.36 — Exact residual conditions for G9 post-close + nested workers.
 * Documentation-as-code. Does not claim Chrome results.
 */

/** @type {readonly string[]} */
export const POST_CLOSE_ABSENCE_REQUIRED = Object.freeze([
  'Host emergencyClose already recorded (registered workers terminateCalls ≥ 1)',
  'Classification ABSENCE_DEMONSTRATED is insufficient alone',
  'postClose.proof.observeWindowMs ≥ 5000',
  'postClose.proof.networkRequestsObserved === 0 (DevTools Network after close)',
  'postClose.proof.liveWorkerThreadsObserved === 0 (Sources Threads / workers after close)',
  'postClose.proof.technique is an allowed observation method',
  'postClose.proof.recordedAt ISO timestamp present',
  'No claim based solely on SDK dispose() or telemetría',
]);

/** @type {readonly string[]} */
export const NESTED_WORKERS_REQUIRED = Object.freeze([
  'Acknowledge host window.Worker wrapper cannot see Worker() inside DedicatedWorker realms',
  'Static audit of vendor SDK_REAL scripts for new Worker( call sites (Node)',
  'If static audit finds new Worker( in worker-module glue: runtime spawn must be ruled out or observed',
  'Runtime observation (Chrome): after RO-1 and/or after close, Threads shows only expected top-level workers or none',
  'evidence.nestedWorkers.runtimeObservation + method + proof required for PASS',
  'Unregistered OrigWorker bypass remains a separate host-limitation demo (Node)',
]);

export const POST_CLOSE_PROOF_TECHNIQUES = Object.freeze([
  'devtools_network_and_threads',
  'cdp_network_and_target_workers',
]);

export const NESTED_RUNTIME_METHODS = Object.freeze([
  'devtools_sources_threads',
  'cdp_target_gettargets_workers',
]);

/**
 * Validate postClose.proof shape (does not trust classification alone).
 * @param {any} postClose
 */
export function assessPostCloseProof(postClose) {
  const classification = postClose?.classification || 'NOT_TESTED';
  if (classification === 'NOT_TESTED') {
    return { status: 'NOT_EXECUTED', detail: 'postClose.classification NOT_TESTED' };
  }
  if (classification === 'ACTIVITY_OBSERVED') {
    return { status: 'FAIL', detail: 'post-close activity observed' };
  }
  if (classification === 'NO_ACTIVITY_OBSERVED') {
    return {
      status: 'INSUFFICIENT_EVIDENCE',
      detail: 'NO_ACTIVITY_OBSERVED ≠ proven absence (runbook)',
    };
  }
  if (classification === 'NOT_DEMONSTRATED') {
    return { status: 'INSUFFICIENT_EVIDENCE', detail: 'operator marked NOT_DEMONSTRATED' };
  }
  if (classification !== 'ABSENCE_DEMONSTRATED') {
    return { status: 'INSUFFICIENT_EVIDENCE', detail: `postClose=${classification}` };
  }

  const proof = postClose?.proof;
  if (!proof || typeof proof !== 'object') {
    return {
      status: 'INSUFFICIENT_EVIDENCE',
      detail: 'ABSENCE_DEMONSTRATED without postClose.proof object',
    };
  }
  const missing = [];
  if (!(Number(proof.observeWindowMs) >= 5000)) missing.push('observeWindowMs≥5000');
  if (proof.networkRequestsObserved !== 0) missing.push('networkRequestsObserved===0');
  if (proof.liveWorkerThreadsObserved !== 0) missing.push('liveWorkerThreadsObserved===0');
  if (!POST_CLOSE_PROOF_TECHNIQUES.includes(proof.technique)) missing.push('technique');
  if (typeof proof.recordedAt !== 'string' || !proof.recordedAt) missing.push('recordedAt');
  if (missing.length) {
    return {
      status: 'INSUFFICIENT_EVIDENCE',
      detail: `ABSENCE_DEMONSTRATED proof incomplete: ${missing.join(',')}`,
    };
  }
  return { status: 'PASS', detail: 'ABSENCE_DEMONSTRATED with complete proof schema' };
}

/**
 * Assess nestedWorkers evidence block.
 * @param {any} nested
 * @param {{ newWorkerCallSites: number } | null} [staticAudit]
 */
export function assessNestedWorkers(nested, staticAudit = null) {
  const audit = staticAudit || nested?.staticAudit || null;
  const sites = audit?.newWorkerCallSites;

  if (!nested || typeof nested !== 'object') {
    if (typeof sites === 'number' && sites > 0) {
      return {
        status: 'INSUFFICIENT_EVIDENCE',
        detail: `static audit found ${sites} new Worker( site(s) in SDK worker modules; runtime observation missing`,
      };
    }
    return {
      status: 'INSUFFICIENT_EVIDENCE',
      detail: 'nested workers outside host registry remain NOT DEMONSTRATED by design',
    };
  }

  const runtime = nested.runtimeObservation;
  if (!runtime || runtime === 'NOT_TESTED' || runtime === 'NOT_EXECUTED') {
    if (typeof sites === 'number' && sites > 0) {
      return {
        status: 'INSUFFICIENT_EVIDENCE',
        detail: `static audit found ${sites} new Worker( site(s); runtimeObservation not executed`,
      };
    }
    return {
      status: 'NOT_EXECUTED',
      detail: 'nestedWorkers.runtimeObservation not executed',
    };
  }
  if (runtime === 'NESTED_OBSERVED_OUTSIDE_REGISTRY') {
    return { status: 'FAIL', detail: 'nested worker observed outside host registry' };
  }
  if (runtime === 'NOT_DEMONSTRATED') {
    return { status: 'INSUFFICIENT_EVIDENCE', detail: 'nested runtime NOT_DEMONSTRATED' };
  }
  if (runtime !== 'NO_NESTED_OUTSIDE_REGISTRY') {
    return { status: 'INSUFFICIENT_EVIDENCE', detail: `runtimeObservation=${runtime}` };
  }

  if (!NESTED_RUNTIME_METHODS.includes(nested.method)) {
    return {
      status: 'INSUFFICIENT_EVIDENCE',
      detail: 'NO_NESTED_OUTSIDE_REGISTRY without allowed nestedWorkers.method',
    };
  }
  if (!nested.proof || typeof nested.proof !== 'object') {
    return {
      status: 'INSUFFICIENT_EVIDENCE',
      detail: 'NO_NESTED_OUTSIDE_REGISTRY without nestedWorkers.proof',
    };
  }
  if (typeof sites === 'number' && sites > 0 && nested.proof.wasmGlueNewWorkerRuledOut !== true) {
    return {
      status: 'INSUFFICIENT_EVIDENCE',
      detail:
        'SDK worker-module glue contains new Worker(; proof.wasmGlueNewWorkerRuledOut must be true to PASS',
    };
  }
  return {
    status: 'PASS',
    detail: 'NO_NESTED_OUTSIDE_REGISTRY with method+proof (and glue ruled out if present)',
  };
}
