/** Open the isolated SPP host. Prefer internal (background) opens for wallet UX. */

export type OpenSppHostOptions = {
  /** When false, open a background tab (extension) or a minimized window when possible. */
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

/** Internal worker open — not a user-facing navigation target. */
export function openSppHostInternal(options?: OpenSppHostOptions): void {
  const active = options?.active === true;
  const url = sppHostUrl();
  if (isExtensionHost()) {
    void chrome.tabs.create({ url, active });
    return;
  }
  // Webapp: open as named window so repeat prepares reuse the same host context.
  window.open(url, 'astrym-spp-host', active ? 'noopener' : 'noopener,width=420,height=640');
}

/** @deprecated Prefer {@link openSppHostInternal}; kept for lab tooling. */
export function openSppHost(): void {
  openSppHostInternal({ active: true });
}
