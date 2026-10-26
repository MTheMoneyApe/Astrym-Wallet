/**
 * Extract verifiable facts from a Soroban `transact` envelope + auth entries
 * using `@stellar/stellar-sdk` Transaction / xdr APIs (no handmade XDR parser).
 *
 * Layout confirmed in FASE-2.18 / upstream `b79107cd`:
 *   invoke args = [proof, ext_data, sender]
 *   ExtData keys = encrypted_output0, encrypted_output1, ext_amount, recipient
 *   (`pool_ext_data_to_scval` in sdk/native/src/chain/soroban_encode.rs)
 */

import {
  FeeBumpTransaction,
  StrKey,
  Transaction,
  TransactionBuilder,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import type { ExtractedTransactFacts } from './types.js';

export type ExtractErrorCode =
  | 'MALFORMED_TX'
  | 'FEE_BUMP'
  | 'BAD_OP_COUNT'
  | 'NOT_INVOKE'
  | 'NOT_TRANSACT'
  | 'BAD_ARGS'
  | 'BAD_EXT_DATA'
  | 'BAD_AUTH'
  | 'AUTH_PARSE'
  | 'AUTH_TX_MISMATCH';

export class ExtractError extends Error {
  readonly code: ExtractErrorCode;
  constructor(code: ExtractErrorCode, message: string) {
    super(message);
    this.name = 'ExtractError';
    this.code = code;
  }
}

type AnyScAddress = {
  type: string;
  contractId?: { value: Uint8Array };
  accountId?: unknown;
};

type AnyScVal = {
  type: string;
  map?: Array<{ key: { type: string; sym: { toString(): string } }; val: AnyScVal }>;
  i256?: { hiHi: bigint; hiLo: bigint; loHi: bigint; loLo: bigint };
  i128?: { hi: bigint; lo: bigint };
  bytes?: { value: Uint8Array };
  address?: AnyScAddress;
};

function u64(x: bigint): bigint {
  return x < 0n ? x + (1n << 64n) : x;
}

export function i256PartsToBigInt(p: {
  hiHi: bigint;
  hiLo: bigint;
  loHi: bigint;
  loLo: bigint;
}): bigint {
  return (BigInt(p.hiHi) << 192n) + (u64(BigInt(p.hiLo)) << 128n) + (u64(BigInt(p.loHi)) << 64n) + u64(BigInt(p.loLo));
}

export function i128PartsToBigInt(p: { hi: bigint; lo: bigint }): bigint {
  return (BigInt(p.hi) << 64n) + u64(BigInt(p.lo));
}

export function scAddressToStrKey(addr: AnyScAddress): string {
  if (addr.type === 'scAddressTypeContract' && addr.contractId?.value) {
    return StrKey.encodeContract(Buffer.from(addr.contractId.value));
  }
  // Account addresses round-trip via scValToNative on a wrapper ScValAddress.
  throw new ExtractError('BAD_EXT_DATA', `unsupported or incomplete ScAddress type ${addr.type}`);
}

function scValNumericToBigInt(v: AnyScVal): bigint {
  if (v.type === 'scvI256' && v.i256) return i256PartsToBigInt(v.i256);
  if (v.type === 'scvI128' && v.i128) return i128PartsToBigInt(v.i128);
  throw new ExtractError('BAD_EXT_DATA', `expected i256/i128 ScVal, got ${v.type}`);
}

function scValToAddressString(v: AnyScVal): string {
  if (v.type !== 'scvAddress') {
    throw new ExtractError('BAD_EXT_DATA', `expected address ScVal, got ${v.type}`);
  }
  const native = scValToNative(v as never);
  if (typeof native === 'string') return native;
  if (v.address) {
    if (v.address.type === 'scAddressTypeContract') return scAddressToStrKey(v.address);
  }
  throw new ExtractError('BAD_EXT_DATA', 'could not decode address ScVal');
}

function mapGet(map: NonNullable<AnyScVal['map']>, key: string): AnyScVal | undefined {
  for (const e of map) {
    if (e.key.type === 'scvSymbol' && e.key.sym.toString() === key) return e.val;
  }
  return undefined;
}

/** Reject ambiguous ExtData maps with duplicate symbol keys. */
function assertNoDuplicateMapKeys(map: NonNullable<AnyScVal['map']>): void {
  const seen = new Set<string>();
  for (const e of map) {
    if (e.key.type !== 'scvSymbol') {
      throw new ExtractError('BAD_EXT_DATA', 'ExtData map keys must be symbols');
    }
    const k = e.key.sym.toString();
    if (seen.has(k)) {
      throw new ExtractError('BAD_EXT_DATA', `duplicate ExtData key "${k}"`);
    }
    seen.add(k);
  }
}

/** Canonical XDR for ScVal wrappers (stellar-sdk 17 `toXDR`). */
export function scValToXdrBase64(v: AnyScVal): string {
  const withXdr = v as AnyScVal & { toXDR?: (fmt: string) => string };
  if (typeof withXdr.toXDR !== 'function') {
    throw new ExtractError('BAD_ARGS', 'ScVal wrapper missing toXDR');
  }
  return withXdr.toXDR('base64');
}

function parseExtData(ext: AnyScVal): {
  extAmount: bigint;
  recipientAddress: string;
  encryptedOutput0ByteLength: number;
  encryptedOutput1ByteLength: number;
} {
  if (ext.type !== 'scvMap' || !ext.map) {
    throw new ExtractError('BAD_EXT_DATA', 'ext_data must be an ScVal map');
  }
  assertNoDuplicateMapKeys(ext.map);
  const amountVal = mapGet(ext.map, 'ext_amount');
  const recipientVal = mapGet(ext.map, 'recipient');
  const enc0 = mapGet(ext.map, 'encrypted_output0');
  const enc1 = mapGet(ext.map, 'encrypted_output1');
  if (!amountVal || !recipientVal || !enc0 || !enc1) {
    throw new ExtractError(
      'BAD_EXT_DATA',
      'ExtData missing required keys encrypted_output0|encrypted_output1|ext_amount|recipient',
    );
  }
  if (enc0.type !== 'scvBytes' || enc1.type !== 'scvBytes' || !enc0.bytes || !enc1.bytes) {
    throw new ExtractError('BAD_EXT_DATA', 'encrypted_output* must be Bytes');
  }
  return {
    extAmount: scValNumericToBigInt(amountVal),
    recipientAddress: scValToAddressString(recipientVal),
    encryptedOutput0ByteLength: enc0.bytes.value.length,
    encryptedOutput1ByteLength: enc1.bytes.value.length,
  };
}

function parseAuthEntry(authXdrB64: string): {
  authRootFunctionName: string;
  authRootContractId: string;
  authRootArgs: AnyScVal[];
  authSubInvocationCount: number;
  tokenTransfer?: ExtractedTransactFacts['tokenTransfer'];
} {
  let parsed: {
    rootInvocation: {
      function: {
        type: string;
        contractFn?: {
          contractAddress: AnyScAddress;
          functionName: { toString(): string };
          args: AnyScVal[];
        };
      };
      subInvocations: Array<{
        function: {
          type: string;
          contractFn?: {
            contractAddress: AnyScAddress;
            functionName: { toString(): string };
            args: AnyScVal[];
          };
        };
        subInvocations: unknown[];
      }>;
    };
  };
  try {
    parsed = xdr.SorobanAuthorizationEntry.fromXDR(authXdrB64, 'base64') as typeof parsed;
  } catch {
    throw new ExtractError('AUTH_PARSE', 'auth entry XDR could not be decoded');
  }
  const rootFn = parsed.rootInvocation.function;
  if (rootFn.type !== 'sorobanAuthorizedFunctionTypeContractFn' || !rootFn.contractFn) {
    throw new ExtractError('BAD_AUTH', 'auth root is not ContractFn');
  }
  const authRootContractId = scAddressToStrKey(rootFn.contractFn.contractAddress);
  const authRootFunctionName = rootFn.contractFn.functionName.toString();
  const authRootArgs = rootFn.contractFn.args ?? [];
  const subs = parsed.rootInvocation.subInvocations ?? [];
  let tokenTransfer: ExtractedTransactFacts['tokenTransfer'];
  if (subs.length === 1) {
    const sub = subs[0]!;
    if (sub.subInvocations.length !== 0) {
      throw new ExtractError('BAD_AUTH', 'token transfer must not nest further sub-invocations');
    }
    const sf = sub.function;
    if (sf.type !== 'sorobanAuthorizedFunctionTypeContractFn' || !sf.contractFn) {
      throw new ExtractError('BAD_AUTH', 'auth sub-invocation is not ContractFn');
    }
    if (sf.contractFn.functionName.toString() !== 'transfer' || sf.contractFn.args.length !== 3) {
      throw new ExtractError('BAD_AUTH', 'expected sub-invocation token.transfer(from,to,amount)');
    }
    tokenTransfer = {
      tokenContractId: scAddressToStrKey(sf.contractFn.contractAddress),
      from: scValToAddressString(sf.contractFn.args[0]!),
      to: scValToAddressString(sf.contractFn.args[1]!),
      amount: scValNumericToBigInt(sf.contractFn.args[2]!),
    };
  } else if (subs.length > 1) {
    throw new ExtractError('BAD_AUTH', `refusing ${subs.length} auth sub-invocations`);
  }
  return {
    authRootFunctionName,
    authRootContractId,
    authRootArgs,
    authSubInvocationCount: subs.length,
    tokenTransfer,
  };
}

/**
 * Bind auth root ContractFn args to the transaction invoke args (byte-identical ScVal XDR).
 * Without this, separately valid TX + auth from different ops can be cross-paired.
 */
function assertAuthRootArgsMatchInvoke(invokeArgs: AnyScVal[], authRootArgs: AnyScVal[]): void {
  if (authRootArgs.length !== invokeArgs.length) {
    throw new ExtractError(
      'AUTH_TX_MISMATCH',
      `auth root arg count ${authRootArgs.length} !== invoke arg count ${invokeArgs.length}`,
    );
  }
  for (let i = 0; i < invokeArgs.length; i++) {
    const a = scValToXdrBase64(invokeArgs[i]!);
    const b = scValToXdrBase64(authRootArgs[i]!);
    if (a !== b) {
      throw new ExtractError(
        'AUTH_TX_MISMATCH',
        `auth root arg[${i}] XDR does not match transaction invoke arg[${i}] (cross-paired evidence)`,
      );
    }
  }
}

/**
 * Parse transaction + auth entry XDRs into structured facts.
 */
export function extractTransactFacts(
  transactionXdr: string,
  networkPassphrase: string,
  authEntryXdrs: string[],
): ExtractedTransactFacts {
  let parsed: Transaction | FeeBumpTransaction;
  try {
    parsed = TransactionBuilder.fromXDR(transactionXdr, networkPassphrase);
  } catch {
    throw new ExtractError('MALFORMED_TX', 'transaction XDR could not be parsed for network');
  }
  if (parsed instanceof FeeBumpTransaction) {
    throw new ExtractError('FEE_BUMP', 'fee-bump envelopes are not accepted by this prototype');
  }
  const tx = parsed as Transaction;
  if (tx.operations.length !== 1) {
    throw new ExtractError(
      'BAD_OP_COUNT',
      `expected exactly 1 operation, got ${tx.operations.length}`,
    );
  }

  const op = tx.operations[0] as {
    type: string;
    func?: {
      type: string;
      invokeContract?: {
        contractAddress: AnyScAddress;
        functionName: { toString(): string };
        args: AnyScVal[];
      };
    };
  };
  if (op.type !== 'invokeHostFunction') {
    throw new ExtractError('NOT_INVOKE', `operation type is "${op.type}", expected invokeHostFunction`);
  }
  if (!op.func || op.func.type !== 'hostFunctionTypeInvokeContract' || !op.func.invokeContract) {
    throw new ExtractError('NOT_INVOKE', 'host function is not invokeContract');
  }

  const inv = op.func.invokeContract;
  const poolContractId = scAddressToStrKey(inv.contractAddress);
  const functionName = inv.functionName.toString();
  if (functionName !== 'transact') {
    throw new ExtractError('NOT_TRANSACT', `function is "${functionName}", expected "transact"`);
  }
  if (inv.args.length !== 3) {
    throw new ExtractError(
      'BAD_ARGS',
      `transact expects 3 args [proof, ext_data, sender], got ${inv.args.length}`,
    );
  }

  const ext = parseExtData(inv.args[1]!);
  const senderAddress = scValToAddressString(inv.args[2]!);

  if (!Array.isArray(authEntryXdrs) || authEntryXdrs.length === 0) {
    throw new ExtractError('BAD_AUTH', 'authEntryXdrs must be a non-empty array');
  }
  if (authEntryXdrs.length !== 1) {
    throw new ExtractError(
      'BAD_AUTH',
      `check_transact_auth allows exactly 1 auth entry; got ${authEntryXdrs.length}`,
    );
  }
  const auth = parseAuthEntry(authEntryXdrs[0]!);

  // Critical binding (Fase 2.20): auth entry must authorize THIS invoke, not a sibling op.
  if (auth.authRootContractId !== poolContractId || auth.authRootFunctionName !== functionName) {
    throw new ExtractError(
      'AUTH_TX_MISMATCH',
      'auth root contract/function does not match transaction invoke',
    );
  }
  assertAuthRootArgsMatchInvoke(inv.args, auth.authRootArgs);

  // Deposit-shaped auth: token.transfer amount must equal ExtData.ext_amount from the SAME tx.
  if (auth.tokenTransfer && auth.tokenTransfer.amount !== ext.extAmount) {
    throw new ExtractError(
      'AUTH_TX_MISMATCH',
      'token.transfer amount does not equal ExtData.ext_amount from transaction',
    );
  }

  return {
    sourceAccount: tx.source,
    poolContractId,
    functionName,
    senderAddress,
    extAmount: ext.extAmount,
    recipientAddress: ext.recipientAddress,
    encryptedOutput0ByteLength: ext.encryptedOutput0ByteLength,
    encryptedOutput1ByteLength: ext.encryptedOutput1ByteLength,
    authEntryCount: 1,
    authRootFunctionName: auth.authRootFunctionName,
    authRootContractId: auth.authRootContractId,
    authSubInvocationCount: auth.authSubInvocationCount,
    tokenTransfer: auth.tokenTransfer,
    operationCount: tx.operations.length,
    isFeeBump: false,
    authBoundToInvoke: true,
  };
}
