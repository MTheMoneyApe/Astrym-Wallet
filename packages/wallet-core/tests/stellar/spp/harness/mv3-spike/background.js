/**
 * Fase 2.36 — Thin MV3 service worker broker (spike only).
 * NO WASM, NO OPFS, NO vault, NO SPP SDK import.
 */

import {
  validateBrokerRequest,
  errorResponse,
  okResponse,
  BROKER_V,
} from './broker/envelope.mjs';

/** @type {chrome.runtime.Port | null} */
let hostPort = null;
let closed = false;
/** @type {Set<string>} */
const seenRequestIds = new Set();
const MAX_SEEN = 500;
/** @type {object[]} */
const auditLog = [];

function audit(event, detail) {
  auditLog.push({ at: new Date().toISOString(), event, ...detail });
  if (auditLog.length > 200) auditLog.shift();
}

function rememberRequestId(id) {
  if (seenRequestIds.has(id)) return false;
  seenRequestIds.add(id);
  if (seenRequestIds.size > MAX_SEEN) {
    const first = seenRequestIds.values().next().value;
    seenRequestIds.delete(first);
  }
  return true;
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'spp-ro1-host') {
    audit('port_reject', { name: port.name });
    port.disconnect();
    return;
  }
  if (closed) {
    port.postMessage({ type: 'SW_CLOSED', v: BROKER_V });
    port.disconnect();
    return;
  }
  hostPort = port;
  audit('host_port_connected', {});
  port.onDisconnect.addListener(() => {
    if (hostPort === port) hostPort = null;
    audit('host_port_disconnected', {});
  });
  port.onMessage.addListener((msg) => {
    // Host → SW: status / evidence only. Never SDK.
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'HOST_STATUS' || msg.type === 'HOST_EVIDENCE') {
      audit('host_message', { type: msg.type, requestId: msg.requestId || null });
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Legacy popup convenience (pre-envelope) still accepted ONLY for open/ping/status/close
  // but 2.36 operator UI should use envelopes. Dual-path documented.
  const isEnvelope =
    message &&
    typeof message === 'object' &&
    message.v === BROKER_V &&
    message.kind === 'req';

  if (isEnvelope) {
    const validated = validateBrokerRequest(message);
    if (!validated.ok) {
      audit('envelope_reject', { code: validated.code, message: validated.message });
      sendResponse(
        errorResponse(message.sessionId, message.requestId, validated.code, validated.message),
      );
      return true;
    }
    const req = validated.value;
    if (!rememberRequestId(req.requestId)) {
      audit('duplicate_requestId', { requestId: req.requestId });
      sendResponse(
        errorResponse(req.sessionId, req.requestId, 'DUPLICATE_REQUEST', 'requestId already seen'),
      );
      return true;
    }
    if (closed && req.type !== 'RO1_STATUS') {
      sendResponse(errorResponse(req.sessionId, req.requestId, 'SW_CLOSED', 'broker closed'));
      return true;
    }
    handleTyped(req, sendResponse);
    return true;
  }

  // Strict: unknown / non-envelope → reject (popup updated to envelopes)
  const type = message && message.type;
  if (typeof type === 'string' && ['RO1_OPEN_HOST', 'RO1_PING', 'RO1_STATUS', 'RO1_EMERGENCY_CLOSE'].includes(type)) {
    // Compat shim: wrap into validated path
    const wrapped = {
      v: BROKER_V,
      kind: 'req',
      sessionId: 'legacy-popup',
      requestId: `legacy-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type,
    };
    const validated = validateBrokerRequest(wrapped);
    if (!validated.ok) {
      sendResponse({ ok: false, code: validated.code, message: validated.message });
      return true;
    }
    if (closed && type !== 'RO1_STATUS') {
      sendResponse({ ok: false, code: 'SW_CLOSED' });
      return true;
    }
    handleTyped(validated.value, (res) => {
      // Flatten for old popup
      if (res && res.ok) sendResponse({ ok: true, ...(res.result || {}), closed });
      else sendResponse({ ok: false, code: res?.error?.code || 'ERROR', message: res?.error?.message });
    });
    return true;
  }

  audit('unknown_message', { from: sender?.id, keys: message && Object.keys(message) });
  sendResponse({ ok: false, code: 'UNKNOWN_METHOD' });
  return true;
});

function handleTyped(req, sendResponse) {
  const { type, sessionId, requestId } = req;

  if (type === 'RO1_PING' || type === 'RO1_STATUS') {
    sendResponse(
      okResponse(sessionId, requestId, {
        closed,
        hasHostPort: Boolean(hostPort),
        sdkInServiceWorker: false,
        auditLen: auditLog.length,
      }),
    );
    return;
  }

  if (type === 'RO1_OPEN_HOST') {
    const url = chrome.runtime.getURL('host/spp-ro1-host.html');
    chrome.tabs.create({ url }).then(
      (tab) => {
        audit('open_host', { tabId: tab.id });
        sendResponse(okResponse(sessionId, requestId, { tabId: tab.id, url }));
      },
      (err) => {
        sendResponse(
          errorResponse(sessionId, requestId, 'TAB_ERROR', String(err)),
        );
      },
    );
    return;
  }

  if (type === 'RO1_EMERGENCY_CLOSE') {
    closed = true;
    try {
      hostPort?.postMessage({
        type: 'EMERGENCY_CLOSE',
        v: BROKER_V,
        reason: 'sw_broker',
        sessionId,
        requestId,
      });
    } catch {
      /* ignore */
    }
    audit('emergency_close', { sessionId, requestId });
    sendResponse(okResponse(sessionId, requestId, { closed: true, sdkInServiceWorker: false }));
    return;
  }

  if (type === 'RO1_DISPATCH') {
    // SW does NOT execute SDK. Forward to host port if connected; else fail closed.
    if (!hostPort) {
      sendResponse(
        errorResponse(sessionId, requestId, 'NO_HOST', 'host port not connected'),
      );
      return;
    }
    try {
      hostPort.postMessage({
        type: 'DISPATCH',
        v: BROKER_V,
        sessionId,
        requestId,
        method: req.method,
        args: req.args || {},
      });
      sendResponse(
        okResponse(sessionId, requestId, {
          forwarded: true,
          note: 'Host executes RO-1; SW does not import SDK',
        }),
      );
    } catch (e) {
      sendResponse(
        errorResponse(sessionId, requestId, 'FORWARD_ERROR', String(e)),
      );
    }
    return;
  }

  sendResponse(errorResponse(sessionId, requestId, 'UNHANDLED', type));
}
