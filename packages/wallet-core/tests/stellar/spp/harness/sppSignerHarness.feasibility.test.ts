/**
 * Fase 1.8 — Offline SPP signer harness feasibility.
 *
 * Distinguishes:
 *   OBSERVED   — a real WalletSigner call from stellar-private-payments WASM/JS
 *   PARCIAL    — local init / construct without reaching sign*
 *   BLOQUEADO  — requires browser Workers/OPFS, RPC, circuits session, or contracts
 *
 * Storage.open() is NOT invoked here: in Node it panics (gloo-worker) and can
 * leave an unhandled WASM trap. That path is documented as BLOQUEADO from a
 * prior controlled probe; this suite proves Client.new cannot proceed without
 * StorageHandle and that sign* capture works locally.
 *
 * No Horizon / Soroban RPC / Friendbot / Nym. No valid signatures. No production wiring.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  Account,
  Address,
  Asset,
  hash,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import {
  classifyAuthEntryXdr,
  classifyMessageInput,
  classifyTransactionXdr,
} from './classifySigningInput.js';
import {
  HARNESS_REJECT,
  RecordingWalletSigner,
} from './RecordingWalletSigner.js';

function resolveSdkRoot(): string {
  return path.resolve('node_modules/stellar-private-payments');
}

describe('SPP signer harness feasibility (offline)', () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  beforeEach(() => {
    fetchCalls = 0;
    globalThis.fetch = (async (..._args: Parameters<typeof fetch>) => {
      fetchCalls += 1;
      throw new Error('offline harness: network fetch is forbidden');
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('PARCIAL: WASM initSync works from local bytes without fetch', async () => {
    const root = resolveSdkRoot();
    const mod = await import(pathToFileURL(path.join(root, 'dist/stellar_private_payments_web.js')).href);
    const bytes = readFileSync(path.join(root, 'dist/stellar_private_payments_web_bg.wasm'));
    mod.initSync({ module: bytes });
    expect(mod.parseTokenAmount('1.0', 7).toString()).toBe('10000000');
    expect(fetchCalls).toBe(0);
  });

  it('PARCIAL: WasmWalletSigner can be constructed; construct does not call sign*', async () => {
    const root = resolveSdkRoot();
    const mod = await import(pathToFileURL(path.join(root, 'dist/stellar_private_payments_web.js')).href);
    mod.initSync({ module: readFileSync(path.join(root, 'dist/stellar_private_payments_web_bg.wasm')) });

    const kp = Keypair.random();
    const recorder = new RecordingWalletSigner({ publicKey: kp.publicKey() });
    const ws = new mod.WalletSigner(recorder, Networks.TESTNET, kp.publicKey());
    const handle = ws.toHandle();
    handle.free();
    ws.free();

    expect(recorder.calls.map((c) => c.method)).toEqual([]);
    expect(fetchCalls).toBe(0);
  });

  it('BLOQUEADO: storage worker + circuits exist locally but Node cannot open OPFS Storage', () => {
    const root = resolveSdkRoot();
    expect(existsSync(path.join(root, 'dist/workers/storage-worker.js'))).toBe(true);
    expect(existsSync(path.join(root, 'dist/circuits/circuits.json'))).toBe(true);
    // Documented: Storage.open({ workerUrl }) panics in Node (gloo-worker failed to spawn).
    // Not invoked in this test to avoid unhandled WASM traps / hangs.
    expect(fetchCalls).toBe(0);
  });

  it('BLOQUEADO: Client.new requires StorageHandle (pool ops unreachable offline)', async () => {
    const root = resolveSdkRoot();
    const mod = await import(pathToFileURL(path.join(root, 'dist/stellar_private_payments_web.js')).href);
    mod.initSync({ module: readFileSync(path.join(root, 'dist/stellar_private_payments_web_bg.wasm')) });

    let message = '';
    try {
      // Intentional invalid handles — prove Client cannot start without Storage.
      mod.Client.new('http://127.0.0.1:1', null as never, null as never, { network: 'test' });
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toMatch(/StorageHandle|instance/i);
    expect(fetchCalls).toBe(0);
  });

  it('RecordingWalletSigner captures args unchanged and refuses valid signatures', async () => {
    const kp = Keypair.random();
    const recorder = new RecordingWalletSigner({ publicKey: kp.publicKey() });
    const msg = 'Privacy Pool Key Derivation [v2] (synthetic-test)';
    const opts = { address: kp.publicKey(), networkPassphrase: Networks.TESTNET };

    await expect(recorder.signMessage(msg, opts)).rejects.toThrow(HARNESS_REJECT);
    expect(recorder.calls).toHaveLength(1);
    expect(recorder.calls[0]!.method).toBe('signMessage');
    expect(recorder.calls[0]!.input).toBe(msg);
    expect(recorder.calls[0]!.opts).toEqual(opts);

    const xdrTx = new TransactionBuilder(new Account(kp.publicKey(), '1'), {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: Keypair.random().publicKey(),
          asset: Asset.native(),
          amount: '1',
        }),
      )
      .setTimeout(30)
      .build()
      .toXDR();

    await expect(recorder.signTransaction(xdrTx, opts)).rejects.toThrow(HARNESS_REJECT);
    expect(recorder.calls[1]!.input).toBe(xdrTx);
    expect(recorder.calls[1]!.opts).toEqual(opts);

    const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
      new xdr.HashIdPreimageSorobanAuthorization({
        networkId: hash(Buffer.from(Networks.TESTNET)),
        nonce: xdr.Int64(1n),
        signatureExpirationLedger: 100,
        invocation: new xdr.SorobanAuthorizedInvocation({
          function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
            new xdr.InvokeContractArgs({
              contractAddress: Address.fromString(kp.publicKey()).toScAddress(),
              functionName: 'ping',
              args: [],
            }),
          ),
          subInvocations: [],
        }),
      }),
    ).toXDR('base64');

    await expect(recorder.signAuthEntry(preimage, opts)).rejects.toThrow(HARNESS_REJECT);
    expect(recorder.calls[2]!.input).toBe(preimage);
    expect(fetchCalls).toBe(0);
  });

  it('classifies message / transaction / auth preimage discriminants offline', () => {
    const kp = Keypair.random();
    expect(classifyMessageInput('hello')).toEqual({ kind: 'message', message: 'hello' });

    const txXdr = new TransactionBuilder(new Account(kp.publicKey(), '1'), {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: Keypair.random().publicKey(),
          asset: Asset.native(),
          amount: '1',
        }),
      )
      .setTimeout(30)
      .build()
      .toXDR();

    const txClass = classifyTransactionXdr(txXdr, Networks.TESTNET);
    expect(txClass.kind).toBe('transaction');
    if (txClass.kind === 'transaction') {
      expect(txClass.source).toBe(kp.publicKey());
      expect(txClass.isFeeBump).toBe(false);
      expect(txClass.signatureCount).toBe(0);
    }

    const legacy = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
      new xdr.HashIdPreimageSorobanAuthorization({
        networkId: hash(Buffer.from(Networks.TESTNET)),
        nonce: xdr.Int64(2n),
        signatureExpirationLedger: 200,
        invocation: new xdr.SorobanAuthorizedInvocation({
          function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
            new xdr.InvokeContractArgs({
              contractAddress: Address.fromString(kp.publicKey()).toScAddress(),
              functionName: 'transfer',
              args: [],
            }),
          ),
          subInvocations: [],
        }),
      }),
    ).toXDR('base64');

    expect(classifyAuthEntryXdr(legacy)).toMatchObject({
      kind: 'auth_preimage',
      preimageType: 'envelopeTypeSorobanAuthorization',
    });

    const withAddr = xdr.HashIdPreimage.envelopeTypeSorobanAuthorizationWithAddress(
      new xdr.HashIdPreimageSorobanAuthorizationWithAddress({
        networkId: hash(Buffer.from(Networks.TESTNET)),
        nonce: xdr.Int64(3n),
        signatureExpirationLedger: 300,
        address: Address.fromString(kp.publicKey()).toScAddress(),
        invocation: new xdr.SorobanAuthorizedInvocation({
          function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
            new xdr.InvokeContractArgs({
              contractAddress: Address.fromString(kp.publicKey()).toScAddress(),
              functionName: 'transfer',
              args: [],
            }),
          ),
          subInvocations: [],
        }),
      }),
    ).toXDR('base64');

    expect(classifyAuthEntryXdr(withAddr)).toMatchObject({
      kind: 'auth_preimage',
      preimageType: 'envelopeTypeSorobanAuthorizationWithAddress',
      boundAddress: kp.publicKey(),
    });

    expect(classifyAuthEntryXdr('%%%%').kind).toBe('unclassified');
  });
});

describe('SPP operation observation matrix (documented)', () => {
  it('records that no SPP account/pool op was OBSERVED in this environment', () => {
    const matrix = {
      derivePrivacyKeys: 'BLOQUEADO',
      registerPublicKeys: 'BLOQUEADO',
      deposit: 'BLOQUEADO',
      transfer: 'BLOQUEADO',
      withdraw: 'BLOQUEADO',
      wasmInitSync: 'PARCIAL',
      wasmWalletSignerConstruct: 'PARCIAL',
      recordingSignerUnit: 'OBSERVADO_LOCAL_ONLY',
    } as const;
    expect(matrix.derivePrivacyKeys).toBe('BLOQUEADO');
    expect(matrix.wasmInitSync).toBe('PARCIAL');
    expect((Object.values(matrix) as string[]).includes('OBSERVADO')).toBe(false);
  });
});
