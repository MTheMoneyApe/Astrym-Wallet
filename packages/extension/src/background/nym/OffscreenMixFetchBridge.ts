/**
 * NymMixFetchBridge over chrome.runtime ↔ offscreen document.
 * Never uses clearnet fetch; never reports setup success without offscreen ack.
 */

import type {
  NymMixFetchBridge,
  NymMixFetchSetupOptions,
} from '@solanym/wallet-core/src/nym/NymMixFetchBridge.js';
import {
  NYM_OFFSCREEN_CHANNEL,
  NYM_OFFSCREEN_BRIDGE_AUTHENTICATED_SIGNAL,
  NYM_OFFSCREEN_PORT_NAME,
  NYM_OFFSCREEN_TARGET,
  type NymOffscreenFetchResult,
  type NymOffscreenHttpSmokeOperationStatus,
  type NymOffscreenRequest,
  type NymOffscreenResponse,
  type NymOffscreenStatusPayload,
} from '../../nym-offscreen/protocol.js';
import { createOffscreenDocumentManager } from './OffscreenDocumentManager.js';

const authoritativeHttpSmokeStatuses = new WeakSet<object>();
let nextRequestId = 0;

export function isAuthoritativeHttpSmokeStatus(
  status: NymOffscreenHttpSmokeOperationStatus,
): boolean {
  return authoritativeHttpSmokeStatuses.has(status);
}

function newId(): string {
  nextRequestId += 1;
  return `nym-${Date.now()}-${nextRequestId}-${Math.random().toString(36).slice(2, 10)}`;
}

function base64ToBytes(b64: string): Uint8Array {
  if (!b64) return new Uint8Array(0);
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function headersFromInit(init?: RequestInit): Record<string, string> | undefined {
  if (!init?.headers) return undefined;
  if (init.headers instanceof Headers) {
    const out: Record<string, string> = {};
    init.headers.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }
  if (Array.isArray(init.headers)) {
    return Object.fromEntries(init.headers);
  }
  return { ...init.headers };
}

async function bodyToText(body: BodyInit | null | undefined): Promise<string | null> {
  if (body == null) return null;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) {
    return new TextDecoder().decode(body);
  }
  if (ArrayBuffer.isView(body)) {
    return new TextDecoder().decode(body as ArrayBufferView);
  }
  // Blob / FormData / ReadableStream are unsupported over this IPC slice
  throw new Error('Unsupported request body type for Nym offscreen fetch IPC');
}

