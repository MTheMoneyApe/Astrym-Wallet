import type { ValidatedRequestPayload, ValidatedResponsePayload } from '../../shared/ipcTypes.js';
import { runNymLiveSmoke } from '../nym/NymLiveSmoke.js';
import {
  getNymRuntimeController,
  type NymRuntimeUiSnapshot,
} from '../nym/NymRuntimeController.js';

function toSnapshot(snap: NymRuntimeUiSnapshot): ValidatedResponsePayload<'NYM_STATUS'> {
  return {
    state: snap.state,
    lastError: snap.lastError,
    connected: snap.connected,
    implementation: snap.implementation,
    selfAddress: snap.selfAddress ?? null,
    mode: snap.mode,
    documentReady: snap.documentReady,
    diagnosticCode: snap.diagnosticCode,
    diagnosticStage: snap.diagnosticStage ?? null,
    assetsReady: snap.assetsReady,
    gatewayAllowlistConfigured: snap.gatewayAllowlistConfigured,
    selectedGateway: snap.selectedGateway ?? null,
    gatewayIdentityKey: snap.gatewayIdentityKey ?? null,
    gatewayHostPermissionGranted: snap.gatewayHostPermissionGranted ?? null,
    gatewayHostPermissionPattern: snap.gatewayHostPermissionPattern ?? null,
  };
}

export function createNymConnectHandler() {
  return async (
    payload: ValidatedRequestPayload<'NYM_CONNECT'>,
  ): Promise<ValidatedResponsePayload<'NYM_CONNECT'>> => {
    const ctrl = getNymRuntimeController();
    const connectOpts: {
      disableCoverTraffic?: boolean;
      preferredGateway?: string;
    } = {};
    if (payload.disableCoverTraffic !== undefined) {
      connectOpts.disableCoverTraffic = payload.disableCoverTraffic;
    }
    if (payload.preferredGateway !== undefined) {
      connectOpts.preferredGateway = payload.preferredGateway;
    }
    const snap = await ctrl.connect(connectOpts);
    return toSnapshot(snap);
  };
}

export function createNymDisconnectHandler() {
  return async (
    _payload: ValidatedRequestPayload<'NYM_DISCONNECT'>,
  ): Promise<ValidatedResponsePayload<'NYM_DISCONNECT'>> => {
    const snap = await getNymRuntimeController().disconnect();
    return toSnapshot(snap);
  };
}

export function createNymStatusHandler() {
  return async (
    _payload: ValidatedRequestPayload<'NYM_STATUS'>,
  ): Promise<ValidatedResponsePayload<'NYM_STATUS'>> => {
    const snap = await getNymRuntimeController().refreshStatus();
    return toSnapshot(snap);
  };
}

export function createNymSetModeHandler() {
  return async (
    payload: ValidatedRequestPayload<'NYM_SET_MODE'>,
  ): Promise<ValidatedResponsePayload<'NYM_SET_MODE'>> => {
    const ctrl = getNymRuntimeController();
    ctrl.setMode(payload.mode);
    await ctrl.syncGatewayConfigUi();
    return toSnapshot(ctrl.getSnapshot());
  };
}

export function createNymConfigureGatewayHandler() {
  return async (
    payload: ValidatedRequestPayload<'NYM_CONFIGURE_GATEWAY'>,
  ): Promise<ValidatedResponsePayload<'NYM_CONFIGURE_GATEWAY'>> => {
    const ctrl = getNymRuntimeController();
    const { config, validation } = await ctrl.gatewayConfig.addGateway(
      payload.origin,
      payload.identityKey,
    );
    await ctrl.syncGatewayConfigUi();
    return {
      config,
      hostPermissionPattern: validation.hostPermissionPattern,
      snapshot: toSnapshot(ctrl.getSnapshot()),
    };
  };
}

