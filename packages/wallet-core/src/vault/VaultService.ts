/**
 * vault/VaultService.ts — Vault lifecycle state machine.
 *
 * Manages the three-layer vault security model:
 *   1. Persistent storage (chrome.storage.local) — EncryptedVaultBlob only.
 *   2. Session storage (chrome.storage.session) — AES-256-GCM CryptoKey only.
 *   3. SW module memory — VaultContents (decrypted mnemonic) only.
 *
 * Auto-lock integration:
 *   The optional IAlarmService parameter enables inactivity-based auto-lock.
 *   When provided:
 *     - unlock / createVault / tryRestoreFromSession → schedule alarm
 *     - resetActivityTimer() → cancel + reschedule (call from every SW handler)
 *     - lock() → cancel alarm
 *   setTimeout is NOT used — it does not survive SW suspension.
 *
 * SECURITY INVARIANTS ENFORCED HERE:
 *   - Mnemonic never written to persistent or session storage.
 *   - Session storage receives ONLY a non-extractable CryptoKey.
 *   - lock() clears both in-memory VaultContents and the session key.
 *   - lock() cancels any pending auto-lock alarm.
 *   - A new VaultService instance starts locked (simulates SW restart).
 *   - getMnemonic() throws WalletLockedError if locked; callers must unlock first.
 *   - Passwords are never stored, logged, or serialised.
 *   - No setAccessLevel() call anywhere in this module.
 *
 * Session key lifecycle:
 *   createVault / unlock → PBKDF2 → CryptoKey → session storage
 *   tryRestoreFromSession → session key + blob → AES-GCM decrypt (no PBKDF2)
 *   lock / logout / browser-close → session key cleared
 *
 * KDF note:
 *   unlock() calls deriveKey() once (1× PBKDF2) then decryptWithKey().
 *   createVault() calls encrypt() (1× PBKDF2 internally) then deriveKey() (1× PBKDF2)
 *   = 2× PBKDF2 at creation only, acceptable since creation is a one-time event.
 */

import { makeSeedPhrase, rawMnemonic, type SeedPhrase } from '../crypto/types.js';
import type { IAlarmService } from './IAlarmService.js';
import type { IPersistentStorage, ISessionStorage } from './IVaultStorage.js';
import type { IVaultUnlocker } from './IVaultUnlocker.js';
import {
  VaultAlreadyExistsError,
  VaultDecryptionError,
  VaultNotFoundError,
  WalletLockedError,
  type VaultContents,
} from './types.js';

// ── Encoding helpers ───────────────────────────────────────────────────────────

const _enc = new TextEncoder();
const _dec = new TextDecoder();

/** Serialise VaultContents to JSON bytes for AES-GCM encryption. */
function encodeContents(contents: VaultContents): Uint8Array {
  // Only mnemonic (and optional accountName) — never embed keys or passwords.
  return _enc.encode(JSON.stringify(contents));
}

/** Deserialise JSON bytes back to VaultContents after AES-GCM decryption. */
function decodeContents(plaintext: Uint8Array): VaultContents {
  let obj: unknown;
  try {
    obj = JSON.parse(_dec.decode(plaintext));
  } catch {
    throw new VaultDecryptionError('vault contents are not valid JSON');
  }
  if (
    typeof obj !== 'object' ||
    obj === null ||
    typeof (obj as Record<string, unknown>)['mnemonic'] !== 'string'
  ) {
    throw new VaultDecryptionError('vault contents missing required mnemonic field');
  }
  return obj as VaultContents;
}

// ── VaultService ───────────────────────────────────────────────────────────────

/**
 * Vault lifecycle state machine.
 *
 * Inject via constructor — never reach through to storage or unlocker directly.
 * One instance per service-worker activation.
 *
 * @example
 *   const vault = new VaultService(
 *     new PasswordUnlocker(),
 *     persistentStorage,
 *     sessionStorage,
 *     alarmService,   // optional — enables auto-lock
 *   );
 *   await vault.createVault('strong-password', phrase);
 *   vault.getMnemonic(); // → SeedPhrase
 *   await vault.lock();
 */
