import { StrKey } from '@stellar/stellar-sdk';
import type { Storage, StorageOpenOptions } from 'stellar-private-payments';
import { hashSep53Message } from '@solanym/wallet-core/src/stellar/spp/sep53.js';
import {
  createSppStorageUnlockMessage,
  SPP_STORAGE_DATABASE_ID,
  SPP_STORAGE_UNLOCK_RECORD_KEY,
  SPP_STORAGE_UNLOCK_TTL_MS,
} from '@solanym/wallet-core/src/stellar/spp/sppStorageUnlockGate.js';
import type { SppHostRemoteSigner } from './sppHostRemoteSigner.js';

const DIRECTORY = '.opfs-sahpool-encrypted';
const DIRECTORY_PREFIX = `${DIRECTORY}-`;
const validDirectory = (value: unknown): value is string =>
  value === DIRECTORY || (typeof value === 'string' && /^\.opfs-sahpool-encrypted-[0-9a-f-]{36}$/.test(value));
const WRAP_INFO = 'spp.browser.storage-key-wrap.v1';
const encoder = new TextEncoder();

/** WebCrypto BufferSource requires an ArrayBuffer-backed view under strict TS. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

type StorageSignResult = { signedMessage: string; signerAddress: string };

function encode(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8_192));
  }
  return btoa(binary);
}

function decode(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('Invalid SPP storage key metadata encoding');
  }
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

async function verifySignedMessage(
  account: string,
  message: string,
  signature: Uint8Array,
): Promise<boolean> {
  if (!StrKey.isValidEd25519PublicKey(account) || signature.byteLength !== 64) return false;
  try {
    const publicKey = await crypto.subtle.importKey(
      'raw',
      toArrayBuffer(StrKey.decodeEd25519PublicKey(account)),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify(
      'Ed25519',
      publicKey,
      toArrayBuffer(signature),
      toArrayBuffer(hashSep53Message(message)),
    );
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'NotSupportedError') {
      throw new Error(
        'This browser does not support Ed25519 verification required to unlock encrypted SPP storage. Update the browser before continuing.',
        { cause },
      );
    }
    return false;
  }
}

async function hasExistingEncryptedDatabase(): Promise<boolean> {
  const root = await navigator.storage.getDirectory();
  for await (const [name, handle] of root.entries()) {
    if (handle.kind !== 'directory' || (name !== DIRECTORY && !name.startsWith(DIRECTORY_PREFIX))) continue;
    const directory = handle as FileSystemDirectoryHandle;
    for await (const _entry of directory.entries()) return true;
  }
  return false;
}

async function obtainApproval(input: {
  message: string;
  prepareGeneration: number;
  uses: 1 | 2;
}): Promise<string> {
  const response = await chrome.runtime.sendMessage({
    id: crypto.randomUUID(),
    type: 'SPP_AUTHORIZE_STORAGE_UNLOCK',
    payload: input,
  }) as {
    payload?: { approved?: boolean; approvalToken?: string };
    error?: { message?: string };
  } | undefined;
  const token = response?.payload?.approvalToken;
  if (response?.payload?.approved !== true || typeof token !== 'string') {
    throw new Error(response?.error?.message || 'Storage unlock was not approved by the wallet background');
  }
  return token;
}

async function confirmStorageUnlock(details: {
  account: string;
  origin: string;
  message: string;
  fresh: boolean;
}): Promise<boolean> {
  if (typeof document === 'undefined' || !document.body) {
    throw new Error('SPP storage unlock requires an interactive extension page.');
  }
  return new Promise<boolean>((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-labelledby', 'spp-storage-unlock-title');
    dialog.setAttribute('aria-describedby', 'spp-storage-unlock-description');
    dialog.style.cssText = [
      'max-width:min(680px,calc(100vw - 32px))',
      'width:calc(100vw - 48px)',
      'max-height:calc(100vh - 48px)',
      'overflow:auto',
      'border:1px solid #64748b',
      'border-radius:16px',
      'padding:24px',
      'color:#e5e7eb',
      'background:#111827',
      'box-shadow:0 24px 80px rgba(0,0,0,.55)',
    ].join(';');
    const title = document.createElement('h2');
    title.id = 'spp-storage-unlock-title';
    title.textContent = details.fresh
      ? 'Crear almacenamiento privado SPP cifrado'
      : 'Desbloquear almacenamiento privado SPP';
    const description = document.createElement('p');
    description.id = 'spp-storage-unlock-description';
    description.textContent = [
      `Cuenta Stellar: ${details.account}`,
      `Origen: ${details.origin}`,
      `Base de datos: ${SPP_STORAGE_DATABASE_ID}`,
      details.fresh
        ? 'Se creará una clave aleatoria cifrada para esta base de datos.'
        : 'Se recuperará la clave cifrada existente para esta cuenta.',
      'La firma solo envuelve o recupera la clave local. No deriva claves privadas SPP, no autoriza pagos y no transmite transacciones.',
    ].join('\n\n');
    description.style.whiteSpace = 'pre-wrap';
    const exactMessage = document.createElement('pre');
    exactMessage.textContent = details.message;
    exactMessage.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;border-radius:10px;background:#030712;font-size:12px;max-height:240px;overflow:auto';
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;justify-content:flex-end;gap:12px;margin-top:20px';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancelar';
    const authorize = document.createElement('button');
    authorize.type = 'button';
    authorize.textContent = 'Autorizar firma de desbloqueo';
    authorize.style.cssText = 'padding:10px 16px;border-radius:10px;background:#155e75;color:white;font-weight:600';
    let timeoutId: number | null = null;
    const finish = (accepted: boolean) => {
      if (!dialog.isConnected) return;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(accepted);
    };
    cancel.addEventListener('click', () => finish(false));
    authorize.addEventListener('click', () => finish(true));
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(false);
    });
    actions.append(cancel, authorize);
    dialog.append(title, description, exactMessage, actions);
    document.body.append(dialog);
    try {
      dialog.showModal();
      window.focus();
      timeoutId = window.setTimeout(() => finish(false), SPP_STORAGE_UNLOCK_TTL_MS);
    } catch {
      finish(false);
    }
  });
}

type StorageKeyRecord = {
  version: 1;
  address: string;
  origin: string;
  salt: string;
  iv?: string;
  envelope?: string;
  pending: boolean;
  directory?: string;
};

function readRecord(): StorageKeyRecord | null {
  let raw: unknown;
  try {
    raw = JSON.parse(localStorage.getItem(SPP_STORAGE_UNLOCK_RECORD_KEY) || 'null');
  } catch (cause) {
    throw new Error('Invalid SPP storage key metadata. Restore its encrypted backup before continuing.', { cause });
  }
  if (raw === null) return null;
  const record = raw as Partial<StorageKeyRecord>;
  let valid = false;
  try {
    valid = record.version === 1 &&
      typeof record.address === 'string' &&
      StrKey.isValidEd25519PublicKey(record.address) &&
      record.origin === location.origin &&
      typeof record.salt === 'string' &&
      decode(record.salt).byteLength === 32 &&
      typeof record.pending === 'boolean' &&
      (record.directory === undefined || validDirectory(record.directory)) &&
      (record.pending === true ||
        (typeof record.iv === 'string' && decode(record.iv).byteLength === 12 &&
         typeof record.envelope === 'string' && decode(record.envelope).byteLength === 48));
  } catch {
    valid = false;
  }
  if (!valid) {
    throw new Error('Invalid SPP storage key metadata. The existing database was preserved.');
  }
  return record as StorageKeyRecord;
}

/**
 * Opens the encrypted SDK database using the upstream wallet-wrapped random key
 * pattern. The key itself exists only in memory and is zeroed after Storage.open.
 */
