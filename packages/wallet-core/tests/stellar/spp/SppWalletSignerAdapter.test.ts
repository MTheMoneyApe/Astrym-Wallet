/**
 * Offline hardening tests for SppWalletSignerAdapter — no Horizon / Soroban RPC / Friendbot.
 */

import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  Account,
  Address,
  Asset,
  hash,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk';
import type { WalletSigner } from 'stellar-private-payments';
import { makeSeedPhrase } from '../../../src/crypto/types.js';
import { SoftwareSigner } from '../../../src/signer/SoftwareSigner.js';
import {
  SppSignerError,
  SppWalletSignerAdapter,
} from '../../../src/stellar/spp/SppWalletSignerAdapter.js';
import { STELLAR_SIGNED_MESSAGE_PREFIX } from '../../../src/stellar/spp/sep53.js';
import {
  contextsEqual,
  createContextualSignatureGate,
  createRejectingSignatureGate,
  type SignatureAuthContext,
  type SignatureAuthorizationGate,
  type SignatureLease,
} from '../../../src/stellar/spp/signatureGate.js';
import {
  mintSppSignApproval,
  resetSppSignApprovalsForTests,
  sppKeyDerivationMessage,
  type SppSignIntent,
} from '../../../src/stellar/spp/sppSignGate.js';
import {
  resetSppBroadcastGateForTests,
  setSppTestnetBroadcastAuthorized,
} from '../../../src/stellar/spp/sppBroadcastGate.js';
import { NETHERMIND_PUBLIC_KDF_DOMAIN } from '../../../src/stellar/spp/nethermind/nethermindPublicTestnet.js';
import { PasswordUnlocker } from '../../../src/vault/PasswordUnlocker.js';
import { VaultService } from '../../../src/vault/VaultService.js';
import type { IPersistentStorage, ISessionStorage } from '../../../src/vault/IVaultStorage.js';
import type { EncryptedVaultBlob } from '../../../src/vault/types.js';

/** SEP-0005 TV1 public fixture (not a user secret). */
const SEP0005_TV1 =
  'illness spike retreat truth genius clock brain pass fit cave bargain toe';
const SEP0005_TV1_G =
  'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';

/** SEP-0053 official test vector 1 (from the SEP text — independent of production helpers). */
const SEP53_SEED = 'SAKICEVQLYWGSOJS4WW7HZJWAHZVEEBS527LHK5V4MLJALYKICQCJXMW';
const SEP53_ADDRESS = 'GBXFXNDLV4LSWA4VB7YIL5GBD7BVNR22SGBTDKMO2SBZZHDXSKZYCP7L';
const SEP53_MSG = 'Hello, World!';
const SEP53_SIG_B64 =
  'fO5dbYhXUhBMhe6kId/cuVq/AfEnHRHEvsP8vXh03M1uLpi5e46yO2Q8rEBzu3feXQewcQE5GArp88u6ePK6BA==';
/** SEP-0053 official TV2 (Japanese). */
const POOL = 'CCSI25UI6P42ZZWFPHAJ44BIYFLZV2QLMJ3BBT3XHDKNM5RRHXOLB5TW';
const TOKEN = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const REGISTRY = 'CA5MA3LDXS4TQKBQ7SY57IHO3VMYV7G3ZJH45CWCX4QVP25IDFMZWZ3E';
const NOTE_KEY = 'ab'.repeat(32);
const ENC_KEY = 'ee'.repeat(32);
const SEP53_MSG_JA = 'こんにちは、世界！';

function baseIntent(overrides: Partial<SppSignIntent> = {}): SppSignIntent {
  return {
    operation: 'deposit',
    amountStroops: '10',
    recipient: null,
    networkPassphrase: Networks.TESTNET,
    poolContractId: POOL,
    registryContractId: null,
    tokenContractId: TOKEN,
    registerNoteKeyHex: null,
    registerEncryptionKeyHex: null,
    registerNoteKeyProofHex: null,
    registerEncryptionKeySignatureHex: null,
    registerOwnerSignatureHex: null,
    maxFeeStroops: '8000000',
    minResourceFeeStroops: null,
    account: SEP0005_TV1_G,
    exactMessage: null,
    ...overrides,
  };
}

