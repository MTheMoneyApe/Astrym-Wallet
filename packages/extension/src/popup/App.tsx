import React, { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { sendIpcMessage } from './ipc.js';
import { Onboarding } from './Onboarding.js';
import { Unlock } from './Unlock.js';
import { Dashboard } from './Dashboard.js';
import { OpenAndroidWebappBar } from './OpenAndroidWebappBar.js';
// Founder Decision A: ApproveConnect and ApproveSign removed from active startup flow.
// Legacy component sources preserved in ./ApproveConnect.tsx and ./ApproveSign.tsx.

type PopupErrorBoundaryProps = {
  children: ReactNode;
  onReset?: () => void;
};

type PopupErrorBoundaryState = {
  hasError: boolean;
  errorMessage: string;
};

export class PopupErrorBoundary extends Component<
  PopupErrorBoundaryProps,
  PopupErrorBoundaryState
> {
  override state: PopupErrorBoundaryState = {
    hasError: false,
    errorMessage: '',
  };

  static getDerivedStateFromError(error: unknown): PopupErrorBoundaryState {
    const message =
      error instanceof Error && error.message
        ? error.message
        : 'Error inesperado al mostrar esta pantalla.';
    return { hasError: true, errorMessage: message };
  }

  override componentDidCatch(_error: unknown, _info: ErrorInfo): void {
    // Error is rendered cleanly in the fallback UI so the popup never turns blank.
  }

  private readonly handleReset = () => {
    this.setState({ hasError: false, errorMessage: '' });
    this.props.onReset?.();
  };

  override render() {
    if (this.state.hasError) {
      return (
        <div className="view-container" role="alert" data-testid="popup-error-boundary">
          <div className="card" style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            <h2 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--error-color)' }}>
              Ocurrió un error inesperado
            </h2>
            <p
              className="text-secondary"
              style={{ margin: 0, fontSize: '0.82rem', lineHeight: 1.45, overflowWrap: 'anywhere' }}
              data-testid="popup-error-message"
            >
              {this.state.errorMessage}
            </p>
            <button
              type="button"
              className="btn-primary"
              data-testid="popup-error-reset"
              onClick={this.handleReset}
            >
              Volver al inicio
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export type ThemePalette = {
  '--bg-color': string;
  '--surface-color': string;
  '--accent-color': string;
  '--text-main': string;
  '--text-sec': string;
};

export const isThemePalette = (value: unknown): value is ThemePalette => {
  if (typeof value !== 'object' || value === null) return false;
  const palette = value as Partial<Record<keyof ThemePalette, unknown>>;
  return ['--bg-color', '--surface-color', '--accent-color', '--text-main', '--text-sec']
    .every((key) => typeof palette[key as keyof ThemePalette] === 'string');
};

export type AppState = 'LOADING' | 'ONBOARDING' | 'LOCKED' | 'DASHBOARD';

export const THEME_PRESETS: Record<string, ThemePalette> = {
  midnight: {
    '--bg-color': '#11151B',
    '--surface-color': '#1B222B',
    '--accent-color': '#8FE8D0',
    '--text-main': '#F4F7F8',
    '--text-sec': '#A4ADBA',
  },
  lightmint: {
    '--bg-color': '#F7FAF8',
    '--surface-color': '#FFFFFF',
    '--accent-color': '#168B68',
    '--text-main': '#17211D',
    '--text-sec': '#64736B',
  },
  forest: {
    '--bg-color': '#10251D',
    '--surface-color': '#18362A',
    '--accent-color': '#8FE8A8',
    '--text-main': '#F1FFF5',
    '--text-sec': '#A9C8B4',
  },
  astrym: {
    '--bg-color': '#191A1C',
    '--surface-color': '#141416',
    '--accent-color': '#3CE894',
    '--text-main': '#FFFFFF',
    '--text-sec': '#D0D5DD',
  },
};

export function App() {
  const [appState, setAppState] = useState<AppState>('LOADING');
  const [error, setError] = useState<string | null>(null);
  const [boundaryKey, setBoundaryKey] = useState(0);

  useEffect(() => {
    // Load theme
    chrome.storage.local.get(['themePreset', 'customColors'], (res) => {
      const storage = res as Record<string, unknown>;
      const webapp = document.documentElement.classList.contains('astrym-webapp');
      const presetId = typeof storage['themePreset'] === 'string'
        ? String(storage['themePreset'])
        : 'astrym';
      const fallbackColors = THEME_PRESETS['astrym'] as ThemePalette;
      let colors: ThemePalette = fallbackColors;
      const presetColors = THEME_PRESETS[presetId] as ThemePalette | undefined;
      if (presetColors) {
        colors = presetColors as ThemePalette;
      }
      if (presetId === 'custom' && isThemePalette(storage['customColors'])) {
        colors = storage['customColors'] as ThemePalette;
      }
      applyColors(colors);
    });

    checkWalletState();
  }, []);

  useEffect(() => {
    if (appState !== 'DASHBOARD') return;

    let lastActivitySentAt = 0;
    const recordActivity = () => {
      const now = Date.now();
      if (now - lastActivitySentAt < 15_000) return;
      lastActivitySentAt = now;
      void sendIpcMessage('RECORD_USER_ACTIVITY', {}).catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Could not record wallet activity.');
      });
    };

    recordActivity();
    document.addEventListener('pointerdown', recordActivity, true);
    document.addEventListener('keydown', recordActivity, true);
    document.addEventListener('input', recordActivity, true);
    return () => {
      document.removeEventListener('pointerdown', recordActivity, true);
      document.removeEventListener('keydown', recordActivity, true);
      document.removeEventListener('input', recordActivity, true);
    };
  }, [appState]);

  const applyColors = (colors: ThemePalette) => {
    const root = document.documentElement;
    if (colors['--bg-color']) root.style.setProperty('--bg-color', colors['--bg-color']);
    if (colors['--surface-color']) root.style.setProperty('--surface-color', colors['--surface-color']);
    if (colors['--accent-color']) root.style.setProperty('--accent-color', colors['--accent-color']);
    if (colors['--text-main']) root.style.setProperty('--text-main', colors['--text-main']);
    if (colors['--text-sec']) root.style.setProperty('--text-sec', colors['--text-sec']);
    
    // Auto-derive border colors based on bg
    // For simplicity, we just keep the default border colors or they can be overridden
    if (colors['--bg-color'] === '#F7FAF8') {
       root.style.setProperty('--border-color', '#E5E7EB');
       root.style.setProperty('--border-dark', '#D1D5DB');
    } else {
       root.style.setProperty('--border-color', '#2A323C');
       root.style.setProperty('--border-dark', '#333333');
    }

  };

  const checkWalletState = async () => {
    try {
      const state = await sendIpcMessage('GET_WALLET_STATE', {});
      if (!state.hasVault) {
        setAppState('ONBOARDING');
      } else if (state.isLocked) {
        setAppState('LOCKED');
      } else {
        setAppState('DASHBOARD');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to initialize wallet');
    }
  };

  const screen = error ? (
    <div style={{ padding: 20, color: 'red' }}>
      <h2>Error</h2>
      <p>{error}</p>
      <button onClick={() => { setError(null); checkWalletState(); }}>Retry</button>
    </div>
  ) : (
    renderWalletScreen(appState, checkWalletState)
  );

  // Desktop extension popup must not show Android/PWA chrome.
  // Webapp (html.astrym-webapp) keeps the compact brand bar only.
  const showWebappBrandBar =
    typeof document !== 'undefined' &&
    document.documentElement.classList.contains('astrym-webapp');

  const handleBoundaryReset = () => {
    setError(null);
    setBoundaryKey((prev) => prev + 1);
    void checkWalletState();
  };

  return (
    <div className="wallet-shell app-shell">
      {showWebappBrandBar ? <OpenAndroidWebappBar /> : null}
      <PopupErrorBoundary key={boundaryKey} onReset={handleBoundaryReset}>
        {screen}
      </PopupErrorBoundary>
    </div>
  );
}

function renderWalletScreen(appState: AppState, checkWalletState: () => Promise<void>) {
  switch (appState) {
    case 'LOADING':
      return <div className="center-content">Loading Astrym...</div>;
    case 'ONBOARDING':
      return <Onboarding onComplete={checkWalletState} />;
    case 'LOCKED':
      return <Unlock onUnlock={checkWalletState} />;
    case 'DASHBOARD':
      return <Dashboard onLock={checkWalletState} />;
    default: {
      const unexpected: never = appState;
      throw new Error(`Unhandled wallet screen: ${String(unexpected)}`);
    }
  }
}