export async function openSppEncryptedStorage(input: {
  storageOpen: (options: StorageOpenOptions) => Promise<Storage>;
  workerUrl: string;
  signer: Pick<SppHostRemoteSigner, 'signStorageUnlockMessage'>;
  activeStellarAddress: string;
  prepareGeneration: number;
  confirmUnlock?: (details: { account: string; origin: string; message: string; fresh: boolean }) => Promise<boolean>;
}): Promise<Storage> {
  if (typeof navigator.locks?.request !== 'function') {
    throw new Error('SPP encrypted storage requires Web Locks; no signature or storage operation was started.');
  }
  return navigator.locks.request(SPP_STORAGE_UNLOCK_RECORD_KEY, { mode: 'exclusive' }, async () => {
    const origin = location.origin;
    if (!/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) {
      throw new Error('SPP storage unlock requires the exact packaged extension origin.');
    }
    if (!StrKey.isValidEd25519PublicKey(input.activeStellarAddress)) {
      throw new Error('Unlock the Stellar vault before opening SPP storage.');
    }

    let record = readRecord();
    const fresh = record === null;
    if (fresh && await hasExistingEncryptedDatabase()) {
      throw Object.assign(
        new Error('Encrypted SPP data exists but its unlock metadata is missing. Restore the original encrypted metadata; existing data was not changed.'),
        { code: 'storage-recovery-required' },
      );
    }
    if (!record) {
      record = {
        version: 1,
        address: input.activeStellarAddress,
        origin,
        salt: encode(crypto.getRandomValues(new Uint8Array(32))),
        pending: true,
      };
    } else if (record.address !== input.activeStellarAddress) {
      throw new Error(`Switch to the Stellar account originally used for SPP storage unlock (${record.address}). No signature was requested.`);
    }

    const message = createSppStorageUnlockMessage({
      origin: record.origin,
      account: record.address,
      salt: record.salt,
    });
    if (!await (input.confirmUnlock ?? confirmStorageUnlock)({
      account: record.address,
      origin,
      message,
      fresh,
    })) {
      throw Object.assign(new Error('SPP storage unlock cancelled by the user.'), { code: 'unlock-cancelled' });
    }

    const approvalToken = await obtainApproval({
      message,
      prepareGeneration: input.prepareGeneration,
      uses: fresh ? 2 : 1,
    });
    const signatureResult = await input.signer.signStorageUnlockMessage(
      message,
      approvalToken,
      { address: record.address },
    );
    if (signatureResult.signerAddress !== record.address) {
      throw new Error('SPP storage unlock signature came from a different Stellar account.');
    }
    const signature = decode(signatureResult.signedMessage);
    if (!await verifySignedMessage(record.address, message, signature)) {
      signature.fill(0);
      throw new Error('SPP storage unlock signature failed local Ed25519 verification.');
    }

    let repeated: Uint8Array | null = null;
    let key: Uint8Array | null = null;
    try {
      if (fresh) {
        const repeatedResult: StorageSignResult = await input.signer.signStorageUnlockMessage(
          message,
          approvalToken,
          { address: record.address },
        );
        repeated = decode(repeatedResult.signedMessage);
        if (
          repeatedResult.signerAddress !== record.address ||
          !await verifySignedMessage(record.address, message, repeated) ||
          !repeated.every((byte, index) => byte === signature[index])
        ) {
          throw new Error('Wallet signatures must be reproducible to initialize encrypted SPP storage.');
        }

        const material = await crypto.subtle.importKey('raw', toArrayBuffer(signature), 'HKDF', false, ['deriveKey']);
        const wrappingKey = await crypto.subtle.deriveKey({
          name: 'HKDF',
          hash: 'SHA-256',
          salt: toArrayBuffer(decode(record.salt)),
          info: toArrayBuffer(encoder.encode(WRAP_INFO)),
        }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

        key = crypto.getRandomValues(new Uint8Array(32));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        record.iv = encode(iv);
        record.envelope = encode(new Uint8Array(await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv: toArrayBuffer(iv), additionalData: toArrayBuffer(encoder.encode(message)) },
          wrappingKey,
          toArrayBuffer(key),
        )));
        record.pending = true;
        // Persist the wrapped key before the first OPFS create attempt. This is
        // what makes an interrupted creation recoverable without losing its key.
        localStorage.setItem(SPP_STORAGE_UNLOCK_RECORD_KEY, JSON.stringify(record));
      } else {
        if (!record.iv || !record.envelope) {
          throw new Error('SPP storage key envelope is incomplete; existing database was preserved.');
        }
        const material = await crypto.subtle.importKey('raw', toArrayBuffer(signature), 'HKDF', false, ['deriveKey']);
        const wrappingKey = await crypto.subtle.deriveKey({
          name: 'HKDF',
          hash: 'SHA-256',
          salt: toArrayBuffer(decode(record.salt)),
          info: toArrayBuffer(encoder.encode(WRAP_INFO)),
        }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        key = new Uint8Array(await crypto.subtle.decrypt({
          name: 'AES-GCM',
          iv: toArrayBuffer(decode(record.iv)),
          additionalData: toArrayBuffer(encoder.encode(message)),
        }, wrappingKey, toArrayBuffer(decode(record.envelope))));
      }
      if (!key || key.byteLength !== 32) throw new Error('Invalid SPP database key envelope.');

      const keyProvider = async (databaseId: string, purpose: 'create' | 'open') => {
        if (databaseId !== SPP_STORAGE_DATABASE_ID) {
          throw new Error('SPP storage key provider refused an unknown database identifier.');
        }
        if (purpose !== (record!.pending ? 'create' : 'open')) {
          throw new Error('SPP storage open purpose does not match the protected database record.');
        }
        return key!;
      };
      const open = (createNew: boolean) => input.storageOpen({
        workerUrl: input.workerUrl,
        createNew,
        keyProvider,
        ...(record!.directory ? { directory: record!.directory } : {}),
      });

      let storage: Storage;
      if (record.pending) {
        try {
          storage = await open(true);
        } catch (cause) {
          if (!(cause instanceof Error) ||
              !cause.message.includes('database create/open purpose does not match existing file')) {
            throw cause;
          }
          storage = await input.storageOpen({
            workerUrl: input.workerUrl,
            createNew: false,
            ...(record.directory ? { directory: record.directory } : {}),
            keyProvider: async (databaseId, purpose) => {
              if (databaseId !== SPP_STORAGE_DATABASE_ID || purpose !== 'open') {
                throw new Error('SPP storage recovery refused an unexpected database context.');
              }
              return key!;
            },
          });
        }
      } else {
        storage = await open(false);
      }
      try {
        record.pending = false;
        localStorage.setItem(SPP_STORAGE_UNLOCK_RECORD_KEY, JSON.stringify(record));
      } catch (cause) {
        // Do not strand an OPFS worker when persisting the completed marker fails.
        try {
          await storage.close();
        } catch {
          /* preserve the metadata persistence error */
        }
        throw cause;
      }
      return storage;
    } catch (cause) {
      throw cause;
    } finally {
      signature.fill(0);
      repeated?.fill(0);
      key?.fill(0);
    }
  });
}
