import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const hostHtml = join(dirname(fileURLToPath(import.meta.url)), '../../spp-host.html');

describe('spp-host fonts', () => {
  it('does not reference Google font hosts', () => {
    const html = readFileSync(hostHtml, 'utf8');
    expect(html).not.toMatch(/fonts\.googleapis/);
    expect(html).not.toMatch(/fonts\.gstatic/);
    expect(html).toMatch(/--font-ui/);
  });
});