type PendingRequest = {
  port: chrome.runtime.Port;
  resolve: (response: NymOffscreenResponse) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type PortCandidate = {
  port: chrome.runtime.Port;
  expectedUrl: string;
  senderId: string;
  senderUrl: string;
  senderDocumentId: string;
  disconnected: boolean;
  accepted: boolean;
  rejectionReported: boolean;
};

export type OffscreenMixFetchBridgeRejectionReason =
  | 'wrong_port_name'
  | 'missing_or_invalid_sender'
  | 'sender_id_mismatch'
  | 'sender_url_mismatch'
  | 'invalid_document_id'
  | 'get_contexts_unavailable'
  | 'get_contexts_failed'
  | 'context_count_mismatch'
  | 'context_document_id_mismatch'
  | 'candidate_disconnected'
  | 'candidate_superseded';

export type OffscreenMixFetchBridgeDiagnostic =
  | Readonly<{
      event: 'connect_received';
      portNameMatches: boolean;
    }>
  | Readonly<{
      event: 'connect_rejected';
      reason: OffscreenMixFetchBridgeRejectionReason;
    }>;

export type OffscreenMixFetchBridgeAuthenticationDiagnostic = Readonly<{
  authenticated: true;
  senderId: string;
  senderUrl: string;
  senderDocumentId: string;
  contextType: chrome.runtime.ExtensionContext['contextType'];
  contextDocumentUrl: string;
  contextDocumentId: string;
}>;

export type OffscreenMixFetchBridgeOptions = {
  rpcTimeoutMs?: number;
  readinessTimeoutMs?: number;
  onAuthenticated?: (
    diagnostic: OffscreenMixFetchBridgeAuthenticationDiagnostic,
  ) => void | Promise<void>;
  onDiagnostic?: (
    diagnostic: OffscreenMixFetchBridgeDiagnostic,
  ) => void | Promise<void>;
};

const DEFAULT_RPC_TIMEOUT_MS = 120_000;
const DEFAULT_READINESS_TIMEOUT_MS = 15_000;

function isDocumentId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})$/i.test(value)
  );
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function isNymOffscreenResponse(
  value: unknown,
  expectedId: string,
): value is NymOffscreenResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const response = value as Record<string, unknown>;
  if (
    response['channel'] !== NYM_OFFSCREEN_CHANNEL ||
    response['id'] !== expectedId ||
    typeof response['ok'] !== 'boolean'
  ) {
    return false;
  }
  if (response['ok'] === true) {
    return hasExactKeys(response, ['channel', 'id', 'ok', 'payload']);
  }
  const error = response['error'];
  if (!error || typeof error !== 'object' || Array.isArray(error)) return false;
  const details = error as Record<string, unknown>;
  return (
    (hasExactKeys(details, ['code', 'message']) ||
      hasExactKeys(details, ['code', 'message', 'stage'])) &&
    typeof details['code'] === 'string' &&
    typeof details['message'] === 'string' &&
    (details['stage'] === undefined || typeof details['stage'] === 'string') &&
    hasExactKeys(response, ['channel', 'id', 'ok', 'error'])
  );
}

export class OffscreenMixFetchBridge implements NymMixFetchBridge {
  private _setupComplete = false;
  private _readinessStatusDeadlineAt: number | null = null;
  private readonly _docs = createOffscreenDocumentManager();
  private _port: chrome.runtime.Port | null = null;
  private _portCandidate: PortCandidate | null = null;
  private readonly _portWaiters = new Set<(port: chrome.runtime.Port) => void>();
  private readonly _pending = new Map<string, PendingRequest>();
  private readonly _rpcTimeoutMs: number;
  private readonly _readinessTimeoutMs: number;
  private readonly _onAuthenticated?: OffscreenMixFetchBridgeOptions['onAuthenticated'];
  private readonly _onDiagnostic?: OffscreenMixFetchBridgeOptions['onDiagnostic'];

  constructor(options: OffscreenMixFetchBridgeOptions = {}) {
    if (typeof chrome === 'undefined' || !chrome?.runtime?.onConnect) {
      throw new Error('chrome.runtime.onConnect unavailable');
    }
    this._rpcTimeoutMs = options.rpcTimeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
    this._readinessTimeoutMs =
      options.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS;
    this._onAuthenticated = options.onAuthenticated;
    this._onDiagnostic = options.onDiagnostic;
    if (
      !Number.isSafeInteger(this._rpcTimeoutMs) ||
      this._rpcTimeoutMs <= 0 ||
      this._rpcTimeoutMs > 2_147_483_647
    ) {
      throw new Error('Nym offscreen RPC timeout must be a positive safe timer duration');
    }
    if (
      !Number.isSafeInteger(this._readinessTimeoutMs) ||
      this._readinessTimeoutMs <= 0 ||
      this._readinessTimeoutMs > 2_147_483_647
    ) {
      throw new Error('Nym offscreen readiness timeout must be a positive safe timer duration');
    }
    chrome.runtime.onConnect.addListener((port) => this.queuePortAcceptance(port));
  }

  get setupComplete(): boolean {
    return this._setupComplete;
  }

