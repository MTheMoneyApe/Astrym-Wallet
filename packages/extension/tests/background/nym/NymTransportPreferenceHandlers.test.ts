import { beforeEach, describe, expect, it, vi } from 'vitest';
import type browser from 'webextension-polyfill';

const mocks = vi.hoisted(() => ({
  controller: {
    refreshStatus: vi.fn(),
    setPreferredMode: vi.fn(),
  },
  getNymRuntimeController: vi.fn(),
}));

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: {
      id: 'trusted-extension-id',
      getURL: (path: string) => `chrome-extension://trusted-extension-id${path}`,
    },
  },
}));

vi.mock('../../../src/background/nym/NymRuntimeController.js', () => ({
  getNymRuntimeController: mocks.getNymRuntimeController,
}));

import {
  createNymSetModeHandler,
  createNymStatusHandler,
} from '../../../src/background/handlers/nymHandlers.js';

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    state: 'disconnected',
    lastError: null,
    connected: false,
    implementation: 'mix-fetch-offscreen',
    selfAddress: null,
    mode: 'nym',
    preferredMode: null,
    preferenceLoaded: false,
    preferenceError: null,
    documentReady: false,
    diagnosticCode: 'OK',
    diagnosticStage: null,
    assetsReady: false,
    gatewayAllowlistConfigured: false,
    selectedGateway: null,
    gatewayIdentityKey: null,
    gatewayHostPermissionGranted: null,
    gatewayHostPermissionPattern: null,
    ...overrides,
  };
}

const popupSender = {
  id: 'trusted-extension-id',
  url: 'chrome-extension://trusted-extension-id/popup.html',
} as browser.Runtime.MessageSender;

describe('Nym transport preference handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getNymRuntimeController.mockReturnValue(mocks.controller);
    mocks.controller.refreshStatus.mockResolvedValue(snapshot());
  });

  it.each([
    ['missing preference', snapshot()],
    [
      'corrupt preference',
      snapshot({ preferenceError: 'INVALID_STORED_VALUE' }),
    ],
    [
      'unreadable preference',
      snapshot({ preferenceError: 'STORAGE_READ_FAILED' }),
    ],
  ])('keeps NYM_STATUS available with a %s', async (_label, status) => {
    mocks.controller.refreshStatus.mockResolvedValue(status);

    await expect(createNymStatusHandler()({} as any)).resolves.toMatchObject({
      preferredMode: status.preferredMode,
      preferenceLoaded: status.preferenceLoaded,
      preferenceError: status.preferenceError,
    });
  });

  it.each(['nym', 'direct'] as const)(
    'accepts an authorized explicit %s selection',
    async (mode) => {
      mocks.controller.setPreferredMode.mockResolvedValue(
        snapshot({
          mode,
          preferredMode: mode,
          preferenceLoaded: true,
        }),
      );

      await expect(
        createNymSetModeHandler()({ mode }, popupSender),
      ).resolves.toMatchObject({
        mode,
        preferredMode: mode,
        preferenceLoaded: true,
        preferenceError: null,
      });
      expect(mocks.controller.setPreferredMode).toHaveBeenCalledWith(mode);
    },
  );

  it.each([
    ['wrong extension ID', { ...popupSender, id: 'other-extension-id' }],
    ['another extension page', { ...popupSender, url: 'chrome-extension://trusted-extension-id/options.html' }],
    ['query string', { ...popupSender, url: 'chrome-extension://trusted-extension-id/popup.html?mode=direct' }],
    ['fragment', { ...popupSender, url: 'chrome-extension://trusted-extension-id/popup.html#mode' }],
    ['URL suffix', { ...popupSender, url: 'chrome-extension://trusted-extension-id/popup.html/other' }],
    ['web origin', { ...popupSender, url: 'https://example.com/popup.html' }],
  ])('rejects NYM_SET_MODE from a sender with %s', async (_label, sender) => {
    await expect(
      createNymSetModeHandler()({ mode: 'direct' }, sender as browser.Runtime.MessageSender),
    ).rejects.toThrow(/trusted popup/i);
    expect(mocks.controller.setPreferredMode).not.toHaveBeenCalled();
  });

  it('rejects invalid modes without invoking persistence', async () => {
    await expect(
      createNymSetModeHandler()({ mode: 'invalid' } as any, popupSender),
    ).rejects.toThrow('Invalid transport mode');
    expect(mocks.controller.setPreferredMode).not.toHaveBeenCalled();
  });

  it('returns the previous authoritative preference and sanitized error after a failed write', async () => {
    mocks.controller.setPreferredMode.mockResolvedValue(
      snapshot({
        mode: 'nym',
        preferredMode: 'nym',
        preferenceLoaded: true,
        preferenceError: 'STORAGE_WRITE_FAILED',
      }),
    );

    await expect(
      createNymSetModeHandler()({ mode: 'direct' }, popupSender),
    ).resolves.toMatchObject({
      mode: 'nym',
      preferredMode: 'nym',
      preferenceLoaded: true,
      preferenceError: 'STORAGE_WRITE_FAILED',
    });
  });
});
