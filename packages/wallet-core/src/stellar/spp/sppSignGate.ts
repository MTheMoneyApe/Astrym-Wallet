/**
 * Single choke point for SPP signatures.
 *
 * Vault HD ({@link SppWalletSignerAdapter}) and any future disposable Testnet
 * key must obtain a digest from {@link authorizeSppSignature} /
 * {@link signDigestWithSppGate} before Ed25519. There is no skip flag and no
 * Public-network denylist: the passphrase must be exactly `Networks.TESTNET`.
 *
 * Disposable Testnet signer plug-in (do not sign raw XDR in a side branch):
 *
 *   await signDigestWithSppGate({
 *     kind, input, boundAccount,
 *     networkPassphrase: Networks.TESTNET,
 *     signer: { signDigest: (digest) => disposable.sign(digest) },
 *   });
 *
 * {@link assertSppAssembledFees} is the fee check for both paths:
 * - background / any signer: `tx.fee` on the envelope, and `minResourceFee`
 *   when the approval recorded a simulation;
 * - spp-host: the same function, via the host fee scope, when the host signer
 *   sees the assembled transaction or a simulated resource fee.
 */

import {
  Address,
  FeeBumpTransaction,
  Networks,
  StrKey,
  Transaction,
  TransactionBuilder,
  hash,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import { hashSep53Message } from './sep53.js';
import {
  SPP_PROPOSED_MAX_FEE_STROOPS,
  assertFeeWithinCeiling,
  type SppFeeOperation,
} from './sppFeePolicy.js';
import {
  digestToHex,
  type SignatureAuthContext,
  type SignatureKind,
} from './signatureGate.js';

export class SppSignerError extends Error {
  readonly code: 'UNAUTHORIZED' | 'INVALID_REQUEST';

  constructor(message: string, code: 'UNAUTHORIZED' | 'INVALID_REQUEST' = 'UNAUTHORIZED') {
    super(message);
    this.name = 'SppSignerError';
    this.code = code;
  }
}

export type SppSignOperation = SppFeeOperation;

export type SppSignatureKind = SignatureKind;

/** User-approved SPP intent. Fields are copied and frozen at mint time. */
export type SppSignIntent = {
  operation: SppSignOperation;
  /** Positive stroops. Null for register_public_keys. */
  amountStroops: string | null;
  /** G… recipient. Null for deposit and register. Withdraw may be null (self). */
  recipient: string | null;
  networkPassphrase: string;
  poolContractId: string | null;
  registryContractId: string | null;
  /**
   * Token contract a deposit auth entry must `transfer`. Required for deposit.
   * Taken from the enabled pool's configured token, not invented here.
   */
  tokenContractId: string | null;
  /** 32-byte note public key, hex. Required for register. */
  registerNoteKeyHex: string | null;
  /** 32-byte encryption public key, hex. Required for register. */
  registerEncryptionKeyHex: string | null;
  /**
   * Optional `note_key_proof` bytes, hex. Null means the register map must
   * not contain a proof (SDK 0.2.1). A non-null value must match exactly.
   */
  registerNoteKeyProofHex: string | null;
  maxFeeStroops: string;
  /**
   * Simulated Soroban minResourceFee, when the preparer measured one.
   * Null if no simulation was available. Never invent a value.
   */
  minResourceFeeStroops: string | null;
  account: string;
  /**
   * Exact SEP-53 message the user reviewed. Null refuses every signMessage.
   * Only register_public_keys may set this.
   */
  exactMessage: string | null;
};

export type SppAssembledFeeInput = {
  operation: SppSignOperation;
  approvedMaxFeeStroops: string | bigint;
  txFeeStroops?: string | bigint | null;
  minResourceFeeStroops?: string | bigint | null;
  /** When true, a missing tx.fee is a refusal. Transaction signing sets this. */
  requireTxFee?: boolean;
  /** When true, a missing minResourceFee is a refusal. */
  requireMinResourceFee?: boolean;
};

export type SppDigestSigner = {
  signDigest(digest: Uint8Array): Promise<Uint8Array>;
};

export type SppSignAuthorization = {
  readonly kind: SppSignatureKind;
  readonly digest: Uint8Array;
  readonly context: SignatureAuthContext;
  readonly unsignedTransactionXdr: string | null;
  readonly approvalId: string;
};

const APPROVAL_TTL_MS = 120_000;

type UsedSlots = Record<SppSignatureKind, boolean>;

type StoredApproval = {
  id: string;
  intent: SppSignIntent;
  mintedAtMs: number;
  expiresAtMs: number;
  used: UsedSlots;
};

const pending: StoredApproval[] = [];

type InvokeContractView = {
  contractAddress: xdr.ScAddress;
  functionName: { toString(): string };
  args: xdr.ScVal[];
};

type InvocationView = {
  function?: {
    type?: string;
    contractFn?: InvokeContractView;
  };
  subInvocations?: InvocationView[];
};

type ParsedInvocation = {
  contractId: string;
  functionName: string;
  args: xdr.ScVal[];
  subInvocations: InvocationView[];
};

/** Testnet allowlist. Futurenet, Public, standalone, and whitespace variants all fail. */
/**
 * SEP-53 message the SDK 0.2.1 wallet signs to derive privacy keys.
 * `kdfDomain` is the contract config domain, trimmed the same way as the SDK.
 */
export function sppKeyDerivationMessage(kdfDomain: string): string {
  const domain = kdfDomain.trim();
  if (domain.length === 0 || /[()\r\n]/.test(domain)) {
    throw new SppSignerError('KDF domain is not safe to bind into the derivation message', 'INVALID_REQUEST');
  }
  return `Privacy Pool Key Derivation [v2] (${domain})`;
}

export function assertStellarTestnetPassphrase(passphrase: string): void {
  if (passphrase !== Networks.TESTNET) {
    throw new SppSignerError('Only the Stellar Testnet passphrase is allowed');
  }
}

/**
 * Compare an assembled fee with the per-operation ceiling and the user cap.
 * `tx.fee` is the envelope fee (inclusion + Soroban resource fee).
 * `minResourceFee` is the simulated resource fee when the caller has one.
 */
export function assertSppAssembledFees(input: SppAssembledFeeInput): void {
  let approved: bigint;
  try {
    approved = typeof input.approvedMaxFeeStroops === 'bigint'
      ? input.approvedMaxFeeStroops
      : parseInteger(input.approvedMaxFeeStroops, 'approved max fee');
  } catch (cause) {
    if (cause instanceof SppSignerError) throw cause;
    throw new SppSignerError('Approved max fee is not an integer', 'INVALID_REQUEST');
  }
  try {
    assertFeeWithinCeiling(input.operation, approved);
  } catch (cause) {
    throw new SppSignerError(
      cause instanceof Error ? cause.message : 'Fee ceiling violated',
    );
  }
  const ceiling = BigInt(SPP_PROPOSED_MAX_FEE_STROOPS[input.operation]);
  const txFee = readFee(input.txFeeStroops, input.requireTxFee === true, 'tx.fee');
  const resource = readFee(
    input.minResourceFeeStroops,
    input.requireMinResourceFee === true,
    'minResourceFee',
  );
  if (txFee !== null) {
    assertFeeAtMost(txFee, approved, ceiling, 'tx.fee', input.operation);
  }
  if (resource !== null) {
    assertFeeAtMost(resource, approved, ceiling, 'minResourceFee', input.operation);
  }
  if (txFee !== null && resource !== null && txFee < resource) {
    throw new SppSignerError(
      `tx.fee ${txFee.toString()} is below simulated minResourceFee ${resource.toString()}`,
    );
  }
}

export function mintSppSignApproval(intent: SppSignIntent, nowMs: number = Date.now()): string {
  const frozen = freezeIntent(intent);
  const id = crypto.randomUUID();
  pending.push({
    id,
    intent: frozen,
    mintedAtMs: nowMs,
    expiresAtMs: nowMs + APPROVAL_TTL_MS,
    used: { message: false, transaction: false, auth_entry: false },
  });
  return id;
}

/** Test-only. Production has no message that clears used approvals. */
export function resetSppSignApprovalsForTests(): void {
  pending.length = 0;
}

/**
 * Match the payload to one unused approval, consume that slot, and return
 * the digest that may be signed. Throws otherwise. Does not sign.
 */
export function authorizeSppSignature(args: {
  kind: SppSignatureKind;
  input: string;
  boundAccount: string;
  networkPassphrase: string;
  nowMs?: number;
}): SppSignAuthorization {
  assertStellarTestnetPassphrase(args.networkPassphrase);
  if (args.boundAccount.length === 0 || !StrKey.isValidEd25519PublicKey(args.boundAccount)) {
    throw new SppSignerError('Bound account must be a G… address', 'INVALID_REQUEST');
  }
  const nowMs = args.nowMs ?? Date.now();
  const prepared = prepareSignature(args.kind, args.input, args.boundAccount, args.networkPassphrase);
  const approval = consumeMatchingApproval(prepared.facts, args.kind, nowMs, args.boundAccount);
  const context: SignatureAuthContext = {
    kind: args.kind,
    account: args.boundAccount,
    networkPassphrase: Networks.TESTNET,
    payloadDigestHex: digestToHex(prepared.digest),
  };
  return {
    kind: args.kind,
    digest: prepared.digest,
    context,
    unsignedTransactionXdr: prepared.unsignedTransactionXdr,
    approvalId: approval.id,
  };
}

/**
 * Authorize then sign. A disposable Testnet key implements {@link SppDigestSigner}
 * and is not given the XDR. The same intent, network, and fee checks run first.
 */
export async function signDigestWithSppGate(args: {
  kind: SppSignatureKind;
  input: string;
  boundAccount: string;
  networkPassphrase: string;
  signer: SppDigestSigner;
  nowMs?: number;
}): Promise<{ signature: Uint8Array; authorization: SppSignAuthorization }> {
  const authorization = authorizeSppSignature({
    kind: args.kind,
    input: args.input,
    boundAccount: args.boundAccount,
    networkPassphrase: args.networkPassphrase,
    ...(args.nowMs !== undefined ? { nowMs: args.nowMs } : {}),
  });
  const signature = await args.signer.signDigest(authorization.digest);
  return { signature, authorization };
}

/**
 * Network, variant, address, and invocation preamble for an auth-entry preimage.
 * Host and background both use this. Contract/function/amount checks are in
 * {@link authorizeSppSignature}; the host also compares the contract to its scope.
 */
export function inspectSppAuthEntry(
  xdrInput: string,
  boundAccount: string,
): ParsedInvocation & { address: string | null } {
  assertStellarTestnetPassphrase(Networks.TESTNET);
  const preimage = parseAuthPreimage(xdrInput);
  assertAuthPreamble(preimage, boundAccount);
  const invocation = readInvocation(preimage.invocation);
  return { ...invocation, address: preimage.address };
}

type SignatureFacts = {
  operationHint: SppSignOperation | null;
  contractId: string | null;
  functionName: string | null;
  amountStroops: bigint | null;
  recipient: string | null;
  sender: string | null;
  exactMessage: string | null;
  txFeeStroops: bigint | null;
  invocation: ParsedInvocation | null;
  registerOwner: string | null;
  registerNoteKeyHex: string | null;
  registerEncryptionKeyHex: string | null;
  registerNoteKeyProofHex: string | null;
};

type PreparedSignature = {
  facts: SignatureFacts;
  digest: Uint8Array;
  unsignedTransactionXdr: string | null;
};

function prepareSignature(
  kind: SppSignatureKind,
  input: string,
  boundAccount: string,
  networkPassphrase: string,
): PreparedSignature {
  switch (kind) {
    case 'message':
      return prepareMessage(input);
    case 'transaction':
      return prepareTransaction(input, boundAccount, networkPassphrase);
    case 'auth_entry':
      return prepareAuthEntry(input, boundAccount);
    default: {
      const unexpected: never = kind;
      throw new SppSignerError(`Unknown signature kind ${String(unexpected)}`, 'INVALID_REQUEST');
    }
  }
}

function prepareMessage(message: string): PreparedSignature {
  if (typeof message !== 'string') {
    throw new SppSignerError('signMessage requires a string message', 'INVALID_REQUEST');
  }
  return {
    facts: {
      operationHint: 'register_public_keys',
      contractId: null,
      functionName: null,
      amountStroops: null,
      recipient: null,
      sender: null,
      exactMessage: message,
      txFeeStroops: null,
      invocation: null,
      registerOwner: null,
      registerNoteKeyHex: null,
      registerEncryptionKeyHex: null,
      registerNoteKeyProofHex: null,
    },
    digest: hashSep53Message(message),
    unsignedTransactionXdr: null,
  };
}

function prepareTransaction(
  xdrInput: string,
  boundAccount: string,
  networkPassphrase: string,
): PreparedSignature {
  if (typeof xdrInput !== 'string' || xdrInput.length === 0) {
    throw new SppSignerError('signTransaction requires a non-empty XDR string', 'INVALID_REQUEST');
  }
  let parsed: Transaction | FeeBumpTransaction;
  try {
    parsed = TransactionBuilder.fromXDR(xdrInput, networkPassphrase);
  } catch {
    throw new SppSignerError('Invalid transaction XDR or network passphrase mismatch', 'INVALID_REQUEST');
  }
  if (parsed instanceof FeeBumpTransaction) {
    throw new SppSignerError('Fee-bump transactions are not supported by this adapter');
  }
  const tx = parsed;
  if (tx.source !== boundAccount) {
    throw new SppSignerError('Transaction source does not match the bound Stellar account');
  }
  if (tx.signatures.length > 0) {
    throw new SppSignerError('Transaction envelope already contains signatures');
  }
  if (tx.operations.length !== 1) {
    throw new SppSignerError(
      `Expected exactly one operation, got ${tx.operations.length}`,
    );
  }
  const op = tx.operations[0] as {
    type?: string;
    source?: string;
    func?: { type?: string; invokeContract?: InvokeContractView };
    auth?: Array<{ rootInvocation?: InvocationView }>;
  };
  if (op.source && op.source !== boundAccount) {
    throw new SppSignerError('Operation source does not match the bound account');
  }
  if (op.type !== 'invokeHostFunction') {
    throw new SppSignerError(
      `Operation type "${op.type ?? 'unknown'}" is not allowed; expected invokeHostFunction`,
    );
  }
  const invoke = op.func?.invokeContract;
  if (!invoke || op.func?.type !== 'hostFunctionTypeInvokeContract') {
    throw new SppSignerError('Host function is not invokeContract');
  }
  const contractId = contractIdOf(invoke.contractAddress);
  const functionName = invoke.functionName.toString();
  const txFee = parseInteger(String(tx.fee), 'tx.fee');
  let amountStroops: bigint | null = null;
  let recipient: string | null = null;
  let sender: string | null = null;
  let registerOwner: string | null = null;
  let registerNoteKeyHex: string | null = null;
  let registerEncryptionKeyHex: string | null = null;
  let registerNoteKeyProofHex: string | null = null;
  if (functionName === 'transact') {
    const ext = readTransactArgs(invoke.args, boundAccount);
    amountStroops = ext.amount;
    recipient = ext.recipient;
    sender = ext.sender;
  } else if (functionName === 'register') {
    const registered = readRegisterAccount(invoke.args);
    registerOwner = registered.owner;
    registerNoteKeyHex = registered.noteKeyHex;
    registerEncryptionKeyHex = registered.encryptionKeyHex;
    registerNoteKeyProofHex = registered.noteKeyProofHex;
  } else {
    throw new SppSignerError(`Unexpected contract function "${functionName}"`);
  }
  if (Array.isArray(op.auth)) {
    for (const entry of op.auth) {
      if (!entry?.rootInvocation) {
        throw new SppSignerError('Transaction auth entry is missing rootInvocation');
      }
      const root = readInvocation(entry.rootInvocation);
      if (root.contractId !== contractId || root.functionName !== functionName) {
        throw new SppSignerError('Transaction auth entry does not match the invoke');
      }
    }
  }
  const txHash = tx.hash();
  const digest = txHash instanceof Uint8Array ? txHash : new Uint8Array(txHash as ArrayLike<number>);
  return {
    facts: {
      operationHint: functionName === 'register' ? 'register_public_keys' : null,
      contractId,
      functionName,
      amountStroops,
      recipient,
      sender,
      exactMessage: null,
      txFeeStroops: txFee,
      invocation: null,
      registerOwner,
      registerNoteKeyHex,
      registerEncryptionKeyHex,
      registerNoteKeyProofHex,
    },
    digest,
    unsignedTransactionXdr: xdrInput,
  };
}

function prepareAuthEntry(xdrInput: string, boundAccount: string): PreparedSignature {
  const inspected = inspectSppAuthEntry(xdrInput, boundAccount);
  const preimage = parseAuthPreimage(xdrInput);
  const payload = hash(preimage.raw.toXDR());
  const digest = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  let amountStroops: bigint | null = null;
  let recipient: string | null = null;
  let sender: string | null = null;
  let registerOwner: string | null = null;
  let registerNoteKeyHex: string | null = null;
  let registerEncryptionKeyHex: string | null = null;
  let registerNoteKeyProofHex: string | null = null;
  if (inspected.functionName === 'transact') {
    const ext = readTransactArgs(inspected.args, boundAccount);
    amountStroops = ext.amount;
    recipient = ext.recipient;
    sender = ext.sender;
  } else if (inspected.functionName === 'register') {
    if (inspected.subInvocations.length !== 0) {
      throw new SppSignerError('register auth entry must not carry sub-invocations');
    }
    const registered = readRegisterAccount(inspected.args);
    registerOwner = registered.owner;
    registerNoteKeyHex = registered.noteKeyHex;
    registerEncryptionKeyHex = registered.encryptionKeyHex;
    registerNoteKeyProofHex = registered.noteKeyProofHex;
  } else {
    throw new SppSignerError(`Unexpected auth function "${inspected.functionName}"`);
  }
  return {
    facts: {
      operationHint: inspected.functionName === 'register' ? 'register_public_keys' : null,
      contractId: inspected.contractId,
      functionName: inspected.functionName,
      amountStroops,
      recipient,
      sender,
      exactMessage: null,
      txFeeStroops: null,
      invocation: inspected,
      registerOwner,
      registerNoteKeyHex,
      registerEncryptionKeyHex,
      registerNoteKeyProofHex,
    },
    digest,
    unsignedTransactionXdr: null,
  };
}

type AuthPreimageView = {
  raw: xdr.HashIdPreimage;
  typeName: string;
  networkId: unknown;
  nonce: unknown;
  signatureExpirationLedger: unknown;
  address: string | null;
  invocation: InvocationView;
};

function parseAuthPreimage(xdrInput: string): AuthPreimageView {
  if (typeof xdrInput !== 'string' || xdrInput.length === 0) {
    throw new SppSignerError('signAuthEntry requires a non-empty XDR string', 'INVALID_REQUEST');
  }
  let preimage: xdr.HashIdPreimage;
  try {
    preimage = xdr.HashIdPreimage.fromXDR(xdrInput, 'base64');
  } catch {
    throw new SppSignerError(
      'Invalid auth-entry preimage XDR (expected HashIdPreimage, not a raw transaction)',
      'INVALID_REQUEST',
    );
  }
  const typeName = String((preimage as { type?: unknown }).type ?? '');
  if (
    typeName !== 'envelopeTypeSorobanAuthorization' &&
    typeName !== 'envelopeTypeSorobanAuthorizationWithAddress'
  ) {
    throw new SppSignerError(
      `Auth preimage variant is not allowed (${typeName || 'unknown'}); expected Soroban authorization`,
    );
  }
  const value = (preimage as { value?: unknown }).value as {
    networkId?: unknown;
    nonce?: unknown;
    signatureExpirationLedger?: unknown;
    address?: xdr.ScAddress;
    invocation?: InvocationView;
  } | undefined;
  if (!value?.invocation) {
    throw new SppSignerError('Auth preimage is missing its invocation', 'INVALID_REQUEST');
  }
  let address: string | null = null;
  if (typeName === 'envelopeTypeSorobanAuthorizationWithAddress') {
    if (!value.address) {
      throw new SppSignerError('Auth preimage WithAddress is missing address');
    }
    try {
      address = Address.fromScAddress(value.address).toString();
    } catch {
      throw new SppSignerError('Auth preimage address is not a recognizable ScAddress');
    }
  }
  return {
    raw: preimage,
    typeName,
    networkId: value.networkId,
    nonce: value.nonce,
    signatureExpirationLedger: value.signatureExpirationLedger,
    address,
    invocation: value.invocation,
  };
}

function assertAuthPreamble(preimage: AuthPreimageView, boundAccount: string): void {
  if (typeof preimage.nonce !== 'bigint' && typeof preimage.nonce !== 'number') {
    throw new SppSignerError('Auth preimage nonce is missing', 'INVALID_REQUEST');
  }
  const expiration = typeof preimage.signatureExpirationLedger === 'number'
    ? preimage.signatureExpirationLedger
    : typeof preimage.signatureExpirationLedger === 'bigint'
      ? Number(preimage.signatureExpirationLedger)
      : NaN;
  if (!Number.isInteger(expiration) || expiration <= 0) {
    throw new SppSignerError('Auth preimage signatureExpirationLedger must be a positive ledger');
  }
  const expectedNetworkId = hash(new TextEncoder().encode(Networks.TESTNET));
  const got = hashBytes(preimage.networkId);
  if (!bytesEqual(got, expectedNetworkId)) {
    throw new SppSignerError('Auth preimage networkId is not Stellar Testnet');
  }
  if (preimage.address !== null) {
    if (!StrKey.isValidEd25519PublicKey(preimage.address)) {
      throw new SppSignerError('Auth preimage address is not a classic G… account');
    }
    if (preimage.address !== boundAccount) {
      throw new SppSignerError('Auth preimage address does not match the bound Stellar account');
    }
  }
}

function readInvocation(invocation: InvocationView): ParsedInvocation {
  const fn = invocation.function;
  if (!fn || fn.type !== 'sorobanAuthorizedFunctionTypeContractFn' || !fn.contractFn) {
    throw new SppSignerError('Auth invocation is not a contract function');
  }
  return {
    contractId: contractIdOf(fn.contractFn.contractAddress),
    functionName: fn.contractFn.functionName.toString(),
    args: fn.contractFn.args ?? [],
    subInvocations: invocation.subInvocations ?? [],
  };
}

function readTransactArgs(
  args: xdr.ScVal[],
  boundAccount: string,
): { amount: bigint; recipient: string; sender: string } {
  if (args.length !== 3) {
    throw new SppSignerError(
      `transact expects 3 args [proof, ext_data, sender], got ${args.length}`,
    );
  }
  let native: unknown;
  try {
    native = scValToNative(args[1]!);
  } catch {
    throw new SppSignerError('transact ext_data could not be decoded');
  }
  if (!native || typeof native !== 'object') {
    throw new SppSignerError('transact ext_data is not a map');
  }
  const record = native as { ext_amount?: unknown; recipient?: unknown };
  if (typeof record.ext_amount !== 'bigint') {
    throw new SppSignerError('transact ext_amount is not an integer');
  }
  if (record.ext_amount <= 0n) {
    throw new SppSignerError('transact ext_amount must be positive');
  }
  if (typeof record.recipient !== 'string' || !StrKey.isValidEd25519PublicKey(record.recipient)) {
    throw new SppSignerError('transact recipient is not a G… address');
  }
  let senderNative: unknown;
  try {
    senderNative = scValToNative(args[2]!);
  } catch {
    throw new SppSignerError('transact sender could not be decoded');
  }
  if (typeof senderNative !== 'string' || senderNative !== boundAccount) {
    throw new SppSignerError('transact sender does not match the bound account');
  }
  return { amount: record.ext_amount, recipient: record.recipient, sender: senderNative };
}

type RegisterAccountBytes = {
  owner: string;
  noteKeyHex: string;
  encryptionKeyHex: string;
  noteKeyProofHex: string | null;
};

function readRegisterAccount(args: xdr.ScVal[]): RegisterAccountBytes {
  if (args.length !== 1) {
    throw new SppSignerError(
      `register expects 1 Account argument, got ${args.length}`,
    );
  }
  let native: unknown;
  try {
    native = scValToNative(args[0]!);
  } catch {
    throw new SppSignerError('register Account argument could not be decoded');
  }
  if (!native || typeof native !== 'object' || Array.isArray(native)) {
    throw new SppSignerError('register Account argument is not a map');
  }
  const record = native as Record<string, unknown>;
  const allowed = new Set(['encryption_key', 'note_key', 'owner', 'note_key_proof']);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new SppSignerError(`register Account has unexpected field "${key}"`);
    }
  }
  for (const key of ['encryption_key', 'note_key', 'owner']) {
    if (!(key in record)) {
      throw new SppSignerError(`register Account is missing ${key}`);
    }
  }
  if (typeof record['owner'] !== 'string' || !StrKey.isValidEd25519PublicKey(record['owner'])) {
    throw new SppSignerError('register owner is not a G… address');
  }
  const noteKey = bytesOf(record['note_key']);
  const encryptionKey = bytesOf(record['encryption_key']);
  if (!noteKey || noteKey.byteLength !== 32 || !encryptionKey || encryptionKey.byteLength !== 32) {
    throw new SppSignerError('register note_key and encryption_key must be 32 bytes');
  }
  let noteKeyProofHex: string | null = null;
  if ('note_key_proof' in record) {
    const proof = bytesOf(record['note_key_proof']);
    if (!proof || proof.byteLength === 0) {
      throw new SppSignerError('register note_key_proof is empty');
    }
    noteKeyProofHex = toHex(proof);
  }
  return {
    owner: record['owner'],
    noteKeyHex: toHex(noteKey),
    encryptionKeyHex: toHex(encryptionKey),
    noteKeyProofHex,
  };
}

