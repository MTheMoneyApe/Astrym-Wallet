import { z } from 'zod';

// ==========================================
// Base Envelope & Error Types
// ==========================================

export const IpcErrorSchema = z.object({
  name: z.string(),
  message: z.string(),
});

export const BaseRequestEnvelopeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  payload: z.unknown().optional(),
});

export const BaseResponseEnvelopeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  payload: z.unknown().optional(),
  error: IpcErrorSchema.optional(),
});

// ==========================================
// Specific Payloads
// ==========================================

export const GetWalletStateRequestSchema = z.object({});
export const GetWalletStateResponseSchema = z.object({
  hasVault: z.boolean(),
  isLocked: z.boolean(),
});

export const CreateVaultRequestSchema = z.object({
  password: z.string().min(1),
});
export const CreateVaultResponseSchema = z.object({
  recoveryPhrase: z.array(z.string()).length(24),
});

export const ImportVaultRequestSchema = z.object({
  password: z.string().min(1),
  recoveryPhrase: z.array(z.string()).min(12).max(24),
});
export const ImportVaultResponseSchema = z.object({
  success: z.boolean(),
});

export const GetBalanceRequestSchema = z.object({
  address: z.string(),
});
export const GetBalanceResponseSchema = z.object({
  lamports: z.string(), // Send as string to avoid precision loss over JSON
});

export const StellarBalanceItemSchema = z.object({
  assetType: z.string(),
  balance: z.string(),
  assetCode: z.string().optional(),
  assetIssuer: z.string().optional(),
});

export const GetStellarBalanceRequestSchema = z.object({
  address: z.string(),
});
export const GetStellarBalanceResponseSchema = z.object({
  address: z.string(),
  exists: z.boolean(),
  balance: z.string(),
  asset: z.literal('XLM'),
  subentryCount: z.number().int().min(0),
  balances: z.array(StellarBalanceItemSchema),
});

export const FundStellarTestnetRequestSchema = z.object({
  address: z.string(),
});
export const FundStellarTestnetResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  txHash: z.string().optional(),
});

export const UnlockVaultRequestSchema = z.object({
  password: z.string().min(1),
});

export const UnlockVaultResponseSchema = z.object({
  success: z.boolean(),
});

export const LockVaultRequestSchema = z.object({});
export const LockVaultResponseSchema = z.object({
  success: z.boolean(),
});

export const GetAutoLockTimeoutRequestSchema = z.object({});
export const GetAutoLockTimeoutResponseSchema = z.object({
  timeoutMinutes: z.union([
    z.literal(1),
    z.literal(5),
    z.literal(10),
    z.literal(15),
    z.literal(30),
  ]),
});
export const SetAutoLockTimeoutRequestSchema = z.object({
  timeoutMinutes: GetAutoLockTimeoutResponseSchema.shape.timeoutMinutes,
});
export const SetAutoLockTimeoutResponseSchema = z.object({
  success: z.boolean(),
});
export const RecordUserActivityRequestSchema = z.object({});
export const RecordUserActivityResponseSchema = z.object({
  success: z.boolean(),
});

export const AccountInfoSchema = z.object({
  index: z.number().int().min(0),
  publicKey: z.string().min(32).max(64), // Base58 encoded string length roughly
  label: z.string(),
});

export const GetAccountsRequestSchema = z.object({});
export const GetAccountsResponseSchema = z.array(AccountInfoSchema);

export const GetActiveAccountRequestSchema = z.object({});
export const GetActiveAccountResponseSchema = z.object({
  status: z.enum(['VALID', 'NONE', 'INVALID']),
  index: z.number().int().min(0).nullable(),
});

// ==========================================
// DApp Payloads
// ==========================================

export const DappTransactionReviewSchema = z.object({
  internalRequestId: z.string().uuid(),
  origin: z.string().url(),
  account: z.string(),
  destination: z.string(),
  amountLamports: z.string(),
  estimatedFeeLamports: z.string(),
  program: z.literal('System Program (Transfer)'),
  warnings: z.array(z.string()).optional()
});

export const GetPendingApprovalsRequestSchema = z.object({});
export const GetPendingApprovalsResponseSchema = z.object({
  connectRequest: z.object({ internalRequestId: z.string().uuid(), origin: z.string().url() }).nullable(),
  signRequest: DappTransactionReviewSchema.nullable()
});

export const ApprovePendingRequestSchema = z.object({
  id: z.string().uuid(),
  approved: z.boolean()
});
export const ApprovePendingResponseSchema = z.object({
  success: z.boolean()
});

