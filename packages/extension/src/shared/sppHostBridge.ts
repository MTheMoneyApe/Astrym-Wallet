/**
 * Explicit message bridge between the background service worker and the
 * spp-host page (separate execution contexts).
 *
 * Objects such as WASM `PrivatePool` / `Client` / OPFS `Storage` cannot be
 * structured-cloned across SW ↔ tab. Only validated JSON payloads cross.
 *
 * Never put seeds, private keys, mnemonics, or CryptoKey material on this channel.
 * Signatures may cross as base64; digests and XDR are public protocol material.
 */

import { z } from 'zod';

export const SPP_HOST_BRIDGE_CHANNEL = 'astrym-spp-host-bridge' as const;

export const SppHostPoolLifecycleStateSchema = z.enum([
  'cleared',
  'session_ready_readonly',
  'write_pool_ready',
  'error',
]);

export type SppHostPoolLifecycleState = z.infer<typeof SppHostPoolLifecycleStateSchema>;

export const SppHostLifecycleEventSchema = z.object({
  channel: z.literal(SPP_HOST_BRIDGE_CHANNEL),
  type: z.literal('SPP_HOST_POOL_LIFECYCLE'),
  generation: z.number().int().positive(),
  state: SppHostPoolLifecycleStateSchema,
  message: z.string().max(400).optional(),
});

export type SppHostLifecycleEvent = z.infer<typeof SppHostLifecycleEventSchema>;

export const SppHostExecuteRequestSchema = z.object({
  channel: z.literal(SPP_HOST_BRIDGE_CHANNEL),
  type: z.literal('SPP_HOST_EXECUTE_PRIVATE_PAYMENT'),
  id: z.string().min(1),
  payload: z.object({
    operation: z.enum(['deposit', 'transfer', 'withdraw']),
    poolContract: z.string().min(56).max(56),
    amountStroops: z.string().regex(/^[1-9][0-9]*$/),
    recipient: z.string().min(56).max(56).optional(),
    rpcUrl: z.string().url(),
    nymMode: z.enum(['direct', 'nym']),
    nymConnected: z.boolean(),
    sppSelected: z.literal(true),
    /** Signing G… account for account-scoped sequence tracking (optional; both this and freshSequence required to engage). */
    signingAccount: z.string().min(56).max(56).optional(),
    /** Fresh Horizon sequence for signingAccount before submit. */
    freshSequence: z.string().regex(/^[0-9]+$/).optional(),
    /** Horizon sequence after confirmed submit; required to advance tracker on success. */
    nextFreshSequence: z.string().regex(/^[0-9]+$/).optional(),
    /** Deterministic auth fingerprint; derived on host if omitted when sequence tracking is engaged. */
    operationFingerprint: z.string().min(8).max(256).optional(),
  }),
});

export type SppHostExecuteRequest = z.infer<typeof SppHostExecuteRequestSchema>;

export const SppHostExecuteSuccessSchema = z.object({
  channel: z.literal(SPP_HOST_BRIDGE_CHANNEL),
  type: z.literal('SPP_HOST_EXECUTE_PRIVATE_PAYMENT_RESULT'),
  id: z.string().min(1),
  ok: z.literal(true),
  operation: z.enum(['deposit', 'transfer', 'withdraw']),
  txHash: z.string().nullable(),
  rpcRoutedViaNym: z.literal(true),
});

export const SppHostExecuteFailureSchema = z.object({
  channel: z.literal(SPP_HOST_BRIDGE_CHANNEL),
  type: z.literal('SPP_HOST_EXECUTE_PRIVATE_PAYMENT_RESULT'),
  id: z.string().min(1),
  ok: z.literal(false),
  code: z.enum([
    'NYM_REQUIRED',
    'NOT_SELECTED',
    'INVALID_REQUEST',
    'SESSION_NOT_READY',
    'RPC_FAILED',
    'EXECUTION_FAILED',
    'HOST_UNAVAILABLE',
    'UNAUTHORIZED',
  ]),
  message: z.string().min(1).max(500),
});

