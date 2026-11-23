import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');

type HeaderRule = { source: string; headers: { key: string; value: string }[] };

function headerMap(rule: HeaderRule): Record<string, string> {
  return Object.fromEntries(rule.headers.map((header) => [header.key, header.value]));
}

describe('webapp response headers', () => {
  const vercel = JSON.parse(readFileSync(resolve(root, '../../vercel.json'), 'utf8')) as {
    headers: HeaderRule[];
  };
  const catchAll = vercel.headers.find((rule) => rule.source === '/(.*)');
  const headers = catchAll ? headerMap(catchAll) : {};
  const csp = headers['Content-Security-Policy'] ?? '';

  it('sends a catch-all policy that denies framing and skips unsafe script sources', () => {
    expect(catchAll).toBeTruthy();
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("object-src 'none'");
    const withoutWasmEval = csp.replaceAll("'wasm-unsafe-eval'", '');
    expect(withoutWasmEval).not.toContain('unsafe-inline');
    expect(withoutWasmEval).not.toContain('unsafe-eval');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['X-Frame-Options']).toBe('DENY');
    for (const rule of vercel.headers) {
      const policy = headerMap(rule)['Content-Security-Policy'];
      if (policy) expect(policy).not.toContain("frame-ancestors 'self'");
    }
  });
});