export const DappConnectRequestSchema = z.object({
  onlyIfTrusted: z.boolean().optional()
});
export const DappConnectResponseSchema = z.object({
  publicKey: z.string()
});

export const DappDisconnectRequestSchema = z.object({});
export const DappDisconnectResponseSchema = z.object({
  success: z.boolean()
});

export const DappSignRequestSchema = z.object({
  transactionBase64: z.string().min(10).max(50000)
});
export const DappSignResponseSchema = z.object({
  signature: z.string(),
  transaction: z.string()
});

// Internal Transfers
// ==========================================

export const ReviewTransferRequestSchema = z.object({
  accountIndex: z.number().int().min(0),
  destination: z.string(),
  lamports: z.string().regex(/^\d+$/)
});

export const ReviewTransferResponseSchema = z.object({
  id: z.string().uuid(),
  sourceAddress: z.string(),
  destinationAddress: z.string(),
  lamports: z.string(),
  feeLamports: z.string(),
  balanceLamports: z.string()
});

export const EstimateTransferRequestSchema = ReviewTransferRequestSchema;
export const EstimateTransferResponseSchema = z.object({
  sourceAddress: z.string(),
  destinationAddress: z.string(),
  lamports: z.string(),
  feeLamports: z.string(),
  balanceLamports: z.string()
});

export const SendTransferRequestSchema = z.object({
  id: z.string().uuid()
});

export const SendTransferResponseSchema = z.object({
  signature: z.string(),
  status: z.literal('PENDING')
});

export const ConfirmTransferRequestSchema = z.object({
  signature: z.string().min(1).max(100)
});
export const ConfirmTransferResponseSchema = z.object({
  signature: z.string(),
  status: z.enum(['CONFIRMED', 'FAILED', 'UNKNOWN'])
});

// Stellar Transfers
// ==========================================

export const EstimateStellarTransferRequestSchema = z.object({
  accountIndex: z.number().int().min(0),
  destination: z.string().min(56).max(56),
  amountXlm: z.string().regex(/^\d+(\.\d{1,7})?$/),
  memo: z.string().max(28).optional(),
});

export const EstimateStellarTransferResponseSchema = z.object({
  sourceAddress: z.string(),
  destinationAddress: z.string(),
  amountXlm: z.string(),
  feeXlm: z.string(),
  balanceXlm: z.string(),
  destinationExists: z.boolean(),
  operationType: z.enum(['payment', 'createAccount']),
});

export const ReviewStellarTransferRequestSchema = z.object({
  accountIndex: z.number().int().min(0),
  destination: z.string().min(56).max(56),
  amountXlm: z.string().regex(/^\d+(\.\d{1,7})?$/),
  memo: z.string().max(28).optional(),
});

export const ReviewStellarTransferResponseSchema = z.object({
  id: z.string().uuid(),
  sourceAddress: z.string(),
  destinationAddress: z.string(),
  amountXlm: z.string(),
  feeXlm: z.string(),
  balanceXlm: z.string(),
  destinationExists: z.boolean(),
  operationType: z.enum(['payment', 'createAccount']),
  memo: z.string().optional(),
});

export const SendStellarTransferRequestSchema = z.object({
  id: z.string().uuid(),
});

export const SendStellarTransferResponseSchema = z.object({
  txHash: z.string().length(64),
  status: z.literal('PENDING'),
});

export const ConfirmStellarTransferRequestSchema = z.object({
  txHash: z.string().length(64),
});

export const ConfirmStellarTransferResponseSchema = z.object({
  txHash: z.string(),
  status: z.enum(['CONFIRMED', 'FAILED', 'UNKNOWN']),
  ledger: z.number().optional(),
});

// Phase 10 Schemas
// ==========================================

export const ResetWalletRequestSchema = z.object({
  userConfirmed: z.boolean()
});
export const ResetWalletResponseSchema = z.object({
  success: z.boolean()
});
export const RevealRecoveryPhraseRequestSchema = z.object({ auth: z.string() });
export const RevealRecoveryPhraseResponseSchema = z.object({ recoveryPhrase: z.array(z.string()) });

export const AddAccountRequestSchema = z.object({
  idempotencyUuid: z.string().uuid(),
  label: z.string().optional()
});
export const AddAccountResponseSchema = z.object({
  account: AccountInfoSchema
});

export const SetActiveAccountRequestSchema = z.object({
  index: z.number().int().min(0)
});
export const SetActiveAccountResponseSchema = z.object({
  success: z.boolean()
});

export const RenameAccountRequestSchema = z.object({
  index: z.number().int().min(0),
  label: z.string().min(1)
});
export const RenameAccountResponseSchema = z.object({
  success: z.boolean()
});

