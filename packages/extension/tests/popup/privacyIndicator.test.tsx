import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  PrivacyModeIndicator,
  describeWalletPrivacy,
} from '../../src/popup/privacyIndicator.js';

describe('privacy indicator', () => {
  it('describes loading, Nym-disconnected, Nym, and explicit Direct from one snapshot', () => {
    expect(
      describeWalletPrivacy({
        mode: 'nym',
        connected: false,
        preferenceHydrated: false,
        egressBlocked: true,
        privacyPreference: null,
      }),
    ).toMatchObject({ tone: 'loading', egress: 'blocked' });

    expect(
      describeWalletPrivacy({
        mode: 'nym',
        connected: false,
        preferenceHydrated: true,
        egressBlocked: true,
        privacyPreference: 'nym',
      }).label,
    ).toMatch(/Nym — disconnected/);

    expect(
      describeWalletPrivacy({
        mode: 'nym',
        connected: true,
        preferenceHydrated: true,
        egressBlocked: false,
        privacyPreference: 'nym',
      }),
    ).toMatchObject({ tone: 'nym', egress: 'open' });

    expect(
      describeWalletPrivacy({
        mode: 'direct',
        connected: false,
        preferenceHydrated: true,
        egressBlocked: false,
        privacyPreference: 'direct',
      }).label,
    ).toBe('Privacy: Direct');

    const unset = describeWalletPrivacy({
      mode: 'nym',
      connected: false,
      preferenceHydrated: true,
      egressBlocked: true,
      privacyPreference: null,
      diagnosticCode: 'PRIVACY_CHOICE_REQUIRED',
    });
    expect(unset.tone).toBe('blocked');
    expect(unset.egress).toBe('blocked');
    expect(unset.label).toBe('Privacy: no saved choice — wallet network blocked');
    expect(unset.label).not.toMatch(/Direct/);

    const implicitDirect = describeWalletPrivacy({
      mode: 'direct',
      preferenceHydrated: true,
      egressBlocked: false,
      privacyPreference: null,
    });
    expect(implicitDirect.tone).toBe('blocked');
    expect(implicitDirect.label).not.toMatch(/^Privacy: Direct$/);

    const blocked = describeWalletPrivacy({
      mode: 'nym',
      connected: false,
      preferenceHydrated: true,
      diagnosticCode: 'PRIVACY_PREFERENCE_CORRUPT',
    });
    expect(blocked.tone).toBe('blocked');
    expect(blocked.label).not.toMatch(/Direct/);
  });

  it('renders the runtime snapshot and does not paint Direct while loading', () => {
    const loading = renderToStaticMarkup(
      React.createElement(PrivacyModeIndicator, {
        snapshot: {
          mode: 'nym',
          connected: false,
          preferenceHydrated: false,
          egressBlocked: true,
          privacyPreference: null,
        },
      }),
    );
    expect(loading).toContain('data-testid="privacy-mode-indicator"');
    expect(loading).toContain('data-privacy-tone="loading"');
    expect(loading).toContain('data-privacy-egress="blocked"');
    expect(loading).not.toContain('Privacy: Direct');

    const chosen = renderToStaticMarkup(
      React.createElement(PrivacyModeIndicator, {
        snapshot: {
          mode: 'direct',
          connected: false,
          preferenceHydrated: true,
          egressBlocked: false,
          privacyPreference: 'direct',
        },
      }),
    );
    expect(chosen).toContain('data-privacy-tone="direct"');
    expect(chosen).toContain('data-privacy-preference="direct"');
    expect(chosen).toContain('Privacy: Direct');
  });
});
