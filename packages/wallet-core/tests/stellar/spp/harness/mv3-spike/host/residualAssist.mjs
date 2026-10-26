/**
 * Page-realm residual assist: PerformanceObserver (page only) + draft builder input.
 * Never claims full network or nested-worker visibility.
 */
import { buildResidualDraft } from '../evidence/residualDraftBuilder.mjs';

/**
 * Start page-only resource timing observation after close.
 * @param {number} windowMs
 */
export function startPageOnlyNetworkWatch(windowMs = 8000) {
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  /** @type {PerformanceEntry[]} */
  const entries = [];
  let observer = null;

  if (typeof PerformanceObserver === 'function') {
    try {
      observer = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) entries.push(e);
      });
      observer.observe({ type: 'resource', buffered: true });
    } catch {
      observer = null;
    }
  }

  return {
    startedAt,
    windowMs,
    stop() {
      const endedAt = new Date().toISOString();
      const elapsedMs = Math.round(performance.now() - t0);
      try {
        observer?.disconnect();
      } catch {
        /* ignore */
      }
      return {
        startedAt,
        endedAt,
        elapsedMs,
        pageResourceEntries: entries.length,
        names: entries.slice(0, 50).map((e) => e.name),
        claimsFullNetworkVisibility: false,
        scope: 'extension_page_only',
        limitation:
          'Page PerformanceObserver does not observe DedicatedWorker-internal network; zeros here must not set networkRequestsObserved===0',
      };
    },
  };
}

/**
 * Build draft from form values; returns builder result.
 * @param {object} form
 */
export function buildDraftFromAssistForm(form) {
  return buildResidualDraft({
    startedAt: form.startedAt,
    endedAt: form.endedAt,
    observeWindowMs: Number(form.observeWindowMs),
    networkVisibility: form.networkVisibility,
    threadsVisibility: form.threadsVisibility,
    networkRequestsObserved:
      form.networkRequestsObserved === '' || form.networkRequestsObserved == null
        ? undefined
        : Number(form.networkRequestsObserved),
    liveWorkerThreadsObserved:
      form.liveWorkerThreadsObserved === '' || form.liveWorkerThreadsObserved == null
        ? undefined
        : Number(form.liveWorkerThreadsObserved),
    workersObserved: form.workersObservedText
      ? String(form.workersObservedText)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : null,
    detectionMethod: {
      network: form.detectionNetwork || '',
      threads: form.detectionThreads || '',
    },
    pagePerformanceObserver: form.pagePerf || null,
    intendAbsenseDemonstrated: form.intendAbsence === true,
    intendNestedNoOutsideRegistry: form.intendNested === true,
    wasmGlueNewWorkerRuledOut: form.wasmGlueRuledOut === true,
    nestedMethod: form.nestedMethod || 'devtools_sources_threads',
    nestedJustification: form.nestedJustification || null,
    staticAudit: form.staticAudit || null,
    inferNoNestedFromHostWrapper: form.inferNoNestedFromHostWrapper === true,
  });
}
