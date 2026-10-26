import { describe, expect, it } from 'vitest';

import {
  validateGatewayIdentityKey,
  validateGatewayOrigin,
} from '../../src/nym-offscreen/gatewayConfig.js';
import { NYM_VERIFIED_GATEWAY } from '../../src/nym-offscreen/verifiedGateway.js';
import { DEFAULT_NYM_NETWORK_ALLOWLIST } from '../../src/nym-offscreen/networkAllowlist.js';

describe('NYM_VERIFIED_GATEWAY reference', () => {
  it('keeps identity and WSS as separate validated shapes', () => {
    const id = validateGatewayIdentityKey(NYM_VERIFIED_GATEWAY.identityKey);
    const origin = validateGatewayOrigin(NYM_VERIFIED_GATEWAY.wssOrigin);
    expect(id.ok).toBe(true);
    expect(origin.ok).toBe(true);
    if (id.ok && origin.ok) {
      expect(id.identityKey).toBe(NYM_VERIFIED_GATEWAY.identityKey);
      expect(origin.origin).toBe(NYM_VERIFIED_GATEWAY.wssOrigin);
      expect(origin.hostPermissionPattern).toBe(
        NYM_VERIFIED_GATEWAY.hostPermissionPattern,
      );
      expect(id.identityKey).not.toBe(origin.origin);
    }
  });

  it('does not populate the default runtime allowlist', () => {
    expect(DEFAULT_NYM_NETWORK_ALLOWLIST.gatewayOrigins).toEqual([]);
  });
});
