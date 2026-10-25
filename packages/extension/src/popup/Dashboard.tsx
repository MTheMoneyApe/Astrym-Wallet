import React, { useEffect, useState } from 'react';
import { sendIpcMessage } from './ipc.js';
import { Send } from './Send.js';
import { THEME_PRESETS } from './App.js';

export function Dashboard({ onLock }: { onLock: () => void }) {
  const [account, setAccount] = useState<{ address: string; label: string; index: number } | null>(null);
  const [balance, setBalance] = useState<string>('--');
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState('');
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [accountError, setAccountError] = useState('');
  const [nymStatus, setNymStatus] = useState<'connecting' | 'connected' | 'unavailable' | 'idle'>('idle');
  const [view, setView] = useState<'dashboard' | 'send' | 'settings'>('dashboard');
  
  // Settings / Recovery State
  const [recoveryPhrase, setRecoveryPhrase] = useState<string[] | null>(null);
  const [settingsPassword, setSettingsPassword] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  // Theme State
  const [themePreset, setThemePreset] = useState('midnight');
  const [customColors, setCustomColors] = useState({
    '--bg-color': '#11151B',
    '--surface-color': '#1B222B',
    '--accent-color': '#8FE8D0',
    '--text-main': '#F4F7F8',
    '--text-sec': '#A4ADBA'
  });

  useEffect(() => {
    if (view === 'dashboard') {
      loadAccounts();
    } else {
      if (recoveryPhrase) setRecoveryPhrase(null);
      setSettingsPassword('');
      setSettingsError('');
    }
  }, [view]);

  useEffect(() => {
    if (view === 'settings') {
      chrome.storage.local.get(['themePreset', 'customColors'], (res) => {
        if (res.themePreset) setThemePreset(res.themePreset);
        if (res.customColors) setCustomColors(res.customColors);
      });
    }
  }, [view]);

  const applyColors = (colors: any) => {
    const root = document.documentElement;
    if (colors['--bg-color']) root.style.setProperty('--bg-color', colors['--bg-color']);
    if (colors['--surface-color']) root.style.setProperty('--surface-color', colors['--surface-color']);
    if (colors['--accent-color']) root.style.setProperty('--accent-color', colors['--accent-color']);
    if (colors['--text-main']) root.style.setProperty('--text-main', colors['--text-main']);
    if (colors['--text-sec']) root.style.setProperty('--text-sec', colors['--text-sec']);
    
    if (colors['--bg-color'] === '#F7FAF8') {
       root.style.setProperty('--border-color', '#E5E7EB');
       root.style.setProperty('--border-dark', '#D1D5DB');
    } else {
       root.style.setProperty('--border-color', '#2A323C');
       root.style.setProperty('--border-dark', '#333333');
    }
  };

  const handleThemeChange = (preset: string) => {
    setThemePreset(preset);
    const colors = preset === 'custom' ? customColors : (THEME_PRESETS[preset as keyof typeof THEME_PRESETS] || THEME_PRESETS.midnight);
    applyColors(colors);
    chrome.storage.local.set({ themePreset: preset, customColors: preset === 'custom' ? colors : undefined });
  };

  const handleCustomColorChange = (key: string, value: string) => {
    const newColors = { ...customColors, [key]: value };
    setCustomColors(newColors);
    applyColors(newColors);
    chrome.storage.local.set({ themePreset: 'custom', customColors: newColors });
  };

  const loadAccounts = async () => {
    setLoadingAccounts(true);
    setAccountError('');
    try {
      const accounts = await sendIpcMessage('GET_ACCOUNTS', {});
      if (accounts.length > 0) {
        const selected = accounts[0];
        setAccount({ address: selected.publicKey, label: selected.label, index: selected.index });
        fetchBalance(selected.publicKey);
      } else {
        setAccount(null);
      }
    } catch (err: any) {
      setAccountError(err.message);
    } finally {
      setLoadingAccounts(false);
    }
  };

  const fetchBalance = async (address: string) => {
    setBalanceLoading(true);
    setBalanceError('');
    setNymStatus('connecting');
    try {
      const bal = await sendIpcMessage('GET_BALANCE', { address });
      const sol = (Number(bal.lamports) / 1000000000).toFixed(4);
      setBalance(sol);
      setNymStatus('connected');
    } catch (err: any) {
      console.error("fetchBalance RPC error:", err);
      const rawError = err.message || 'Unknown error';
      if (rawError.includes('timeout')) {
        setBalanceError(`Timeout: ${rawError}`);
      } else if (rawError.includes('fetch')) {
        setBalanceError(`Network Error: ${rawError}`);
      } else {
        setBalanceError(`Error: ${rawError}`);
      }
      setBalance('--');
      setNymStatus('unavailable');
    } finally {
      setBalanceLoading(false);
    }
  };

  const handleLock = async () => {
    try {
      await sendIpcMessage('LOCK_VAULT', {});
      setRecoveryPhrase(null);
      onLock();
    } catch (err: any) {
      setAccountError(err.message);
    }
  };

  const handleRevealMnemonic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settingsPassword) return;
    setSettingsError('');
    setSettingsLoading(true);
    setCopySuccess(false);
    try {
      const res = await sendIpcMessage('REVEAL_RECOVERY_PHRASE', { auth: settingsPassword });
      setRecoveryPhrase(res.recoveryPhrase);
    } catch (err: any) {
      setSettingsError(err.message);
    } finally {
      setSettingsLoading(false);
      setSettingsPassword('');
    }
  };

  const handleCopyPhrase = async () => {
    if (!recoveryPhrase) return;
    try {
      await navigator.clipboard.writeText(recoveryPhrase.join(' '));
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 3000);
    } catch (err) {
      setSettingsError('Failed to copy to clipboard.');
    }
  };

  if (view === 'send' && account) {
    return <Send onBack={() => setView('dashboard')} accountIndex={account.index} onComplete={() => setView('dashboard')} />;
  }

  if (view === 'settings') {
    return (
      <div className="view-container" style={{ overflowY: 'auto' }}>
        <div className="header">
          <button onClick={() => setView('dashboard')} className="btn-icon">&larr; Back</button>
          <h2>Settings</h2>
          <div style={{ width: 45 }}></div>
        </div>

        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 10px 0' }}>Theme</h3>
          <select 
            value={themePreset} 
            onChange={e => handleThemeChange(e.target.value)}
            className="input-field"
            style={{ width: '100%', marginBottom: 15 }}
          >
            <option value="midnight">Midnight Green</option>
            <option value="lightmint">Light Mint</option>
            <option value="forest">Forest</option>
            <option value="custom">Custom Colors</option>
          </select>
          
          {themePreset === 'custom' && (
            <div style={{ display: 'grid', gap: 10 }}>
              {Object.entries(customColors).map(([key, value]) => (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: '0.85em', color: 'var(--text-sec)' }}>{key.replace('--', '')}</label>
                  <input 
                    type="color" 
                    value={value} 
                    onChange={e => handleCustomColorChange(key, e.target.value)}
                    style={{ background: 'none', border: 'none', width: 30, height: 30, cursor: 'pointer', padding: 0 }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h3 style={{ margin: '0 0 10px 0' }}>Wallet Backup</h3>
          <p className="text-secondary" style={{ marginBottom: 20, fontSize: '0.9em' }}>
            Your recovery phrase is the only way to restore your wallet. Never share it with anyone.
          </p>

          {recoveryPhrase ? (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
                {recoveryPhrase.map((word, i) => (
                  <div key={i} className="phrase-word">
                    <span className="text-secondary" style={{ userSelect: 'none' }}>{i + 1}.</span>
                    <span className="text-accent">{word}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={handleCopyPhrase} className="btn-secondary" style={{ flex: 1 }}>
                  {copySuccess ? 'Copied \u2713' : 'Copy'}
                </button>
                <button onClick={() => setRecoveryPhrase(null)} className="btn-secondary" style={{ flex: 1 }}>
                  Hide
                </button>
              </div>
              {copySuccess && (
                <p className="text-secondary" style={{ fontSize: '0.8em', marginTop: 10, textAlign: 'center' }}>
                  Clipboard contents may be accessible to other apps. Clear your clipboard after secure offline storage.
                </p>
              )}
            </div>
          ) : (
            <form onSubmit={handleRevealMnemonic} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input 
                type="password" 
                placeholder="Enter password to reveal"
                value={settingsPassword}
                onChange={e => setSettingsPassword(e.target.value)}
                className="input-field"
              />
              {settingsError && <p className="error-text">{settingsError}</p>}
              <button type="submit" disabled={settingsLoading || !settingsPassword} className="btn-primary">
                {settingsLoading ? 'Verifying...' : 'Reveal Recovery Phrase'}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="view-container">
      <div className="header">
        <h2 className="text-accent" style={{ margin: 0, fontSize: '1.2rem' }}>Solanym</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => setView('settings')} className="btn-outline">Settings</button>
          <button onClick={handleLock} className="btn-outline">Lock</button>
        </div>
      </div>
      
      {accountError && (
        <div className="error-card">
          <span style={{ fontSize: '0.9em' }}>{accountError}</span>
          <button onClick={loadAccounts} className="btn-error">Retry</button>
        </div>
      )}
      
      {loadingAccounts ? (
        <div className="center-content">
          <p className="text-secondary">Loading account...</p>
        </div>
      ) : account ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="card balance-card" style={{ padding: 25, border: '1px solid var(--border-color)' }}>
            <div className="balance-indicator" data-status={nymStatus}></div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <h3 style={{ margin: '0 0 4px 0', fontSize: '1rem', fontWeight: '500' }}>{account.label}</h3>
                <p className="text-secondary" style={{ margin: 0, fontFamily: 'monospace', fontSize: '0.8em' }}>
                  {account.address.slice(0, 6)}...{account.address.slice(-6)}
                </p>
              </div>
              
              <div className="nym-status">
                {nymStatus === 'connecting' && <span className="text-secondary">Nym: Connecting...</span>}
                {nymStatus === 'connected' && <span className="text-accent" style={{ fontWeight: 'bold' }}>&#128274; Nym Protected</span>}
                {nymStatus === 'unavailable' && <span className="error-text" style={{ fontWeight: 'bold' }}>&#9888; Nym Unavailable</span>}
              </div>
            </div>
            
            <h1 style={{ margin: '0', fontSize: '2.8rem', fontWeight: '700' }}>
              {balanceLoading ? <span className="text-secondary" style={{ fontSize: '2rem' }}>...</span> : balance} 
              <span className="text-secondary" style={{ fontSize: '1.2rem', fontWeight: 'normal', marginLeft: 8 }}>SOL</span>
            </h1>

            {balanceError && (
              <div style={{ marginTop: 15, padding: 10, background: 'rgba(255, 107, 107, 0.1)', borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="error-text" style={{ fontSize: '0.85em' }}>{balanceError}</span>
                <button onClick={() => fetchBalance(account.address)} disabled={balanceLoading} className="btn-error">Retry</button>
              </div>
            )}
          </div>

          <div className="action-grid">
            <button onClick={() => setView('send')} className="btn-primary" style={{ padding: 14 }}>Send</button>
            <button disabled className="btn-disabled">
              Swap <span className="badge-soon">Soon</span>
            </button>
            <button disabled className="btn-disabled">
              Stake <span className="badge-soon">Soon</span>
            </button>
            <button disabled className="btn-disabled">
              Lend <span className="badge-soon">Soon</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="center-content">
          <p className="text-secondary">No accounts found. Please unlock or reset.</p>
        </div>
      )}
    </div>
  );
}
