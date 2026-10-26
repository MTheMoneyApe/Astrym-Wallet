/**
 * Synthetic (non-authentic) Soroban envelopes for offline semantic tests.
 *
 * These are harness constructions via `@stellar/stellar-sdk` builders.
 * They are NOT real SPP SDK simulate/submit responses and must not be
 * presented as on-chain transactions.
 */

import {
  Account,
  Address,
  Asset,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk';
import type { OperationEvidence } from './types.js';

export const FIXTURE_ACCOUNT = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';
export const FIXTURE_ACCOUNT_2 = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
export const FIXTURE_POOL = 'CACQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQLC2U';
export const FIXTURE_TOKEN = 'CADAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMSST';
export const FIXTURE_NETWORK = Networks.TESTNET;

function asXdrScVal(v: { toXDR(): Buffer } | xdr.ScVal): xdr.ScVal {
  if (v instanceof xdr.ScVal) return v;
  return xdr.ScVal.fromXDR(v.toXDR(), 'raw');
}

/** ExtData map matching `pool_ext_data_to_scval` key set. */
export function buildExtDataScVal(args: {
  extAmount: bigint;
  recipient: string;
  enc0?: Uint8Array;
  enc1?: Uint8Array;
}): xdr.ScVal {
  const enc0 = args.enc0 ?? new Uint8Array(32).fill(1);
  const enc1 = args.enc1 ?? new Uint8Array(32).fill(2);
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('encrypted_output0'),
      val: xdr.ScVal.scvBytes(Buffer.from(enc0)),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('encrypted_output1'),
      val: xdr.ScVal.scvBytes(Buffer.from(enc1)),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('ext_amount'),
      val: asXdrScVal(nativeToScVal(args.extAmount, { type: 'i256' })),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('recipient'),
      val: asXdrScVal(Address.fromString(args.recipient).toScVal()),
    }),
  ]);
}

export function dummyProofScVal(): xdr.ScVal {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('harness_dummy_proof'),
      val: xdr.ScVal.scvU32(1),
    }),
  ]);
}

export function buildTransactTxXdr(args: {
  source: string;
  pool: string;
  sender: string;
  extData: xdr.ScVal;
  proof?: xdr.ScVal;
  networkPassphrase?: string;
}): string {
  const network = args.networkPassphrase ?? FIXTURE_NETWORK;
  const proof = args.proof ?? dummyProofScVal();
  const sender = asXdrScVal(Address.fromString(args.sender).toScVal());
  return new TransactionBuilder(new Account(args.source, '1'), {
    fee: '100',
    networkPassphrase: network,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: args.pool,
        function: 'transact',
        args: [proof, args.extData, sender],
      }),
    )
    .setTimeout(30)
    .build()
    .toXDR();
}

/** Adversarial: two operations in one envelope. */
export function buildTransactTxXdrWithExtraOp(args: {
  source: string;
  pool: string;
  sender: string;
  extData: xdr.ScVal;
  networkPassphrase?: string;
}): string {
  const network = args.networkPassphrase ?? FIXTURE_NETWORK;
  const proof = dummyProofScVal();
  const sender = asXdrScVal(Address.fromString(args.sender).toScVal());
  return new TransactionBuilder(new Account(args.source, '1'), {
    fee: '100',
    networkPassphrase: network,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: args.pool,
        function: 'transact',
        args: [proof, args.extData, sender],
      }),
    )
    .addOperation(
      Operation.payment({
        destination: FIXTURE_ACCOUNT_2,
        asset: Asset.native(),
        amount: '1',
      }),
    )
    .setTimeout(30)
    .build()
    .toXDR();
}

export function buildAuthEntryXdr(args: {
  pool: string;
  proof: xdr.ScVal;
  extData: xdr.ScVal;
  sender: string;
  /** When set, adds token.transfer(sender, pool, amount) sub-invocation (deposit). */
  tokenTransfer?: { token: string; amount: bigint };
}): string {
  const sender = asXdrScVal(Address.fromString(args.sender).toScVal());
  const subInvocations: xdr.SorobanAuthorizedInvocation[] = [];
  if (args.tokenTransfer) {
    subInvocations.push(
      new xdr.SorobanAuthorizedInvocation({
        function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
          new xdr.InvokeContractArgs({
            contractAddress: Address.fromString(args.tokenTransfer.token).toScAddress(),
            functionName: 'transfer',
            args: [
              sender,
              asXdrScVal(Address.fromString(args.pool).toScVal()),
              asXdrScVal(nativeToScVal(args.tokenTransfer.amount, { type: 'i128' })),
            ],
          }),
        ),
        subInvocations: [],
      }),
    );
  }
  const entry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: Address.fromString(args.pool).toScAddress(),
          functionName: 'transact',
          args: [args.proof, args.extData, sender],
        }),
      ),
      subInvocations,
    }),
  });
  return entry.toXDR('base64');
}

export function buildDepositEvidence(args?: {
  amount?: bigint;
  source?: string;
  pool?: string;
  token?: string;
  recipient?: string;
  networkPassphrase?: string;
}): OperationEvidence {
  const amount = args?.amount ?? 10_000_000n;
  const source = args?.source ?? FIXTURE_ACCOUNT;
  const pool = args?.pool ?? FIXTURE_POOL;
  const token = args?.token ?? FIXTURE_TOKEN;
  const recipient = args?.recipient ?? source;
  const networkPassphrase = args?.networkPassphrase ?? FIXTURE_NETWORK;
  const extData = buildExtDataScVal({ extAmount: amount, recipient });
  const proof = dummyProofScVal();
  return {
    networkPassphrase,
    transactionXdr: buildTransactTxXdr({
      source,
      pool,
      sender: source,
      extData,
      proof,
      networkPassphrase,
    }),
    authEntryXdrs: [
      buildAuthEntryXdr({
        pool,
        proof,
        extData,
        sender: source,
        tokenTransfer: { token, amount },
      }),
    ],
  };
}

export function buildWithdrawEvidence(args?: {
  amount?: bigint;
  source?: string;
  pool?: string;
  recipient?: string;
  networkPassphrase?: string;
}): OperationEvidence {
  const amount = args?.amount ?? 5_000_000n;
  const source = args?.source ?? FIXTURE_ACCOUNT;
  const pool = args?.pool ?? FIXTURE_POOL;
  const recipient = args?.recipient ?? source;
  const networkPassphrase = args?.networkPassphrase ?? FIXTURE_NETWORK;
  const extData = buildExtDataScVal({ extAmount: -amount, recipient });
  const proof = dummyProofScVal();
  return {
    networkPassphrase,
    transactionXdr: buildTransactTxXdr({
      source,
      pool,
      sender: source,
      extData,
      proof,
      networkPassphrase,
    }),
    authEntryXdrs: [
      buildAuthEntryXdr({
        pool,
        proof,
        extData,
        sender: source,
      }),
    ],
  };
}
