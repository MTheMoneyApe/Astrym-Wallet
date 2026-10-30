import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  extensionCanOpenTab,
  isWebappDocument,
  webappPageUrl,
} from '../../src/webapp/openAndroidWebapp.js';

describe('open Android webapp', () => {
  afterEach(() => {
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it('uses chrome.runtime.getURL only for a real extension id', () => {
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        id: 'extension-id',
        getURL: (path: string) => `chrome-extension://extension-id/${path}`,
      },
      tabs: { create: vi.fn() },
    };
    expect(extensionCanOpenTab()).toBe(true);
    expect(webappPageUrl()).toBe('chrome-extension://extension-id/webapp.html');
  });

  it('does not treat the Android shim id as an extension tab host', () => {
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        id: 'astrym-android-webapp',
        getURL: (path: string) => `http://127.0.0.1/${path}`,
      },
      tabs: { create: vi.fn() },
    };
    expect(extensionCanOpenTab()).toBe(false);
  });

  it('is not the webapp document when location is absent', () => {
    expect(isWebappDocument()).toBe(false);
  });
});