  private queuePortAcceptance(port: chrome.runtime.Port): void {
    const portNameMatches = port.name === NYM_OFFSCREEN_PORT_NAME;
    this.emitDiagnostic(
      Object.freeze({ event: 'connect_received' as const, portNameMatches }),
    );
    if (!portNameMatches) {
      this.emitRejected('wrong_port_name');
      return;
    }
    const sender = port.sender;
    const runtimeId = chrome.runtime.id;
    const expectedUrl = this._docs.getDocumentUrl();
    const senderId = sender?.id;
    const senderUrl = sender?.url;
    const senderDocumentId = sender?.documentId;
    let senderUrlIsValid = false;
    if (typeof senderUrl === 'string') {
      try {
        const parsedSenderUrl = new URL(senderUrl);
        senderUrlIsValid =
          parsedSenderUrl.protocol === 'chrome-extension:' &&
          parsedSenderUrl.hostname === runtimeId &&
          senderUrl === expectedUrl;
      } catch {
        senderUrlIsValid = false;
      }
    }
    if (
      typeof runtimeId !== 'string' ||
      !sender ||
      typeof senderId !== 'string' ||
      senderId !== runtimeId ||
      !senderUrlIsValid ||
      typeof senderUrl !== 'string' ||
      !isDocumentId(senderDocumentId)
    ) {
      const rejectionReason =
        typeof runtimeId !== 'string' || !sender || typeof senderId !== 'string'
          ? 'missing_or_invalid_sender'
          : senderId !== runtimeId
            ? 'sender_id_mismatch'
            : !senderUrlIsValid || typeof senderUrl !== 'string'
              ? 'sender_url_mismatch'
              : 'invalid_document_id';
      this.emitRejected(rejectionReason);
      port.disconnect();
      return;
    }

    const candidate: PortCandidate = {
      port,
      expectedUrl,
      senderId,
      senderUrl,
      senderDocumentId,
      disconnected: false,
      accepted: false,
      rejectionReported: false,
    };
    const previousCandidate = this._portCandidate;
    this._portCandidate = candidate;
    if (previousCandidate) {
      this.rejectPortCandidate(
        previousCandidate,
        'candidate_superseded',
        false,
      );
    }
    port.onDisconnect.addListener(() => {
      const wasAccepted = candidate.accepted;
      candidate.disconnected = true;
      if (this._portCandidate === candidate) this._portCandidate = null;
      if (this._port === port) {
        this._port = null;
        this._setupComplete = false;
      }
      this.rejectPendingForPort(port, new Error('Nym offscreen IPC port disconnected'));
      if (!wasAccepted) {
        this.rejectPortCandidate(candidate, 'candidate_disconnected');
      }
    });

    void this.authenticateAndAcceptPort(candidate).catch(() => {
      this.rejectPortCandidate(
        candidate,
        candidate.disconnected
          ? 'candidate_disconnected'
          : this._portCandidate === candidate
            ? 'get_contexts_failed'
            : 'candidate_superseded',
      );
    });
  }

