import React, { useEffect, useState } from 'react';
import { sendIpcMessage } from './ipc.js';
import { Send } from './Send.js';

export function Dashboard({ onLock }: { onLock: () => void }) {
  const [account, setAccount] = useState<{ address: string; label: string; index: number } | null>(null);
  const [balance, setBalance] = useState<string>('0');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'dashboard' | 'send'>('dashboard');

  useEffect(() => {
    if (view === 'dashboard') {
      loadData();
    }
  }, [view]);

  const loadData = async () => {
    setLoading(true);
    try {
      const accounts = await sendIpcMessage('GET_ACCOUNTS', {});
      if (accounts.length > 0) {
        const selected = accounts[0];
        if (!selected) return;
        setAccount({ address: selected.publicKey, label: selected.label, index: selected.index });
        
        const bal = await sendIpcMessage('GET_BALANCE', { address: selected.publicKey });
        const sol = (Number(bal.lamports) / 1000000000).toFixed(4);
        setBalance(sol);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLock = async () => {
    try {
      await sendIpcMessage('LOCK_VAULT', {});
      onLock();
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (view === 'send' && account) {
    return <Send onBack={() => setView('dashboard')} accountIndex={account.index} onComplete={() => setView('dashboard')} />;
  }

  if (loading) return <div style={{ padding: 20 }}>Loading account data...</div>;

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Dashboard</h2>
        <button onClick={handleLock}>Lock</button>
      </div>
      
      {error && <p style={{ color: 'red' }}>{error}</p>}
      
      {account ? (
        <div style={{ marginTop: 20, padding: 15, border: '1px solid #ccc', borderRadius: 8 }}>
          <h3>{account.label}</h3>
          <p style={{ wordBreak: 'break-all', fontSize: '0.9em', color: '#555' }}>
            {account.address}
          </p>
          <h1 style={{ margin: '10px 0' }}>{balance} SOL</h1>
          <p style={{ color: 'gray', fontSize: '0.8em', marginBottom: 15 }}>Devnet</p>
          
          <button onClick={() => setView('send')} style={{ width: '100%', padding: 10, background: 'blue', color: 'white' }}>
            Send
          </button>
        </div>
      ) : (
        <p>No accounts found.</p>
      )}
    </div>
  );
}

