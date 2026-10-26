// Crypto
export * from './crypto/types.js';
export * from './crypto/entropy.js';
export * from './crypto/mnemonic.js';
export * from './crypto/hdDerive.js';

// Vault
export * from './vault/types.js';
export * from './vault/IVaultStorage.js';
export * from './vault/IVaultUnlocker.js';
export * from './vault/IAlarmService.js';
export * from './vault/PasswordUnlocker.js';
export * from './vault/VaultService.js';
export { ChromePersistentStorage } from './vault/ChromePersistentStorage.js';
export { ChromeSessionStorage } from './vault/ChromeSessionStorage.js';

// Signer
export * from './signer/types.js';
export * from './signer/ISigner.js';
export * from './signer/SoftwareSigner.js';

// KeyManager
export * from './keyManager/types.js';
export * from './keyManager/IAccountStorage.js';
export { ChromeAccountStorage, ACCOUNTS_STORAGE_KEY } from './keyManager/ChromeAccountStorage.js';
export * from './keyManager/KeyManager.js';

// Stellar
export { StrKey } from '@stellar/stellar-sdk';
export * from './stellar/accounts/types.js';
export * from './stellar/accounts/StellarAccountService.js';
export * from './stellar/read/types.js';
export * from './stellar/read/StellarReadClient.js';
export * from './stellar/transaction/types.js';
export * from './stellar/transaction/StellarTransactionClient.js';

// Stellar Private Payments — signature adapter + read-only session (no deposit/transfer UI yet)
export { SppWalletSignerAdapter, SppSignerError, verifySep53Signature } from './stellar/spp/SppWalletSignerAdapter.js';
export {
  createContextualSignatureGate,
  createRejectingSignatureGate,
  contextsEqual,
  digestToHex,
} from './stellar/spp/signatureGate.js';
export type {
  ContextualGateApprovalMode,
  ContextualSignatureGate,
  SignatureAuthContext,
  SignatureAuthorizationGate,
  SignatureKind,
  SignatureLease,
} from './stellar/spp/signatureGate.js';
export { encodeSep53Message, hashSep53Message, STELLAR_SIGNED_MESSAGE_PREFIX } from './stellar/spp/sep53.js';
export {
  SppSession,
  SppSessionError,
  createSppSdkRuntime,
} from './stellar/spp/SppSession.js';
export type {
  SppAssetUrls,
  SppCreateClientArgs,
  SppReadOnlyClient,
  SppSdkRuntimeDeps,
  SppSessionConfig,
  SppSessionErrorCode,
  SppSessionRuntime,
  SppSessionState,
} from './stellar/spp/SppSession.js';
export {
  SppIntegrationStatus,
  SPP_SESSION_STATUS_STORAGE_KEY,
  applyStoredSppSessionClearIfNewer,
  applyStoredSppSessionStatusIfNewer,
  createPopupSppIntegrationProbe,
  describeSppIntegrationAvailability,
  parseStoredSppSessionStatus,
  parseStoredSppSessionStatusRecord,
  probeSppFacadePackaged,
  readSppSessionStatusHandle,
  toStoredSppSessionClear,
  toStoredSppSessionStatus,
} from './stellar/spp/SppIntegrationStatus.js';
export type {
  SppIntegrationAvailability,
  SppIntegrationCapability,
  SppIntegrationCapabilities,
  SppIntegrationError,
  SppIntegrationErrorCode,
  SppIntegrationProbe,
  SppIntegrationSnapshot,
  SppSessionStatusHandle,
  SppSessionStatusPublishMeta,
  StoredSppSessionStatus,
} from './stellar/spp/SppIntegrationStatus.js';

// Nym mixnet HTTP transport (mix-fetch) + fail-closed router
export {
  UnavailableNymTransport,
  MixFetchNymTransport,
  NymTransportError,
  createNymTransport,
  createMixFetchNymTransport,
  createNymTransportAsync,
} from './nym/NymTransport.js';
export type {
  NymTransport,
  NymHttpTransport,
  NymTransportConfig,
  NymTransportSnapshot,
  NymTransportState,
} from './nym/NymTransport.js';
export {
  tryLoadOfficialMixFetchBridge,
  toSetupMixFetchOps,
} from './nym/NymMixFetchBridge.js';
export type {
  NymMixFetchBridge,
  NymMixFetchSetupOptions,
  SetupMixFetchOps,
} from './nym/NymMixFetchBridge.js';
export type {
  MixFetchOpts,
  MixFetchOptsSimple,
} from './nym/MixFetchOpts.js';
export {
  FailClosedTransportRouter,
  createFailClosedTransportRouter,
  STELLAR_HTTP_OPERATIONS_VIA_POLICY,
} from './nym/NymTransportPolicy.js';
export type {
  NymTransportMode,
  StellarHttpOperation,
  FailClosedTransportRouterOptions,
} from './nym/NymTransportPolicy.js';
// Note: createPermissiveSignatureGate was removed. Use createContextualSignatureGate
// (default require-prior-approval). Tests may use approvalMode 'bind-on-authorize'
// via direct import from signatureGate — not a production authorization path.
// SppSession is RO-only; wire createSppSdkRuntime from an extension page host (Fase 3).
// SppIntegrationStatus is a UI/status contract only — does not initialize the SDK.
