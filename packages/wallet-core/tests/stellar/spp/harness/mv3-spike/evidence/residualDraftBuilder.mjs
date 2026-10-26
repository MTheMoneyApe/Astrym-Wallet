/**
 * Assisted residual evidence draft builder.
 * Rejects incomplete / inferred-zero claims. Node + browser safe (no Chrome APIs).
 */
import { assessPostCloseProof, assessNestedWorkers } from './g9ResidualCriteria.mjs';

/**
 * @typedef {'full_window'|'partial'|'none'|'unknown'} Visibility
 */

/**
 * @param {object} input
 * @returns {{ ok: true, draft: object } | { ok: false, code: string, errors: string[], draft: null }}
 */
export function buildResidualDraft(input) {
  const errors = [];
  const startedAt = input?.startedAt;
  const endedAt = input?.endedAt;
  const observeWindowMs = Number(input?.observeWindowMs);

  if (typeof startedAt !== 'string' || !startedAt) errors.push('startedAt required (ISO)');
  if (typeof endedAt !== 'string' || !endedAt) errors.push('endedAt required (ISO)');
  if (!(observeWindowMs >= 5000)) errors.push('observeWindowMs must be ≥ 5000');

  /** @type {Visibility} */
  const networkVisibility = input?.networkVisibility || 'unknown';
  /** @type {Visibility} */
  const threadsVisibility = input?.threadsVisibility || 'unknown';

  if (!['full_window', 'partial', 'none', 'unknown'].includes(networkVisibility)) {
    errors.push('networkVisibility invalid');
  }
  if (!['full_window', 'partial', 'none', 'unknown'].includes(threadsVisibility)) {
    errors.push('threadsVisibility invalid');
  }

  // Page PerformanceObserver is optional supplementary — never sufficient alone.
  const pagePerf = input?.pagePerformanceObserver || null;
  if (pagePerf) {
    if (pagePerf.claimsFullNetworkVisibility === true) {
      errors.push(
        'pagePerformanceObserver.claimsFullNetworkVisibility must not be true (page observer cannot see worker-only traffic)',
      );
    }
  }

  const networkRequestsObserved = input?.networkRequestsObserved;
  const liveWorkerThreadsObserved = input?.liveWorkerThreadsObserved;

  if (networkVisibility !== 'full_window') {
    if (networkRequestsObserved === 0) {
      errors.push(
        'cannot set networkRequestsObserved===0 unless networkVisibility===full_window (DevTools Network watched entire window)',
      );
    }
  } else if (typeof networkRequestsObserved !== 'number' || networkRequestsObserved < 0) {
    errors.push('networkRequestsObserved must be a number ≥ 0 when networkVisibility===full_window');
  }

  if (threadsVisibility !== 'full_window') {
    if (liveWorkerThreadsObserved === 0) {
      errors.push(
        'cannot set liveWorkerThreadsObserved===0 unless threadsVisibility===full_window (Sources Threads watched entire window)',
      );
    }
  } else if (typeof liveWorkerThreadsObserved !== 'number' || liveWorkerThreadsObserved < 0) {
    errors.push('liveWorkerThreadsObserved must be a number ≥ 0 when threadsVisibility===full_window');
  }

  // Nested: host wrapper emptiness is never enough
  if (input?.inferNoNestedFromHostWrapper === true) {
    errors.push(
      'inferNoNestedFromHostWrapper forbidden — window.Worker wrapper cannot see DedicatedWorker-inner Worker()',
    );
  }

  const workersObserved = Array.isArray(input?.workersObserved) ? input.workersObserved : null;
  if (threadsVisibility === 'full_window' && !workersObserved) {
    errors.push('workersObserved array required when threadsVisibility===full_window');
  }

  const detectionMethod = input?.detectionMethod || null;
  if (!detectionMethod || typeof detectionMethod !== 'object') {
    errors.push('detectionMethod required ({ network, threads })');
  } else {
    if (typeof detectionMethod.network !== 'string' || !detectionMethod.network) {
      errors.push('detectionMethod.network required');
    }
    if (typeof detectionMethod.threads !== 'string' || !detectionMethod.threads) {
      errors.push('detectionMethod.threads required');
    }
    if (/host.?wrapper|window\.Worker alone/i.test(detectionMethod.threads)) {
      errors.push('detectionMethod.threads must not claim host wrapper alone');
    }
  }

  const wantAbsence = input?.intendAbsenseDemonstrated === true;
  const wantNestedPass = input?.intendNestedNoOutsideRegistry === true;

  if (wantAbsence) {
    if (networkVisibility !== 'full_window' || threadsVisibility !== 'full_window') {
      errors.push('ABSENCE_DEMONSTRATED intent requires full_window visibility for network AND threads');
    }
    if (networkRequestsObserved !== 0 || liveWorkerThreadsObserved !== 0) {
      errors.push('ABSENCE_DEMONSTRATED intent requires both observed counts === 0');
    }
  }

  if (wantNestedPass) {
    if (threadsVisibility !== 'full_window') {
      errors.push('nested NO_NESTED intent requires threadsVisibility===full_window');
    }
    if (input?.wasmGlueNewWorkerRuledOut !== true) {
      errors.push(
        'nested NO_NESTED intent requires explicit wasmGlueNewWorkerRuledOut===true (operator justification; not inferred from static glue)',
      );
    }
    if (!input?.nestedMethod || !['devtools_sources_threads', 'cdp_target_gettargets_workers'].includes(input.nestedMethod)) {
      errors.push('nestedMethod must be an allowlisted runtime method');
    }
  }

  if (errors.length) {
    return { ok: false, code: 'INCOMPLETE_OR_INVALID', errors, draft: null };
  }

  const draft = {
    kind: 'residual-observation-draft',
    phase: '2.36',
    createdAt: new Date().toISOString(),
    window: { startedAt, endedAt, observeWindowMs },
    visibility: { network: networkVisibility, threads: threadsVisibility },
    detectionMethod,
    networkRequestsObserved:
      networkVisibility === 'full_window' ? networkRequestsObserved : null,
    liveWorkerThreadsObserved:
      threadsVisibility === 'full_window' ? liveWorkerThreadsObserved : null,
    workersObserved: workersObserved,
    pagePerformanceObserver: pagePerf
      ? {
          ...pagePerf,
          scope: 'extension_page_only',
          limitation:
            'Does not include DedicatedWorker-internal fetch/XHR; must not justify networkRequestsObserved===0 alone',
        }
      : null,
    observabilityLimits: [
      'Page PerformanceObserver ≠ full network visibility',
      'Host Worker registry ≠ nested Worker visibility',
      'Static wasm-bindgen new Worker( glue ≠ runtime nested spawn proof',
    ],
    dataProvenance: {
      network:
        networkVisibility === 'full_window'
          ? detectionMethod.network
          : `not_claimed (visibility=${networkVisibility})`,
      threads:
        threadsVisibility === 'full_window'
          ? detectionMethod.threads
          : `not_claimed (visibility=${threadsVisibility})`,
      pagePerf: pagePerf ? 'host_page_PerformanceObserver' : 'none',
    },
    postClose: null,
    nestedWorkers: null,
    gatePreview: null,
  };

  if (wantAbsence) {
    draft.postClose = {
      classification: 'ABSENCE_DEMONSTRATED',
      proof: {
        observeWindowMs,
        networkRequestsObserved,
        liveWorkerThreadsObserved,
        technique: 'devtools_network_and_threads',
        recordedAt: endedAt,
      },
    };
  } else if (networkVisibility === 'full_window' || threadsVisibility === 'full_window') {
    draft.postClose = {
      classification:
        networkRequestsObserved > 0 || liveWorkerThreadsObserved > 0
          ? 'ACTIVITY_OBSERVED'
          : 'NO_ACTIVITY_OBSERVED',
      note:
        'Draft without ABSENCE intent — evaluator treats NO_ACTIVITY_OBSERVED as INSUFFICIENT_EVIDENCE',
      partialProof: {
        observeWindowMs,
        networkVisibility,
        threadsVisibility,
        networkRequestsObserved: draft.networkRequestsObserved,
        liveWorkerThreadsObserved: draft.liveWorkerThreadsObserved,
      },
    };
  } else {
    draft.postClose = {
      classification: 'NOT_DEMONSTRATED',
      note: 'Insufficient DevTools visibility declared',
    };
  }

  if (wantNestedPass) {
    draft.nestedWorkers = {
      runtimeObservation: 'NO_NESTED_OUTSIDE_REGISTRY',
      method: input.nestedMethod,
      proof: {
        observedAt: endedAt,
        threadsSeen: workersObserved,
        wasmGlueNewWorkerRuledOut: true,
        operatorJustification: input.nestedJustification || null,
      },
    };
  } else {
    draft.nestedWorkers = {
      runtimeObservation: 'NOT_DEMONSTRATED',
      note: 'Nested not claimed — static glue may still allow spawn; host wrapper is insufficient',
    };
  }

  draft.gatePreview = {
    postCloseAbsence: assessPostCloseProof(draft.postClose),
    nestedWorkers: assessNestedWorkers(draft.nestedWorkers, input.staticAudit || null),
  };

  // Final reject if preview still insufficient while operator intended PASS
  if (wantAbsence && draft.gatePreview.postCloseAbsence.status !== 'PASS') {
    return {
      ok: false,
      code: 'PREVIEW_REJECTED',
      errors: [`postClose preview: ${draft.gatePreview.postCloseAbsence.detail}`],
      draft: null,
    };
  }
  if (wantNestedPass && draft.gatePreview.nestedWorkers.status !== 'PASS') {
    return {
      ok: false,
      code: 'PREVIEW_REJECTED',
      errors: [`nested preview: ${draft.gatePreview.nestedWorkers.detail}`],
      draft: null,
    };
  }

  return { ok: true, draft };
}
