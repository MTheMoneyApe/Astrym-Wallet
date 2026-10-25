import React, { useState } from 'react';
import { sendIpcMessage } from './ipc.js';

export function Unlock({ onUnlock }: { onUnlock: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleUnlock = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!password) return;
    setError('');
    setLoading(true);
    try {
      await sendIpcMessage('UNLOCK_VAULT', { password });
      onUnlock();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
      setPassword('');
    }
  };

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      
<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginBottom: 24 }}>
  <img
    src="/icons/sym-logo.png"
    alt="SYM — Solanym Wallet"
    style={{
      width: 88,
      height: 88,
      objectFit: 'contain',
      borderRadius: 18
    }}
  />
  <h2
    style={{
      color: '#F4F7F8',
      margin: 0,
      fontSize: 22,
      fontWeight: 600,
      letterSpacing: '0.5px'
    }}
  >
    Solanym
  </h2>
  <span style={{ color: '#8FE8D0', fontSize: 11, letterSpacing: '2px' }}>
    PRIVATE BY DESIGN
  </span>
</div>

      <form onSubmit={handleUnlock} style={{ width: '100%', maxWidth: 300, display: 'flex', flexDirection: 'column', gap: 15 }}>
        <div style={{ position: 'relative' }}>
          <input 
            type={showPassword ? "text" : "password"} 
            placeholder="Enter your password"
            value={password} 
            onChange={(e) => setPassword(e.target.value)} 
            style={{ 
              width: '100%', 
              padding: '12px', 
              boxSizing: 'border-box',
              background: '#1B222B',
              border: '1px solid #333',
              color: 'white',
              borderRadius: 6,
              outline: 'none'
            }}
          />
          <button 
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            style={{ 
              position: 'absolute', 
              right: 10, 
              top: '50%', 
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              color: '#888',
              cursor: 'pointer'
            }}
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
        {error && <p style={{ color: '#ff6b6b', fontSize: '0.9em', margin: 0 }}>{error}</p>}
        <button 
          type="submit" 
          disabled={loading || !password}
          style={{ 
            padding: '12px', 
            background: loading || !password ? '#555' : '#8FE8D0', 
            color: loading || !password ? '#888' : '#11151B',
            border: 'none',
            borderRadius: 6,
            fontWeight: 'bold',
            cursor: loading || !password ? 'not-allowed' : 'pointer'
          }}
        >
          {loading ? 'Unlocking...' : 'Unlock'}
        </button>
      </form>
    </div>
  );
}