function registerBindingMatches(
  facts: {
    registerOwner: string | null;
    registerNoteKeyHex: string | null;
    registerEncryptionKeyHex: string | null;
    registerNoteKeyProofHex: string | null;
  },
  intent: SppSignIntent,
): boolean {
  if (
    intent.registerNoteKeyHex === null
    || intent.registerEncryptionKeyHex === null
    || facts.registerOwner === null
    || facts.registerNoteKeyHex === null
    || facts.registerEncryptionKeyHex === null
  ) {
    return false;
  }
  if (facts.registerOwner !== intent.account) return false;
  if (!hexEq(facts.registerNoteKeyHex, intent.registerNoteKeyHex)) return false;
  if (!hexEq(facts.registerEncryptionKeyHex, intent.registerEncryptionKeyHex)) return false;
  if (intent.registerNoteKeyProofHex === null) return facts.registerNoteKeyProofHex === null;
  return facts.registerNoteKeyProofHex !== null
    && hexEq(facts.registerNoteKeyProofHex, intent.registerNoteKeyProofHex);
}

function bytesOf(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  return null;
}

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    hex += bytes[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

function hexEq(actual: string, expected: string): boolean {
  return actual.toLowerCase() === expected.toLowerCase();
}

function assertKeyHex(value: string | null, label: string): void {
  if (value === null || !/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new SppSignerError(`Register ${label} must be 32 bytes of hex`, 'INVALID_REQUEST');
  }
}

function assertEvenHex(value: string, label: string): void {
  if (!/^[0-9a-fA-F]+$/.test(value) || value.length % 2 !== 0 || value.length === 0) {
    throw new SppSignerError(`Register ${label} must be non-empty even-length hex`, 'INVALID_REQUEST');
  }
}

function assertSubInvocations(
  subs: InvocationView[],
  expected: {
    amount: bigint;
    account: string;
    poolContractId: string;
    tokenContractId: string | null;
  },
): void {
  if (!expected.tokenContractId) {
    throw new SppSignerError('Deposit intent is missing tokenContractId', 'INVALID_REQUEST');
  }
  if (subs.length !== 1) {
    throw new SppSignerError('Deposit auth requires exactly one token.transfer sub-invocation');
  }
  const sub = subs[0]!;
  if ((sub.subInvocations?.length ?? 0) !== 0) {
    throw new SppSignerError('Auth sub-invocation must not nest further calls');
  }
  const parsed = readInvocation(sub);
  if (parsed.functionName !== 'transfer' || parsed.args.length !== 3) {
    throw new SppSignerError('Unexpected auth sub-invocation; expected token.transfer');
  }
  if (parsed.contractId !== expected.tokenContractId) {
    throw new SppSignerError('token.transfer contract does not match the approved token');
  }
  let from: unknown;
  let to: unknown;
  let amountNative: unknown;
  try {
    from = scValToNative(parsed.args[0]!);
    to = scValToNative(parsed.args[1]!);
    amountNative = scValToNative(parsed.args[2]!);
  } catch {
    throw new SppSignerError('token.transfer arguments could not be decoded');
  }
  if (from !== expected.account || to !== expected.poolContractId) {
    throw new SppSignerError('token.transfer from/to does not match the approved deposit');
  }
  if (typeof amountNative !== 'bigint' || amountNative !== expected.amount) {
    throw new SppSignerError('token.transfer amount does not match the approved amount');
  }
}

function consumeMatchingApproval(
  facts: SignatureFacts,
  kind: SppSignatureKind,
  nowMs: number,
  boundAccount: string,
): StoredApproval {
  for (let i = pending.length - 1; i >= 0; i -= 1) {
    if (pending[i]!.expiresAtMs <= nowMs) pending.splice(i, 1);
  }
  const matches: StoredApproval[] = [];
  const used: StoredApproval[] = [];
  for (const row of pending) {
    if (row.intent.account !== boundAccount) continue;
    if (!factsMatchIntent(facts, row.intent, kind)) continue;
    if (row.used[kind]) used.push(row);
    else matches.push(row);
  }
  if (matches.length > 1) {
    throw new SppSignerError('Signature authorization denied: ambiguous matching approvals');
  }
  const chosen = matches[0];
  if (!chosen) {
    if (used.length > 0) {
      throw new SppSignerError('Signature authorization denied: approval already used');
    }
    throw new SppSignerError('Signature authorization denied: no matching prior approval');
  }
  if (kind === 'transaction') {
    assertSppAssembledFees({
      operation: chosen.intent.operation,
      approvedMaxFeeStroops: chosen.intent.maxFeeStroops,
      txFeeStroops: facts.txFeeStroops,
      minResourceFeeStroops: chosen.intent.minResourceFeeStroops,
      requireTxFee: true,
      requireMinResourceFee: chosen.intent.minResourceFeeStroops !== null,
    });
    if (facts.invocation) {
      assertInvocationAgainstIntent(facts.invocation, chosen.intent, chosen.intent.account);
    }
  }
  if (kind === 'auth_entry' && facts.invocation) {
    assertInvocationAgainstIntent(facts.invocation, chosen.intent, chosen.intent.account);
    if (chosen.intent.minResourceFeeStroops !== null) {
      assertSppAssembledFees({
        operation: chosen.intent.operation,
        approvedMaxFeeStroops: chosen.intent.maxFeeStroops,
        minResourceFeeStroops: chosen.intent.minResourceFeeStroops,
        requireMinResourceFee: true,
      });
    }
  }
  chosen.used[kind] = true;
  return chosen;
}

function factsMatchIntent(facts: SignatureFacts, intent: SppSignIntent, kind: SppSignatureKind): boolean {
  switch (kind) {
    case 'message':
      return intent.exactMessage !== null && facts.exactMessage === intent.exactMessage
        && intent.operation === 'register_public_keys';
    case 'transaction':
    case 'auth_entry':
      return envelopeMatchesIntent(facts, intent);
    default: {
      const unexpected: never = kind;
      throw new SppSignerError(`Unknown signature kind ${String(unexpected)}`, 'INVALID_REQUEST');
    }
  }
}

function envelopeMatchesIntent(facts: SignatureFacts, intent: SppSignIntent): boolean {
  const expectedFn = expectedFunction(intent.operation);
  const expectedContract = contractForOperation(intent);
  if (facts.functionName !== expectedFn || facts.contractId !== expectedContract) return false;
  if (intent.operation === 'register_public_keys') {
    return registerBindingMatches(facts, intent);
  }
  if (facts.sender !== intent.account) return false;
  if (facts.amountStroops === null || facts.amountStroops !== BigInt(intent.amountStroops ?? '0')) {
    return false;
  }
  return facts.recipient === expectedRecipient(intent);
}

function assertInvocationAgainstIntent(
  invocation: ParsedInvocation,
  intent: SppSignIntent,
  account: string,
): void {
  if (invocation.contractId !== contractForOperation(intent)) {
    throw new SppSignerError('Invocation contract does not match the approved intent');
  }
  if (invocation.functionName !== expectedFunction(intent.operation)) {
    throw new SppSignerError('Invocation function does not match the approved intent');
  }
  if (intent.operation === 'register_public_keys') {
    if (invocation.subInvocations.length !== 0) {
      throw new SppSignerError('register auth entry must not carry sub-invocations');
    }
    const registered = readRegisterAccount(invocation.args);
    if (!registerBindingMatches({
      registerOwner: registered.owner,
      registerNoteKeyHex: registered.noteKeyHex,
      registerEncryptionKeyHex: registered.encryptionKeyHex,
      registerNoteKeyProofHex: registered.noteKeyProofHex,
    }, intent)) {
      throw new SppSignerError('Register arguments do not match the approved intent');
    }
    return;
  }
  const ext = readTransactArgs(invocation.args, account);
  if (ext.amount !== BigInt(intent.amountStroops ?? '0') || ext.recipient !== expectedRecipient(intent)) {
    throw new SppSignerError('Invocation amount or recipient does not match the approved intent');
  }
  if (intent.operation === 'deposit') {
    assertSubInvocations(invocation.subInvocations, {
      amount: ext.amount,
      account,
      poolContractId: contractForOperation(intent),
      tokenContractId: intent.tokenContractId,
    });
    return;
  }
  if (invocation.subInvocations.length !== 0) {
    throw new SppSignerError('Unexpected auth sub-invocation for this operation');
  }
}

function expectedFunction(operation: SppSignOperation): string {
  switch (operation) {
    case 'register_public_keys':
      return 'register';
    case 'deposit':
    case 'transfer':
    case 'withdraw':
      return 'transact';
    default: {
      const unexpected: never = operation;
      throw new SppSignerError(`Unknown SPP operation ${String(unexpected)}`, 'INVALID_REQUEST');
    }
  }
}

function contractForOperation(intent: SppSignIntent): string {
  switch (intent.operation) {
    case 'register_public_keys':
      if (!intent.registryContractId) {
        throw new SppSignerError('Register intent is missing registryContractId', 'INVALID_REQUEST');
      }
      return intent.registryContractId;
    case 'deposit':
    case 'transfer':
    case 'withdraw':
      if (!intent.poolContractId) {
        throw new SppSignerError('Pool intent is missing poolContractId', 'INVALID_REQUEST');
      }
      return intent.poolContractId;
    default: {
      const unexpected: never = intent.operation;
      throw new SppSignerError(`Unknown SPP operation ${String(unexpected)}`, 'INVALID_REQUEST');
    }
  }
}

function expectedRecipient(intent: SppSignIntent): string {
  switch (intent.operation) {
    case 'deposit':
      return intent.account;
    case 'transfer':
      if (!intent.recipient) {
        throw new SppSignerError('Transfer intent is missing recipient', 'INVALID_REQUEST');
      }
      return intent.recipient;
    case 'withdraw':
      return intent.recipient ?? intent.account;
    case 'register_public_keys':
      throw new SppSignerError('Register intent has no recipient', 'INVALID_REQUEST');
    default: {
      const unexpected: never = intent.operation;
      throw new SppSignerError(`Unknown SPP operation ${String(unexpected)}`, 'INVALID_REQUEST');
    }
  }
}

function freezeIntent(intent: SppSignIntent): SppSignIntent {
  assertStellarTestnetPassphrase(intent.networkPassphrase);
  if (!StrKey.isValidEd25519PublicKey(intent.account)) {
    throw new SppSignerError('Intent account must be a G… address', 'INVALID_REQUEST');
  }
  assertOptionalContract(intent.poolContractId, 'poolContractId');
  assertOptionalContract(intent.registryContractId, 'registryContractId');
  assertOptionalContract(intent.tokenContractId, 'tokenContractId');
  assertSppAssembledFees({
    operation: intent.operation,
    approvedMaxFeeStroops: intent.maxFeeStroops,
    minResourceFeeStroops: intent.minResourceFeeStroops,
    requireMinResourceFee: intent.minResourceFeeStroops !== null,
  });
  switch (intent.operation) {
    case 'deposit':
      assertPositiveAmount(intent.amountStroops);
      if (intent.recipient !== null) {
        throw new SppSignerError('Deposit intent must not set a recipient', 'INVALID_REQUEST');
      }
      if (!intent.poolContractId) {
        throw new SppSignerError('Deposit intent requires poolContractId', 'INVALID_REQUEST');
      }
      if (!intent.tokenContractId) {
        throw new SppSignerError('Deposit intent requires tokenContractId', 'INVALID_REQUEST');
      }
      if (intent.exactMessage !== null) {
        throw new SppSignerError('Deposit intent cannot approve a SEP-53 message', 'INVALID_REQUEST');
      }
      break;
    case 'transfer':
      assertPositiveAmount(intent.amountStroops);
      if (!intent.recipient || !StrKey.isValidEd25519PublicKey(intent.recipient)) {
        throw new SppSignerError('Transfer intent requires a G… recipient', 'INVALID_REQUEST');
      }
      if (!intent.poolContractId) {
        throw new SppSignerError('Transfer intent requires poolContractId', 'INVALID_REQUEST');
      }
      if (intent.exactMessage !== null) {
        throw new SppSignerError('Transfer intent cannot approve a SEP-53 message', 'INVALID_REQUEST');
      }
      break;
    case 'withdraw':
      assertPositiveAmount(intent.amountStroops);
      if (intent.recipient !== null && !StrKey.isValidEd25519PublicKey(intent.recipient)) {
        throw new SppSignerError('Withdraw recipient must be a G… address', 'INVALID_REQUEST');
      }
      if (!intent.poolContractId) {
        throw new SppSignerError('Withdraw intent requires poolContractId', 'INVALID_REQUEST');
      }
      if (intent.exactMessage !== null) {
        throw new SppSignerError('Withdraw intent cannot approve a SEP-53 message', 'INVALID_REQUEST');
      }
      break;
    case 'register_public_keys':
      if (intent.amountStroops !== null || intent.recipient !== null) {
        throw new SppSignerError('Register intent must not set amount or recipient', 'INVALID_REQUEST');
      }
      if (!intent.registryContractId) {
        throw new SppSignerError('Register intent requires registryContractId', 'INVALID_REQUEST');
      }
      if (intent.exactMessage === null) {
        throw new SppSignerError('Register intent requires the approved derivation message', 'INVALID_REQUEST');
      }
      assertKeyHex(intent.registerNoteKeyHex, 'note key');
      assertKeyHex(intent.registerEncryptionKeyHex, 'encryption key');
      if (intent.registerNoteKeyProofHex !== null) {
        assertEvenHex(intent.registerNoteKeyProofHex, 'note_key_proof');
      }
      break;
    default: {
      const unexpected: never = intent.operation;
      throw new SppSignerError(`Unknown SPP operation ${String(unexpected)}`, 'INVALID_REQUEST');
    }
  }
  return Object.freeze({
    operation: intent.operation,
    amountStroops: intent.amountStroops,
    recipient: intent.recipient,
    networkPassphrase: Networks.TESTNET,
    poolContractId: intent.poolContractId,
    registryContractId: intent.registryContractId,
    tokenContractId: intent.tokenContractId,
    registerNoteKeyHex: intent.registerNoteKeyHex?.toLowerCase() ?? null,
    registerEncryptionKeyHex: intent.registerEncryptionKeyHex?.toLowerCase() ?? null,
    registerNoteKeyProofHex: intent.registerNoteKeyProofHex?.toLowerCase() ?? null,
    maxFeeStroops: intent.maxFeeStroops,
    minResourceFeeStroops: intent.minResourceFeeStroops,
    account: intent.account,
    exactMessage: intent.exactMessage,
  });
}

function assertPositiveAmount(amount: string | null): void {
  if (amount === null || !/^[1-9][0-9]*$/.test(amount)) {
    throw new SppSignerError('Intent amount must be a positive stroop integer', 'INVALID_REQUEST');
  }
}

function assertOptionalContract(id: string | null, label: string): void {
  if (id === null) return;
  if (!StrKey.isValidContract(id)) {
    throw new SppSignerError(`${label} is not a C… contract`, 'INVALID_REQUEST');
  }
}

function contractIdOf(address: xdr.ScAddress): string {
  let encoded: string;
  try {
    encoded = Address.fromScAddress(address).toString();
  } catch {
    throw new SppSignerError('Invocation contract address could not be decoded');
  }
  if (!StrKey.isValidContract(encoded)) {
    throw new SppSignerError('Invocation target is not a C… contract');
  }
  return encoded;
}

function parseInteger(value: string, label: string): bigint {
  if (!/^[0-9]+$/.test(value)) {
    throw new SppSignerError(`${label} is not an integer`, 'INVALID_REQUEST');
  }
  return BigInt(value);
}

function readFee(
  value: string | bigint | null | undefined,
  required: boolean,
  label: string,
): bigint | null {
  if (value === null || value === undefined) {
    if (required) throw new SppSignerError(`${label} is required`);
    return null;
  }
  const parsed = typeof value === 'bigint' ? value : parseInteger(String(value), label);
  if (parsed <= 0n) {
    throw new SppSignerError(`${label} must be positive`);
  }
  return parsed;
}

function assertFeeAtMost(
  fee: bigint,
  approved: bigint,
  ceiling: bigint,
  label: string,
  operation: SppSignOperation,
): void {
  if (fee > ceiling) {
    throw new SppSignerError(
      `${label} ${fee.toString()} exceeds policy ceiling ${ceiling.toString()} for ${operation}`,
    );
  }
  if (fee > approved) {
    throw new SppSignerError(
      `${label} ${fee.toString()} exceeds the approved max fee ${approved.toString()}`,
    );
  }
}

function hashBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value && typeof (value as { toXDR?: unknown }).toXDR === 'function') {
    const raw = (value as { toXDR: (format: string) => Uint8Array }).toXDR('raw');
    return raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  }
  throw new SppSignerError('Auth preimage networkId is not a recognizable hash', 'INVALID_REQUEST');
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
