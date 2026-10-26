/**
 * Local integration: vault (test fixture) → SEP-0005 Stellar path → StrKey
 * → offline payment TX → SoftwareSigner(tx.hash) → cryptographic verify.
 *
 * Uses only the published SEP-0005 Test Vector 1 mnemonic (not a user secret).
 * Does not touch Horizon, Friendbot, LIVE flags, or the user's real vault.
 */

import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { makeSeedPhrase } from '../../src/crypto/types.js';
import {
  deriveStellarPublicKey,
  STELLAR_DERIVATION_PATH,
} from '../../src/crypto/hdDerive.js';
import { mnemonicToSeed } from '../../src/crypto/mnemonic.js';
import { SoftwareSigner } from '../../src/signer/SoftwareSigner.js';
import { uint8ArrayToBase64 } from '../../src/stellar/transaction/StellarTransactionClient.js';
import { PasswordUnlocker } from '../../src/vault/PasswordUnlocker.js';
import { VaultService } from '../../src/vault/VaultService.js';
import type { IPersistentStorage, ISessionStorage } from '../../src/vault/IVaultStorage.js';
import type { EncryptedVaultBlob } from '../../src/vault/types.js';

/** SEP-0005 official Test Vector 1 (12-word) — public fixture only. */
const SEP0005_TV1_MNEMONIC =
  'illness spike retreat truth genius clock brain pass fit cave bargain toe';
const SEP0005_TV1_ACCOUNT0 =
  'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';
/** Deterministic Testnet destination (not funded; never submitted). */
const TEST_DESTINATION =
  'GDOOZOX54XD7PAOHO6EXLH4OZC4JRBU4HLRM5RBD7A2DRBZJFDPFPBRE';

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

describe('Stellar signing chain integration (local, offline)', () => {
  it('vault → m/44\'/148\'/0\' → StrKey → payment TX hash signature verifies', async () => {
    expect(STELLAR_DERIVATION_PATH(0)).toBe("m/44'/148'/0'");

    const vault = new VaultService(
      new PasswordUnlocker(),
      new MemPersistent(),
      new MemSession(),
    );
    await vault.createVault('TestFixturePassword!1', makeSeedPhrase(SEP0005_TV1_MNEMONIC));

    const signer = new SoftwareSigner(vault, 'stellar');
    expect(signer.chain).toBe('stellar');

    const accountIndex = 0;
    const publicKey = await signer.getPublicKey(accountIndex);
    const sourceAddress = StrKey.encodeEd25519PublicKey(publicKey);

    // Same address from raw SEP-0005 derivation (no vault round-trip ambiguity).
    const seed = mnemonicToSeed(makeSeedPhrase(SEP0005_TV1_MNEMONIC));
    const expectedPub = deriveStellarPublicKey(seed, accountIndex);
    expect(Buffer.from(publicKey).equals(Buffer.from(expectedPub))).toBe(true);
    expect(sourceAddress).toBe(SEP0005_TV1_ACCOUNT0);
    expect(STELLAR_DERIVATION_PATH(accountIndex)).toBe(`m/44'/148'/${accountIndex}'`);

    // Offline payment envelope — no Horizon load/submit.
    const account = new Account(sourceAddress, '100');
    const tx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: TEST_DESTINATION,
          asset: Asset.native(),
          amount: '1',
        }),
      )
      .setTimeout(300)
      .build();

    expect(tx.source).toBe(sourceAddress);
    const txHash = tx.hash();
    expect(txHash.byteLength).toBe(32);

    const signature = await signer.signTransaction(txHash, accountIndex);
    expect(signature.byteLength).toBe(64);

    // Cryptographic verify (noble) against the vault-derived public key.
    expect(ed25519.verify(signature, txHash, publicKey)).toBe(true);

    // Stellar Keypair verify — same format SOLANYM attaches via addSignature.
    const stellarKp = Keypair.fromPublicKey(sourceAddress);
    expect(stellarKp.verify(txHash, signature)).toBe(true);

    // Stellar SDK addSignature verifies the base64 Ed25519 sig against sourceAddress
    // (throws on invalid) — same attachment path as StellarTransactionClient.sendXlm.
    tx.addSignature(sourceAddress, uint8ArrayToBase64(signature));
    expect(tx.signatures.length).toBe(1);

    // Wrong key / wrong payload must fail (coherence, not just non-empty sig).
    const otherPub = await signer.getPublicKey(1);
    expect(ed25519.verify(signature, txHash, otherPub)).toBe(false);
    const tampered = new Uint8Array(txHash);
    tampered[0] = (tampered[0]! + 1) % 256;
    expect(ed25519.verify(signature, tampered, publicKey)).toBe(false);

    await vault.lock();
  });
});
