/**
 * Dedicated live-smoke entry for real createMixFetch.
 *
 * Default: assets-only probe (no Mixnet). When
 * {@link NYM_LIVE_SMOKE_EXECUTION_AUTHORIZED} is true AND the caller passes
 * `confirmLiveSmoke: true`, runs connect→status→disconnect via the existing
 * offscreen runtime. Never uses clearnet fallback.
 *
 * This module does not launch Chrome or contact the network by itself —
 * callers must invoke it explicitly after authorization.
 */

import {
  NYM_LIVE_SMOKE_EXECUTION_AUTHORIZED,
  assertNymLiveSmokeAuthorized,
} from '../../nym-offscreen/liveSmokeAuth.js';
import { validateGatewayOrigin } from '../../nym-offscreen/gatewayConfig.js';
import type { NymRuntimeController, NymRuntimeUiSnapshot } from './NymRuntimeController.js';
import type { NymGatewayConfigService } from './NymGatewayConfigService.js';
import type { NymHostPermissionService } from './NymHostPermissionService.js';

export type NymLiveSmokeRequest = {
  /** Must be true together with NYM_LIVE_SMOKE_EXECUTION_AUTHORIZED. */
  confirmLiveSmoke: boolean;
  /**
   * Optional MixFetch identity-key override (base58).
   * WSS allowlist / host permission still come from persisted gatewayOrigins.
   */
  preferredGateway?: string;
};

export type NymLiveSmokeResult = {
  authorizedFlag: boolean;
  confirmLiveSmoke: boolean;
  executedCreateMixFetch: boolean;
  assetsReady: boolean;
  gatewayConfigured: boolean;
  hostPermissionGranted: boolean | null;
  snapshot: NymRuntimeUiSnapshot;
  steps: string[];
};

export async function runNymLiveSmoke(deps: {
  controller: NymRuntimeController;
  gatewayConfig: NymGatewayConfigService;
  hostPermissions: NymHostPermissionService;
  request: NymLiveSmokeRequest;
}): Promise<NymLiveSmokeResult> {
  const steps: string[] = [];
  const { controller, gatewayConfig, hostPermissions, request } = deps;

  // Always refresh status / asset probe path first (no createMixFetch yet).
  let snapshot = await controller.refreshStatus();
  steps.push('status-refresh');

  const config = await gatewayConfig.load();
  const gatewayConfigured =
    config.gatewayOrigins.length > 0 && Boolean(config.identityKey);
  steps.push(gatewayConfigured ? 'gateway-config-present' : 'gateway-config-empty');

  const wssOrigin = config.selectedGateway || config.gatewayOrigins[0] || null;
  const identityKey =
    request.preferredGateway?.trim() || config.identityKey || null;

  let hostPermissionGranted: boolean | null = null;
  if (wssOrigin) {
    const validation = validateGatewayOrigin(wssOrigin);
    if (!validation.ok) {
      throw Object.assign(new Error(validation.message), { code: validation.code });
    }
    if (!config.gatewayOrigins.includes(validation.origin)) {
      throw Object.assign(
        new Error('Smoke WSS gateway is not on the configured allowlist'),
        { code: 'GATEWAY_NOT_ALLOWLISTED' },
      );
    }
    const perm = await hostPermissions.getStatus(validation.origin);
    hostPermissionGranted = perm.granted;
    steps.push(perm.granted ? 'host-permission-granted' : 'host-permission-missing');
  }
  if (identityKey) {
    steps.push('gateway-identity-present');
  } else {
    steps.push('gateway-identity-missing');
  }

  const assetsReady = snapshot.assetsReady === true;
  steps.push(assetsReady ? 'assets-ready' : 'assets-not-ready');

  // Gate: do not call createMixFetch unless both flags are set.
  if (!request.confirmLiveSmoke) {
    snapshot = controller.getSnapshot();
    return {
      authorizedFlag: NYM_LIVE_SMOKE_EXECUTION_AUTHORIZED,
      confirmLiveSmoke: false,
      executedCreateMixFetch: false,
      assetsReady,
      gatewayConfigured,
      hostPermissionGranted,
      snapshot: {
        ...snapshot,
        // Dry-run is expected — not an authorization failure.
        diagnosticCode: 'SMOKE_DRY_RUN',
        lastError:
          snapshot.lastError ??
          'Smoke dry-run: config/assets/permission probed only; createMixFetch not executed (confirmLiveSmoke=false)',
        connected: false,
        state: snapshot.state === 'connected' ? 'disconnected' : snapshot.state,
      },
      steps: [...steps, 'smoke-dry-run'],
    };
  }

  assertNymLiveSmokeAuthorized();
  steps.push('live-smoke-authorized');

  if (!assetsReady) {
    throw Object.assign(new Error('Packaged nym-mixfetch assets are not ready'), {
      code: 'ASSET_MISSING',
    });
  }
  if (!wssOrigin) {
    throw Object.assign(
      new Error('No WSS gateway origin configured for live smoke'),
      { code: 'GATEWAY_ALLOWLIST_EMPTY' },
    );
  }
  if (!identityKey) {
    throw Object.assign(
      new Error('No MixFetch gateway identity key configured for live smoke'),
      { code: 'GATEWAY_IDENTITY_REQUIRED' },
    );
  }
  if (hostPermissionGranted !== true) {
    throw Object.assign(
      new Error(
        'Gateway host permission not granted — use user-initiated Grant permission first',
      ),
      { code: 'PERMISSION_DENIED' },
    );
  }

  // Real createMixFetch path (offscreen). Permission grant ≠ connected until this succeeds.
  steps.push('createMixFetch-connect');
  snapshot = await controller.connect({ preferredGateway: identityKey });
  if (!snapshot.connected) {
    throw Object.assign(
      new Error(snapshot.lastError ?? 'createMixFetch did not report connected'),
      { code: snapshot.diagnosticCode ?? 'CONNECT_FAILED' },
    );
  }
  steps.push('createMixFetch-connected');

  snapshot = await controller.disconnect();
  steps.push('disconnect');

  return {
    authorizedFlag: true,
    confirmLiveSmoke: true,
    executedCreateMixFetch: true,
    assetsReady: true,
    gatewayConfigured: true,
    hostPermissionGranted: true,
    snapshot,
    steps,
  };
}
