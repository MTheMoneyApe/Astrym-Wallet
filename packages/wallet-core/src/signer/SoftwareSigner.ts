/**
 * signer/SoftwareSigner.ts — Ed25519 HD software signer.
 *
 * Implements ISigner using SLIP-0010 key derivation (hdDerive.ts) and
 * @noble/curves Ed25519 for signing.
 *
 * SECURITY INVARIANTS:
 *   INVARIANT 1 (plan):
 *     Ed25519 private scalars are derived in memory during getPublicKey(),
 *     signTransaction(), and signMessage() only. They are NEVER assigned to
 *     object properties or returned from any public method.
 *     The scalar's scope is strictly limited to the signing call stack.
 *
 *   INVARIANT 2 (plan):
 *     VaultContents (the mnemonic SeedPhrase) is NOT stored on this object.
 *     getMnemonic() is called once per signing operation and the result is
 *     immediately converted to a seed via mnemonicToSeed(). It is not cached.
 *
 *   INVARIANT 9 (plan):
 *     No console.* calls anywhere in this module.
 *
 * Design:
 *   - Constructor accepts VaultService — the vault boundary for mnemonic access.
 *   - Private key bytes are local variables inside each method that uses them.
 *   - Public keys are returned as plain Uint8Array (non-secret).
 *   - Signatures are returned as branded Signature (64 bytes).
 *   - WalletLockedError propagates naturally from VaultService.getMnemonic().
 */

import { ed25519 } from '@noble/curves/ed25519.js';
import { mnemonicToSeed } from '../crypto/mnemonic.js';
import { derivePath, STELLAR_DERIVATION_PATH, SOLANA_DERIVATION_PATH } from '../crypto/hdDerive.js';
import type { VaultService } from '../vault/VaultService.js';
import type { ISigner } from './ISigner.js';
import { makeSignature, type PublicKeyBytes, type Signature } from './types.js';

export type SupportedSignerChain = 'solana' | 'stellar';

/** Solana BIP-44 path template. accountIndex maps directly to n. */
export const SOLANA_PATH = SOLANA_DERIVATION_PATH;

/** Stellar SEP-0005 BIP-44 path template. */
export const STELLAR_PATH = STELLAR_DERIVATION_PATH;

export class SoftwareSigner implements ISigner {
  /**
   * @param _vault - The VaultService that holds the mnemonic.
   * @param _chain - The target blockchain for key derivation ('solana' | 'stellar', defaults to 'solana').
   *
   * SECURITY: The VaultService is stored only for calling getMnemonic().
   *           No mnemonic, seed, or private key is stored on this object.
   */
  constructor(
    private readonly _vault: VaultService,
    private readonly _chain: SupportedSignerChain = 'solana',
  ) {}

  public get chain(): SupportedSignerChain {
    return this._chain;
  }

  private _getPath(accountIndex: number): string {
    return this._chain === 'stellar' ? STELLAR_PATH(accountIndex) : SOLANA_PATH(accountIndex);
  }

  /**
   * Derive the Ed25519 public key for the given HD account index.
   *
   * Path: m/44'/148'/{accountIndex}' for Stellar, or m/44'/501'/{accountIndex}'/0' for Solana.
   *
   * The seed bytes are derived fresh on every call and are scoped to
   * this method's stack frame only.
   *
   * @throws {WalletLockedError} (propagated from getMnemonic()) if locked.
   */
  async getPublicKey(accountIndex: number): Promise<PublicKeyBytes> {
    const seed = await this._deriveSeed();
    const path = this._getPath(accountIndex);
    // derivePath returns { privateKey, chainCode }. The private key is local,
    // used only to derive the public key. It is not returned or stored.
    const { privateKey } = derivePath(seed, path);
    // ed25519.getPublicKey performs the scalar multiplication G * clamp(privateKey).
    const publicKey = ed25519.getPublicKey(privateKey);
    return publicKey;
  }

  /**
   * Sign a serialized transaction payload.
   *
   * The private key scalar is a local variable inside this method —
   * it is not stored anywhere and goes out of scope when the method returns.
   *
   * @param serializedTx - Raw serialized transaction bytes (pre-built by caller).
   * @param accountIndex - HD account index.
   * @throws {WalletLockedError} if locked.
   */
  async signTransaction(serializedTx: Uint8Array, accountIndex: number): Promise<Signature> {
    return this._sign(serializedTx, accountIndex);
  }

  /**
   * Sign an arbitrary message.
   *
   * The private key scalar is a local variable inside _sign() —
   * it is not stored anywhere and goes out of scope when the method returns.
   *
   * @param message - Message bytes to sign.
   * @param accountIndex - HD account index.
   * @throws {WalletLockedError} if locked.
   */
  async signMessage(message: Uint8Array, accountIndex: number): Promise<Signature> {
    return this._sign(message, accountIndex);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Derive the BIP-39 seed from the vault's mnemonic.
   *
   * The mnemonic string is used only to produce the seed; neither the
   * mnemonic nor the seed is stored on this object.
   *
   * SECURITY: getMnemonic() throws WalletLockedError if locked.
   *           rawMnemonic() is used only to pass to mnemonicToSeed().
   */
  private async _deriveSeed(): Promise<Uint8Array> {
    // getMnemonic() enforces the locked check — WalletLockedError propagates.
    const phrase = this._vault.getMnemonic();
    // Convert mnemonic to 64-byte BIP-39 seed. No passphrase (Phantom-compatible,
    // empty passphrase is hardcoded inside mnemonicToSeed per mnemonic.ts).
    return mnemonicToSeed(phrase);
  }

  /**
   * Core signing operation: derive the private key scalar and sign.
   *
   * INVARIANT 1 ENFORCEMENT:
   *   `privateKey` is a const local variable in this method.
   *   It is passed directly to ed25519.sign() and is not returned,
   *   stored, or assigned outside this stack frame.
   *
   * @param payload - Bytes to sign (transaction or message).
   * @param accountIndex - HD account index.
   */
  private async _sign(payload: Uint8Array, accountIndex: number): Promise<Signature> {
    const seed = await this._deriveSeed();
    const path = this._getPath(accountIndex);

    // INVARIANT 1: `privateKey` lives only within this stack frame.
    const { privateKey } = derivePath(seed, path);

    // ed25519.sign(message, secretKey) → 64-byte signature Uint8Array
    const rawSig = ed25519.sign(payload, privateKey);

    return makeSignature(rawSig);
  }
}
