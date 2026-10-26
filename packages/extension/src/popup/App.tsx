import React, { useEffect, useState } from 'react';
import { sendIpcMessage } from './ipc.js';
import { Onboarding } from './Onboarding.js';
import { Unlock } from './Unlock.js';
import { Dashboard } from './Dashboard.js';
import { ApproveConnect } from './ApproveConnect.js';
import { ApproveSign } from './ApproveSign.js';

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

export type AppState = 'LOADING' | 'ONBOARDING' | 'LOCKED' | 'DASHBOARD' | 'APPROVE_CONNECT' | 'APPROVE_SIGN';

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
  }
};

export function App() {
  const [appState, setAppState] = useState<AppState>('LOADING');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Load theme
    chrome.storage.local.get(['themePreset', 'customColors'], (res) => {
      const storage = res as Record<string, unknown>;
      const presetId = typeof storage['themePreset'] === 'string' ? String(storage['themePreset']) : 'midnight';
      const fallbackColors = THEME_PRESETS['midnight'] as ThemePalette;
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
        const pending = await sendIpcMessage('GET_PENDING_APPROVALS', {});
        if (pending.connectRequest) {
          setAppState('APPROVE_CONNECT');
        } else if (pending.signRequest) {
          setAppState('APPROVE_SIGN');
        } else {
          setAppState('DASHBOARD');
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to initialize wallet');
    }
  };

  if (error) {
    return (
      <div style={{ padding: 20, color: 'red' }}>
        <h2>Error</h2>
        <p>{error}</p>
        <button onClick={() => { setError(null); checkWalletState(); }}>Retry</button>
      </div>
    );
  }

  switch (appState) {
    case 'LOADING':
      return <div className="center-content">Loading Solanym...</div>;
    case 'ONBOARDING':
      return <Onboarding onComplete={checkWalletState} />;
    case 'LOCKED':
      return <Unlock onUnlock={checkWalletState} />;
    case 'APPROVE_CONNECT':
      return <ApproveConnect onComplete={checkWalletState} />;
    case 'APPROVE_SIGN':
      return <ApproveSign onComplete={checkWalletState} />;
    case 'DASHBOARD':
      return <Dashboard onLock={checkWalletState} />;
    default:
      return null;
  }
}
