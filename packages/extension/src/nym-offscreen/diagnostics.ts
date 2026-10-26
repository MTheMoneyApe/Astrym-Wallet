/**
 * Classify mix-fetch / worker / WASM / IPC failures into typed codes.
 * Never fabricates success; used for UI + IPC error payloads.
 */

export type NymDiagnosticCode =
  | 'OK'
  | 'INVALID_MESSAGE'
  | 'UNSUPPORTED'
  | 'NOT_CONNECTED'
  | 'CLOSED'
  | 'MODULE_LOAD_FAILED'
  | 'ASSET_MISSING'
  | 'WORKER_LOAD_FAILED'
  | 'WASM_LOAD_FAILED'
  | 'BOOTSTRAP_ALLOWLIST_EMPTY'
  | 'GATEWAY_ALLOWLIST_EMPTY'
  | 'GATEWAY_NOT_ALLOWLISTED'
  | 'GATEWAY_IDENTITY_REQUIRED'
  | 'BAD_IDENTITY'
  | 'INIT_FAILED'
  | 'CONNECT_FAILED'
  | 'REQUEST_FAILED'
  | 'RUNTIME_UNAVAILABLE'
  | 'IPC_FAILED'
  | 'PERMISSION_DENIED'
  | 'PERMISSION_NOT_IN_MANIFEST'
  | 'PERMISSION_REQUEST_FAILED'
  | 'SMOKE_NOT_AUTHORIZED'
  | 'SMOKE_DRY_RUN'
  | 'PERMISSION_GESTURE_REQUIRED'
  | 'CLOCK_SKEWED';

export type NymDiagnostic = {
  code: NymDiagnosticCode;
  message: string;
  /** Optional stage hint for operators. */
  stage?:
    | 'asset-check'
    | 'module-import'
    | 'worker'
    | 'wasm'
    | 'setupMixFetch'
    | 'ipc'
    | 'fetch'
    | 'policy';
};

export function classifyNymFailure(
  cause: unknown,
  fallback: NymDiagnosticCode = 'INIT_FAILED',
): NymDiagnostic {
  if (cause && typeof cause === 'object' && 'code' in cause) {
    const coded = cause as { code: unknown; message?: unknown };
    const code = String(coded.code);
    const message =
      cause instanceof Error
        ? cause.message
        : typeof coded.message === 'string'
          ? coded.message
          : code;
    if (isNymDiagnosticCode(code)) {
      return withStage({ code, message }, stageForCode(code));
    }
  }

  const message =
    cause instanceof Error
      ? cause.message
      : typeof cause === 'string'
        ? cause
        : 'Unknown Nym runtime failure';
  const lower = message.toLowerCase();

  if (/smoke dry-run|SMOKE_DRY_RUN|confirmLiveSmoke=false/i.test(message)) {
    return withStage({ code: 'SMOKE_DRY_RUN', message }, 'policy');
  }
  if (/smoke is not authorized|SMOKE_NOT_AUTHORIZED/i.test(message)) {
    return withStage({ code: 'SMOKE_NOT_AUTHORIZED', message }, 'policy');
  }
  if (/user gesture|PERMISSION_GESTURE_REQUIRED/i.test(message)) {
    return withStage({ code: 'PERMISSION_GESTURE_REQUIRED', message }, 'policy');
  }
  if (/permission not granted|PERMISSION_DENIED|denied by user/i.test(message)) {
    return withStage({ code: 'PERMISSION_DENIED', message }, 'policy');
  }
  if (/optional_host_permissions|PERMISSION_NOT_IN_MANIFEST/i.test(message)) {
    return withStage({ code: 'PERMISSION_NOT_IN_MANIFEST', message }, 'policy');
  }
  if (/gateway allowlist is empty/i.test(message)) {
    return withStage({ code: 'GATEWAY_ALLOWLIST_EMPTY', message }, 'policy');
  }
  if (/identity key is required|GATEWAY_IDENTITY_REQUIRED/i.test(message)) {
    return withStage({ code: 'GATEWAY_IDENTITY_REQUIRED', message }, 'policy');
  }
  if (/base58|BAD_IDENTITY|not a url or hostname/i.test(message)) {
    return withStage({ code: 'BAD_IDENTITY', message }, 'policy');
  }
  if (/bootstrap.*allowlist/i.test(message)) {
    return withStage({ code: 'BOOTSTRAP_ALLOWLIST_EMPTY', message }, 'policy');
  }
  if (/not allowlisted|gateway_not_allowlisted/i.test(message)) {
    return withStage({ code: 'GATEWAY_NOT_ALLOWLISTED', message }, 'policy');
  }
  if (/asset|missing.*(wasm|worker|index\.js)|nym-mixfetch/i.test(lower)) {
    return withStage({ code: 'ASSET_MISSING', message }, 'asset-check');
  }
  if (/failed to fetch dynamically imported module|import.*nym-mixfetch|module.?load/i.test(lower)) {
    return withStage({ code: 'MODULE_LOAD_FAILED', message }, 'module-import');
  }
  if (/worker|web-worker-0/i.test(lower)) {
    return withStage({ code: 'WORKER_LOAD_FAILED', message }, 'worker');
  }
  if (/wasm|webassembly|go_conn|mix_fetch_wasm/i.test(lower)) {
    return withStage({ code: 'WASM_LOAD_FAILED', message }, 'wasm');
  }
  if (/ipc|extension context invalidated|receiving end does not exist/i.test(lower)) {
    return withStage({ code: 'IPC_FAILED', message }, 'ipc');
  }
  if (/not connected|refusing clearnet/i.test(lower)) {
    return withStage({ code: 'NOT_CONNECTED', message }, 'fetch');
  }
  if (/closed/i.test(lower)) {
    return withStage({ code: 'CLOSED', message }, 'fetch');
  }
  if (/timestamp is excessively skewed|excessively skewed|clock skew|time.*skew/i.test(lower)) {
    return withStage(
      {
        code: 'CLOCK_SKEWED',
        message:
          message +
          ' — sync this machine’s clock (Windows Time / NTP) to UTC, then retry Connect. MixFetch gateway auth rejects skewed timestamps.',
      },
      'setupMixFetch',
    );
  }
  if (/createMixFetch|setupMixFetch|mixfetch setup|`window` is not defined/i.test(lower)) {
    return withStage({ code: 'INIT_FAILED', message }, 'setupMixFetch');
  }

  return withStage({ code: fallback, message }, stageForCode(fallback));
}

