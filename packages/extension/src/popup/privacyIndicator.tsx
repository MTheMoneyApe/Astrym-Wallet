/**
 * Wording for the wallet privacy indicator.
 * Popup and webapp both render {@link PrivacyModeIndicator} from the runtime
 * snapshot (NYM_STATUS). Probe transports must not be copied into that snapshot.
 */

import React from 'react';

export type PrivacyIndicatorTone = 'loading' | 'blocked' | 'nym' | 'direct';

export type PrivacyIndicatorSnapshot = {
  mode?: 'direct' | 'nym';
  connected?: boolean;
  preferenceHydrated?: boolean;
  egressBlocked?: boolean;
  privacyPreference?: 'direct' | 'nym' | null;
  preferenceDurable?: boolean;
  diagnosticCode?: string;
};

export type PrivacyIndicatorView = {
  tone: PrivacyIndicatorTone;
  label: string;
  egress: 'blocked' | 'open';
};

function preferenceDiagnostic(code: string | undefined): boolean {
  return (
    code === 'PRIVACY_PREFERENCE_CORRUPT' ||
    code === 'PRIVACY_PREFERENCE_UNREADABLE' ||
    code === 'PRIVACY_PREFERENCE_PERSIST_FAILED'
  );
}

export function describeWalletPrivacy(snapshot: PrivacyIndicatorSnapshot): PrivacyIndicatorView {
  if (snapshot.preferenceHydrated === false) {
    return {
      tone: 'loading',
      label: 'Privacy: loading — wallet network blocked',
      egress: 'blocked',
    };
  }
  if (
    snapshot.diagnosticCode === 'PRIVACY_PREFERENCE_PERSIST_FAILED' ||
    (snapshot.preferenceDurable === false &&
      (snapshot.privacyPreference === 'nym' || snapshot.privacyPreference === 'direct'))
  ) {
    if (
      snapshot.privacyPreference === 'nym' &&
      snapshot.connected === true &&
      snapshot.egressBlocked !== true
    ) {
      return {
        tone: 'nym',
        label: 'Privacy: Nym — not saved; reload may restore previous Direct',
        egress: 'open',
      };
    }
    return {
      tone: 'blocked',
      label: 'Privacy: not saved — reload may restore previous Direct',
      egress: 'blocked',
    };
  }
  if (preferenceDiagnostic(snapshot.diagnosticCode) && snapshot.connected !== true) {
    return {
      tone: 'blocked',
      label: 'Privacy: blocked — saved choice unreadable',
      egress: 'blocked',
    };
  }
  if (snapshot.preferenceHydrated === true && snapshot.privacyPreference === null) {
    return {
      tone: 'blocked',
      label: 'Privacy: no saved choice — wallet network blocked',
      egress: 'blocked',
    };
  }
  if (
    snapshot.mode === 'nym' &&
    snapshot.connected === true &&
    snapshot.egressBlocked !== true &&
    snapshot.privacyPreference !== null
  ) {
    return {
      tone: 'nym',
      label: 'Privacy: Nym',
      egress: 'open',
    };
  }
  if (snapshot.mode === 'nym' || snapshot.privacyPreference === 'nym') {
    return {
      tone: 'blocked',
      label: 'Privacy: Nym — disconnected, network blocked',
      egress: 'blocked',
    };
  }
  if (
    snapshot.mode === 'direct' &&
    snapshot.privacyPreference === 'direct' &&
    snapshot.egressBlocked !== true
  ) {
    return {
      tone: 'direct',
      label: 'Privacy: Direct',
      egress: 'open',
    };
  }
  return {
    tone: 'blocked',
    label: 'Privacy: blocked — wallet network blocked',
    egress: 'blocked',
  };
}

export function PrivacyModeIndicator({
  snapshot,
}: {
  snapshot: PrivacyIndicatorSnapshot;
}): React.ReactElement {
  const view = describeWalletPrivacy(snapshot);
  const hydrated =
    snapshot.preferenceHydrated === true
      ? 'true'
      : snapshot.preferenceHydrated === false
        ? 'false'
        : 'unknown';
  return (
    <div
      data-testid="privacy-mode-indicator"
      data-privacy-tone={view.tone}
      data-privacy-egress={view.egress}
      data-privacy-mode={snapshot.mode ?? 'unknown'}
      data-privacy-hydrated={hydrated}
      data-privacy-preference={snapshot.privacyPreference ?? 'none'}
      style={{ fontSize: '0.75rem', lineHeight: 1.3 }}
    >
      {view.label}
    </div>
  );
}
