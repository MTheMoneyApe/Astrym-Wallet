/**
 * Fase 2.31 — Show that script-src 'self' alone blocks WASM under Chromium CSP
 * unless 'wasm-unsafe-eval' is present. Does not load full SPP Client path.
 */

const violations = [];
document.addEventListener('securitypolicyviolation', (e) => {
  violations.push({
    effectiveDirective: e.effectiveDirective,
    violatedDirective: e.violatedDirective,
    blockedURI: e.blockedURI,
    disposition: e.disposition,
  });
});

async function run() {
  const report = {
    phase: '2.31',
    kind: 'csp-wasm-requirement',
    cspMeta: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content,
    hasWasmUnsafeEval: false,
    violations,
    result: null,
  };

  try {
    const wasmUrl = new URL(
      '/node_modules/stellar-private-payments/dist/stellar_private_payments_web_bg.wasm',
      location.origin,
    );
    const res = await fetch(wasmUrl);
    const buf = await res.arrayBuffer();
    await WebAssembly.instantiate(buf);
    report.result = {
      status: 'UNEXPECTED_SUCCESS',
      note: 'WASM instantiated without wasm-unsafe-eval — document browser behavior',
    };
  } catch (e) {
    await new Promise((r) => setTimeout(r, 50));
    const cspHit = violations.some(
      (v) =>
        String(v.effectiveDirective || v.violatedDirective || '').includes('script') ||
        String(v.blockedURI || '').includes('wasm'),
    );
    report.result = {
      status: 'FAILED_AS_EXPECTED',
      message: e instanceof Error ? e.message : String(e),
      cspViolationObserved: cspHit,
      verdict: cspHit ? 'PASS_CSP_BLOCKS_WASM_WITHOUT_UNSAFE_EVAL' : 'NO DEMOSTRADO_CSP_ATTR',
      note: cspHit
        ? 'Documented necessity of wasm-unsafe-eval for isolation host'
        : 'WASM failed but violation attribution incomplete — still do not add silent unsafe-eval without review',
    };
  }

  document.getElementById('status').textContent = report.result.status;
  document.getElementById('report').textContent = JSON.stringify(report, null, 2);
  window.__SPP_WASM_CSP_REQ__ = report;
}

run();