export const SppHostExecuteResultSchema = z.union([
  SppHostExecuteSuccessSchema,
  SppHostExecuteFailureSchema,
]);

export type SppHostExecuteResult = z.infer<typeof SppHostExecuteResultSchema>;

/** Host → SW: request vault-backed signature (no private keys on the wire). */
export const SppHostSignRequestSchema = z.object({
  channel: z.literal(SPP_HOST_BRIDGE_CHANNEL),
  type: z.literal('SPP_HOST_SIGN'),
  id: z.string().min(1),
  payload: z.object({
    kind: z.enum(['message', 'transaction', 'auth_entry']),
    input: z.string().min(1).max(200_000),
    address: z.string().min(56).max(56).optional(),
    networkPassphrase: z.string().min(1).max(200).optional(),
  }),
});

export type SppHostSignRequest = z.infer<typeof SppHostSignRequestSchema>;

export const SppHostSignSuccessSchema = z.object({
  channel: z.literal(SPP_HOST_BRIDGE_CHANNEL),
  type: z.literal('SPP_HOST_SIGN_RESULT'),
  id: z.string().min(1),
  ok: z.literal(true),
  kind: z.enum(['message', 'transaction', 'auth_entry']),
  signatureBase64: z.string().min(1),
  signerAddress: z.string().min(56).max(56),
});

export const SppHostSignFailureSchema = z.object({
  channel: z.literal(SPP_HOST_BRIDGE_CHANNEL),
  type: z.literal('SPP_HOST_SIGN_RESULT'),
  id: z.string().min(1),
  ok: z.literal(false),
  code: z.enum([
    'VAULT_LOCKED',
    'UNAUTHORIZED',
    'INVALID_REQUEST',
    'SIGN_FAILED',
    'NYM_REQUIRED',
  ]),
  message: z.string().min(1).max(500),
});

export const SppHostSignResultSchema = z.union([
  SppHostSignSuccessSchema,
  SppHostSignFailureSchema,
]);

export type SppHostSignResult = z.infer<typeof SppHostSignResultSchema>;

/**
 * Host → SW: proxy a Soroban-origin HTTP request through Nym-aware fetch.
 * Only same-origin as the declared rpcUrl is allowed on the SW side.
 */
export const SppHostNymFetchRequestSchema = z.object({
  channel: z.literal(SPP_HOST_BRIDGE_CHANNEL),
  type: z.literal('SPP_HOST_NYM_FETCH'),
  id: z.string().min(1),
  payload: z.object({
    rpcUrl: z.string().url(),
    url: z.string().url(),
    method: z.string().min(1).max(16),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().max(2_000_000).optional(),
  }),
});

export type SppHostNymFetchRequest = z.infer<typeof SppHostNymFetchRequestSchema>;

export const SppHostNymFetchSuccessSchema = z.object({
  channel: z.literal(SPP_HOST_BRIDGE_CHANNEL),
  type: z.literal('SPP_HOST_NYM_FETCH_RESULT'),
  id: z.string().min(1),
  ok: z.literal(true),
  status: z.number().int().min(100).max(599),
  statusText: z.string().max(200),
  headers: z.record(z.string(), z.string()),
  bodyText: z.string().max(2_000_000),
});

export const SppHostNymFetchFailureSchema = z.object({
  channel: z.literal(SPP_HOST_BRIDGE_CHANNEL),
  type: z.literal('SPP_HOST_NYM_FETCH_RESULT'),
  id: z.string().min(1),
  ok: z.literal(false),
  code: z.enum(['NYM_REQUIRED', 'ORIGIN_BLOCKED', 'RPC_FAILED', 'INVALID_REQUEST']),
  message: z.string().min(1).max(500),
});

export const SppHostNymFetchResultSchema = z.union([
  SppHostNymFetchSuccessSchema,
  SppHostNymFetchFailureSchema,
]);

export type SppHostNymFetchResult = z.infer<typeof SppHostNymFetchResultSchema>;