const DERIVATION_MESSAGE = sppKeyDerivationMessage(NETHERMIND_PUBLIC_KDF_DOMAIN);

function approveDerivationMessage(): void {
  mintSppSignApproval(baseIntent({
    operation: 'register_public_keys',
    amountStroops: null,
    recipient: null,
    poolContractId: null,
    registryContractId: REGISTRY,
    tokenContractId: null,
    registerNoteKeyHex: NOTE_KEY,
    registerEncryptionKeyHex: ENC_KEY,
    registerNoteKeyProofHex: 'aa'.repeat(16),
    registerEncryptionKeySignatureHex: 'bb'.repeat(64),
    registerOwnerSignatureHex: 'cc'.repeat(64),
    maxFeeStroops: '5000000',
    exactMessage: DERIVATION_MESSAGE,
  }));
}

function buildTransactXdr(fee = '100', amount = 10n): string {
  const ext = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('ext_amount'),
      val: nativeToScVal(amount, { type: 'i256' }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('recipient'),
      val: Address.fromString(SEP0005_TV1_G).toScVal(),
    }),
  ]);
  const sender = Address.fromString(SEP0005_TV1_G).toScVal();
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(POOL).toScAddress(),
        functionName: 'transact',
        args: [xdr.ScVal.scvBytes(Buffer.from([1])), ext, sender],
      }),
    ),
    subInvocations: [
      new xdr.SorobanAuthorizedInvocation({
        function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
          new xdr.InvokeContractArgs({
            contractAddress: Address.fromString(TOKEN).toScAddress(),
            functionName: 'transfer',
            args: [sender, Address.fromString(POOL).toScVal(), nativeToScVal(amount, { type: 'i128' })],
          }),
        ),
        subInvocations: [],
      }),
    ],
  });
  return new TransactionBuilder(new Account(SEP0005_TV1_G, '10'), {
    fee,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.invokeContractFunction({
      contract: POOL,
      function: 'transact',
      args: [xdr.ScVal.scvBytes(Buffer.from([1])), ext, sender],
      auth: [
        new xdr.SorobanAuthorizationEntry({
          credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
          rootInvocation: invocation,
        }),
      ],
    }))
    .setTimeout(180)
    .build()
    .toXDR();
}
const SEP53_SIG_JA_B64 =
  'CDU265Xs8y3OWbB/56H9jPgUss5G9A0qFuTqH2zs2YDgTm+++dIfmAEceFqB7bhfN3am59lCtDXrCtwH2k1GBA==';

class MemPersistent implements IPersistentStorage {
  private _blob: EncryptedVaultBlob | null = null;
  async loadBlob() {
    return this._blob;
  }
  async saveBlob(blob: EncryptedVaultBlob) {
    this._blob = blob;
  }
  async clearBlob() {
    this._blob = null;
  }
}

class MemSession implements ISessionStorage {
  private _key: CryptoKey | null = null;
  async loadKey() {
    return this._key;
  }
  async saveKey(key: CryptoKey) {
    this._key = key;
  }
  async clearKey() {
    this._key = null;
  }
}

async function unlockedStellarSigner() {
  const vault = new VaultService(new PasswordUnlocker(), new MemPersistent(), new MemSession());
  await vault.createVault('AdapterTestPassword!1', makeSeedPhrase(SEP0005_TV1));
  const signer = new SoftwareSigner(vault, 'stellar');
  return { vault, signer };
}

/** Independent SEP-53 digest (does not import production hashSep53Message). */
function independentSep53Digest(message: string): Uint8Array {
  const prefix = new TextEncoder().encode('Stellar Signed Message:\n');
  const body = new TextEncoder().encode(message);
  const out = new Uint8Array(prefix.length + body.length);
  out.set(prefix, 0);
  out.set(body, prefix.length);
  return sha256(out);
}

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function makeAdapter(
  signer: SoftwareSigner,
  gate: SignatureAuthorizationGate = createContextualSignatureGate('bind-on-authorize'),
  networkPassphrase = Networks.TESTNET,
  stellarAddress = SEP0005_TV1_G,
) {
  return new SppWalletSignerAdapter({
    signer,
    accountIndex: 0,
    stellarAddress,
    networkPassphrase,
    authorizationGate: gate,
  });
}

