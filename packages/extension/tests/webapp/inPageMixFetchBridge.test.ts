import { describe, expect, it } from 'vitest';

import { InPageMixFetchBridge } from '../../src/webapp/inPageMixFetchBridge.js';

describe('InPageMixFetchBridge', () => {
  it('starts disconnected in the page and does not require chrome.offscreen', async () => {
    const bridge = new InPageMixFetchBridge();
    const status = await bridge.queryStatus();
    expect(status).not.toBeNull();
    expect(status?.connected).toBe(false);
    expect(status?.state).toBe('disconnected');
  });
});
