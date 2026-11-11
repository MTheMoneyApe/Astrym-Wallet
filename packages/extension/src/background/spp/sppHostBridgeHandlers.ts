/**
 * SW-side handlers for spp-host bridge requests that must touch the vault or Nym.
 * Signatures and HTTP bodies only — never seeds or private keys on the wire.
 */

import browser from 'webextension-polyfill';
import type { SoftwareSigner } from '@solanym/wallet-core/src/signer/SoftwareSigner.js';
import type { KeyManager } from '@solanym/wallet-core/src/keyManager/KeyManager.js';
import { SppWalletSignerAdapter } from '@solanym/wallet-core/src/stellar/spp/SppWalletSignerAdapter.js';
import { createContextualSignatureGate } from '@solanym/wallet-core/src/stellar/spp/signatureGate.js';
import {
  SppSignerError,
  assertStellarTestnetPassphrase,
  revokeSppSignApprovals,
  sppKeyDerivationDomainFromMessage,
  waitForSppKeyDerivationApproval,
} from '@solanym/wallet-core/src/stellar/spp/sppSignGate.js';
import { isSppTestnetBroadcastAuthorized } from '@solanym/wallet-core/src/stellar/spp/sppBroadcastGate.js';
import { STELLAR_SOROBAN_TESTNET_RPC } from '@solanym/wallet-core/src/stellar/spp/sppNymOption.js';
import {
  SPP_HOST_BRIDGE_CHANNEL,
  type SppHostNymFetchRequest,
  type SppHostNymFetchResult,
  type SppHostSignRequest,
  type SppHostSignResult,
} from '../../shared/sppHostBridge.js';
import { getNymRuntimeController } from '../nym/NymRuntimeController.js';
import { isSppHostDocumentSender } from '../trustedWalletOrigin.js';
import { parseSppStorageUnlockMessage, sppStorageUnlockOriginFromUrl } from '@solanym/wallet-core/src/stellar/spp/sppStorageUnlockGate.js';
import { resolveActiveStellarAddress } from './sppBoundAccount.js';
import {
  SPP_AUTO_PREPARE_INTENT_KEY,
  SPP_PREPARE_STATUS_KEY,
  type SppAutoPrepareIntent,
  type SppPrepareStatus,
} from '../../shared/sppPrepareStatus.js';

/** Testnet passphrase (keep in sync with Networks.TESTNET). */
const STELLAR_TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

export type SppHostBridgeHandlerDeps = {
  signer: SoftwareSigner;
  keyManager: KeyManager;
  networkPassphrase?: string;
};

const SOROBAN_READ_METHODS = new Set([
  'getHealth',
  'getLatestLedger',
  'getLedgerEntries',
  'getEvents',
  'getTransaction',
  'simulateTransaction',
]);

type SorobanRpcClass = 'read' | 'send' | 'unknown' | 'mixed';

/** Reads stay on the allow-list. Anything else, including an unreadable body, is not fetched. */
function classifySorobanBody(body: string | undefined): SorobanRpcClass {
  if (!body) return 'unknown';
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return 'unknown';
  }
  const batch = Array.isArray(parsed) ? parsed : [parsed];
  if (batch.length === 0) return 'unknown';
  let sawRead = false;
  let sawSend = false;
  let sawOther = false;
  for (const entry of batch) {
    if (!entry || typeof entry !== 'object') {
      sawOther = true;
      continue;
    }
    const method = (entry as { method?: unknown }).method;
    if (typeof method !== 'string') {
      sawOther = true;
    } else if (method === 'sendTransaction') {
      sawSend = true;
    } else if (SOROBAN_READ_METHODS.has(method)) {
      sawRead = true;
    } else {
      sawOther = true;
    }
  }
  const kinds = Number(sawRead) + Number(sawSend) + Number(sawOther);
  if (kinds > 1) return 'mixed';
  if (sawSend) return 'send';
  if (sawRead) return 'read';
  return 'unknown';
}

function isTrustedSorobanEndpoint(value: string): boolean {
  let given: URL;
  let trusted: URL;
  try {
    given = new URL(value);
    trusted = new URL(STELLAR_SOROBAN_TESTNET_RPC);
  } catch {
    return false;
  }
  return given.origin === trusted.origin
    && given.pathname === trusted.pathname
    && given.search === ''
    && given.username === ''
    && given.password === '';
}

