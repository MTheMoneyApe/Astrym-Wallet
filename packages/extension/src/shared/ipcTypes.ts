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
  GetActiveAccountRequestSchema,
  GetActiveAccountResponseSchema,
  GetWalletStateRequestSchema,
  GetWalletStateResponseSchema,
  CreateVaultRequestSchema,
  CreateVaultResponseSchema,
  ImportVaultRequestSchema,
  ImportVaultResponseSchema,
  GetBalanceRequestSchema,
  GetBalanceResponseSchema,
  GetStellarBalanceRequestSchema,
  GetStellarBalanceResponseSchema,
  FundStellarTestnetRequestSchema,
  FundStellarTestnetResponseSchema,
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

export type GetStellarBalanceRequest = z.infer<typeof GetStellarBalanceRequestSchema>;
export type GetStellarBalanceResponse = z.infer<typeof GetStellarBalanceResponseSchema>;

export type FundStellarTestnetRequest = z.infer<typeof FundStellarTestnetRequestSchema>;
export type FundStellarTestnetResponse = z.infer<typeof FundStellarTestnetResponseSchema>;

export type UnlockVaultRequest = z.infer<typeof UnlockVaultRequestSchema>;
export type UnlockVaultResponse = z.infer<typeof UnlockVaultResponseSchema>;

export type LockVaultRequest = z.infer<typeof LockVaultRequestSchema>;
export type LockVaultResponse = z.infer<typeof LockVaultResponseSchema>;

export type AccountInfo = z.infer<typeof AccountInfoSchema>;
export type GetAccountsRequest = z.infer<typeof GetAccountsRequestSchema>;
export type GetAccountsResponse = z.infer<typeof GetAccountsResponseSchema>;
export type GetActiveAccountRequest = z.infer<typeof GetActiveAccountRequestSchema>;
export type GetActiveAccountResponse = z.infer<typeof GetActiveAccountResponseSchema>;

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
export type EstimateTransferRequest = z.infer<typeof import('./ipcSchemas.js').EstimateTransferRequestSchema>;
export type EstimateTransferResponse = z.infer<typeof import('./ipcSchemas.js').EstimateTransferResponseSchema>;
export type SendTransferRequest = z.infer<typeof import('./ipcSchemas.js').SendTransferRequestSchema>;
export type SendTransferResponse = z.infer<typeof import('./ipcSchemas.js').SendTransferResponseSchema>;
export type ConfirmTransferRequest = z.infer<typeof import('./ipcSchemas.js').ConfirmTransferRequestSchema>;
export type ConfirmTransferResponse = z.infer<typeof import('./ipcSchemas.js').ConfirmTransferResponseSchema>;

export type EstimateStellarTransferRequest = z.infer<typeof import('./ipcSchemas.js').EstimateStellarTransferRequestSchema>;
export type EstimateStellarTransferResponse = z.infer<typeof import('./ipcSchemas.js').EstimateStellarTransferResponseSchema>;
export type ReviewStellarTransferRequest = z.infer<typeof import('./ipcSchemas.js').ReviewStellarTransferRequestSchema>;
export type ReviewStellarTransferResponse = z.infer<typeof import('./ipcSchemas.js').ReviewStellarTransferResponseSchema>;
export type SendStellarTransferRequest = z.infer<typeof import('./ipcSchemas.js').SendStellarTransferRequestSchema>;
export type SendStellarTransferResponse = z.infer<typeof import('./ipcSchemas.js').SendStellarTransferResponseSchema>;
export type ConfirmStellarTransferRequest = z.infer<typeof import('./ipcSchemas.js').ConfirmStellarTransferRequestSchema>;
export type ConfirmStellarTransferResponse = z.infer<typeof import('./ipcSchemas.js').ConfirmStellarTransferResponseSchema>;

export type MessageTypes = keyof typeof MessageSchemas;

export type ValidatedRequestPayload<T extends MessageTypes> = z.infer<typeof MessageSchemas[T]['request']>;
export type ValidatedResponsePayload<T extends MessageTypes> = z.infer<typeof MessageSchemas[T]['response']>;

export type AddAccountRequest = z.infer<typeof import('./ipcSchemas.js').AddAccountRequestSchema>;
export type AddAccountResponse = z.infer<typeof import('./ipcSchemas.js').AddAccountResponseSchema>;
export type SetActiveAccountRequest = z.infer<typeof import('./ipcSchemas.js').SetActiveAccountRequestSchema>;
export type SetActiveAccountResponse = z.infer<typeof import('./ipcSchemas.js').SetActiveAccountResponseSchema>;
export type RenameAccountRequest = z.infer<typeof import('./ipcSchemas.js').RenameAccountRequestSchema>;
export type RenameAccountResponse = z.infer<typeof import('./ipcSchemas.js').RenameAccountResponseSchema>;
export type ResetWalletRequest = z.infer<typeof import('./ipcSchemas.js').ResetWalletRequestSchema>;
export type RevealRecoveryPhraseRequest = z.infer<typeof import('./ipcSchemas.js').RevealRecoveryPhraseRequestSchema>;
export type RevealRecoveryPhraseResponse = z.infer<typeof import('./ipcSchemas.js').RevealRecoveryPhraseResponseSchema>;
export type ResetWalletResponse = z.infer<typeof import('./ipcSchemas.js').ResetWalletResponseSchema>;


