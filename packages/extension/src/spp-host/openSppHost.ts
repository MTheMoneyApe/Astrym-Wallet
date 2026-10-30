/** Open the isolated SPP host. The extension uses a tab; the webapp opens the page. */

export function openSppHost(): void {
  const extension = typeof chrome !== 'undefined'
    && typeof chrome.runtime?.id === 'string'
    && chrome.runtime.id.length > 0
    && chrome.runtime.id !== 'astrym-android-webapp'
    && typeof chrome.tabs?.create === 'function'
    && typeof chrome.runtime.getURL === 'function';
  const url = extension
    ? chrome.runtime.getURL('spp-host.html')
    : new URL('spp-host.html', location.href).href;
  if (extension) {
    chrome.tabs.create({ url });
    return;
  }
  window.open(url, '_blank', 'noopener');
}
