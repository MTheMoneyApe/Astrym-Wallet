/**
 * Offline simulateTransaction inspection. Envelopes are built in-process.
 * No RPC, no signing, no broadcast.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Account,
  Address,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import {
  NETHERMIND_PUBLIC_TESTNET_DEPLOYMENTS,
  NETHERMIND_PUBLIC_XLM_POOL_CONTRACT,
  STALE_NETHERMIND_PUBLIC_XLM_POOL_CONTRACT,
} from '@solanym/wallet-core/src/stellar/spp/nethermind/nethermindPublicTestnet.js';
import { STELLAR_SOROBAN_TESTNET_RPC } from '@solanym/wallet-core/src/stellar/spp/sppNymOption.js';
import {
  isSppTestnetBroadcastAuthorized,
  resetSppBroadcastGateForTests,
  setSppTestnetBroadcastAuthorized,
} from '@solanym/wallet-core/src/stellar/spp/sppBroadcastGate.js';
import {
  mintSppSignApproval,
  resetSppSignApprovalsForTests,
  sppSignApprovalCount,
  type SppSignIntent,
} from '@solanym/wallet-core/src/stellar/spp/sppSignGate.js';
import { setSppPaymentIdentityChecksForTests } from '@solanym/wallet-core/tests/stellar/spp/seams/sppPaymentIdentityChecks.js';

// vi.mock is hoisted above imports. The dynamic import loads the test seam
// without a static import cycle while sppPaymentIdentityChecks.js is mocked.
vi.mock('@solanym/wallet-core/src/stellar/spp/sppPaymentIdentityChecks.js', async () => {
  const seam = await import('@solanym/wallet-core/tests/stellar/spp/seams/sppPaymentIdentityChecks.js');
  return {
    sppPaymentIdentityChecksEnabled: () => seam.sppPaymentIdentityChecks.enabled,
  };
});

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: {
      id: 'test-extension-id',
      getURL: (path: string) => `chrome-extension://test-extension-id${path.startsWith('/') ? path : `/${path}`}`,
    },
  },
}));

import { SPP_HOST_BRIDGE_CHANNEL } from '../../../src/shared/sppHostBridge.js';

vi.mock('../../../src/background/accounts/ActiveAccountManager.js', () => ({
  activeAccountManager: {
    getActiveAccountIndex: () => 0,
  },
}));

vi.mock('../../../src/background/nym/NymRuntimeController.js', () => {
  const fetchImpl = vi.fn(async () => new Response('ok-body', {
    status: 200,
    statusText: 'OK',
    headers: { 'x-test': '1' },
  }));
  return {
    getNymRuntimeController: () => ({
      getSnapshot: () => ({ mode: 'nym', connected: true }),
      getStellarFetch: () => fetchImpl,
    }),
  };
});

const HOST_SENDER = {
  id: 'test-extension-id',
  url: 'chrome-extension://test-extension-id/spp-host.html',
};

const ACCOUNT = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';
const OTHER = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const POOL = NETHERMIND_PUBLIC_XLM_POOL_CONTRACT;
const REGISTRY = NETHERMIND_PUBLIC_TESTNET_DEPLOYMENTS.public_key_registry;
const TOKEN = NETHERMIND_PUBLIC_TESTNET_DEPLOYMENTS.pools[0].tokenContractId;

function invokeTx(contract: string, auth: xdr.SorobanAuthorizationEntry[] = []): string {
  return new TransactionBuilder(new Account(ACCOUNT, '10'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.invokeContractFunction({
      contract,
      function: 'transact',
      args: [],
      auth,
    }))
    .setTimeout(30)
    .build()
    .toXDR();
}

function invocation(contract: string): xdr.SorobanAuthorizedInvocation {
  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(contract).toScAddress(),
        functionName: 'transact',
        args: [],
      }),
    ),
    subInvocations: [],
  });
}

function addressCredentials(signature: xdr.ScVal): xdr.SorobanAddressCredentials {
  return new xdr.SorobanAddressCredentials({
    address: Address.fromString(ACCOUNT).toScAddress(),
    nonce: 1n,
    signatureExpirationLedger: 10,
    signature,
  });
}

function authEntry(credentials: xdr.SorobanCredentials, contract = POOL): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    credentials,
    rootInvocation: invocation(contract),
  });
}

function delegate(signature: xdr.ScVal, nested: xdr.SorobanDelegateSignature[] = []): xdr.SorobanDelegateSignature {
  return new xdr.SorobanDelegateSignature({
    address: Address.fromString(ACCOUNT).toScAddress(),
    signature,
    nestedDelegates: nested,
  });
}

function simulateRpc(transaction: string, id: string | number = 1): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'simulateTransaction',
    params: { transaction },
  });
}

function readRpc(method: string, id: string | number = 1): { jsonrpc: '2.0'; id: string | number; method: string } {
  return { jsonrpc: '2.0', id, method };
}

async function post(body: string) {
  const { handleSppHostNymFetchRequest, MAX_SOROBAN_READ_BATCH } = await import(
    '../../../src/background/spp/sppHostBridgeHandlers.js'
  );
  const { getNymRuntimeController } = await import(
    '../../../src/background/nym/NymRuntimeController.js'
  );
  const fetchImpl = getNymRuntimeController().getStellarFetch() as ReturnType<typeof vi.fn>;
  fetchImpl.mockClear();
  const result = await handleSppHostNymFetchRequest({
    channel: SPP_HOST_BRIDGE_CHANNEL,
    type: 'SPP_HOST_NYM_FETCH',
    id: 'sim',
    payload: {
      rpcUrl: STELLAR_SOROBAN_TESTNET_RPC,
      url: STELLAR_SOROBAN_TESTNET_RPC,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    },
  }, HOST_SENDER);
  return { result, fetchImpl, MAX_SOROBAN_READ_BATCH };
}

async function expectRejected(body: string): Promise<void> {
  const { result, fetchImpl } = await post(body);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.code).toBe('UNAUTHORIZED');
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(isSppTestnetBroadcastAuthorized()).toBe(false);
}

describe('simulateTransaction bridge inspection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSppBroadcastGateForTests();
    resetSppSignApprovalsForTests();
    setSppPaymentIdentityChecksForTests(true);
    setSppTestnetBroadcastAuthorized(false);
  });

  it('forwards a rebuilt unsigned pool simulate and leaves the broadcast gate off', async () => {
    const transaction = invokeTx(POOL);
    const raw = `{ "jsonrpc" : "2.0", "id" : "sim-1", "method" : "simulateTransaction", "params" : { "transaction" : ${JSON.stringify(transaction)} } }`;
    const expected = JSON.stringify({
      jsonrpc: '2.0',
      id: 'sim-1',
      method: 'simulateTransaction',
      params: { transaction },
    });
    expect(raw).not.toBe(expected);
    const { result, fetchImpl } = await post(raw);
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(STELLAR_SOROBAN_TESTNET_RPC);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', body: expected });
    expect(isSppTestnetBroadcastAuthorized()).toBe(false);
  });

  it('accepts an unsigned registry simulate', async () => {
    const { result, fetchImpl } = await post(simulateRpc(invokeTx(REGISTRY)));
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('accepts source-account and void address auth, including delegates', async () => {
    const voidSig = xdr.ScVal.scvVoid();
    const transaction = invokeTx(POOL, [
      authEntry(xdr.SorobanCredentials.sorobanCredentialsSourceAccount()),
      authEntry(xdr.SorobanCredentials.sorobanCredentialsAddress(addressCredentials(voidSig))),
      authEntry(xdr.SorobanCredentials.sorobanCredentialsAddressV2(addressCredentials(voidSig))),
      authEntry(xdr.SorobanCredentials.sorobanCredentialsAddressWithDelegates(
        new xdr.SorobanAddressCredentialsWithDelegates({
          addressCredentials: addressCredentials(voidSig),
          delegates: [delegate(voidSig, [delegate(voidSig)])],
        }),
      )),
    ]);
    const { result, fetchImpl } = await post(simulateRpc(transaction));
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects non-canonical base64', async () => {
    const canonical = invokeTx(POOL);
    await expectRejected(simulateRpc(`${canonical.slice(0, 12)} ${canonical.slice(12)}`));
  });

  it('rejects a transaction that is not a TransactionEnvelope', async () => {
    await expectRejected(simulateRpc('not-an-envelope'));
  });

  it('rejects TxV0', async () => {
    const v0 = new xdr.TransactionV0({
      sourceAccountEd25519: Keypair.fromPublicKey(ACCOUNT).rawPublicKey(),
      fee: 100,
      seqNum: 10n,
      timeBounds: null,
      memo: xdr.Memo.memoNone(),
      operations: [],
      ext: xdr.TransactionV0Ext.v0(),
    });
    const transaction = xdr.TransactionEnvelope.envelopeTypeTxV0(
      new xdr.TransactionV0Envelope({ tx: v0, signatures: [] }),
    ).toXDR('base64');
    await expectRejected(simulateRpc(transaction));
  });

  it('rejects a fee-bump envelope', async () => {
    const inner = new TransactionBuilder(new Account(ACCOUNT, '10'), {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.invokeContractFunction({
        contract: POOL,
        function: 'transact',
        args: [],
      }))
      .setTimeout(30)
      .build();
    const transaction = TransactionBuilder.buildFeeBumpTransaction(
      ACCOUNT,
      '200',
      inner,
      Networks.TESTNET,
    ).toXDR();
    await expectRejected(simulateRpc(transaction));
  });

  it('rejects an envelope that already has a signature', async () => {
    const tx = new TransactionBuilder(new Account(ACCOUNT, '10'), {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.invokeContractFunction({
        contract: POOL,
        function: 'transact',
        args: [],
      }))
      .setTimeout(30)
      .build();
    tx.signatures.push(new xdr.DecoratedSignature({
      hint: Buffer.alloc(4),
      signature: Buffer.alloc(64),
    }));
    await expectRejected(simulateRpc(tx.toXDR()));
  });

  it('rejects zero operations and two operations', async () => {
    const parsed = xdr.TransactionEnvelope.fromXDR(invokeTx(POOL), 'base64');
    if (parsed.type !== 'envelopeTypeTx') {
      throw new Error('expected a v1 envelope');
    }
    const tx = parsed.v1.tx;
    const empty = xdr.TransactionEnvelope.envelopeTypeTx(new xdr.TransactionV1Envelope({
      tx: new xdr.Transaction({
        sourceAccount: tx.sourceAccount,
        fee: tx.fee,
        seqNum: tx.seqNum,
        cond: tx.cond,
        memo: tx.memo,
        operations: [],
        ext: tx.ext,
      }),
      signatures: [],
    })).toXDR('base64');
    await expectRejected(simulateRpc(empty));

    const two = new TransactionBuilder(new Account(ACCOUNT, '10'), {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.invokeContractFunction({ contract: POOL, function: 'transact', args: [] }))
      .addOperation(Operation.invokeContractFunction({ contract: POOL, function: 'transact', args: [] }))
      .setTimeout(30)
      .build()
      .toXDR();
    await expectRejected(simulateRpc(two));
  });

  it('rejects a payment instead of invokeHostFunction', async () => {
    const payment = new TransactionBuilder(new Account(ACCOUNT, '10'), {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.payment({
        destination: OTHER,
        asset: Asset.native(),
        amount: '1',
      }))
      .setTimeout(30)
      .build()
      .toXDR();
    await expectRejected(simulateRpc(payment));
  });

  it('rejects a host function that is not invokeContract', async () => {
    const upload = new TransactionBuilder(new Account(ACCOUNT, '10'), {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeUploadContractWasm(Buffer.from([1, 2, 3])),
        auth: [],
      }))
      .setTimeout(30)
      .build()
      .toXDR();
    await expectRejected(simulateRpc(upload));
  });

  it('rejects a contract that is not a pool or the registry', async () => {
    await expectRejected(simulateRpc(invokeTx(TOKEN)));
    await expectRejected(simulateRpc(invokeTx(STALE_NETHERMIND_PUBLIC_XLM_POOL_CONTRACT)));
  });

  it('rejects address credentials whose signature is not void', async () => {
    const signed = xdr.ScVal.scvBytes(Buffer.from([1]));
    await expectRejected(simulateRpc(invokeTx(POOL, [
      authEntry(xdr.SorobanCredentials.sorobanCredentialsAddress(addressCredentials(signed))),
    ])));
    await expectRejected(simulateRpc(invokeTx(POOL, [
      authEntry(xdr.SorobanCredentials.sorobanCredentialsAddressV2(addressCredentials(signed))),
    ])));
  });

  it('rejects a non-void delegate signature even when the address signature is void', async () => {
    const transaction = invokeTx(POOL, [
      authEntry(xdr.SorobanCredentials.sorobanCredentialsAddressWithDelegates(
        new xdr.SorobanAddressCredentialsWithDelegates({
          addressCredentials: addressCredentials(xdr.ScVal.scvVoid()),
          delegates: [delegate(xdr.ScVal.scvVoid(), [delegate(xdr.ScVal.scvBytes(Buffer.from([2])))])],
        }),
      )),
    ]);
    await expectRejected(simulateRpc(transaction));
  });

  it('rejects a batch that contains simulateTransaction', async () => {
    await expectRejected(JSON.stringify([
      readRpc('getHealth', 1),
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'simulateTransaction',
        params: { transaction: invokeTx(POOL) },
      },
    ]));
    await expectRejected(JSON.stringify([
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'simulateTransaction',
        params: { transaction: invokeTx(POOL) },
      },
    ]));
  });

  it('rejects an empty batch and a batch over the cap, and forwards a full read batch rebuilt', async () => {
    await expectRejected('[]');
    const { MAX_SOROBAN_READ_BATCH } = await import(
      '../../../src/background/spp/sppHostBridgeHandlers.js'
    );
    const oversized = await post(JSON.stringify(
      Array.from({ length: MAX_SOROBAN_READ_BATCH + 1 }, (_, index) => readRpc('getHealth', index)),
    ));
    expect(oversized.result.ok).toBe(false);
    expect(oversized.fetchImpl).not.toHaveBeenCalled();

    const entries = Array.from(
      { length: MAX_SOROBAN_READ_BATCH },
      (_, index) => readRpc('getLatestLedger', index),
    );
    const spaced = `[\n${JSON.stringify(entries).slice(1)}`;
    const forwarded = await post(spaced);
    expect(forwarded.result.ok).toBe(true);
    expect(forwarded.fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify(entries),
    });
  });

  it('rejects extra keys, a non-2.0 jsonrpc, and ids that are not strings or finite numbers', async () => {
    await expectRejected(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getHealth',
      extra: true,
    }));
    await expectRejected(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'simulateTransaction',
      params: { transaction: invokeTx(POOL), resourceConfig: { instructionLeeway: 0 } },
    }));
    await expectRejected(JSON.stringify({ jsonrpc: '1.0', id: 1, method: 'getHealth' }));
    await expectRejected(JSON.stringify({ jsonrpc: '2.0', id: null, method: 'getHealth' }));
    await expectRejected(JSON.stringify({ jsonrpc: '2.0', id: true, method: 'getHealth' }));
    await expectRejected(JSON.stringify({ jsonrpc: '2.0', id: { n: 1 }, method: 'getHealth' }));
    await expectRejected('{"jsonrpc":"2.0","id":1e309,"method":"getHealth"}');
    await expectRejected(JSON.stringify({ jsonrpc: '2.0', method: 'getHealth' }));
    await expectRejected(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'simulateTransaction',
    }));
  });

  it('forwards a string id on a non-simulate read as rebuilt entries only', async () => {
    const raw = '{ "jsonrpc" : "2.0", "id" : "health", "method" : "getHealth" }';
    const expected = JSON.stringify({ jsonrpc: '2.0', id: 'health', method: 'getHealth' });
    const { result, fetchImpl } = await post(raw);
    expect(result.ok).toBe(true);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ body: expected });
    expect(raw).not.toBe(expected);
  });

  it('still revokes approvals when simulate is batched with sendTransaction', async () => {
    const intent: SppSignIntent = {
      operation: 'transfer',
      amountStroops: '25',
      recipient: OTHER,
      networkPassphrase: Networks.TESTNET,
      poolContractId: POOL,
      registryContractId: null,
      tokenContractId: null,
      registerNoteKeyHex: null,
      registerEncryptionKeyHex: null,
      registerNoteKeyProofHex: null,
      registerEncryptionKeySignatureHex: null,
      registerOwnerSignatureHex: null,
      maxFeeStroops: '8000000',
      minResourceFeeStroops: null,
      account: ACCOUNT,
      exactMessage: null,
    };
    mintSppSignApproval(intent);
    await expectRejected(JSON.stringify([
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'simulateTransaction',
        params: { transaction: invokeTx(POOL) },
      },
      { jsonrpc: '2.0', id: 2, method: 'sendTransaction' },
    ]));
    expect(sppSignApprovalCount()).toBe(0);
  });
});
