/**
 * Full-page wallet entry.
 * - Inside the extension tab: chrome.runtime exists, IPC talks to the MV3 worker
 *   (same vault as the popup).
 * - In a phone browser or installed Android PWA: install the chrome shim and
 *   boot the wallet in-process, including MixFetch in this window.
 */

function hasExtensionRuntime(): boolean {
  return typeof chrome !== 'undefined'
    && typeof chrome.runtime?.id === 'string'
    && chrome.runtime.id.length > 0
    && chrome.runtime.id !== 'astrym-android-webapp';
}

async function registerWebappServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('webapp-sw.js');
  } catch {
    /* A phone can still use the page over http://LAN. Install needs HTTPS or localhost. */
  }
}

async function start(): Promise<void> {
  document.documentElement.classList.add('astrym-webapp');
  if (!hasExtensionRuntime()) {
    const { installAndroidChromeShim } = await import('./installChromeShim.js');
    installAndroidChromeShim();
    const { bootStandaloneWallet } = await import('./bootStandalone.js');
    await bootStandaloneWallet();
    await registerWebappServiceWorker();
  }
  await import('../popup/index.js');
}

void start();
