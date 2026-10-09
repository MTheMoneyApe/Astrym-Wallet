import type { z } from 'zod';
import type {
  IpcErrorSchema,
  BaseRequestEnvelopeSchema,
  BaseResponseEnvelopeSchema,
  UnlockVaultRequestSchema,
  UnlockVaultResponseSchema,
  LockVaultRequestSchema,
  LockVaultResponseSchema,
  AccountInfoSchema,
  GetAccountsRequestSchema,
  GetAccountsResponseSchema,
  GetWalletStateRequestSchema,
  GetWalletStateResponseSchema,
  CreateVaultRequestSchema,
  CreateVaultResponseSchema,
  ImportVaultRequestSchema,
  ImportVaultResponseSchema,
  GetBalanceRequestSchema,
  GetBalanceResponseSchema,
  MessageSchemas,
} from './ipcSchemas.js';

export type IpcError = z.infer<typeof IpcErrorSchema>;
export type BaseRequestEnvelope = z.infer<typeof BaseRequestEnvelopeSchema>;
export type BaseResponseEnvelope = z.infer<typeof BaseResponseEnvelopeSchema>;

export type GetWalletStateRequest = z.infer<typeof GetWalletStateRequestSchema>;
export type GetWalletStateResponse = z.infer<typeof GetWalletStateResponseSchema>;

export type CreateVaultRequest = z.infer<typeof CreateVaultRequestSchema>;
export type CreateVaultResponse = z.infer<typeof CreateVaultResponseSchema>;

export type ImportVaultRequest = z.infer<typeof ImportVaultRequestSchema>;
export type ImportVaultResponse = z.infer<typeof ImportVaultResponseSchema>;

export type GetBalanceRequest = z.infer<typeof GetBalanceRequestSchema>;
export type GetBalanceResponse = z.infer<typeof GetBalanceResponseSchema>;

export type UnlockVaultRequest = z.infer<typeof UnlockVaultRequestSchema>;
export type UnlockVaultResponse = z.infer<typeof UnlockVaultResponseSchema>;

export type LockVaultRequest = z.infer<typeof LockVaultRequestSchema>;
export type LockVaultResponse = z.infer<typeof LockVaultResponseSchema>;

export type AccountInfo = z.infer<typeof AccountInfoSchema>;
export type GetAccountsRequest = z.infer<typeof GetAccountsRequestSchema>;
export type GetAccountsResponse = z.infer<typeof GetAccountsResponseSchema>;

export type DappTransactionReview = z.infer<typeof import('./ipcSchemas.js').DappTransactionReviewSchema>;
export type GetPendingApprovalsRequest = z.infer<typeof import('./ipcSchemas.js').GetPendingApprovalsRequestSchema>;
export type GetPendingApprovalsResponse = z.infer<typeof import('./ipcSchemas.js').GetPendingApprovalsResponseSchema>;
export type ApprovePendingRequest = z.infer<typeof import('./ipcSchemas.js').ApprovePendingRequestSchema>;
export type ApprovePendingResponse = z.infer<typeof import('./ipcSchemas.js').ApprovePendingResponseSchema>;
export type DappConnectRequest = z.infer<typeof import('./ipcSchemas.js').DappConnectRequestSchema>;
export type DappConnectResponse = z.infer<typeof import('./ipcSchemas.js').DappConnectResponseSchema>;
export type DappDisconnectRequest = z.infer<typeof import('./ipcSchemas.js').DappDisconnectRequestSchema>;
export type DappDisconnectResponse = z.infer<typeof import('./ipcSchemas.js').DappDisconnectResponseSchema>;
export type DappSignRequest = z.infer<typeof import('./ipcSchemas.js').DappSignRequestSchema>;
export type DappSignResponse = z.infer<typeof import('./ipcSchemas.js').DappSignResponseSchema>;

export type ReviewTransferRequest = z.infer<typeof import('./ipcSchemas.js').ReviewTransferRequestSchema>;
export type ReviewTransferResponse = z.infer<typeof import('./ipcSchemas.js').ReviewTransferResponseSchema>;
export type SendTransferRequest = z.infer<typeof import('./ipcSchemas.js').SendTransferRequestSchema>;
export type SendTransferResponse = z.infer<typeof import('./ipcSchemas.js').SendTransferResponseSchema>;

export type MessageTypes = keyof typeof MessageSchemas;

export type ValidatedRequestPayload<T extends MessageTypes> = z.infer<typeof MessageSchemas[T]['request']>;
export type ValidatedResponsePayload<T extends MessageTypes> = z.infer<typeof MessageSchemas[T]['response']>;