function buildAuthPreimage(
  networkPassphrase: string,
  options: {
    variant?: 'legacy' | 'withAddress' | 'contractId';
    addressG?: string;
    withAddressG?: string;
  } = {},
): string {
  const networkId = hash(Buffer.from(networkPassphrase));
  const contractG = options.addressG ?? SEP0005_TV1_G;
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(contractG).toScAddress(),
        functionName: 'ping',
        args: [],
      }),
    ),
    subInvocations: [],
  });

  const variant = options.variant ?? 'legacy';
  if (variant === 'contractId') {
    const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
      new xdr.HashIdPreimageContractId({
        networkId,
        contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
          new xdr.ContractIdPreimageFromAddress({
            address: Address.fromString(contractG).toScAddress(),
            salt: Buffer.alloc(32),
          }),
        ),
      }),
    );
    return preimage.toXDR('base64');
  }

  if (variant === 'withAddress') {
    const addr = options.withAddressG ?? SEP0005_TV1_G;
    const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorizationWithAddress(
      new xdr.HashIdPreimageSorobanAuthorizationWithAddress({
        networkId,
        nonce: xdr.Int64(7n),
        signatureExpirationLedger: 1_000_000,
        address: Address.fromString(addr).toScAddress(),
        invocation,
      }),
    );
    return preimage.toXDR('base64');
  }

  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId,
      nonce: xdr.Int64(7n),
      signatureExpirationLedger: 1_000_000,
      invocation,
    }),
  );
  return preimage.toXDR('base64');
}

function buildTransactAuth(
  networkPassphrase: string,
  options: { withAddress?: boolean; contract?: string } = {},
): string {
  const networkId = hash(Buffer.from(networkPassphrase));
  const contract = options.contract ?? POOL;
  const ext = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('ext_amount'),
      val: nativeToScVal(10n, { type: 'i256' }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('recipient'),
      val: Address.fromString(SEP0005_TV1_G).toScVal(),
    }),
  ]);
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(contract).toScAddress(),
        functionName: 'transact',
        args: [
          xdr.ScVal.scvBytes(Buffer.from([1])),
          ext,
          Address.fromString(SEP0005_TV1_G).toScVal(),
        ],
      }),
    ),
    subInvocations: [
      new xdr.SorobanAuthorizedInvocation({
        function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
          new xdr.InvokeContractArgs({
            contractAddress: Address.fromString(TOKEN).toScAddress(),
            functionName: 'transfer',
            args: [
              Address.fromString(SEP0005_TV1_G).toScVal(),
              Address.fromString(contract).toScVal(),
              nativeToScVal(10n, { type: 'i128' }),
            ],
          }),
        ),
        subInvocations: [],
      }),
    ],
  });
  const preimage = options.withAddress
    ? xdr.HashIdPreimage.envelopeTypeSorobanAuthorizationWithAddress(
      new xdr.HashIdPreimageSorobanAuthorizationWithAddress({
        networkId,
        nonce: xdr.Int64(7n),
        signatureExpirationLedger: 1_000_000,
        address: Address.fromString(SEP0005_TV1_G).toScAddress(),
        invocation,
      }),
    )
    : xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
      new xdr.HashIdPreimageSorobanAuthorization({
        networkId,
        nonce: xdr.Int64(7n),
        signatureExpirationLedger: 1_000_000,
        invocation,
      }),
    );
  return preimage.toXDR('base64');
}

function buildPaymentXdr(source: string, networkPassphrase: string, dest?: string): string {
  const account = new Account(source, '10');
  return new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase,
  })
    .addOperation(
      Operation.payment({
        destination: dest ?? Keypair.random().publicKey(),
        asset: Asset.native(),
        amount: '1',
      }),
    )
    .setTimeout(180)
    .build()
    .toXDR();
}