function withStage(
  base: { code: NymDiagnosticCode; message: string },
  stage: NymDiagnostic['stage'],
): NymDiagnostic {
  return stage ? { ...base, stage } : base;
}

function isNymDiagnosticCode(value: string): value is NymDiagnosticCode {
  return (
    value === 'OK' ||
    value === 'INVALID_MESSAGE' ||
    value === 'UNSUPPORTED' ||
    value === 'NOT_CONNECTED' ||
    value === 'CLOSED' ||
    value === 'MODULE_LOAD_FAILED' ||
    value === 'ASSET_MISSING' ||
    value === 'WORKER_LOAD_FAILED' ||
    value === 'WASM_LOAD_FAILED' ||
    value === 'BOOTSTRAP_ALLOWLIST_EMPTY' ||
    value === 'GATEWAY_ALLOWLIST_EMPTY' ||
    value === 'GATEWAY_NOT_ALLOWLISTED' ||
    value === 'GATEWAY_IDENTITY_REQUIRED' ||
    value === 'BAD_IDENTITY' ||
    value === 'INIT_FAILED' ||
    value === 'CONNECT_FAILED' ||
    value === 'REQUEST_FAILED' ||
    value === 'RUNTIME_UNAVAILABLE' ||
    value === 'IPC_FAILED' ||
    value === 'PERMISSION_DENIED' ||
    value === 'PERMISSION_NOT_IN_MANIFEST' ||
    value === 'PERMISSION_REQUEST_FAILED' ||
    value === 'SMOKE_NOT_AUTHORIZED' ||
    value === 'SMOKE_DRY_RUN' ||
    value === 'PERMISSION_GESTURE_REQUIRED' ||
    value === 'CLOCK_SKEWED'
  );
}

function stageForCode(code: NymDiagnosticCode): NymDiagnostic['stage'] {
  switch (code) {
    case 'ASSET_MISSING':
      return 'asset-check';
    case 'MODULE_LOAD_FAILED':
      return 'module-import';
    case 'WORKER_LOAD_FAILED':
      return 'worker';
    case 'WASM_LOAD_FAILED':
      return 'wasm';
    case 'INIT_FAILED':
    case 'CONNECT_FAILED':
      return 'setupMixFetch';
    case 'IPC_FAILED':
    case 'RUNTIME_UNAVAILABLE':
      return 'ipc';
    case 'GATEWAY_ALLOWLIST_EMPTY':
    case 'GATEWAY_NOT_ALLOWLISTED':
    case 'GATEWAY_IDENTITY_REQUIRED':
    case 'BAD_IDENTITY':
    case 'BOOTSTRAP_ALLOWLIST_EMPTY':
    case 'PERMISSION_DENIED':
    case 'PERMISSION_NOT_IN_MANIFEST':
    case 'PERMISSION_REQUEST_FAILED':
    case 'SMOKE_NOT_AUTHORIZED':
    case 'SMOKE_DRY_RUN':
    case 'PERMISSION_GESTURE_REQUIRED':
      return 'policy';
    case 'CLOCK_SKEWED':
      return 'setupMixFetch';
    case 'REQUEST_FAILED':
    case 'NOT_CONNECTED':
    case 'CLOSED':
      return 'fetch';
    default:
      return undefined;
  }
}
