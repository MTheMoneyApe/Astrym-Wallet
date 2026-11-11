import { Networks, StrKey } from '@stellar/stellar-sdk';
import { hashSep53Message } from './sep53.js';

export const SPP_STORAGE_DATABASE_ID = 'spp.encrypted.db' as const;
export const SPP_STORAGE_UNLOCK_RECORD_KEY = 'poolstellar_encrypted_storage_v1' as const;
export const SPP_STORAGE_UNLOCK_TTL_MS = 120_000 as const;

export type SppStorageUnlockChallenge = {
  origin: string;
  account: string;
  salt: string;
};

export type SppStorageUnlockAuthorization = {
  digest: Uint8Array;
  permissionEpoch: number;
};

type Permit = {
  account: string;
  message: string;
  generation: number;
  usesRemaining: number;
  expiresAtMs: number;
};

const permits = new Map<string, Permit>();
const reserved = new Set<string>();
let permissionEpoch = 0;

function decodeBase64(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('Storage unlock salt must be canonical base64');
  }
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function assertOrigin(origin: string): string {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error('Storage unlock origin is invalid');
  }
  if (parsed.protocol !== 'chrome-extension:' || parsed.origin !== origin || parsed.pathname !== '/') {
    throw new Error('Storage unlock is restricted to the exact Astrym extension origin');
  }
  return origin;
}

/**
 * Purpose is intentionally excluded from the signed message. A crash after the
 * wrapped key is persisted but before OPFS creation must be recoverable with the
 * same wallet signature and envelope.
 */
export function createSppStorageUnlockMessage(input: SppStorageUnlockChallenge): string {
  if (!StrKey.isValidEd25519PublicKey(input.account)) {
    throw new Error('Storage unlock account must be a valid Stellar G… address');
  }
  const origin = assertOrigin(input.origin);
  const salt = decodeBase64(input.salt);
  if (salt.byteLength !== 32) throw new Error('Storage unlock salt must be 32 bytes');
  return [
    'Stellar Private Payments storage unlock v1',
    `Database: ${SPP_STORAGE_DATABASE_ID}`,
    `Origin: ${origin}`,
    `Account: ${input.account}`,
    `Salt: ${input.salt}`,
  ].join('\n');
}

export function parseSppStorageUnlockMessage(message: string): SppStorageUnlockChallenge | null {
  if (typeof message !== 'string' || message.length > 2_000) return null;
  const lines = message.split('\n');
  if (
    lines.length !== 5 ||
    lines[0] !== 'Stellar Private Payments storage unlock v1' ||
    lines[1] !== `Database: ${SPP_STORAGE_DATABASE_ID}`
  ) return null;
  const origin = lines[2]?.slice('Origin: '.length);
  const account = lines[3]?.slice('Account: '.length);
  const salt = lines[4]?.slice('Salt: '.length);
  if (!origin || !account || !salt || !StrKey.isValidEd25519PublicKey(account)) return null;
  try {
    const canonical = createSppStorageUnlockMessage({ origin, account, salt });
    return canonical === message ? { origin, account, salt } : null;
  } catch {
    return null;
  }
}

function approvalKey(account: string, message: string, generation: number): string {
  return JSON.stringify([account, message, generation]);
}

/** Mint a short-lived permit only after the trusted host's explicit unlock confirmation. */
export function approveSppStorageUnlockRequest(input: {
  account: string;
  message: string;
  prepareGeneration: number;
  uses: number;
  nowMs?: number;
}): string | null {
  if (!StrKey.isValidEd25519PublicKey(input.account)) return null;
  if (!Number.isSafeInteger(input.prepareGeneration) || input.prepareGeneration <= 0) return null;
  const challenge = parseSppStorageUnlockMessage(input.message);
  if (!challenge || challenge.account !== input.account) return null;
  if (input.uses !== 1 && input.uses !== 2) return null;
  const key = approvalKey(input.account, input.message, input.prepareGeneration);
  if (reserved.has(key)) return null;
  const token = crypto.randomUUID();
  reserved.add(key);
  permits.set(token, {
    account: input.account,
    message: input.message,
    generation: input.prepareGeneration,
    usesRemaining: input.uses,
    expiresAtMs: (input.nowMs ?? Date.now()) + SPP_STORAGE_UNLOCK_TTL_MS,
  });
  return token;
}

/** Consume one signature slot from the exact account/message/generation permit. */
export function authorizeSppStorageUnlockSignature(input: {
  account: string;
  message: string;
  prepareGeneration: number;
  approvalToken: string;
  networkPassphrase: string;
  nowMs?: number;
}): SppStorageUnlockAuthorization {
  if (input.networkPassphrase !== Networks.TESTNET) {
    throw new Error('Storage unlock signatures are restricted to Stellar Testnet');
  }
  const permit = permits.get(input.approvalToken);
  if (
    !permit ||
    permit.expiresAtMs <= (input.nowMs ?? Date.now()) ||
    permit.account !== input.account ||
    permit.message !== input.message ||
    permit.generation !== input.prepareGeneration
  ) {
    permits.delete(input.approvalToken);
    throw new Error('Storage unlock approval is missing, expired, or bound to another request');
  }
  permit.usesRemaining -= 1;
  if (permit.usesRemaining <= 0) permits.delete(input.approvalToken);
  return { digest: hashSep53Message(input.message), permissionEpoch };
}

export function assertSppStorageUnlockSignatureStillPermitted(epoch: number): void {
  if (epoch !== permissionEpoch) {
    throw new Error('SPP storage unlock approval was revoked before signing');
  }
}

export function revokeSppStorageUnlockApprovals(): void {
  permissionEpoch += 1;
  permits.clear();
  reserved.clear();
}

export function resetSppStorageUnlockApprovalsForTests(): void {
  permissionEpoch = 0;
  permits.clear();
  reserved.clear();
}
