/**
 * Typed SW ↔ Nym offscreen IPC.
 * Separate from wallet MessageRouter envelopes.
 * connected=true is never implied by document creation alone.
 */

import type { NymDiagnosticCode } from './diagnostics.js';

export const NYM_OFFSCREEN_CHANNEL = 'nym-offscreen' as const;
export const NYM_OFFSCREEN_TARGET = 'nym-runtime' as const;
export const NYM_OFFSCREEN_PORT_NAME = 'nym-offscreen-runtime' as const;
export const NYM_OFFSCREEN_BRIDGE_AUTHENTICATED_SIGNAL = Object.freeze({
  channel: NYM_OFFSCREEN_CHANNEL,
  target: NYM_OFFSCREEN_TARGET,
  type: 'bridgeAuthenticated',
} as const);

export type NymOffscreenBridgeAuthenticatedSignal =
  typeof NYM_OFFSCREEN_BRIDGE_AUTHENTICATED_SIGNAL;

export function isNymOffscreenBridgeAuthenticatedSignal(
  value: unknown,
): value is NymOffscreenBridgeAuthenticatedSignal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return (
    keys.length === 3 &&
    keys.includes('channel') &&
    keys.includes('target') &&
    keys.includes('type') &&
    record['channel'] === NYM_OFFSCREEN_CHANNEL &&
    record['target'] === NYM_OFFSCREEN_TARGET &&
    record['type'] === 'bridgeAuthenticated'
  );
}

export type NymOffscreenRequestType =
  | 'ping'
  | 'connect'
  | 'disconnect'
  | 'status'
  | 'fetch'
  | 'httpSmokeStatus';

export type NymOffscreenRuntimeState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'closed';

export type NymOffscreenStatusPayload = {
  state: NymOffscreenRuntimeState;
  /** True only after successful createMixFetch/setupMixFetch. */
  connected: boolean;
  lastError: string | null;
  /** Typed diagnostic when lastError is set (or OK). */
  diagnosticCode: NymDiagnosticCode;
  diagnosticStage?: string | null;
  implementation: 'mix-fetch-offscreen' | 'unavailable';
  /** Offscreen document is open — does NOT mean mixnet connected. */
  documentReady: boolean;
  /** Packaging probe: required sibling assets present under nym-mixfetch/. */
  assetsReady: boolean;
  /** Operator note: empty gateway allowlist → dynamic gateways need explicit config. */
  gatewayAllowlistConfigured: boolean;
  /** Unique to this offscreen document instance; absent only in legacy responders. */
  runtimeGeneration?: string;
};

export type NymOffscreenHttpSmokeOperationStatus = {
  operationId: string;
  runtimeGeneration: string;
  state: 'pending' | 'completed' | 'failed' | 'unknown';
};

export type NymOffscreenFetchInit = {
  method?: string;
  headers?: Record<string, string>;
  bodyText?: string | null;
  /**
   * mix-fetch@1.4.2 (Go WASM) RequestInit extension.
   * `unsafe-ignore-cors` skips client-side CORS checks on Mixnet responses
   * (destinations rarely send ACAO for chrome-extension://). Still Mixnet egress.
   */
  mode?: string;
};

export type NymOffscreenFetchResult = {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyBase64: string;
};

export type NymOffscreenConnectOptions = {
  disableCoverTraffic?: boolean;
  /**
   * MixFetchOpts.preferredGateway — base58 gateway identity key (not a WSS URL).
   * Required for createMixFetch with mix-fetch@1.4.2.
   */
  preferredGateway?: string;
  /** Exact WSS/HTTPS origins for MV3 host-permission policy (never forwarded to MixFetch). */
  gatewayAllowlist?: string[];
  /** MixFetchOpts.forceTls — prefer WSS to the entry gateway (default true from bridge). */
  forceTls?: boolean;
};

export type NymOffscreenRequest =
  | { channel: typeof NYM_OFFSCREEN_CHANNEL; target: typeof NYM_OFFSCREEN_TARGET; type: 'ping'; id: string }
  | {
      channel: typeof NYM_OFFSCREEN_CHANNEL;
      target: typeof NYM_OFFSCREEN_TARGET;
      type: 'connect';
      id: string;
      options?: NymOffscreenConnectOptions;
    }
  | {
      channel: typeof NYM_OFFSCREEN_CHANNEL;
      target: typeof NYM_OFFSCREEN_TARGET;
      type: 'disconnect';
      id: string;
      strict?: boolean;
    }
  | { channel: typeof NYM_OFFSCREEN_CHANNEL; target: typeof NYM_OFFSCREEN_TARGET; type: 'status'; id: string }
  | {
      channel: typeof NYM_OFFSCREEN_CHANNEL;
      target: typeof NYM_OFFSCREEN_TARGET;
      type: 'fetch';
      id: string;
      url: string;
      operationId?: string;
      init?: NymOffscreenFetchInit;
    }
  | {
      channel: typeof NYM_OFFSCREEN_CHANNEL;
      target: typeof NYM_OFFSCREEN_TARGET;
      type: 'httpSmokeStatus';
      id: string;
      operationId: string;
      runtimeGeneration: string;
    };

export type NymOffscreenSuccessResponse<T = unknown> = {
  channel: typeof NYM_OFFSCREEN_CHANNEL;
  id: string;
  ok: true;
  payload: T;
};

export type NymOffscreenErrorResponse = {
  channel: typeof NYM_OFFSCREEN_CHANNEL;
  id: string;
  ok: false;
  error: {
    code: NymDiagnosticCode;
    message: string;
    stage?: string;
  };
};

export type NymOffscreenResponse =
  | NymOffscreenSuccessResponse
  | NymOffscreenErrorResponse;

export function isNymOffscreenRequest(value: unknown): value is NymOffscreenRequest {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v['channel'] !== NYM_OFFSCREEN_CHANNEL) return false;
  if (v['target'] !== NYM_OFFSCREEN_TARGET) return false;
  if (typeof v['id'] !== 'string' || (v['id'] as string).length === 0) return false;
  const type = v['type'];
  if (
    type !== 'ping' &&
    type !== 'connect' &&
    type !== 'disconnect' &&
    type !== 'status' &&
    type !== 'fetch' &&
    type !== 'httpSmokeStatus'
  ) {
    return false;
  }
  if (type === 'fetch') {
    if (typeof v['url'] !== 'string' || (v['url'] as string).length === 0) return false;
    if (
      v['operationId'] !== undefined &&
      (typeof v['operationId'] !== 'string' || v['operationId'].length === 0)
    ) return false;
  }
  if (type === 'httpSmokeStatus') {
    if (
      typeof v['operationId'] !== 'string' ||
      v['operationId'].length === 0 ||
      typeof v['runtimeGeneration'] !== 'string' ||
      v['runtimeGeneration'].length === 0
    ) return false;
  }
  return true;
}

export function isNymOffscreenChannelMessage(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  return (value as { channel?: unknown }).channel === NYM_OFFSCREEN_CHANNEL;
}

export function nymOffscreenError(
  id: string,
  code: NymOffscreenErrorResponse['error']['code'],
  message: string,
  stage?: string,
): NymOffscreenErrorResponse {
  return {
    channel: NYM_OFFSCREEN_CHANNEL,
    id,
    ok: false,
    error: stage ? { code, message, stage } : { code, message },
  };
}

export function nymOffscreenOk<T>(
  id: string,
  payload: T,
): NymOffscreenSuccessResponse<T> {
  return {
    channel: NYM_OFFSCREEN_CHANNEL,
    id,
    ok: true,
    payload,
  };
}
