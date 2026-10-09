/**
 * signer/ISigner.ts — Ed25519 signer interface.
 *
 * All methods that require private key material are async; the private
 * key scalar is only live within each method call's stack frame.
 *
 * SECURITY: Implementations MUST NOT:
 *   - Store private key bytes as object properties.
 *   - Return private key bytes from any method.
 *   - Log, serialise, or transmit private key bytes.
 */

import type { PublicKeyBytes, Signature } from './types.js';

export interface ISigner {
  /**
   * Derive the Ed25519 public key for the given HD account index.
   *
   * Path: m/44'/501'/{accountIndex}'/0'
   *
   * @throws {WalletLockedError} If the vault is locked.
   */
  getPublicKey(accountIndex: number): Promise<PublicKeyBytes>;

  /**
   * Sign a serialized transaction payload with the account's Ed25519 key.
   *
   * The caller is responsible for serialising the transaction before passing it here.
   * This method does NOT perform serialisation or deserialisation.
   *
   * @param serializedTx - Raw serialized transaction bytes (already built by TxBuilder).
   * @param accountIndex - HD account index to sign with.
   * @throws {WalletLockedError} If the vault is locked.
   */
  signTransaction(serializedTx: Uint8Array, accountIndex: number): Promise<Signature>;

  /**
   * Sign an arbitrary message (UTF-8 bytes) with the account's Ed25519 key.
   *
   * @param message - Message bytes to sign.
   * @param accountIndex - HD account index to sign with.
   * @throws {WalletLockedError} If the vault is locked.
   */
  signMessage(message: Uint8Array, accountIndex: number): Promise<Signature>;
}
