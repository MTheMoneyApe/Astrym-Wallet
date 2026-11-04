/**
 * Same-document SPP host for the Android/desktop webapp.
 *
 * Avoids window.open (popup blockers after async Nym connect). Reuses one
 * SppHostController + bridge listener in the wallet page so chrome.runtime
 * IPC shares the standalone wallet host from bootStandaloneWallet.
 */

import {
  SPP_SESSION_STATUS_STORAGE_KEY,
  toStoredSppSessionClear,
  toStoredSppSessionStatus,
  type SppSessionStatusHandle,
} from '@solanym/wallet-core/src/stellar/spp/SppIntegrationStatus.js';
import { SppHostController } from './hostController.js';
import { installSppHostBridgeListener } from './sppHostBridgeListener.js';
import { runSppHostAutoPrepareIfRequested } from './sppHostAutoPrepare.js';

let controller: SppHostController | null = null;
let bridgeInstalled = false;
let prepareInFlight: Promise<void> | null = null;

/**
 * Resolve packaged SPP assets for the in-page webapp embed.
 * Prefer a real extension id when present; otherwise same-origin `/spp/…`
 * (Vite/Vercel copy of dist/spp next to the wallet HTML).
 */
function getURL(path: string): string {
  const normalized = path.replace(/^\//, '');
  const hasRealExtensionRuntime =
    typeof chrome !== 'undefined' &&
    typeof chrome.runtime?.id === 'string' &&
    chrome.runtime.id.length > 0 &&
    chrome.runtime.id !== 'astrym-android-webapp' &&
    typeof chrome.runtime.getURL === 'function';
  if (hasRealExtensionRuntime) {
    return chrome.runtime.getURL(normalized);
  }
  return `/${normalized}`;
}

function publishBoundSession(
  session: SppSessionStatusHandle | null,
  meta: { generation: number },
): void {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  if (session == null) {
    void chrome.storage.local.set({
      [SPP_SESSION_STATUS_STORAGE_KEY]: toStoredSppSessionClear(meta),
    });
    return;
  }
  const stored = toStoredSppSessionStatus(session, meta);
  if (stored) {
    void chrome.storage.local.set({ [SPP_SESSION_STATUS_STORAGE_KEY]: stored });
  }
}

function ensureController(): SppHostController {
  if (!bridgeInstalled) {
    installSppHostBridgeListener();
    bridgeInstalled = true;
  }
  if (!controller) {
    controller = new SppHostController({
      getURL,
      onBoundSessionChange: publishBoundSession,
    });
  }
  return controller;
}

/**
 * Ensure the in-page host exists and consume any auto-prepare intent.
 * Concurrent callers share one in-flight promise (duplicate-init prevention).
 */
export function ensureWebappSppHostAndPrepare(): Promise<void> {
  if (prepareInFlight) return prepareInFlight;
  prepareInFlight = (async () => {
    const host = ensureController();
    await runSppHostAutoPrepareIfRequested(host);
  })().finally(() => {
    prepareInFlight = null;
  });
  return prepareInFlight;
}

/** Test/diagnostics: whether an embed controller exists. */
export function hasWebappSppHostEmbed(): boolean {
  return controller !== null;
}

/** Test helper — reset embed singleton. */
export function resetWebappSppHostEmbedForTests(): void {
  controller = null;
  bridgeInstalled = false;
  prepareInFlight = null;
}
