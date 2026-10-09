import React, { useState } from 'react';
import { sendIpcMessage } from './ipc.js';

export function Unlock({ onUnlock }: { onUnlock: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleUnlock = async () => {
    setError('');
    setLoading(true);
    try {
      await sendIpcMessage('UNLOCK_VAULT', { password });
      // Password is intentionally not kept in state beyond this component
      onUnlock();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
      setPassword(''); // clear password field
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>Wallet Locked</h2>
      <div>
        <input 
          type="password" 
          placeholder="Password"
          value={password} 
          onChange={(e) => setPassword(e.target.value)} 
          style={{ width: '100%', marginBottom: 10 }}
        />
      </div>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <button onClick={handleUnlock} disabled={loading || !password}>
        {loading ? 'Unlocking...' : 'Unlock'}
      </button>
    </div>
  );
}
