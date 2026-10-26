/**
 * Fase 2.36 — Strict broker envelopes for MV3 spike (no SDK).
 * Fail-closed: exact keys, sessionId, requestId, allowlisted types.
 */

export const BROKER_V = 1;

const CONTROL_TYPES = new Set([
  'RO1_OPEN_HOST',
  'RO1_PING',
  'RO1_STATUS',
  'RO1_EMERGENCY_CLOSE',
  'RO1_DISPATCH',
]);

const DISPATCH_METHODS = new Set([
  'Storage.open',
  'Client.new',
  'Client.aspState',
  'Client.allContractsData',
]);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function fail(code, message) {
  return { ok: false, code, message };
}

/**
 * @returns {{ ok: true, value: object } | { ok: false, code: string, message: string }}
 */
export function validateBrokerRequest(raw) {
  if (!isPlainObject(raw)) return fail('MALFORMED', 'request must be plain object');

  const type = raw.type;
  if (typeof type !== 'string' || !CONTROL_TYPES.has(type)) {
    return fail('UNKNOWN_METHOD', `type not allowlisted: ${String(type)}`);
  }

  const allowed =
    type === 'RO1_DISPATCH'
      ? new Set(['v', 'kind', 'sessionId', 'requestId', 'type', 'method', 'args'])
      : new Set(['v', 'kind', 'sessionId', 'requestId', 'type', 'args']);

  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) return fail('EXTRA_FIELD', `unexpected field: ${key}`);
  }

  for (const key of ['v', 'kind', 'sessionId', 'requestId', 'type']) {
    if (!(key in raw)) return fail('MALFORMED', `missing field: ${key}`);
  }

  if (raw.v !== BROKER_V) return fail('MALFORMED', 'v must be 1');
  if (raw.kind !== 'req') return fail('MALFORMED', 'kind must be req');
  if (typeof raw.sessionId !== 'string' || raw.sessionId.length < 1 || raw.sessionId.length > 128) {
    return fail('MALFORMED', 'sessionId invalid');
  }
  if (typeof raw.requestId !== 'string' || raw.requestId.length < 1 || raw.requestId.length > 128) {
    return fail('MALFORMED', 'requestId invalid');
  }

  if (type === 'RO1_DISPATCH') {
    if (typeof raw.method !== 'string' || !DISPATCH_METHODS.has(raw.method)) {
      return fail('UNKNOWN_METHOD', `dispatch method not allowlisted: ${String(raw.method)}`);
    }
    if (!('args' in raw) || !isPlainObject(raw.args)) {
      return fail('MALFORMED', 'RO1_DISPATCH requires plain object args');
    }
  } else if ('args' in raw && !isPlainObject(raw.args)) {
    return fail('MALFORMED', 'args must be plain object when present');
  } else if ('method' in raw) {
    return fail('EXTRA_FIELD', 'method only allowed on RO1_DISPATCH');
  }

  return { ok: true, value: raw };
}

export function errorResponse(sessionId, requestId, code, message) {
  return {
    v: BROKER_V,
    kind: 'res',
    sessionId: sessionId || 'unknown',
    requestId: requestId || 'unknown',
    ok: false,
    error: { code, message },
  };
}

export function okResponse(sessionId, requestId, result) {
  return {
    v: BROKER_V,
    kind: 'res',
    sessionId,
    requestId,
    ok: true,
    result,
  };
}

export function mintRequestId(prefix = 'req') {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export { DISPATCH_METHODS, CONTROL_TYPES };
