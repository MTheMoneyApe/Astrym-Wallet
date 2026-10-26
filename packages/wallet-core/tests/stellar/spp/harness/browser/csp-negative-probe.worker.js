/**
 * Fase 2.31 — Worker negative network probe (.invalid only).
 * Distinguishes CSP violation vs generic fetch failure when possible.
 */
/* eslint-disable no-restricted-globals */

const INVALID = 'https://ro1-csp-probe.invalid/isolation';

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  const localUrl = msg.localUrl;
  const violations = [];

  const onViol = (e) => {
    violations.push({
      at: new Date().toISOString(),
      effectiveDirective: e.effectiveDirective,
      violatedDirective: e.violatedDirective,
      blockedURI: e.blockedURI,
      disposition: e.disposition,
      documentURI: e.documentURI,
      sourceFile: e.sourceFile,
    });
  };

  // Dedicated workers: SecurityPolicyViolationEvent may be available on self
  try {
    self.addEventListener('securitypolicyviolation', onViol);
  } catch {
    /* ignore */
  }

  const out = {
    at: new Date().toISOString(),
    realm: 'DedicatedWorkerGlobalScope',
    fetchAvailable: typeof self.fetch === 'function',
    local: null,
    invalid: null,
    violations,
    classification: {},
  };

  if (localUrl && typeof self.fetch === 'function') {
    try {
      const res = await self.fetch(localUrl, { cache: 'no-store' });
      out.local = { status: 'observed_local', http: res.status };
    } catch (e) {
      out.local = {
        status: 'failed',
        message: e && e.message ? String(e.message) : String(e),
      };
    }
  }

  const before = violations.length;
  if (typeof self.fetch === 'function') {
    try {
      await self.fetch(INVALID, { cache: 'no-store', mode: 'cors' });
      out.invalid = { status: 'REACHED', note: 'unexpected — must not succeed' };
    } catch (e) {
      out.invalid = {
        status: 'failed',
        message: e && e.message ? String(e.message) : String(e),
        name: e && e.name ? e.name : undefined,
      };
    }
  } else {
    out.invalid = { status: 'api_unavailable' };
  }

  // Allow violation events to flush
  await new Promise((r) => setTimeout(r, 50));

  const related = violations.slice(before).filter((v) => {
    const uri = String(v.blockedURI || '');
    return (
      uri.includes('ro1-csp-probe.invalid') ||
      uri.includes('.invalid') ||
      String(v.effectiveDirective || '').includes('connect')
    );
  });

  if (out.invalid && out.invalid.status === 'REACHED') {
    out.classification.invalid = 'FAIL';
  } else if (related.length > 0) {
    out.classification.invalid = 'PASS_CSP_CONFIRMED';
  } else if (out.invalid && out.invalid.status === 'failed') {
    out.classification.invalid = 'NO DEMOSTRADO_CSP';
    out.classification.note =
      'Fetch failed but no SecurityPolicyViolationEvent attributed — could be DNS/network, not proven CSP';
  } else {
    out.classification.invalid = 'NO DEMOSTRADO';
  }

  self.postMessage(out);
};
