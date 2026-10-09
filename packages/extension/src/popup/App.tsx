import React, { useEffect, useState } from 'react';
import { sendIpcMessage } from './ipc.js';
import { Onboarding } from './Onboarding.js';
import { Unlock } from './Unlock.js';
import { Dashboard } from './Dashboard.js';
import { ApproveConnect } from './ApproveConnect.js';
import { ApproveSign } from './ApproveSign.js';

export type AppState = 'LOADING' | 'ONBOARDING' | 'LOCKED' | 'DASHBOARD' | 'APPROVE_CONNECT' | 'APPROVE_SIGN';

export function App() {
  const [appState, setAppState] = useState<AppState>('LOADING');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    checkWalletState();
  }, []);

  const checkWalletState = async () => {
    try {
      const state = await sendIpcMessage('GET_WALLET_STATE', {});
      if (!state.hasVault) {
        setAppState('ONBOARDING');
      } else if (state.isLocked) {
        setAppState('LOCKED');
      } else {
        // Unlocked. Check if there are pending approvals
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
      return <div style={{ padding: 20 }}>Loading Solanym...</div>;
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