/** SW → host: read-only account surface (lookup / balance / notes) or gated register. */
export const SppHostAccountQueryRequestSchema = z.object({
  channel: z.literal(SPP_HOST_BRIDGE_CHANNEL),
  type: z.literal('SPP_HOST_ACCOUNT_QUERY'),
  id: z.string().min(1),
  payload: z.object({
    action: z.enum(['snapshot', 'recipient_lookup', 'sync', 'register_public_keys']),
    recipientAddress: z.string().min(56).max(56).optional(),
    nymMode: z.enum(['direct', 'nym']),
    nymConnected: z.boolean(),
  }),
});

export type SppHostAccountQueryRequest = z.infer<typeof SppHostAccountQueryRequestSchema>;

export const SppHostAccountQuerySuccessSchema = z.object({
  channel: z.literal(SPP_HOST_BRIDGE_CHANNEL),
  type: z.literal('SPP_HOST_ACCOUNT_QUERY_RESULT'),
  id: z.string().min(1),
  ok: z.literal(true),
  action: z.enum(['snapshot', 'recipient_lookup', 'sync', 'register_public_keys']),
  snapshot: z
    .object({
      userAddress: z.string().min(56).max(56),
      poolContract: z.string().min(56).max(56),
      registered: z.boolean().nullable(),
      privateBalanceStroops: z.string().nullable(),
      noteCount: z.number().int().nullable(),
    })
    .optional(),
  lookup: z
    .object({
      address: z.string().min(56).max(56),
      found: z.boolean(),
      registryFullySynced: z.boolean().nullable(),
      networkTipLedger: z.number().nullable(),
      noteKeyPresent: z.boolean(),
      encryptionKeyPresent: z.boolean(),
    })
    .optional(),
  registerTxHash: z.string().nullable().optional(),
  rpcRoutedViaNym: z.literal(true),
});

export const SppHostAccountQueryFailureSchema = z.object({
  channel: z.literal(SPP_HOST_BRIDGE_CHANNEL),
  type: z.literal('SPP_HOST_ACCOUNT_QUERY_RESULT'),
  id: z.string().min(1),
  ok: z.literal(false),
  code: z.enum([
    'NYM_REQUIRED',
    'SESSION_NOT_READY',
    'INVALID_REQUEST',
    'EXECUTION_FAILED',
    'UNAUTHORIZED',
    'HOST_UNAVAILABLE',
  ]),
  message: z.string().min(1).max(500),
});

export const SppHostAccountQueryResultSchema = z.union([
  SppHostAccountQuerySuccessSchema,
  SppHostAccountQueryFailureSchema,
]);

export type SppHostAccountQueryResult = z.infer<typeof SppHostAccountQueryResultSchema>;

export function isSppHostBridgeMessage(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const channel = (value as { channel?: unknown }).channel;
  return channel === SPP_HOST_BRIDGE_CHANNEL;
}

export function parseSppHostLifecycleEvent(value: unknown): SppHostLifecycleEvent | null {
  const parsed = SppHostLifecycleEventSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseSppHostExecuteRequest(value: unknown): SppHostExecuteRequest | null {
  const parsed = SppHostExecuteRequestSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseSppHostExecuteResult(value: unknown): SppHostExecuteResult | null {
  const parsed = SppHostExecuteResultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseSppHostSignRequest(value: unknown): SppHostSignRequest | null {
  const parsed = SppHostSignRequestSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseSppHostSignResult(value: unknown): SppHostSignResult | null {
  const parsed = SppHostSignResultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseSppHostNymFetchRequest(value: unknown): SppHostNymFetchRequest | null {
  const parsed = SppHostNymFetchRequestSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseSppHostNymFetchResult(value: unknown): SppHostNymFetchResult | null {
  const parsed = SppHostNymFetchResultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseSppHostAccountQueryRequest(
  value: unknown,
): SppHostAccountQueryRequest | null {
  const parsed = SppHostAccountQueryRequestSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseSppHostAccountQueryResult(
  value: unknown,
): SppHostAccountQueryResult | null {
  const parsed = SppHostAccountQueryResultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