  private async authenticateAndAcceptPort(candidate: PortCandidate): Promise<void> {
    const {
      port,
      senderDocumentId,
      expectedUrl,
      senderId,
      senderUrl,
    } = candidate;
    if (candidate.disconnected || this._portCandidate !== candidate) {
      this.rejectPortCandidate(
        candidate,
        candidate.disconnected ? 'candidate_disconnected' : 'candidate_superseded',
      );
      return;
    }

    let authenticatedContext: chrome.runtime.ExtensionContext | undefined;
    try {
      const getContexts = chrome.runtime.getContexts;
      if (typeof getContexts !== 'function') {
        this.rejectPortCandidate(candidate, 'get_contexts_unavailable');
        return;
      }
      const contexts = await getContexts({
        contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
        documentUrls: [expectedUrl],
      });
      if (candidate.disconnected || this._portCandidate !== candidate) {
        this.rejectPortCandidate(
          candidate,
          candidate.disconnected ? 'candidate_disconnected' : 'candidate_superseded',
        );
        return;
      }
      const matchingContexts = contexts.filter(
        (context) =>
          context.contextType === chrome.runtime.ContextType.OFFSCREEN_DOCUMENT &&
          context.documentUrl === expectedUrl,
      );
      const context = matchingContexts.length === 1 ? matchingContexts[0] : undefined;
      if (!context) {
        this.rejectPortCandidate(candidate, 'context_count_mismatch');
        return;
      }
      if (!isDocumentId(context.documentId)) {
        this.rejectPortCandidate(candidate, 'invalid_document_id');
        return;
      }
      if (context.documentId !== senderDocumentId) {
        this.rejectPortCandidate(candidate, 'context_document_id_mismatch');
        return;
      }
      authenticatedContext = context;
    } catch {
      this.rejectPortCandidate(candidate, 'get_contexts_failed');
      return;
    }

    if (candidate.disconnected || this._portCandidate !== candidate) {
      this.rejectPortCandidate(
        candidate,
        candidate.disconnected ? 'candidate_disconnected' : 'candidate_superseded',
      );
      return;
    }
    if (!authenticatedContext) {
      this.rejectPortCandidate(candidate, 'context_count_mismatch');
      return;
    }
    const previousPort = this._port;
    if (previousPort && previousPort !== port) {
      this._setupComplete = false;
      this.rejectPendingForPort(
        previousPort,
        new Error('Nym offscreen IPC port was replaced'),
      );
    }
    this._port = port;
    candidate.accepted = true;
    this._portCandidate = null;
    previousPort?.disconnect();
    for (const resolve of this._portWaiters) resolve(port);
    this._portWaiters.clear();
    port.onMessage.addListener((raw) => this.receivePortMessage(port, raw));
    if (this._onAuthenticated) {
      const diagnostic: OffscreenMixFetchBridgeAuthenticationDiagnostic = Object.freeze({
        authenticated: true,
        senderId,
        senderUrl,
        senderDocumentId,
        contextType: authenticatedContext.contextType,
        contextDocumentUrl: expectedUrl,
        contextDocumentId: senderDocumentId,
      });
      try {
        void Promise.resolve(this._onAuthenticated(diagnostic)).catch(() => undefined);
      } catch {
        // Diagnostic failures must not affect the authenticated port.
      }
    }
    port.postMessage(NYM_OFFSCREEN_BRIDGE_AUTHENTICATED_SIGNAL);
  }

  private emitDiagnostic(diagnostic: OffscreenMixFetchBridgeDiagnostic): void {
    try {
      if (this._onDiagnostic) {
        void Promise.resolve(this._onDiagnostic(diagnostic)).catch(() => undefined);
      } else {
        console.info(
          `[Astrym][OffscreenBridge] ${diagnostic.event}`,
          diagnostic,
        );
      }
    } catch {
      // Diagnostic logging must not affect Port handling.
    }
  }

  private emitRejected(reason: OffscreenMixFetchBridgeRejectionReason): void {
    this.emitDiagnostic(
      Object.freeze({ event: 'connect_rejected' as const, reason }),
    );
  }

  private rejectPortCandidate(
    candidate: PortCandidate,
    reason: OffscreenMixFetchBridgeRejectionReason,
    disconnect = true,
  ): void {
    if (candidate.accepted) return;
    if (this._portCandidate === candidate) this._portCandidate = null;
    if (!candidate.rejectionReported) {
      candidate.rejectionReported = true;
      this.emitRejected(reason);
    }
    if (
      disconnect &&
      !candidate.disconnected &&
      this._port !== candidate.port
    ) {
      candidate.port.disconnect();
    }
  }

