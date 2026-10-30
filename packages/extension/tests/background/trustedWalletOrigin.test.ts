import { describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => {
  return {
    default: {
      runtime: {
        id: 'astrym-android-webapp',
        getURL: (path: string) => `http://127.0.0.1:5173${path}`,
      },
    },
  };
});

import {
  isInternalWalletSender,
  isTrustedWalletPageUrl,
} from '../../src/background/trustedWalletOrigin.js';

describe('trusted wallet origin on the standalone webapp', () => {
  it('trusts popup.html and webapp.html on this origin only', () => {
    expect(isTrustedWalletPageUrl('http://127.0.0.1:5173/webapp.html')).toBe(true);
    expect(isTrustedWalletPageUrl('http://127.0.0.1:5173/popup.html')).toBe(true);
    expect(isTrustedWalletPageUrl('http://127.0.0.1:5173/evil.html')).toBe(false);
    expect(isTrustedWalletPageUrl('http://evil.example/webapp.html')).toBe(false);
    expect(
      isInternalWalletSender({
        id: 'astrym-android-webapp',
        url: 'http://127.0.0.1:5173/webapp.html',
      }),
    ).toBe(true);
    expect(
      isInternalWalletSender({
        id: 'someone-else',
        url: 'http://127.0.0.1:5173/webapp.html',
      }),
    ).toBe(false);
  });
});
