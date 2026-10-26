/**
 * Fase 2.32 — Module DedicatedWorker negative probe (.invalid only).
 * Same logic as classic; served as type: 'module'. CSP from this script's response headers.
 */
/* eslint-disable no-restricted-globals */

const INVALID = 'https://ro1-csp-probe.invalid/worker-lifecycle-module';

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  const violations = [];
  try {
    self.addEventListener('securitypolicyviolation', (e) => {
      violations.push({
        at: new Date().toISOString(),
        effectiveDirective: e.effectiveDirective,
        violatedDirective: e.violatedDirective,
        blockedURI: e.blockedURI,
        disposition: e.disposition,
        originalPolicy: e.originalPolicy,
      });
    });
  } catch {
    /* ignore */
  }

  const out = {
    experiment: msg.experiment || 'module',
    at: new Date().toISOString(),
    realm: 'DedicatedWorkerGlobalScope',
    workerType: 'module',
    locationHref: self.location && self.location.href,
    fetchAvailable: typeof self.fetch === 'function',
    local: null,
    invalid: null,
    violations,
    classification: {},
  };

  if (msg.localUrl) {
    try {
      const res = await self.fetch(msg.localUrl, { cache: 'no-store' });
      out.local = { status: 'observed_local', http: res.status };
    } catch (e) {
      out.local = { status: 'failed', message: String(e && e.message ? e.message : e) };
    }
  }

  const before = violations.length;
  try {
    await self.fetch(INVALID, { cache: 'no-store', mode: 'cors' });
    out.invalid = { status: 'REACHED' };
  } catch (e) {
    out.invalid = {
      status: 'failed',
      message: String(e && e.message ? e.message : e),
      name: e && e.name ? e.name : undefined,
    };
  }
  await new Promise((r) => setTimeout(r, 100));
  const related = violations.slice(before).filter((v) => {
    const uri = String(v.blockedURI || '');
    return uri.includes('.invalid') || String(v.effectiveDirective || '').includes('connect');
  });

  if (out.invalid.status === 'REACHED') out.classification.invalid = 'FAIL';
  else if (related.length > 0) {
    out.classification.invalid = 'PASS_CSP_CONFIRMED';
    out.classification.policySource = 'module-worker-script-response';
  } else {
    out.classification.invalid = 'NO DEMOSTRADO_CSP';
    out.classification.note =
      'Fetch failed without SecurityPolicyViolationEvent';
  }

  self.postMessage(out);
};