/**
 * Handle host → SW signing.
 * Sender must be the extension spp-host document. The adapter uses
 * require-prior-approval plus a single-use intent. A future disposable
 * Testnet signer must be passed as `SppWalletSignerAdapter`'s digestSigner
 * (or call `signDigestWithSppGate`); do not sign the raw payload here.
 */
export async function handleSppHostSignRequest(
  request: SppHostSignRequest,
  deps: SppHostBridgeHandlerDeps,
  sender?: { id?: string | undefined; url?: string | undefined },
): Promise<SppHostSignResult> {
  if (!isSppHostDocumentSender(sender)) {
    return {
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_SIGN_RESULT',
      id: request.id,
      ok: false,
      code: 'UNAUTHORIZED',
      message: 'SPP signatures are accepted only from the extension spp-host document.',
    };
  }

  const ctrl = getNymRuntimeController();
  const snap = ctrl.getSnapshot();
  if (snap.mode !== 'nym' || !snap.connected) {
    return {
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_SIGN_RESULT',
      id: request.id,
      ok: false,
      code: 'NYM_REQUIRED',
      message: 'SPP signing requires Nym connected (fail-closed).',
    };
  }

  try {
    if (deps.signer.chain !== 'stellar') {
      return {
        channel: SPP_HOST_BRIDGE_CHANNEL,
        type: 'SPP_HOST_SIGN_RESULT',
        id: request.id,
        ok: false,
        code: 'UNAUTHORIZED',
        message: 'Vault signer is not bound to Stellar.',
      };
    }

    const networkPassphrase = deps.networkPassphrase ?? STELLAR_TESTNET_PASSPHRASE;
    try {
      assertStellarTestnetPassphrase(networkPassphrase);
    } catch (cause) {
      return {
        channel: SPP_HOST_BRIDGE_CHANNEL,
        type: 'SPP_HOST_SIGN_RESULT',
        id: request.id,
        ok: false,
        code: 'UNAUTHORIZED',
        message: cause instanceof Error ? cause.message : 'Only the Stellar Testnet passphrase is allowed',
      };
    }
    if (request.payload.networkPassphrase !== networkPassphrase) {
      return {
        channel: SPP_HOST_BRIDGE_CHANNEL,
        type: 'SPP_HOST_SIGN_RESULT',
        id: request.id,
        ok: false,
        code: 'UNAUTHORIZED',
        message: 'Only the Stellar Testnet passphrase is allowed.',
      };
    }

    const { index, address } = await resolveActiveStellarAddress(deps.keyManager);
    if (request.payload.address && request.payload.address !== address) {
      return {
        channel: SPP_HOST_BRIDGE_CHANNEL,
        type: 'SPP_HOST_SIGN_RESULT',
        id: request.id,
        ok: false,
        code: 'UNAUTHORIZED',
        message: 'Requested signer address does not match the active account.',
      };
    }

    const { kind, input } = request.payload;
    const storageUnlockToken = request.payload.authorization === 'storage_unlock'
      ? request.payload.storageUnlockApprovalToken
      : undefined;
    if (request.payload.authorization === 'storage_unlock') {
      const challenge = kind === 'message' ? parseSppStorageUnlockMessage(input) : null;
      let senderOrigin: string | null = null;
      try {
        senderOrigin = sender?.url ? sppStorageUnlockOriginFromUrl(sender.url) : null;
      } catch {
        senderOrigin = null;
      }
      const [stored, storedIntent] = await Promise.all([
        browser.storage.local.get(SPP_PREPARE_STATUS_KEY),
        browser.storage.local.get(SPP_AUTO_PREPARE_INTENT_KEY),
      ]);
      const current = stored[SPP_PREPARE_STATUS_KEY] as SppPrepareStatus | undefined;
      const activeIntent = storedIntent[SPP_AUTO_PREPARE_INTENT_KEY] as SppAutoPrepareIntent | undefined;
      if (
        !storageUnlockToken ||
        !challenge ||
        challenge.account !== address ||
        challenge.origin !== senderOrigin ||
        current?.phase !== 'initializing_session' ||
        current.generation !== request.payload.prepareGeneration ||
        activeIntent?.autoRun !== true ||
        activeIntent.generation !== request.payload.prepareGeneration
      ) {
        throw new Error('SPP storage unlock requires the exact active account, origin and initialization generation');
      }
    } else if (request.payload.storageUnlockApprovalToken !== undefined) {
      throw new Error('Storage unlock approval token requires storage_unlock authorization mode');
    }
    // Only the exact upstream v3 key-derivation message can use the separate
    // user-consent path. Every other message/transaction/auth entry still
    // requires the Testnet broadcast gate and the normal single-use intent.
    const kdfDomain = kind === 'message' ? sppKeyDerivationDomainFromMessage(input) : null;
    const kdfApprovalToken = kdfDomain
      ? await (async () => {
          const [stored, storedIntent] = await Promise.all([
            browser.storage.local.get(SPP_PREPARE_STATUS_KEY),
            browser.storage.local.get(SPP_AUTO_PREPARE_INTENT_KEY),
          ]);
          const current = stored[SPP_PREPARE_STATUS_KEY] as SppPrepareStatus | undefined;
          const activeIntent = storedIntent[SPP_AUTO_PREPARE_INTENT_KEY] as SppAutoPrepareIntent | undefined;
          if (
            current?.phase !== 'initializing_write_pool' ||
            !Number.isSafeInteger(current.generation) ||
            current.generation <= 0 ||
            current.generation !== request.payload.prepareGeneration ||
            activeIntent?.autoRun !== true ||
            activeIntent.generation !== request.payload.prepareGeneration
          ) {
            throw new Error('SPP KDF signing requires the exact current write-pool preparation');
          }
          return waitForSppKeyDerivationApproval(address, kdfDomain, request.payload.prepareGeneration);
        })()
      : null;
    if (!kdfApprovalToken && !storageUnlockToken && !isSppTestnetBroadcastAuthorized()) {
      const revoked = revokeSppSignApprovals();
      return {
        channel: SPP_HOST_BRIDGE_CHANNEL,
        type: 'SPP_HOST_SIGN_RESULT',
        id: request.id,
        ok: false,
        code: 'UNAUTHORIZED',
        message: `SPP_BROADCAST_AWAITING_APPROVAL: ${kind} signing is disabled (${revoked} approval(s) revoked).`,
      };
    }

    const gate = createContextualSignatureGate('require-prior-approval');
    const adapter = new SppWalletSignerAdapter({
      signer: deps.signer,
      accountIndex: index,
      stellarAddress: address,
      networkPassphrase,
      authorizationGate: gate,
    });

    let signatureBase64: string;
    switch (kind) {
      case 'message': {
        let result: Awaited<ReturnType<SppWalletSignerAdapter['signMessage']>>;
        if (storageUnlockToken) {
          result = await adapter.signStorageUnlockMessage(
            input,
            storageUnlockToken,
            request.payload.prepareGeneration,
            { address, networkPassphrase },
          );
          const [latestStatusRaw, latestIntentRaw, latestNym, latestAccount] = await Promise.all([
            browser.storage.local.get(SPP_PREPARE_STATUS_KEY),
            browser.storage.local.get(SPP_AUTO_PREPARE_INTENT_KEY),
            Promise.resolve(getNymRuntimeController().getSnapshot()),
            resolveActiveStellarAddress(deps.keyManager),
          ]);
          const latestStatus = latestStatusRaw[SPP_PREPARE_STATUS_KEY] as SppPrepareStatus | undefined;
          const latestIntent = latestIntentRaw[SPP_AUTO_PREPARE_INTENT_KEY] as SppAutoPrepareIntent | undefined;
          if (
            latestStatus?.phase !== 'initializing_session' ||
            latestStatus.generation !== request.payload.prepareGeneration ||
            latestIntent?.autoRun !== true ||
            latestIntent.generation !== request.payload.prepareGeneration ||
            latestNym.mode !== 'nym' ||
            !latestNym.connected ||
            latestAccount.address !== address
          ) {
            throw new Error('SPP storage unlock was invalidated before its signature could be returned.');
          }
        } else {
          result = kdfApprovalToken
          ? await adapter.signKeyDerivationMessage(
              input, kdfApprovalToken, request.payload.prepareGeneration,
              { address, networkPassphrase },
              async () => {
                const [stored, storedIntent, nym, active] = await Promise.all([
                  browser.storage.local.get(SPP_PREPARE_STATUS_KEY),
                  browser.storage.local.get(SPP_AUTO_PREPARE_INTENT_KEY),
                  Promise.resolve(getNymRuntimeController().getSnapshot()),
                  resolveActiveStellarAddress(deps.keyManager),
                ]);
                const current = stored[SPP_PREPARE_STATUS_KEY] as SppPrepareStatus | undefined;
                const activeIntent = storedIntent[SPP_AUTO_PREPARE_INTENT_KEY] as SppAutoPrepareIntent | undefined;
                if (
                  current?.phase !== 'initializing_write_pool' ||
                  current.generation !== request.payload.prepareGeneration ||
                  activeIntent?.autoRun !== true ||
                  activeIntent.generation !== request.payload.prepareGeneration ||
                  nym.mode !== 'nym' ||
                  !nym.connected ||
                  active.address !== address
                ) {
                  throw new Error('SPP KDF preparation changed or was cancelled before signing');
                }
              },
            )
          : await adapter.signMessage(input, { address, networkPassphrase });
        }
        signatureBase64 =
          typeof result === 'string' ? result : result.signedMessage;
        break;
      }
      case 'transaction': {
        const result = await adapter.signTransaction(input, { address, networkPassphrase });
        signatureBase64 =
          typeof result === 'string' ? result : result.signedTxXdr;
        break;
      }
      case 'auth_entry': {
        const result = await adapter.signAuthEntry(input, { address, networkPassphrase });
        signatureBase64 =
          typeof result === 'string' ? result : result.signedAuthEntry;
        break;
      }
      default: {
        const unexpected: never = kind;
        return {
          channel: SPP_HOST_BRIDGE_CHANNEL,
          type: 'SPP_HOST_SIGN_RESULT',
          id: request.id,
          ok: false,
          code: 'INVALID_REQUEST',
          message: `Unknown sign kind: ${String(unexpected)}`,
        };
      }
    }

    return {
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_SIGN_RESULT',
      id: request.id,
      ok: true,
      kind,
      signatureBase64,
      signerAddress: address,
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'SPP sign failed';
    const code = cause instanceof SppSignerError
      ? cause.code
      : /lock|unlock|vault/i.test(message)
        ? 'VAULT_LOCKED' as const
        : 'SIGN_FAILED' as const;
    return {
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_SIGN_RESULT',
      id: request.id,
      ok: false,
      code,
      message: message.slice(0, 500),
    };
  }
}

/** Host → SW: route Soroban-origin HTTP through Nym fail-closed fetch. */
export async function handleSppHostNymFetchRequest(
  request: SppHostNymFetchRequest,
  sender?: { id?: string | undefined; url?: string | undefined },
): Promise<SppHostNymFetchResult> {
  if (!isSppHostDocumentSender(sender)) {
    return {
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_NYM_FETCH_RESULT',
      id: request.id,
      ok: false,
      code: 'UNAUTHORIZED',
      message: 'SPP Nym fetch is accepted only from the extension spp-host document.',
    };
  }
  const ctrl = getNymRuntimeController();
  const snap = ctrl.getSnapshot();
  if (snap.mode !== 'nym' || !snap.connected) {
    return {
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_NYM_FETCH_RESULT',
      id: request.id,
      ok: false,
      code: 'NYM_REQUIRED',
      message: 'SPP Nym fetch requires Nym connected (fail-closed).',
    };
  }

  const { rpcUrl, url, method, headers, body } = request.payload;
  try {
    if (!isTrustedSorobanEndpoint(url) || !isTrustedSorobanEndpoint(rpcUrl)) {
      return {
        channel: SPP_HOST_BRIDGE_CHANNEL,
        type: 'SPP_HOST_NYM_FETCH_RESULT',
        id: request.id,
        ok: false,
        code: 'ORIGIN_BLOCKED',
        message: 'SPP RPC proxy only calls the configured Testnet Soroban endpoint.',
      };
    }

    const rpcClass = classifySorobanBody(body);
    if (rpcClass !== 'read') {
      if (rpcClass === 'send' || rpcClass === 'mixed') revokeSppSignApprovals();
      return {
        channel: SPP_HOST_BRIDGE_CHANNEL,
        type: 'SPP_HOST_NYM_FETCH_RESULT',
        id: request.id,
        ok: false,
        code: 'UNAUTHORIZED',
        message: `SPP RPC ${rpcClass} is not a configured read. Not fetched.`,
      };
    }

    const nymFetch = ctrl.getStellarFetch();
    const init: RequestInit = {
      method,
      headers: headers ?? {},
    };
    if (body !== undefined && method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD') {
      init.body = body;
    }
    const response = await nymFetch(STELLAR_SOROBAN_TESTNET_RPC, init);
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key.toLowerCase()] = value;
    });
    const bodyText = await response.text();
    return {
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_NYM_FETCH_RESULT',
      id: request.id,
      ok: true,
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      bodyText,
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Nym fetch failed';
    return {
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_NYM_FETCH_RESULT',
      id: request.id,
      ok: false,
      code: 'RPC_FAILED',
      message: message.slice(0, 500),
    };
  }
}
