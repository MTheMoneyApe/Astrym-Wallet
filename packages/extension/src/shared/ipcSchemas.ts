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

export const AccountInfoSchema = z.object({
  index: z.number().int().min(0),
  publicKey: z.string().min(32).max(64), // Base58 encoded string length roughly
  label: z.string(),
});

export const GetAccountsRequestSchema = z.object({});
export const GetAccountsResponseSchema = z.array(AccountInfoSchema);

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
  feeLamports: z.string()
});

export const SendTransferRequestSchema = z.object({
  id: z.string().uuid()
});

export const SendTransferResponseSchema = z.object({
  signature: z.string()
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
  UNLOCK_VAULT: {
    request: UnlockVaultRequestSchema,
    response: UnlockVaultResponseSchema,
  },
  LOCK_VAULT: {
    request: LockVaultRequestSchema,
    response: LockVaultResponseSchema,
  },
  GET_ACCOUNTS: {
    request: GetAccountsRequestSchema,
    response: GetAccountsResponseSchema,
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
  SEND_TRANSFER: {
    request: SendTransferRequestSchema,
    response: SendTransferResponseSchema,
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
  }
} as const;