describe('SppWalletSignerAdapter hardening (offline)', () => {
  beforeEach(() => {
    resetSppSignApprovalsForTests();
    resetSppBroadcastGateForTests();
    setSppTestnetBroadcastAuthorized(true);
  });
  afterEach(() => {
    resetSppBroadcastGateForTests();
  });

  it('implements the official WalletSigner shape', async () => {
    const { signer, vault } = await unlockedStellarSigner();
    const adapter: WalletSigner = makeAdapter(signer);
    expect(typeof adapter.signMessage).toBe('function');
    expect(typeof adapter.signTransaction).toBe('function');
    expect(typeof adapter.signAuthEntry).toBe('function');
    expect(await adapter.getPublicKey!()).toBe(SEP0005_TV1_G);
    await vault.lock();
  });

  it('SEP-53 official TV1/TV2 verify with independent hasher (not production helper)', () => {
    expect(STELLAR_SIGNED_MESSAGE_PREFIX).toBe('Stellar Signed Message:\n');
    const kp = Keypair.fromSecret(SEP53_SEED);
    expect(kp.publicKey()).toBe(SEP53_ADDRESS);

    const d1 = independentSep53Digest(SEP53_MSG);
    expect(ed25519.verify(b64ToBytes(SEP53_SIG_B64), d1, kp.rawPublicKey())).toBe(true);

    const d2 = independentSep53Digest(SEP53_MSG_JA);
    expect(ed25519.verify(b64ToBytes(SEP53_SIG_JA_B64), d2, kp.rawPublicKey())).toBe(true);
  });

  it('signMessage signs only the pinned derivation message', async () => {
    const { signer, vault } = await unlockedStellarSigner();
    const adapter = makeAdapter(signer);
    const pub = await signer.getPublicKey(0);

    expect(() => mintSppSignApproval(baseIntent({
      operation: 'register_public_keys',
      amountStroops: null,
      recipient: null,
      poolContractId: null,
      registryContractId: REGISTRY,
      tokenContractId: null,
      registerNoteKeyHex: NOTE_KEY,
      registerEncryptionKeyHex: ENC_KEY,
      registerNoteKeyProofHex: 'ab',
      registerEncryptionKeySignatureHex: 'cd'.repeat(64),
      registerOwnerSignatureHex: 'ef'.repeat(64),
      maxFeeStroops: '5000000',
      exactMessage: 'hello',
    }))).toThrow(/pinned derivation challenge|pinned KDF domain/);

    approveDerivationMessage();
    const result = await adapter.signMessage(DERIVATION_MESSAGE);
    const { signedMessage, signerAddress } = result as {
      signedMessage: string;
      signerAddress?: string;
    };
    expect(signerAddress).toBe(SEP0005_TV1_G);
    const digest = independentSep53Digest(DERIVATION_MESSAGE);
    expect(ed25519.verify(b64ToBytes(signedMessage), digest, pub)).toBe(true);
    expect(ed25519.verify(b64ToBytes(signedMessage), new TextEncoder().encode(DERIVATION_MESSAGE), pub)).toBe(
      false,
    );
    await expect(adapter.signMessage('')).rejects.toThrow(/approval|derivation/i);
    await vault.lock();
  });

  it('signTransaction: extracts signature from XDR and verifies independently', async () => {
    const { signer, vault } = await unlockedStellarSigner();
    const adapter = makeAdapter(signer);
    mintSppSignApproval(baseIntent());
    const unsigned = buildTransactXdr();
    await expect(adapter.signTransaction(unsigned, {
      networkPassphrase: Networks.TESTNET,
      address: SEP0005_TV1_G,
    })).rejects.toThrow(/SPP_POOL_ECONOMICS_NOT_VERIFIED/);
    await vault.lock();
  });

  it('rejects incompatible network in both directions and wrong source', async () => {
    const { signer, vault } = await unlockedStellarSigner();
    const testnetAdapter = makeAdapter(signer, undefined, Networks.TESTNET);
    expect(() => makeAdapter(signer, undefined, Networks.PUBLIC)).toThrow(/Testnet/i);
    expect(() => makeAdapter(signer, undefined, Networks.FUTURENET)).toThrow(/Testnet/i);

    const testnetXdr = buildPaymentXdr(SEP0005_TV1_G, Networks.TESTNET);

    await expect(
      testnetAdapter.signTransaction(testnetXdr, { networkPassphrase: Networks.PUBLIC }),
    ).rejects.toThrow(/network/i);

    await expect(
      testnetAdapter.signTransaction(testnetXdr, { networkPassphrase: Networks.FUTURENET }),
    ).rejects.toThrow(/network/i);

    const wrongSource = buildPaymentXdr(Keypair.random().publicKey(), Networks.TESTNET);
    await expect(testnetAdapter.signTransaction(wrongSource)).rejects.toThrow(/source/i);

    await expect(testnetAdapter.signTransaction('not-valid-xdr')).rejects.toThrow(SppSignerError);

    await vault.lock();
  });

  it('rejects envelopes that already contain signatures', async () => {
    const { signer, vault } = await unlockedStellarSigner();
    const adapter = makeAdapter(signer);
    const unsigned = buildPaymentXdr(SEP0005_TV1_G, Networks.TESTNET);
    const tx = TransactionBuilder.fromXDR(unsigned, Networks.TESTNET) as import('@stellar/stellar-sdk').Transaction;
    const sig = await signer.signTransaction(tx.hash(), 0);
    const { uint8ArrayToBase64 } = await import(
      '../../../src/stellar/transaction/StellarTransactionClient.js'
    );
    tx.addSignature(SEP0005_TV1_G, uint8ArrayToBase64(sig));
    await expect(adapter.signTransaction(tx.toXDR())).rejects.toThrow(/already contains signatures/i);
    await vault.lock();
  });

  it('signAuthEntry: allowlist + WithAddress binding; rejects contractId', async () => {
    const { signer, vault } = await unlockedStellarSigner();
    const adapter = makeAdapter(signer);
    mintSppSignApproval(baseIntent());
    const legacyB64 = buildTransactAuth(Networks.TESTNET);
    await expect(adapter.signAuthEntry(legacyB64)).rejects.toThrow(/SPP_POOL_ECONOMICS_NOT_VERIFIED/);

    resetSppSignApprovalsForTests();
    mintSppSignApproval(baseIntent());
    const withAddr = buildTransactAuth(Networks.TESTNET, { withAddress: true });
    await expect(adapter.signAuthEntry(withAddr)).rejects.toThrow(/SPP_POOL_ECONOMICS_NOT_VERIFIED/);

    const wrongAddr = buildAuthPreimage(Networks.TESTNET, {
      variant: 'withAddress',
      withAddressG: Keypair.random().publicKey(),
    });
    await expect(adapter.signAuthEntry(wrongAddr)).rejects.toThrow(/address/i);

    const contractId = buildAuthPreimage(Networks.TESTNET, { variant: 'contractId' });
    await expect(adapter.signAuthEntry(contractId)).rejects.toThrow(/not allowed|variant/i);

    await expect(adapter.signAuthEntry('%%%%')).rejects.toThrow(SppSignerError);

    const mainnetPreimage = buildAuthPreimage(Networks.PUBLIC, { variant: 'legacy' });
    await expect(adapter.signAuthEntry(mainnetPreimage)).rejects.toThrow(/networkId/i);

    await vault.lock();
  });

  it('rejects unauthorized signing', async () => {
    const { signer, vault } = await unlockedStellarSigner();
    const adapter = makeAdapter(signer, createRejectingSignatureGate());
    await expect(adapter.signMessage('nope')).rejects.toThrow(/denied|authorization/i);
    await vault.lock();
  });

  it('require-prior-approval: denies without approve; accepts matching prior approval', async () => {
    const { signer, vault } = await unlockedStellarSigner();
    const gate = createContextualSignatureGate('require-prior-approval');
    const adapter = makeAdapter(signer, gate);
    await expect(adapter.signMessage('needs approval')).rejects.toThrow(/denied|approval/i);

    approveDerivationMessage();
    const result = await adapter.signMessage(DERIVATION_MESSAGE);
    expect((result as { signedMessage: string }).signedMessage.length).toBeGreaterThan(0);
    await vault.lock();
  });

  it('gate: payload context mismatch, reuse, cross-lease, and release on failure', () => {
    const gate = createContextualSignatureGate('bind-on-authorize');
    const ctxA: SignatureAuthContext = {
      kind: 'message',
      account: SEP0005_TV1_G,
      networkPassphrase: Networks.TESTNET,
      payloadDigestHex: 'aa'.repeat(32),
    };
    const ctxB: SignatureAuthContext = {
      ...ctxA,
      payloadDigestHex: 'bb'.repeat(32),
    };
    expect(contextsEqual(ctxA, ctxB)).toBe(false);

    const leaseA = gate.authorize(ctxA);
    const leaseB = gate.authorize(ctxB);

    expect(() => gate.assertActive(leaseA, ctxB)).toThrow(/mismatch/i);
    expect(() => gate.assertActive(leaseB, ctxA)).toThrow(/mismatch/i);
    gate.assertActive(leaseA, ctxA);

    gate.end(leaseA);
    expect(() => gate.assertActive(leaseA, ctxA)).toThrow(/no longer active/i);
    expect(gate.activeLeaseCount()).toBe(1);
    gate.end(leaseB);
    expect(gate.activeLeaseCount()).toBe(0);

    // Reuse after end
    expect(() => gate.assertActive(leaseA, ctxA)).toThrow(/no longer active/i);
  });

  it('releases gate lease when signing fails', async () => {
    const { signer, vault } = await unlockedStellarSigner();
    const gate = createContextualSignatureGate('bind-on-authorize');
    let calls = 0;
    const failingSigner = {
      chain: 'stellar' as const,
      getPublicKey: (i: number) => signer.getPublicKey(i),
      signMessage: async () => {
        calls += 1;
        throw new Error('synthetic signer failure');
      },
      signTransaction: async () => {
        throw new Error('synthetic signer failure');
      },
    };
    const adapter = new SppWalletSignerAdapter({
      signer: failingSigner as unknown as SoftwareSigner,
      accountIndex: 0,
      stellarAddress: SEP0005_TV1_G,
      networkPassphrase: Networks.TESTNET,
      authorizationGate: gate,
    });
    approveDerivationMessage();
    await expect(adapter.signMessage(DERIVATION_MESSAGE)).rejects.toThrow(/synthetic signer failure/);
    expect(calls).toBe(1);
    expect(gate.activeLeaseCount()).toBe(0);
    await vault.lock();
  });

  it('rejects address mismatch without leaking secrets', async () => {
    const { signer, vault } = await unlockedStellarSigner();
    const adapter = makeAdapter(signer);
    const other = Keypair.random().publicKey();
    try {
      await adapter.signMessage('hi', { address: other });
      expect.unreachable('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(SppSignerError);
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg.toLowerCase()).not.toMatch(/illness|spike|mnemonic|seed|private/);
      expect(msg).not.toContain(SEP0005_TV1);
    }
    await vault.lock();
  });

  it('revoked lease cannot be used mid-flight (assert before sign)', async () => {
    const { signer, vault } = await unlockedStellarSigner();
    const inner = createContextualSignatureGate('bind-on-authorize');
    let assertCount = 0;
    const revoking = {
      authorize: (ctx: SignatureAuthContext) => inner.authorize(ctx),
      assertActive(lease: SignatureLease, ctx: SignatureAuthContext) {
        assertCount += 1;
        if (assertCount === 1) {
          inner.assertActive(lease, ctx);
          return;
        }
        // Revoke before the pre-sign assert
        inner.end(lease);
        inner.assertActive(lease, ctx);
      },
      end: (lease: SignatureLease) => inner.end(lease),
    };
    const adapter = makeAdapter(signer, revoking);
    approveDerivationMessage();
    await expect(adapter.signMessage(DERIVATION_MESSAGE)).rejects.toThrow(/no longer active/i);
    expect(assertCount).toBeGreaterThanOrEqual(2);
    expect(inner.activeLeaseCount()).toBe(0);
    await vault.lock();
  });
});
