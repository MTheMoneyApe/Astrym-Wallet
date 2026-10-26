import { describe, expect, it } from 'vitest';

import {
  DEFAULT_NYM_NETWORK_ALLOWLIST,
  assertGatewayAllowlistReady,
  bootstrapHostPermissionPatterns,
  isOriginAllowlisted,
  normalizeOrigin,
} from '../../src/nym-offscreen/networkAllowlist.js';
import { classifyNymFailure } from '../../src/nym-offscreen/diagnostics.js';

describe('Nym network allowlist', () => {
  it('normalizes bootstrap host permission to exact origin pattern', () => {
    expect(bootstrapHostPermissionPatterns()).toEqual([
      'https://validator.nymtech.net/*',
    ]);
  });

  it('does not invent gateway origins by default', () => {
    expect(DEFAULT_NYM_NETWORK_ALLOWLIST.gatewayOrigins).toEqual([]);
    expect(() => assertGatewayAllowlistReady()).toThrow(/gateway allowlist is empty/i);
  });

  it('allowlists only exact configured origins', () => {
    expect(isOriginAllowlisted('wss://gw.example:9000', ['wss://gw.example:9000'])).toBe(true);
    expect(isOriginAllowlisted('wss://other.example', ['wss://gw.example:9000'])).toBe(false);
    expect(normalizeOrigin('https://validator.nymtech.net/api')).toBe(
      'https://validator.nymtech.net',
    );
  });
});

describe('Nym diagnostics classification', () => {
  it('classifies worker / wasm / asset / module failures', () => {
    expect(classifyNymFailure(new Error('web-worker-0.js load failed')).code).toBe(
      'WORKER_LOAD_FAILED',
    );
    expect(classifyNymFailure(new Error('CompileError: wasm')).code).toBe('WASM_LOAD_FAILED');
    expect(
      classifyNymFailure(new Error('Missing nym-mixfetch assets: go_conn.wasm')).code,
    ).toBe('ASSET_MISSING');
    expect(
      classifyNymFailure(new Error('Failed to fetch dynamically imported module')).code,
    ).toBe('MODULE_LOAD_FAILED');
  });
});
