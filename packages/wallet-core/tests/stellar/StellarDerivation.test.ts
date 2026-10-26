import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { StrKey } from '@stellar/stellar-sdk';
import { mnemonicToSeed } from '../../src/crypto/mnemonic.js';
import { makeSeedPhrase } from '../../src/crypto/types.js';
import {
  deriveStellarPublicKey,
  deriveStellarKeyNode,
  STELLAR_DERIVATION_PATH,
  deriveSolanaPublicKey,
} from '../../src/crypto/hdDerive.js';
import { SoftwareSigner } from '../../src/signer/SoftwareSigner.js';
import { PasswordUnlocker } from '../../src/vault/PasswordUnlocker.js';
import { VaultService } from '../../src/vault/VaultService.js';
import type { IPersistentStorage, ISessionStorage } from '../../src/vault/IVaultStorage.js';
import type { EncryptedVaultBlob } from '../../src/vault/types.js';

class MemPersistent implements IPersistentStorage {
  private _blob: EncryptedVaultBlob | null = null;
  async loadBlob() { return this._blob; }
  async saveBlob(blob: EncryptedVaultBlob) { this._blob = blob; }
  async clearBlob() { this._blob = null; }
}

class MemSession implements ISessionStorage {
  private _key: CryptoKey | null = null;
  async loadKey() { return this._key; }
  async saveKey(key: CryptoKey) { this._key = key; }
  async clearKey() { this._key = null; }
}

describe('Stellar SEP-0005 Key Derivation — Official Test Vectors', () => {
  // Test 1 (12 words)
  const MNEMONIC_1 = 'illness spike retreat truth genius clock brain pass fit cave bargain toe';
  const SEED_1 = mnemonicToSeed(makeSeedPhrase(MNEMONIC_1));

  it('SEP-0005 Test 1 — Primary key (m/44\'/148\'/0\') public key and address', () => {
    const pub = deriveStellarPublicKey(SEED_1, 0);
    const addr = StrKey.encodeEd25519PublicKey(pub);
    expect(addr).toBe('GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6');
  });

  it('SEP-0005 Test 1 — Account 1 (m/44\'/148\'/1\') address matches spec', () => {
    const pub = deriveStellarPublicKey(SEED_1, 1);
    const addr = StrKey.encodeEd25519PublicKey(pub);
    expect(addr).toBe('GBAW5XGWORWVFE2XTJYDTLDHXTY2Q2MO73HYCGB3XMFMQ562Q2W2GJQX');
  });

  it('SEP-0005 Test 1 — Account 2 (m/44\'/148\'/2\') address matches spec', () => {
    const pub = deriveStellarPublicKey(SEED_1, 2);
    const addr = StrKey.encodeEd25519PublicKey(pub);
    expect(addr).toBe('GAY5PRAHJ2HIYBYCLZXTHID6SPVELOOYH2LBPH3LD4RUMXUW3DOYTLXW');
  });

  // Test 2 (15 words)
  const MNEMONIC_2 = 'resource asthma orphan phone ice canvas fire useful arch jewel impose vague theory cushion top';
  const SEED_2 = mnemonicToSeed(makeSeedPhrase(MNEMONIC_2));

  it('SEP-0005 Test 2 — Account 0 (m/44\'/148\'/0\') address matches spec', () => {
    const pub = deriveStellarPublicKey(SEED_2, 0);
    const addr = StrKey.encodeEd25519PublicKey(pub);
    expect(addr).toBe('GAVXVW5MCK7Q66RIBWZZKZEDQTRXWCZUP4DIIFXCCENGW2P6W4OA34RH');
  });

  // Test 3 (24 words)
  const MNEMONIC_3 =
    'bench hurt jump file august wise shallow faculty impulse spring exact slush thunder author capable act festival slice deposit sauce coconut afford frown better';
  const SEED_3 = mnemonicToSeed(makeSeedPhrase(MNEMONIC_3));

  it('SEP-0005 Test 3 — 24-word Account 0 (m/44\'/148\'/0\') address matches spec', () => {
    const pub = deriveStellarPublicKey(SEED_3, 0);
    const addr = StrKey.encodeEd25519PublicKey(pub);
    expect(addr).toBe('GC3MMSXBWHL6CPOAVERSJITX7BH76YU252WGLUOM5CJX3E7UCYZBTPJQ');
  });

  it('Preserves Solana derivation distinctly from Stellar derivation on the same seed', () => {
    const stellarPub = deriveStellarPublicKey(SEED_1, 0);
    const solanaPub = deriveSolanaPublicKey(SEED_1, 0);
    expect(Buffer.from(stellarPub).toString('hex')).not.toBe(
      Buffer.from(solanaPub).toString('hex'),
    );
    expect(STELLAR_DERIVATION_PATH(0)).toBe("m/44'/148'/0'");
  });
});

describe('SoftwareSigner — Stellar Mode', () => {
  it('derives correct SEP-0005 public address and signs messages', async () => {
    const MNEMONIC = 'illness spike retreat truth genius clock brain pass fit cave bargain toe';
    const vault = new VaultService(new PasswordUnlocker(), new MemPersistent(), new MemSession());
    await vault.createVault('Password!123', makeSeedPhrase(MNEMONIC));

    const signer = new SoftwareSigner(vault, 'stellar');
    expect(signer.chain).toBe('stellar');

    const pubKey = await signer.getPublicKey(0);
    const addr = StrKey.encodeEd25519PublicKey(pubKey);
    expect(addr).toBe('GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6');

    // Sign message and verify
    const message = new TextEncoder().encode('Test Stellar transaction payload');
    const signature = await signer.signMessage(message, 0);
    expect(signature.length).toBe(64);
    expect(ed25519.verify(signature, message, pubKey)).toBe(true);
  });
});
