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
    expect(csp).toContain('https://mainnet-node-status-api.nymtech.cc');
    expect(csp).not.toMatch(/mainnet-node-status-api\.nymtech\.cc\//);
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

  it('serves spp-host presentation from a same-origin stylesheet', () => {
    const html = readFileSync(resolve(root, 'spp-host.html'), 'utf8');
    const css = readFileSync(resolve(root, 'public/spp-host.css'), 'utf8');
    expect(html).toContain('href="./spp-host.css"');
    expect(html).not.toMatch(/<style[\s>]/i);
    expect(html).not.toMatch(/\sstyle="/);
    expect(css).toContain('--font-ui');
    expect(css).not.toContain('fonts.googleapis.com');
  });

  it('does not load receive QR codes from api.qrserver.com', () => {
    const dashboard = readFileSync(resolve(root, 'src/popup/Dashboard.tsx'), 'utf8');
    expect(dashboard).not.toContain('qrserver');
    expect(dashboard).toContain("from 'qrcode'");
    expect(JSON.stringify(vercel)).not.toContain('qrserver');
  });

  it('sends referrer, permissions, opener, and transport headers', () => {
    expect(headers['Referrer-Policy']).toBe('no-referrer');
    expect(headers['Permissions-Policy']).toBe('camera=(), microphone=(), geolocation=()');
    expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(headers['Strict-Transport-Security']).toBe('max-age=63072000; includeSubDomains');
  });
});