  private rejectPendingForPort(port: chrome.runtime.Port, error: Error): void {
    for (const [id, pending] of this._pending) {
      if (pending.port !== port) continue;
      this._pending.delete(id);
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
  }

  private receivePortMessage(port: chrome.runtime.Port, raw: unknown): void {
    if (!raw || typeof raw !== 'object' || typeof (raw as { id?: unknown }).id !== 'string') return;
    const id = (raw as { id: string }).id;
    const pending = this._pending.get(id);
    if (this._port !== port || !pending || pending.port !== port) return;
    this._pending.delete(id);
    clearTimeout(pending.timeout);
    if (!isNymOffscreenResponse(raw, id)) {
      pending.reject(new Error('Nym offscreen IPC returned malformed response'));
      return;
    }
    pending.resolve(raw);
  }

  private async waitForPort(timeoutMs = 100): Promise<chrome.runtime.Port> {
    if (this._port) return this._port;
    return new Promise((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout>;
      const onPort = (port: chrome.runtime.Port) => {
        clearTimeout(timeout);
        this._portWaiters.delete(onPort);
        resolve(port);
      };
      timeout = setTimeout(() => {
        this._portWaiters.delete(onPort);
        reject(new Error('Nym offscreen IPC port is not connected'));
      }, timeoutMs);
      this._portWaiters.add(onPort);
    });
  }

  private readinessTimeoutError(): Error {
    return Object.assign(
      new Error(`Nym offscreen runtime readiness timed out after ${this._readinessTimeoutMs}ms`),
      { code: 'NYM_OFFSCREEN_READINESS_TIMEOUT', stage: 'ipc' },
    );
  }

  private async promiseBeforeDeadline<T>(
    promise: Promise<T>,
    deadlineAt: number,
  ): Promise<T> {
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) throw this.readinessTimeoutError();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
          timeout = setTimeout(() => reject(this.readinessTimeoutError()), remainingMs);
        }),
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  private async rpc(
    request: NymOffscreenRequest,
    deadlineAt?: number,
  ): Promise<NymOffscreenResponse> {
    const remainingBeforePort = deadlineAt === undefined
      ? 100
      : deadlineAt - Date.now();
    if (remainingBeforePort <= 0) throw this.readinessTimeoutError();
    const port = await this.waitForPort(
      deadlineAt === undefined ? 100 : Math.min(100, remainingBeforePort),
    );
    const remainingBeforeDispatch = deadlineAt === undefined
      ? this._rpcTimeoutMs
      : deadlineAt - Date.now();
    if (remainingBeforeDispatch <= 0) throw this.readinessTimeoutError();
    return new Promise((resolve, reject) => {
      if (this._port !== port) {
        reject(new Error('Nym offscreen IPC port changed before request dispatch'));
        return;
      }
      const timeoutMs = Math.min(this._rpcTimeoutMs, remainingBeforeDispatch);
      const readinessTimeoutBound =
        deadlineAt !== undefined && remainingBeforeDispatch <= this._rpcTimeoutMs;
      const pending: PendingRequest = {
        port,
        resolve,
        reject,
        timeout: setTimeout(() => {
          if (this._pending.get(request.id) !== pending) return;
          this._pending.delete(request.id);
          reject(
            readinessTimeoutBound
              ? this.readinessTimeoutError()
              : Object.assign(
                  new Error(`Nym offscreen RPC timed out after ${timeoutMs}ms`),
                  { code: 'NYM_OFFSCREEN_RPC_TIMEOUT' },
                ),
          );
        }, timeoutMs),
      };
      this._pending.set(request.id, pending);
      try {
        port.postMessage(request);
      } catch (cause) {
        if (this._pending.get(request.id) === pending) {
          this._pending.delete(request.id);
          clearTimeout(pending.timeout);
        }
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      }
    });
  }

  /**
   * createDocument resolves before the offscreen module opens its authenticated port.
   * Retry ping until the runtime answers (document open ≠ MixFetch ready).
   */
  private async waitUntilRuntimeReady(deadlineAt: number): Promise<void> {
    const delayMs = 50;
    let lastError: unknown;
    while (Date.now() < deadlineAt) {
      try {
        const ping = await this.rpc({
          channel: NYM_OFFSCREEN_CHANNEL,
          target: NYM_OFFSCREEN_TARGET,
          type: 'ping',
          id: newId(),
        }, deadlineAt);
        if (ping.ok) return;
        lastError = new Error(ping.error.message);
      } catch (cause) {
        lastError = cause;
      }
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs <= 0) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, remainingMs)));
    }
    const timeoutError = this.readinessTimeoutError();
    if (lastError instanceof Error) timeoutError.message += `: ${lastError.message}`;
    throw timeoutError;
  }

  async setup(options?: NymMixFetchSetupOptions): Promise<void> {
    this._setupComplete = false;
    this._readinessStatusDeadlineAt = null;
    const deadlineAt = Date.now() + this._readinessTimeoutMs;
    if (!this._docs.isApiAvailable()) {
      throw new Error('chrome.offscreen unavailable; cannot host Nym mix-fetch');
    }
    await this.promiseBeforeDeadline(this._docs.ensureDocument(), deadlineAt);
    await this.waitUntilRuntimeReady(deadlineAt);

    const connectOptions: {
      disableCoverTraffic?: boolean;
      preferredGateway?: string;
      gatewayAllowlist?: string[];
      forceTls?: boolean;
    } = {
      // Official MixFetchOpts — browser clients use TLS/WSS to entry gateways.
      forceTls: true,
    };
    if (options?.disableCoverTraffic !== undefined) {
      connectOptions.disableCoverTraffic = Boolean(options.disableCoverTraffic);
    }
    if (typeof options?.preferredGateway === 'string' && options.preferredGateway) {
      connectOptions.preferredGateway = options.preferredGateway;
    }
    if (Array.isArray(options?.gatewayAllowlist)) {
      connectOptions.gatewayAllowlist = options.gatewayAllowlist.filter(
        (x): x is string => typeof x === 'string',
      );
    }
    if (options?.forceTls !== undefined) {
      connectOptions.forceTls = Boolean(options.forceTls);
    }
    const connectReq = {
      channel: NYM_OFFSCREEN_CHANNEL,
      target: NYM_OFFSCREEN_TARGET,
      type: 'connect' as const,
      id: newId(),
      options: connectOptions,
    };
    const connect = await this.rpc(connectReq, deadlineAt);
    if (!connect.ok) {
      throw Object.assign(new Error(connect.error.message), {
        code: connect.error.code,
        stage: connect.error.stage,
      });
    }
    const status = connect.payload as NymOffscreenStatusPayload;
    if (!status.connected) {
      throw new Error(
        status.lastError ?? 'Offscreen connect returned without connected=true',
      );
    }
    this._setupComplete = true;
    this._readinessStatusDeadlineAt = deadlineAt;
  }

  async mixFetch(url: string, init?: RequestInit): Promise<Response> {
    if (!this._setupComplete) {
      throw new Error('Nym offscreen bridge not set up');
    }
    const bodyText = await bodyToText(init?.body ?? null);
    const fetchInit: {
      method?: string;
      headers?: Record<string, string>;
      bodyText?: string | null;
      mode?: string;
    } = { bodyText };
    const operationId = (init as
      | (RequestInit & { httpSmokeOperationId?: string })
      | undefined)?.httpSmokeOperationId;
    if (init?.method) fetchInit.method = init.method;
    const headers = headersFromInit(init);
    if (headers) fetchInit.headers = headers;
    // Forward mix-fetch@1.4.2 CORS opt-out (not a clearnet bypass).
    const initMode = (init as RequestInit & { mode?: string } | undefined)?.mode;
    if (typeof initMode === 'string' && initMode.length > 0) {
      fetchInit.mode = initMode;
    }
    const res = await this.rpc({
      channel: NYM_OFFSCREEN_CHANNEL,
      target: NYM_OFFSCREEN_TARGET,
      type: 'fetch',
      id: newId(),
      url,
      ...(operationId ? { operationId } : {}),
      init: fetchInit,
    });
    if (!res.ok) {
      throw new Error(res.error.message);
    }

    const payload = res.payload as NymOffscreenFetchResult;
    const bytes = base64ToBytes(payload.bodyBase64);
    const body = new Uint8Array(bytes.byteLength);
    body.set(bytes);
    return new Response(body, {
      status: payload.status,
      statusText: payload.statusText,
      headers: payload.headers,
    });
  }

  async queryHttpSmokeOperation(
    operationId: string,
    runtimeGeneration: string,
  ): Promise<NymOffscreenHttpSmokeOperationStatus | null> {
    try {
      const res = await this.rpc({
        channel: NYM_OFFSCREEN_CHANNEL,
        target: NYM_OFFSCREEN_TARGET,
        type: 'httpSmokeStatus',
        id: newId(),
        operationId,
        runtimeGeneration,
      });
      if (!res.ok) return null;
      const status = res.payload as NymOffscreenHttpSmokeOperationStatus;
      if (
        status.operationId !== operationId ||
        status.runtimeGeneration !== runtimeGeneration ||
        !['pending', 'completed', 'failed', 'unknown'].includes(status.state)
      ) return null;
      const verifiedStatus = Object.freeze({
        operationId: status.operationId,
        runtimeGeneration: status.runtimeGeneration,
        state: status.state,
      });
      if (verifiedStatus.state === 'completed' || verifiedStatus.state === 'failed') {
        authoritativeHttpSmokeStatuses.add(verifiedStatus);
      }
      return verifiedStatus;
    } catch {
      return null;
    }
  }

  async disconnect(options?: { strict?: boolean }): Promise<void> {
    this._setupComplete = false;
    this._readinessStatusDeadlineAt = null;
    if (options?.strict) {
      let rpcError: unknown;
      let rpcFailed = false;
      let closeError: unknown;
      let closeFailed = false;
      try {
        if (!this._docs.isApiAvailable()) {
          throw new Error('chrome.offscreen API unavailable; cannot verify MixFetch cleanup');
        }
        const response = await this.rpc({
          channel: NYM_OFFSCREEN_CHANNEL,
          target: NYM_OFFSCREEN_TARGET,
          type: 'disconnect',
          id: newId(),
          strict: true,
        });
        if (!response.ok) {
          throw new Error(response.error.message);
        }
        const status = response.payload as NymOffscreenStatusPayload;
        if (status.connected !== false) {
          throw new Error('Offscreen runtime remained connected after disconnect');
        }
      } catch (cause) {
        rpcError = cause;
        rpcFailed = true;
      }

      try {
        await this._docs.closeDocumentStrict();
      } catch (cause) {
        closeError = cause;
        closeFailed = true;
      }

      if (rpcFailed) {
        throw rpcError;
      }
      if (closeFailed) {
        throw closeError;
      }
      return;
    }

    try {
      if (this._docs.isApiAvailable()) {
        await this.rpc({
          channel: NYM_OFFSCREEN_CHANNEL,
          target: NYM_OFFSCREEN_TARGET,
          type: 'disconnect',
          id: newId(),
        });
      }
    } catch {
      /* IPC loss → still mark disconnected */
    }
    await this._docs.closeDocument();
  }

  async queryStatus(): Promise<NymOffscreenStatusPayload | null> {
    const readinessDeadlineAt = this._readinessStatusDeadlineAt;
    this._readinessStatusDeadlineAt = null;
    try {
      const documentOpen = readinessDeadlineAt === null
        ? await this._docs.hasOpenDocument()
        : await this.promiseBeforeDeadline(
            this._docs.hasOpenDocument(),
            readinessDeadlineAt,
          );
      if (!documentOpen) {
        this._setupComplete = false;
        return null;
      }
      const res = await this.rpc({
        channel: NYM_OFFSCREEN_CHANNEL,
        target: NYM_OFFSCREEN_TARGET,
        type: 'status',
        id: newId(),
      }, readinessDeadlineAt ?? undefined);
      if (!res.ok) {
        this._setupComplete = false;
        return null;
      }
      const status = res.payload as NymOffscreenStatusPayload;
      if (!status.connected) this._setupComplete = false;
      return status;
    } catch {
      this._setupComplete = false;
      return null;
    }
  }
}
