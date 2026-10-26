/**
 * Fase 2.32 — Classic DedicatedWorker negative probe (.invalid only).
 * CSP for this script (if any) comes from the HTTP response that served it —
 * NOT automatically from the creating document (Chromium / HTML policy container).
 */
/* eslint-disable no-restricted-globals */

const INVALID = 'https://ro1-csp-probe.invalid/worker-lifecycle';

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  const violations = [];
  const onViol = (e) => {
    violations.push({
      at: new Date().toISOString(),
      effectiveDirective: e.effectiveDirective,
      violatedDirective: e.violatedDirective,
      blockedURI: e.blockedURI,
      disposition: e.disposition,
      originalPolicy: e.originalPolicy,
      sourceFile: e.sourceFile,
    });
  };
  try {
    self.addEventListener('securitypolicyviolation', onViol);
  } catch {
    /* ignore */
  }

  const out = {
    experiment: msg.experiment || 'classic',
    at: new Date().toISOString(),
    realm: 'DedicatedWorkerGlobalScope',
    workerType: 'classic',
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
      out.local = {
        status: 'failed',
        message: e && e.message ? String(e.message) : String(e),
      };
    }
  }

  const before = violations.length;
  try {
    await self.fetch(INVALID, { cache: 'no-store', mode: 'cors' });
    out.invalid = { status: 'REACHED' };
  } catch (e) {
    out.invalid = {
      status: 'failed',
      message: e && e.message ? String(e.message) : String(e),
      name: e && e.name ? e.name : undefined,
    };
  }
  await new Promise((r) => setTimeout(r, 100));

  const related = violations.slice(before).filter((v) => {
    const uri = String(v.blockedURI || '');
    const dir = String(v.effectiveDirective || v.violatedDirective || '');
    return uri.includes('.invalid') || dir.includes('connect');
  });

  if (out.invalid.status === 'REACHED') {
    out.classification.invalid = 'FAIL';
  } else if (related.length > 0) {
    out.classification.invalid = 'PASS_CSP_CONFIRMED';
    out.classification.policySource = 'worker-script-response-or-inherited-blob';
  } else {
    out.classification.invalid = 'NO DEMOSTRADO_CSP';
    out.classification.note =
      'Fetch failed without SecurityPolicyViolationEvent — DNS/network or CSP without reportable event';
  }

  self.postMessage(out);
};