export const NymTransportModeSchema = z.enum(['direct', 'nym']);

export const NymRuntimeSnapshotSchema = z.object({
  state: z.enum(['disconnected', 'connecting', 'connected', 'error', 'closed']),
  lastError: z.string().nullable(),
  connected: z.boolean(),
  implementation: z.string(),
  selfAddress: z.string().nullable().optional(),
  mode: NymTransportModeSchema,
  documentReady: z.boolean(),
  diagnosticCode: z.string().optional(),
  diagnosticStage: z.string().nullable().optional(),
  assetsReady: z.boolean().optional(),
  gatewayAllowlistConfigured: z.boolean().optional(),
  selectedGateway: z.string().nullable().optional(),
  gatewayIdentityKey: z.string().nullable().optional(),
  gatewayHostPermissionGranted: z.boolean().nullable().optional(),
  gatewayHostPermissionPattern: z.string().nullable().optional(),
});

export const NymConnectRequestSchema = z.object({
  disableCoverTraffic: z.boolean().optional(),
  preferredGateway: z.string().min(1).optional(),
});
export const NymConnectResponseSchema = NymRuntimeSnapshotSchema;

export const NymDisconnectRequestSchema = z.object({});
export const NymDisconnectResponseSchema = NymRuntimeSnapshotSchema;

export const NymStatusRequestSchema = z.object({});
export const NymStatusResponseSchema = NymRuntimeSnapshotSchema;

export const NymSetModeRequestSchema = z.object({
  mode: NymTransportModeSchema,
});
export const NymSetModeResponseSchema = NymRuntimeSnapshotSchema;