export function createNymSelectGatewayHandler() {
  return async (
    payload: ValidatedRequestPayload<'NYM_SELECT_GATEWAY'>,
  ): Promise<ValidatedResponsePayload<'NYM_SELECT_GATEWAY'>> => {
    const ctrl = getNymRuntimeController();
    const config = await ctrl.gatewayConfig.selectGateway(payload.origin);
    await ctrl.syncGatewayConfigUi();
    return { config, snapshot: toSnapshot(ctrl.getSnapshot()) };
  };
}

export function createNymRemoveGatewayHandler() {
  return async (
    payload: ValidatedRequestPayload<'NYM_REMOVE_GATEWAY'>,
  ): Promise<ValidatedResponsePayload<'NYM_REMOVE_GATEWAY'>> => {
    const ctrl = getNymRuntimeController();
    const config = await ctrl.gatewayConfig.removeGateway(payload.origin);
    await ctrl.syncGatewayConfigUi();
    return { config, snapshot: toSnapshot(ctrl.getSnapshot()) };
  };
}

export function createNymRequestGatewayPermissionHandler() {
  return async (
    payload: ValidatedRequestPayload<'NYM_REQUEST_GATEWAY_PERMISSION'>,
  ): Promise<ValidatedResponsePayload<'NYM_REQUEST_GATEWAY_PERMISSION'>> => {
    const ctrl = getNymRuntimeController();
    await ctrl.syncGatewayConfigUi();
    const snap = ctrl.getSnapshot();
    const origin = payload.origin?.trim() || snap.selectedGateway;
    if (!origin) {
      throw Object.assign(new Error('No gateway selected to request permission for'), {
        code: 'GATEWAY_ALLOWLIST_EMPTY',
      });
    }
    // Popup must call chrome.permissions.request in the click gesture.
    // Background only re-queries contains() — never request() (would lose gesture).
    const result = await ctrl.hostPermissions.getStatus(origin);
    await ctrl.syncGatewayConfigUi();
    return {
      origin: result.origin,
      hostPermissionPattern: result.hostPermissionPattern,
      granted: result.granted,
      snapshot: toSnapshot(ctrl.getSnapshot()),
    };
  };
}

export function createNymLiveSmokeHandler() {
  return async (
    payload: ValidatedRequestPayload<'NYM_LIVE_SMOKE'>,
  ): Promise<ValidatedResponsePayload<'NYM_LIVE_SMOKE'>> => {
    const ctrl = getNymRuntimeController();
    const smokeRequest: {
      confirmLiveSmoke: boolean;
      preferredGateway?: string;
    } = { confirmLiveSmoke: payload.confirmLiveSmoke };
    if (payload.preferredGateway !== undefined) {
      smokeRequest.preferredGateway = payload.preferredGateway;
    }
    const result = await runNymLiveSmoke({
      controller: ctrl,
      gatewayConfig: ctrl.gatewayConfig,
      hostPermissions: ctrl.hostPermissions,
      request: smokeRequest,
    });
    return {
      authorizedFlag: result.authorizedFlag,
      confirmLiveSmoke: result.confirmLiveSmoke,
      executedCreateMixFetch: result.executedCreateMixFetch,
      assetsReady: result.assetsReady,
      gatewayConfigured: result.gatewayConfigured,
      hostPermissionGranted: result.hostPermissionGranted,
      steps: result.steps,
      snapshot: toSnapshot(result.snapshot),
    };
  };
}

export function createNymHttpSmokeHandler() {
  return async (
    payload: ValidatedRequestPayload<'NYM_HTTP_SMOKE'>,
  ): Promise<ValidatedResponsePayload<'NYM_HTTP_SMOKE'>> => {
    const ctrl = getNymRuntimeController();
    const request: { url?: string; timeoutMs?: number } = {};
    if (payload.url !== undefined) request.url = payload.url;
    if (payload.timeoutMs !== undefined) request.timeoutMs = payload.timeoutMs;
    const result = await ctrl.runHttpSmoke(request);
    return {
      state: result.state,
      url: result.url,
      probeId: result.probeId,
      durationMs: result.durationMs,
      httpStatus: result.httpStatus,
      httpOk: result.httpOk,
      probeMatched: result.probeMatched,
      echoedProbeId: result.echoedProbeId,
      message: result.message,
      mixFetchInvoked: result.mixFetchInvoked,
    };
  };
}

