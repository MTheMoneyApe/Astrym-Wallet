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

/**
 * Coalesce concurrent opens inside the MV3 worker. The tabs lookup and create
 * must be one serialized operation: otherwise two callers can both observe
 * "no host" and create duplicate spp-host tabs.
 */
let extensionSppHostOpenInFlight: Promise<void> | null = null;

/** Test helper: clear the in-flight lease after each isolated test. */
export function resetSppHostOpenLockForTests(): void {
  extensionSppHostOpenInFlight = null;
}

/**
 * Reuse an existing spp-host tab when possible (keeps OPFS / write-pool alive).
 *
 * Use runtime.getContexts instead of tabs.query({ url }): filtering tabs by URL
 * requires the broad "tabs" permission or matching host permission. Astrym does
 * not request either, so Chrome may ignore that filter and return unrelated tabs.
 */
function openOrFocusExtensionSppHost(active: boolean): Promise<void> {
  if (extensionSppHostOpenInFlight) return extensionSppHostOpenInFlight;

  const opening = (async () => {
    const url = sppHostUrl();
    const runtime = chrome.runtime as unknown as {
      getContexts?: (filter: {
        contextTypes: string[];
        documentUrls: string[];
      }) => Promise<Array<{ tabId?: number }>>;
    };

    let existingTabId: number | undefined;
    if (typeof runtime.getContexts === 'function') {
      const contexts = await runtime.getContexts({
        contextTypes: ['TAB'],
        documentUrls: [url],
      });
      existingTabId = contexts.find(
        (context) => Number.isInteger(context.tabId),
      )?.tabId;
    } else if (typeof chrome.tabs.query === 'function') {
      // Older Chrome fallback: only reuse when the URL is actually readable.
      // Never trust a URL query filter by itself; it can be ignored without tabs
      // or matching host permission. Fail closed rather than opening duplicates.
      const existing = await chrome.tabs.query({});
      existingTabId = existing.find(
        (tab) => tab.url === url && typeof tab.id === 'number',
      )?.id;
      if (existingTabId == null) {
        throw new Error(
          'Safe SPP host reuse requires Chrome 116+ runtime.getContexts or readable tab URLs',
        );
      }
    }

    if (existingTabId != null) {
      if (active) {
        const existing = await chrome.tabs.get(existingTabId);
        await chrome.tabs.update(existingTabId, { active: true });
        if (typeof existing.windowId === 'number') {
          await chrome.windows.update(existing.windowId, { focused: true });
        }
      }
      // Soft reuse: the host listens for storage auto-prepare; never reload it.
      return;
    }

    await chrome.tabs.create({ url, active });
  })();

  extensionSppHostOpenInFlight = opening;
  void opening.then(
    () => {
      if (extensionSppHostOpenInFlight === opening) {
        extensionSppHostOpenInFlight = null;
      }
    },
    () => {
      if (extensionSppHostOpenInFlight === opening) {
        extensionSppHostOpenInFlight = null;
      }
    },
  );
  return opening;
}

/** Internal worker open — not a user-facing navigation target. */
export function openSppHostInternal(options?: OpenSppHostOptions): Promise<void> {
  const active = options?.active === true;
  if (isExtensionHost()) {
    return openOrFocusExtensionSppHost(active);
  }

  // Webapp / PWA: never rely on window.open after async Nym connect (popup blockers).
  // Run the host in-page so IPC shares the standalone wallet process.
  // Static import — dynamic import chunks were easy to miss under Vite webapp splitting.
  if (isAndroidWebappRuntime() || typeof window !== 'undefined') {
    return ensureWebappSppHostAndPrepare().catch((cause: unknown) => {
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
  }

  // Last-resort (non-DOM contexts): named window.
  window.open(
    sppHostUrl(),
    'astrym-spp-host',
    active ? 'noopener' : 'noopener,width=420,height=640',
  );
  return Promise.resolve();
}

/** @deprecated Prefer {@link openSppHostInternal}; kept for lab tooling. */
export function openSppHost(): void {
  void openSppHostInternal({ active: true }).catch(() => {
    // Lab callers do not own the auto-prepare status lifecycle.
  });
}