export const NymGatewayConfigSchema = z.object({
  gatewayOrigins: z.array(z.string()),
  selectedGateway: z.string().nullable(),
  identityKey: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

export const NymConfigureGatewayRequestSchema = z.object({
  /** Exact WSS/HTTPS origin for MV3 host permissions. */
  origin: z.string().min(1),
  /** MixFetchOpts.preferredGateway identity key (base58). */
  identityKey: z.string().min(1).optional(),
});
export const NymConfigureGatewayResponseSchema = z.object({
  config: NymGatewayConfigSchema,
  hostPermissionPattern: z.string(),
  snapshot: NymRuntimeSnapshotSchema,
});

export const NymSelectGatewayRequestSchema = z.object({
  origin: z.string().min(1),
});
export const NymSelectGatewayResponseSchema = z.object({
  config: NymGatewayConfigSchema,
  snapshot: NymRuntimeSnapshotSchema,
});

export const NymRemoveGatewayRequestSchema = z.object({
  origin: z.string().min(1),
});
export const NymRemoveGatewayResponseSchema = z.object({
  config: NymGatewayConfigSchema,
  snapshot: NymRuntimeSnapshotSchema,
});

export const NymRequestGatewayPermissionRequestSchema = z.object({
  origin: z.string().min(1).optional(),
});
export const NymRequestGatewayPermissionResponseSchema = z.object({
  origin: z.string(),
  hostPermissionPattern: z.string(),
  granted: z.boolean(),
  snapshot: NymRuntimeSnapshotSchema,
});

export const NymLiveSmokeRequestSchema = z.object({
  confirmLiveSmoke: z.boolean(),
  preferredGateway: z.string().min(1).optional(),
});
export const NymLiveSmokeResponseSchema = z.object({
  authorizedFlag: z.boolean(),
  confirmLiveSmoke: z.boolean(),
  executedCreateMixFetch: z.boolean(),
  assetsReady: z.boolean(),
  gatewayConfigured: z.boolean(),
  hostPermissionGranted: z.boolean().nullable(),
  steps: z.array(z.string()),
  snapshot: NymRuntimeSnapshotSchema,
});

export const NymHttpSmokeStateSchema = z.enum([
  'idle',
  'running',
  'success',
  'error',
  'timeout',
]);
export const NymHttpSmokeRequestSchema = z.object({
  /** Optional HTTPS echo URL (default: postman-echo.com/post). */
  url: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().max(300_000).optional(),
});
export const NymHttpSmokeResponseSchema = z.object({
  state: NymHttpSmokeStateSchema,
  url: z.string(),
  probeId: z.string(),
  durationMs: z.number(),
  httpStatus: z.number().nullable(),
  httpOk: z.boolean().nullable(),
  probeMatched: z.boolean(),
  echoedProbeId: z.string().nullable(),
  message: z.string(),
  mixFetchInvoked: z.boolean(),
});

export const NymPublicDataFetchRequestSchema = z.object({
  /** Explicit transport; defaults to current router mode when omitted. */
  transport: NymTransportModeSchema.optional(),
  url: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().max(300_000).optional(),
});
export const NymPublicDataFetchResponseSchema = z.object({
  state: NymHttpSmokeStateSchema,
  transport: NymTransportModeSchema,
  url: z.string(),
  probeId: z.string(),
  durationMs: z.number(),
  httpStatus: z.number().nullable(),
  httpOk: z.boolean().nullable(),
  probeMatched: z.boolean(),
  echoedProbeId: z.string().nullable(),
  responsePreview: z.string().nullable(),
  message: z.string(),
  transportFetchInvoked: z.boolean(),
});

// ==========================================
// Zod Router Types Map
// ==========================================

export const MessageSchemas = {
  GET_WALLET_STATE: {
    request: GetWalletStateRequestSchema,
    response: GetWalletStateResponseSchema,
  },
  CREATE_VAULT: {
    request: CreateVaultRequestSchema,
    response: CreateVaultResponseSchema,
  },
  IMPORT_VAULT: {
    request: ImportVaultRequestSchema,
    response: ImportVaultResponseSchema,
  },
  GET_BALANCE: {
    request: GetBalanceRequestSchema,
    response: GetBalanceResponseSchema,
  },
  GET_STELLAR_BALANCE: {
    request: GetStellarBalanceRequestSchema,
    response: GetStellarBalanceResponseSchema,
  },
  FUND_STELLAR_TESTNET_ACCOUNT: {
    request: FundStellarTestnetRequestSchema,
    response: FundStellarTestnetResponseSchema,
  },
  UNLOCK_VAULT: {
    request: UnlockVaultRequestSchema,
    response: UnlockVaultResponseSchema,
  },
  LOCK_VAULT: {
    request: LockVaultRequestSchema,
    response: LockVaultResponseSchema,
  },
  GET_AUTO_LOCK_TIMEOUT: {
    request: GetAutoLockTimeoutRequestSchema,
    response: GetAutoLockTimeoutResponseSchema,
  },
  SET_AUTO_LOCK_TIMEOUT: {
    request: SetAutoLockTimeoutRequestSchema,
    response: SetAutoLockTimeoutResponseSchema,
  },
  RECORD_USER_ACTIVITY: {
    request: RecordUserActivityRequestSchema,
    response: RecordUserActivityResponseSchema,
  },
  GET_ACCOUNTS: {
    request: GetAccountsRequestSchema,
    response: GetAccountsResponseSchema,
  },
  GET_ACTIVE_ACCOUNT: {
    request: GetActiveAccountRequestSchema,
    response: GetActiveAccountResponseSchema,
  },
  GET_PENDING_APPROVALS: {
    request: GetPendingApprovalsRequestSchema,
    response: GetPendingApprovalsResponseSchema,
  },
  APPROVE_DAPP_REQUEST: {
    request: ApprovePendingRequestSchema,
    response: ApprovePendingResponseSchema,
  },
  DAPP_CONNECT: {
    request: DappConnectRequestSchema,
    response: DappConnectResponseSchema,
  },
  DAPP_DISCONNECT: {
    request: DappDisconnectRequestSchema,
    response: DappDisconnectResponseSchema,
  },
  DAPP_SIGN_TRANSACTION: {
    request: DappSignRequestSchema,
    response: DappSignResponseSchema,
  },
  REVIEW_TRANSFER: {
    request: ReviewTransferRequestSchema,
    response: ReviewTransferResponseSchema,
  },
  ESTIMATE_TRANSFER: {
    request: EstimateTransferRequestSchema,
    response: EstimateTransferResponseSchema,
  },
  SEND_TRANSFER: {
    request: SendTransferRequestSchema,
    response: SendTransferResponseSchema,
  },
  CONFIRM_TRANSFER: {
    request: ConfirmTransferRequestSchema,
    response: ConfirmTransferResponseSchema,
  },
  ESTIMATE_STELLAR_TRANSFER: {
    request: EstimateStellarTransferRequestSchema,
    response: EstimateStellarTransferResponseSchema,
  },
  REVIEW_STELLAR_TRANSFER: {
    request: ReviewStellarTransferRequestSchema,
    response: ReviewStellarTransferResponseSchema,
  },
  SEND_STELLAR_TRANSFER: {
    request: SendStellarTransferRequestSchema,
    response: SendStellarTransferResponseSchema,
  },
  CONFIRM_STELLAR_TRANSFER: {
    request: ConfirmStellarTransferRequestSchema,
    response: ConfirmStellarTransferResponseSchema,
  },
  REVEAL_RECOVERY_PHRASE: { request: RevealRecoveryPhraseRequestSchema, response: RevealRecoveryPhraseResponseSchema },
  RESET_WALLET: {
    request: ResetWalletRequestSchema,
    response: ResetWalletResponseSchema,
  },
  ADD_ACCOUNT: {
    request: AddAccountRequestSchema,
    response: AddAccountResponseSchema,
  },
  SET_ACTIVE_ACCOUNT: {
    request: SetActiveAccountRequestSchema,
    response: SetActiveAccountResponseSchema,
  },
  RENAME_ACCOUNT: {
    request: RenameAccountRequestSchema,
    response: RenameAccountResponseSchema,
  },
  NYM_CONNECT: {
    request: NymConnectRequestSchema,
    response: NymConnectResponseSchema,
  },
  NYM_DISCONNECT: {
    request: NymDisconnectRequestSchema,
    response: NymDisconnectResponseSchema,
  },
  NYM_STATUS: {
    request: NymStatusRequestSchema,
    response: NymStatusResponseSchema,
  },
  NYM_SET_MODE: {
    request: NymSetModeRequestSchema,
    response: NymSetModeResponseSchema,
  },
  NYM_CONFIGURE_GATEWAY: {
    request: NymConfigureGatewayRequestSchema,
    response: NymConfigureGatewayResponseSchema,
  },
  NYM_SELECT_GATEWAY: {
    request: NymSelectGatewayRequestSchema,
    response: NymSelectGatewayResponseSchema,
  },
  NYM_REMOVE_GATEWAY: {
    request: NymRemoveGatewayRequestSchema,
    response: NymRemoveGatewayResponseSchema,
  },
  NYM_REQUEST_GATEWAY_PERMISSION: {
    request: NymRequestGatewayPermissionRequestSchema,
    response: NymRequestGatewayPermissionResponseSchema,
  },
  NYM_LIVE_SMOKE: {
    request: NymLiveSmokeRequestSchema,
    response: NymLiveSmokeResponseSchema,
  },
  NYM_HTTP_SMOKE: {
    request: NymHttpSmokeRequestSchema,
    response: NymHttpSmokeResponseSchema,
  },
  NYM_PUBLIC_DATA_FETCH: {
    request: NymPublicDataFetchRequestSchema,
    response: NymPublicDataFetchResponseSchema,
  },
  NYM_STELLAR_HORIZON_PROBE: {
    request: z.object({
      transport: NymTransportModeSchema.optional(),
      /** Logical Horizon URL (SDF). Nym mode may remap to a validated effective base. */
      horizonUrl: z.string().url().optional(),
      timeoutMs: z.number().int().positive().max(300_000).optional(),
    }),
    response: z.object({
      state: NymHttpSmokeStateSchema,
      transport: NymTransportModeSchema,
      /** Logical URL (alias of logicalUrl for older UI). */
      url: z.string(),
      logicalUrl: z.string(),
      effectiveUrl: z.string(),
      urlRewritten: z.boolean(),
      rewriteReason: z.string().nullable(),
      durationMs: z.number(),
      httpStatus: z.number().nullable(),
      httpOk: z.boolean().nullable(),
      contentType: z.string().nullable(),
      horizonVersion: z.string().nullable(),
      networkPassphrase: z.string().nullable(),
      lastLedger: z.string().nullable(),
      lastLedgerBaseFee: z.string().nullable(),
      horizonErrorType: z.string().nullable(),
      horizonErrorTitle: z.string().nullable(),
      horizonErrorDetail: z.string().nullable(),
      responsePreview: z.string().nullable(),
      message: z.string(),
      transportFetchInvoked: z.boolean(),
    }),
  },
  SPP_PRIVATE_PAYMENT: {
    request: z.object({
      enabled: z.literal(true),
      operation: z.enum(['deposit', 'transfer', 'withdraw']),
      poolContract: z.string().min(56).max(56),
      amountStroops: z.string().regex(/^[1-9][0-9]*$/),
      recipient: z.string().min(56).max(56).optional(),
      rpcUrl: z.string().url().optional(),
    }),
    response: z.object({
      operation: z.enum(['deposit', 'transfer', 'withdraw']),
      txHash: z.string().nullable(),
      rpcRoutedViaNym: z.literal(true),
    }),
  },
  NYM_SET_STELLAR_HORIZON_ENDPOINT: {
    request: z.object({
      testnetEffectiveBase: z.string().url().optional(),
      mainnetEffectiveBase: z.string().url().optional(),
    }),
    response: z.object({
      testnetEffectiveBase: z.string(),
      mainnetEffectiveBase: z.string(),
    }),
  },
} as const;