export function createNymPublicDataFetchHandler() {
  return async (
    payload: ValidatedRequestPayload<'NYM_PUBLIC_DATA_FETCH'>,
  ): Promise<ValidatedResponsePayload<'NYM_PUBLIC_DATA_FETCH'>> => {
    const ctrl = getNymRuntimeController();
    const request: {
      transport?: 'direct' | 'nym';
      url?: string;
      timeoutMs?: number;
    } = {};
    if (payload.transport !== undefined) request.transport = payload.transport;
    if (payload.url !== undefined) request.url = payload.url;
    if (payload.timeoutMs !== undefined) request.timeoutMs = payload.timeoutMs;
    const result = await ctrl.fetchPublicData(request);
    return {
      state: result.state,
      transport: result.transport,
      url: result.url,
      probeId: result.probeId,
      durationMs: result.durationMs,
      httpStatus: result.httpStatus,
      httpOk: result.httpOk,
      probeMatched: result.probeMatched,
      echoedProbeId: result.echoedProbeId,
      responsePreview: result.responsePreview,
      message: result.message,
      transportFetchInvoked: result.transportFetchInvoked,
    };
  };
}

export function createNymStellarHorizonProbeHandler() {
  return async (
    payload: ValidatedRequestPayload<'NYM_STELLAR_HORIZON_PROBE'>,
  ): Promise<ValidatedResponsePayload<'NYM_STELLAR_HORIZON_PROBE'>> => {
    const ctrl = getNymRuntimeController();
    const opts: {
      transport?: 'direct' | 'nym';
      horizonUrl?: string;
      timeoutMs?: number;
    } = {};
    if (payload.transport !== undefined) opts.transport = payload.transport;
    if (payload.horizonUrl !== undefined) opts.horizonUrl = payload.horizonUrl;
    if (payload.timeoutMs !== undefined) opts.timeoutMs = payload.timeoutMs;
    const result = await ctrl.probeStellarHorizon(opts);
    return {
      state: result.state,
      transport: result.transport,
      url: result.logicalUrl,
      logicalUrl: result.logicalUrl,
      effectiveUrl: result.effectiveUrl,
      urlRewritten: result.urlRewritten,
      rewriteReason: result.rewriteReason,
      durationMs: result.durationMs,
      httpStatus: result.httpStatus,
      httpOk: result.httpOk,
      contentType: result.contentType,
      horizonVersion: result.horizonVersion,
      networkPassphrase: result.networkPassphrase,
      lastLedger: result.lastLedger,
      lastLedgerBaseFee: result.lastLedgerBaseFee,
      horizonErrorType: result.horizonErrorType,
      horizonErrorTitle: result.horizonErrorTitle,
      horizonErrorDetail: result.horizonErrorDetail,
      responsePreview: result.responsePreview,
      message: result.message,
      transportFetchInvoked: result.transportFetchInvoked,
    };
  };
}

export function createNymSetStellarHorizonEndpointHandler() {
  return async (
    payload: ValidatedRequestPayload<'NYM_SET_STELLAR_HORIZON_ENDPOINT'>,
  ): Promise<ValidatedResponsePayload<'NYM_SET_STELLAR_HORIZON_ENDPOINT'>> => {
    const ctrl = getNymRuntimeController();
    const partial: {
      testnetEffectiveBase?: string;
      mainnetEffectiveBase?: string;
    } = {};
    if (payload.testnetEffectiveBase !== undefined) {
      partial.testnetEffectiveBase = payload.testnetEffectiveBase;
    }
    if (payload.mainnetEffectiveBase !== undefined) {
      partial.mainnetEffectiveBase = payload.mainnetEffectiveBase;
    }
    return ctrl.setStellarNymHorizonConfig(partial);
  };
}
