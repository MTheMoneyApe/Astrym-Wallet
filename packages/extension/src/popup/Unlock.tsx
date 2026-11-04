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
    <div className="unlock-screen">
      <div className="unlock-brand">
        <img className="unlock-logo" src="/icons/sym-logo.png" alt="Astrym" />
        <h2 className="unlock-title">Astrym</h2>
        <span className="unlock-tagline">PRIVATE BY DESIGN</span>
      </div>

      <form className="unlock-form" onSubmit={handleUnlock}>
        <div className="unlock-field">
          <input
            className="input-field"
            type={showPassword ? 'text' : 'password'}
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          <button
            type="button"
            className="unlock-toggle"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
        {error ? <p className="error-text" role="alert" style={{ margin: 0 }}>{error}</p> : null}
        <button
          type="submit"
          className="btn-primary"
          disabled={loading || !password}
          style={{ width: '100%' }}
        >
          {loading ? 'Unlocking...' : 'Unlock'}
        </button>
      </form>
    </div>
  );
}
