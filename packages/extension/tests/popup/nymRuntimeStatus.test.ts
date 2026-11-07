import { describe, expect, it, vi } from 'vitest';

import {
  bindNymRuntimeStatus,
  NYM_RUNTIME_STATUS_CHANNEL,
} from '../../src/shared/nymRuntimeStatus.js';
import { describeWalletPrivacy } from '../../src/popup/privacyIndicator.js';

describe('Nym runtime status push', () => {
  it('updates an open view when MixFetch drops without storage or a view change', () => {
    const listeners = new Set<(message: unknown) => void>();
    const onMessage = {
      addListener(listener: (message: unknown) => void) {
        listeners.add(listener);
      },
      removeListener(listener: (message: unknown) => void) {
        listeners.delete(listener);
      },
    };
    const seen: Array<{ connected: boolean; egressBlocked: boolean }> = [];
    const unbind = bindNymRuntimeStatus(onMessage, (snapshot) => {
      seen.push({ connected: snapshot.connected, egressBlocked: snapshot.egressBlocked });
    });

    for (const listener of listeners) {
      listener({
        channel: NYM_RUNTIME_STATUS_CHANNEL,
        snapshot: {
          state: 'disconnected',
          lastError: null,
          connected: false,
          implementation: 'mix-fetch-offscreen',
          mode: 'nym',
          preferenceHydrated: true,
          egressBlocked: true,
          privacyPreference: 'nym',
          preferenceDurable: true,
          documentReady: false,
        },
      });
    }

    expect(seen).toEqual([{ connected: false, egressBlocked: true }]);
    expect(
      describeWalletPrivacy({
        mode: 'nym',
        connected: false,
        preferenceHydrated: true,
        egressBlocked: true,
        privacyPreference: 'nym',
        preferenceDurable: true,
      }).label,
    ).toMatch(/disconnected, network blocked/);
    unbind();
    expect(listeners.size).toBe(0);
  });

  it('ignores unrelated messages', () => {
    const onStatus = vi.fn();
    const listeners = new Set<(message: unknown) => void>();
    bindNymRuntimeStatus(
      {
        addListener: (listener) => listeners.add(listener),
        removeListener: (listener) => listeners.delete(listener),
      },
      onStatus,
    );
    for (const listener of listeners) listener({ type: 'NYM_STATUS' });
    expect(onStatus).not.toHaveBeenCalled();
  });
});
