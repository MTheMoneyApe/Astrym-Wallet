/** Open the isolated SPP host. Prefer internal (background) opens for wallet UX. */

import {
  SPP_PREPARE_STATUS_KEY,
  type SppPrepareStatus,
} from '../shared/sppPrepareStatus.js';
import { ensureWebappSppHostAndPrepare } from './sppHostWebappEmbed.js';

export type OpenSppHostOptions = {
  /** When false, open a background tab (extension) or embed host when on webapp. */
  active?: boolean;
};

function sppHostUrl(): string {
  const extension =
    typeof chrome !== 'undefined' &&
    typeof chrome.runtime?.id === 'string' &&
    chrome.runtime.id.length > 0 &&
    chrome.runtime.id !== 'astrym-android-webapp' &&
    typeof chrome.tabs?.create === 'function' &&
    typeof chrome.runtime.getURL === 'function';
  return extension
    ? chrome.runtime.getURL('spp-host.html')
    : new URL('spp-host.html', location.href).href;
}

function isExtensionHost(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    typeof chrome.runtime?.id === 'string' &&
    chrome.runtime.id.length > 0 &&
    chrome.runtime.id !== 'astrym-android-webapp' &&
    typeof chrome.tabs?.create === 'function' &&
    typeof chrome.runtime.getURL === 'function'
  );
}

function isAndroidWebappRuntime(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    chrome.runtime?.id === 'astrym-android-webapp'
  );
}

/** Reuse an existing spp-host tab when possible (keeps OPFS / write-pool alive). */
async function openOrFocusExtensionSppHost(active: boolean): Promise<void> {
  const url = sppHostUrl();
  try {
    const existing = await chrome.tabs.query({ url: ['*://*/spp-host.html', url] });
    const live = existing.find((tab) => typeof tab.id === 'number');
    if (live?.id != null) {
      if (active) {
        await chrome.tabs.update(live.id, { active: true });
        if (typeof live.windowId === 'number') {
          await chrome.windows.update(live.windowId, { focused: true });
        }
      }
      // Soft reload intent: host listens for storage auto-prepare; avoid full reload
      // which would drop in-memory write pool unless prepare re-runs.
      return;
    }
  } catch {
    // Fall through to create.
  }
  await chrome.tabs.create({ url, active });
}

/** Internal worker open — not a user-facing navigation target. */
export function openSppHostInternal(options?: OpenSppHostOptions): void {
  const active = options?.active === true;
  if (isExtensionHost()) {
    void openOrFocusExtensionSppHost(active);
    return;
  }

  // Webapp / PWA: never rely on window.open after async Nym connect (popup blockers).
  // Run the host in-page so IPC shares the standalone wallet process.
  // Static import — dynamic import chunks were easy to miss under Vite webapp splitting.
  if (isAndroidWebappRuntime() || typeof window !== 'undefined') {
    void ensureWebappSppHostAndPrepare().catch((cause: unknown) => {
      const message =
        cause instanceof Error ? cause.message : 'Webapp SPP host embed failed';
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const failed: SppPrepareStatus = {
          phase: 'failed',
          message: message.slice(0, 400),
          poolContract: null,
          updatedAt: Date.now(),
          generation: Date.now(),
        };
        void chrome.storage.local.set({ [SPP_PREPARE_STATUS_KEY]: failed });
      }
    });
    return;
  }

  // Last-resort (non-DOM contexts): named window.
  window.open(
    sppHostUrl(),
    'astrym-spp-host',
    active ? 'noopener' : 'noopener,width=420,height=640',
  );
}

/** @deprecated Prefer {@link openSppHostInternal}; kept for lab tooling. */
export function openSppHost(): void {
  openSppHostInternal({ active: true });
}
