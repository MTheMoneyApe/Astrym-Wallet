import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const hostDir = dirname(fileURLToPath(import.meta.url));
const hostHtml = join(hostDir, '../../spp-host.html');
const hostCss = join(hostDir, '../../public/spp-host.css');

describe('spp-host fonts', () => {
  it('does not reference Google font hosts', () => {
    const html = readFileSync(hostHtml, 'utf8');
    const css = readFileSync(hostCss, 'utf8');
    expect(html).not.toMatch(/fonts\.googleapis/);
    expect(html).not.toMatch(/fonts\.gstatic/);
    expect(css).not.toMatch(/fonts\.googleapis/);
    expect(css).not.toMatch(/fonts\.gstatic/);
    expect(css).toMatch(/--font-ui/);
  });
});
