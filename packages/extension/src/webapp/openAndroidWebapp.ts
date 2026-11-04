/** Open the full-page wallet. Extension popup uses chrome.tabs; browsers navigate. */

export function isWebappDocument(): boolean {
  if (typeof location === 'undefined') return false;
  return location.pathname.endsWith('/webapp.html') || location.pathname.endsWith('webapp.html');
}

export function extensionCanOpenTab(): boolean {
  return typeof chrome !== 'undefined'
    && typeof chrome.runtime?.id === 'string'
    && chrome.runtime.id.length > 0
    && chrome.runtime.id !== 'astrym-android-webapp'
    && typeof chrome.tabs?.create === 'function'
    && typeof chrome.runtime.getURL === 'function';
}

export function webappPageUrl(): string {
  if (extensionCanOpenTab()) return chrome.runtime.getURL('webapp.html');
  if (typeof location === 'undefined') return 'webapp.html';
  return new URL('webapp.html', location.href).href;
}

/** From the popup, open the extension page in a tab (shared service worker). */
export function openAndroidWebapp(): void {
  if (isWebappDocument()) return;
  const url = webappPageUrl();
  if (extensionCanOpenTab()) {
    chrome.tabs.create({ url });
    window.close();
    return;
  }
  window.open(url, '_blank', 'noopener');
}
