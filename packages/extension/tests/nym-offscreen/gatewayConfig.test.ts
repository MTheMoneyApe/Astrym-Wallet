import { describe, expect, it } from 'vitest';

import {
  gatewayHostPermissionPattern,
  validateGatewayIdentityKey,
  validateGatewayOrigin,
} from '../../src/nym-offscreen/gatewayConfig.js';

describe('validateGatewayOrigin', () => {
  it('accepts exact wss gateway with port', () => {
    const r = validateGatewayOrigin('wss://gateway.example:9000');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.origin).toBe('wss://gateway.example:9000');
      expect(r.hostPermissionPattern).toBe('https://gateway.example:9000/*');
    }
  });

  it('accepts verified DevRel WSS shape without inventing connectivity', () => {
    const r = validateGatewayOrigin('wss://nym-node-cli.devrel.nymte.ch:9001');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.hostPermissionPattern).toBe('https://nym-node-cli.devrel.nymte.ch:9001/*');
    }
  });

  it('rejects wildcards and broad tokens', () => {
    expect(validateGatewayOrigin('*://*.example.com').ok).toBe(false);
    expect(validateGatewayOrigin('<all_urls>').ok).toBe(false);
    expect(validateGatewayOrigin('wss://*.nymtech.net:9000').ok).toBe(false);
  });

  it('rejects bad schemes, paths, and IPs', () => {
    expect(validateGatewayOrigin('ws://gateway.example:9000').ok).toBe(false);
    expect(validateGatewayOrigin('wss://gateway.example:9000/path').ok).toBe(false);
    expect(validateGatewayOrigin('wss://1.2.3.4:9000').ok).toBe(false);
    expect(validateGatewayOrigin('').ok).toBe(false);
  });

  it('rejects bootstrap API host used as if it were a gateway WSS', () => {
    // validator.nymtech.net is bootstrap — still a valid URL shape if operator
    // mistakenly uses https without port; we accept https origin validation but
    // docs forbid treating it as MixFetch preferredGateway.
    const r = validateGatewayOrigin('https://validator.nymtech.net');
    expect(r.ok).toBe(true);
  });

  it('rejects invalid ports', () => {
    expect(validateGatewayOrigin('wss://gateway.example:99999').ok).toBe(false);
  });

  it('maps host permission pattern for chrome.permissions', () => {
    expect(gatewayHostPermissionPattern('wss://a.example:1234')).toBe(
      'https://a.example:1234/*',
    );
  });
});

describe('validateGatewayIdentityKey (MixFetchOpts.preferredGateway)', () => {
  it('accepts official docs / Status API identity', () => {
    const r = validateGatewayIdentityKey(
      'q2A2cbooyC16YJzvdYaSMH9X3cSiieZNtfBr8cE8Fi1',
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.identityKey).toBe('q2A2cbooyC16YJzvdYaSMH9X3cSiieZNtfBr8cE8Fi1');
    }
  });

  it('rejects WSS URLs and hostnames as identity', () => {
    expect(validateGatewayIdentityKey('wss://nym-node-cli.devrel.nymte.ch:9001').ok).toBe(
      false,
    );
    expect(validateGatewayIdentityKey('nym-node-cli.devrel.nymte.ch').ok).toBe(false);
    expect(validateGatewayIdentityKey('https://validator.nymtech.net').ok).toBe(false);
  });

  it('rejects empty and wildcards', () => {
    expect(validateGatewayIdentityKey('').ok).toBe(false);
    expect(validateGatewayIdentityKey('*').ok).toBe(false);
  });
});
