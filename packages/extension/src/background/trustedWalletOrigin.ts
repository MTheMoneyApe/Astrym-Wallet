import browser from 'webextension-polyfill';

const TRUSTED_WALLET_PAGES = ['/popup.html', '/webapp.html'] as const;

export function trustedWalletPageUrls(): string[] {
  return TRUSTED_WALLET_PAGES.map((page) => browser.runtime.getURL(page));
}

/** Popup and the full-tab / Android webapp page. Not arbitrary extension URLs. */
export function isTrustedWalletPageUrl(url: string | undefined): boolean {
  if (!url) return false;
  return trustedWalletPageUrls().includes(url);
}

/**
 * Internal IPC may come from any extension page (chrome-extension://id/…)
 * or from the standalone webapp, whose origin is this document.
 */
export function isInternalWalletSender(
  sender: { id?: string | undefined; url?: string | undefined } | undefined,
): boolean {
  if (!sender?.id || !sender.url || sender.id !== browser.runtime.id) return false;
  if (sender.url.startsWith(`chrome-extension://${browser.runtime.id}/`)) return true;
  return isTrustedWalletPageUrl(sender.url);
}

/**
 * SPP signatures are accepted only from this extension's own spp-host document.
 * Popup, webapp, content scripts, and other extension pages are refused.
 */
export function isSppHostDocumentSender(
  sender: { id?: string | undefined; url?: string | undefined } | undefined,
): boolean {
  if (!sender?.id || !sender.url || sender.id !== browser.runtime.id) return false;
  return sameDocumentUrl(sender.url, browser.runtime.getURL('spp-host.html'));
}

function sameDocumentUrl(actual: string, expected: string): boolean {
  const base = 'http://astrym.invalid';
  let actualUrl: URL;
  let expectedUrl: URL;
  try {
    actualUrl = new URL(actual, base);
    expectedUrl = new URL(expected, base);
  } catch {
    return false;
  }
  if (actualUrl.pathname !== expectedUrl.pathname) return false;
  const actualAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(actual);
  const expectedAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(expected);
  if (actualAbsolute !== expectedAbsolute) return false;
  if (actualAbsolute && actualUrl.origin !== expectedUrl.origin) return false;
  return true;
}