export class VaultService {
  /**
   * Decrypted vault contents — lives ONLY in SW module memory.
   * null when locked. Cleared by lock() and on SW restart (module re-initialisation).
   *
   * NEVER write this to any storage.
   */
  private _contents: VaultContents | null = null;

  constructor(
    private readonly _unlocker: IVaultUnlocker,
    private readonly _persistent: IPersistentStorage,
    private readonly _session: ISessionStorage,
    private readonly _alarm: IAlarmService | null = null,
  ) {
    // Register the lock callback once, at construction time.
    // When the alarm fires (inactivity timeout), the wallet locks automatically.
    if (_alarm !== null) {
      _alarm.onAlarm(async () => {
        await this.lock();
      });
    }
  }

  // ── State queries ─────────────────────────────────────────────────────────

  /**
   * Whether the wallet is currently locked.
   * A new VaultService instance is always locked (simulates SW restart).
   */
  get isLocked(): boolean {
    return this._contents === null;
  }

  /**
   * Whether an encrypted vault exists in persistent storage.
   * A false result means the user must call createVault() before unlock().
   */
  async hasVault(): Promise<boolean> {
    return (await this._persistent.loadBlob()) !== null;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Create a new encrypted vault from a mnemonic phrase.
   *
   * Steps:
   *   1. Reject if a vault already exists (safety guard).
   *   2. Encrypt mnemonic → EncryptedVaultBlob (1× PBKDF2 inside unlocker.encrypt).
   *   3. Persist the blob to persistent storage.
   *   4. Derive the wrapping key from the blob's salt (1× PBKDF2).
   *   5. Store the wrapping key in session storage.
   *   6. Set in-memory VaultContents → wallet is immediately unlocked.
   *   7. Schedule the auto-lock alarm (if alarm service provided).
   *
   * @throws {VaultAlreadyExistsError} If a vault already exists.
   */
  async createVault(password: string, mnemonic: SeedPhrase): Promise<void> {
    // Guard: prevent accidental overwrite of an existing vault.
    const existingBlob = await this._persistent.loadBlob();
    if (existingBlob !== null) {
      throw new VaultAlreadyExistsError();
    }

    const contents: VaultContents = { mnemonic: rawMnemonic(mnemonic) };
    const plaintext = encodeContents(contents);

    // Step 1: encrypt — generates fresh random salt + IV, runs PBKDF2 internally.
    const blob = await this._unlocker.encrypt(password, plaintext);

    // Step 2: persist the encrypted blob (only safe value for persistent storage).
    await this._persistent.saveBlob(blob);

    // Step 3: derive the wrapping key for session caching (second PBKDF2 for create).
    // Acceptable cost: createVault is a one-time operation.
    const key = await this._unlocker.deriveKey(password, blob);

    // Step 4: cache the wrapping key in session storage for transparent re-unlock.
    // INVARIANT: key is non-extractable CryptoKey — not the mnemonic.
    await this._session.saveKey(key);

    // Step 5: set in-memory state — wallet is now unlocked.
    this._contents = contents;

    // Step 6: start the inactivity auto-lock countdown.
    await this._scheduleAlarm();
  }

  /**
   * Unlock the wallet with a password.
   *
   * Steps:
   *   1. Load the encrypted blob from persistent storage.
   *   2. Derive the wrapping key from password + blob's salt (1× PBKDF2).
   *   3. Decrypt the blob with the key (AES-GCM — verifies auth tag).
   *   4. Cache the wrapping key in session storage.
   *   5. Set in-memory VaultContents.
   *   6. Schedule the auto-lock alarm.
   *
   * @throws {VaultNotFoundError} If no vault exists.
   * @throws {VaultDecryptionError} If the password is wrong or the blob is tampered.
   */
  async unlock(password: string): Promise<void> {
    const blob = await this._persistent.loadBlob();
    if (blob === null) {
      throw new VaultNotFoundError();
    }

    // Single PBKDF2 invocation: derive key, then decrypt with it.
    const key = await this._unlocker.deriveKey(password, blob);
    const plaintext = await this._unlocker.decryptWithKey(key, blob);
    const contents = decodeContents(plaintext);

    // Cache key in session storage for transparent SW-restart re-unlock.
    await this._session.saveKey(key);

    // Set in-memory state.
    this._contents = contents;

    // Start the inactivity auto-lock countdown.
    await this._scheduleAlarm();
  }

  /**
   * Lock the wallet.
   *
   * Clears:
   *   - In-memory VaultContents (_contents = null).
   *   - Session storage wrapping key.
   *   - Any pending auto-lock alarm.
   *
   * After lock(), getMnemonic() throws WalletLockedError until
   * unlock() or tryRestoreFromSession() succeeds.
   */
  async deleteVault(): Promise<void> {
    // 1. Invalidar material sensible en memoria de inmediato
    this._contents = null;

    const errors: Error[] = [];

    // 2. Intentar purgar blob persistente
    try {
      await this._persistent.clearBlob();
    } catch (e) {
      errors.push(e instanceof Error ? e : new Error(String(e)));
    }

    // 3. Intentar purgar llave de sesión, independientemente del disco
    try {
      await this._session.clearKey();
    } catch (e) {
      errors.push(e instanceof Error ? e : new Error(String(e)));
    }

    // 4. Cancelar alarma
    try {
      await this._cancelAlarm();
    } catch (e) {
      errors.push(e instanceof Error ? e : new Error(String(e)));
    }

    if (errors.length > 0) {
      throw new Error(`deleteVault partially failed: ${errors.map(e => e.message).join('; ')}`);
    }
  }

  async lock(): Promise<void> {
    // Clear in-memory secret material first.
    this._contents = null;
    // Clear session key — requires password to unlock again.
    await this._session.clearKey();
    // Cancel the auto-lock alarm — a locked wallet needs no timer.
    await this._cancelAlarm();
  }

  /**
   * Attempt to restore the unlocked state from the session-cached wrapping key.
   *
   * Called at SW activation to transparently re-unlock without prompting
   * for the password, as long as the session key is still valid.
   *
   * On success, schedules the auto-lock alarm.
   *
   * If the session key is missing, expired, or cannot decrypt the blob,
   * returns false and the wallet remains locked.
   *
   * @returns true if the session was successfully restored (wallet is now unlocked).
   */
  async tryRestoreFromSession(): Promise<boolean> {
    const [blob, key] = await Promise.all([
      this._persistent.loadBlob(),
      this._session.loadKey(),
    ]);

    if (blob === null || key === null) {
      return false;
    }

    try {
      const plaintext = await this._unlocker.decryptWithKey(key, blob);
      this._contents = decodeContents(plaintext);
      // Restore also reschedules the alarm — the SW woke up, activity occurred.
      await this._scheduleAlarm();
      return true;
    } catch {
      // Session key is stale or the blob is corrupt. Clear the stale key.
      // SECURITY: Do not log the caught error.
      await this._session.clearKey();
      return false;
    }
  }

  /**
   * Reset the inactivity auto-lock timer.
   *
   * Call this from every service-worker message handler that represents
   * user activity (e.g. balance fetch, account list, dApp request).
   * Has no effect if no alarm service was provided or the wallet is locked.
   */
  async resetActivityTimer(): Promise<void> {
    if (this._alarm === null || this._contents === null) return;
    // Cancel the existing alarm and schedule a fresh one.
    await this._alarm.cancel();
    await this._alarm.schedule();
  }

  // ── Secret data access ────────────────────────────────────────────────────

  /**
   * Return the decrypted mnemonic phrase.
   *
   * SECURITY: Callers must never log, serialise, or store this value outside
   * wallet-core. It must only be used for HD key derivation (hdDerive.ts).
   *
   * @throws {WalletLockedError} If the wallet is locked.
   */
  getMnemonic(): SeedPhrase {
    if (this._contents === null) {
      throw new WalletLockedError();
    }
    return makeSeedPhrase(this._contents.mnemonic);
  }

  // ── Private alarm helpers ─────────────────────────────────────────────────

  /** Schedule the auto-lock alarm if an alarm service is available. */
  private async _scheduleAlarm(): Promise<void> {
    if (this._alarm !== null) {
      await this._alarm.schedule();
    }
  }

  /** Cancel the auto-lock alarm if an alarm service is available. */
  private async _cancelAlarm(): Promise<void> {
    if (this._alarm !== null) {
      await this._alarm.cancel();
    }
  }
}

