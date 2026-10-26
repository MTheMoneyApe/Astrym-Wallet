import { describe, expect, it } from 'vitest';
import { classifyNymFailure } from '../../src/nym-offscreen/diagnostics.js';

describe('classifyNymFailure', () => {
  it('maps gateway timestamp skew to CLOCK_SKEWED', () => {
    const d = classifyNymFailure(
      new Error(
        'gateway returned an error response: the provided request timestamp is excessively skewed. got 2026-10-26 9:07:20.0 +00:00:00 whilst the server time is 2026-10-26 10:07:24 +00:00:00',
      ),
      'CONNECT_FAILED',
    );
    expect(d.code).toBe('CLOCK_SKEWED');
    expect(d.stage).toBe('setupMixFetch');
    expect(d.message).toMatch(/sync this machine/i);
  });
});
