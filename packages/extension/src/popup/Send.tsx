import React, { useState } from 'react';
import { sendIpcMessage } from './ipc.js';
import type { ReviewTransferResponse } from '../shared/ipcTypes.js';

import { parseSolToLamports } from '../shared/solToLamports.js';

export function Send({ onBack, accountIndex, onComplete }: { onBack: () => void, accountIndex: number, onComplete: () => void }) {
  const [destination, setDestination] = useState('');
  const [amountSol, setAmountSol] = useState('');
  const [error, setError] = useState<string | null>(null);
  
  const [review, setReview] = useState<ReviewTransferResponse | null>(null);
  const [sending, setSending] = useState(false);
  const [successSig, setSuccessSig] = useState<string | null>(null);

  const handleReview = async () => {
    setError(null);
    try {
      if (!destination.trim()) throw new Error('Destination required');
      
      const lamports = parseSolToLamports(amountSol);
      
      const res = await sendIpcMessage('REVIEW_TRANSFER', {
        accountIndex,
        destination: destination.trim(),
        lamports
      });
      
      setReview(res);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleSend = async () => {
    if (!review) return;
    setError(null);
    setSending(true);
    try {
      const res = await sendIpcMessage('SEND_TRANSFER', { id: review.id });
      setSuccessSig(res.signature);
    } catch (e: any) {
      setError(e.message);
      setSending(false);
    }
  };

  if (successSig) {
    return (
      <div style={{ padding: 20, textAlign: 'center' }}>
        <h2>Success</h2>
        <p>Transfer sent!</p>
        <p style={{ fontSize: '0.8em', wordBreak: 'break-all', color: '#555' }}>{successSig}</p>
        <button onClick={onComplete} style={{ marginTop: 20 }}>Done</button>
      </div>
    );
  }

  if (review) {
    const formatSol = (lamports: string) => (BigInt(lamports) / 1_000_000_000n).toString();
    return (
      <div style={{ padding: 20 }}>
        <h2>Review Transfer</h2>
        {error && <p style={{ color: 'red' }}>{error}</p>}
        
        <div style={{ background: '#f5f5f5', padding: 15, borderRadius: 8, margin: '20px 0' }}>
          <p><strong>From:</strong> {review.sourceAddress.slice(0, 4)}...{review.sourceAddress.slice(-4)}</p>
          <p><strong>To:</strong> {review.destinationAddress.slice(0, 4)}...{review.destinationAddress.slice(-4)}</p>
          <p><strong>Amount:</strong> {formatSol(review.lamports)} SOL</p>
          <p><strong>Fee:</strong> {formatSol(review.feeLamports)} SOL</p>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => setReview(null)} disabled={sending} style={{ flex: 1 }}>Cancel</button>
          <button onClick={handleSend} disabled={sending} style={{ flex: 1, background: 'blue', color: 'white' }}>
            {sending ? 'Sending...' : 'Confirm'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <button onClick={onBack}>&lt; Back</button>
        <h2>Send SOL</h2>
      </div>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 15 }}>
        <div>
          <label>Destination Address</label>
          <input 
            type="text" 
            value={destination} 
            onChange={e => setDestination(e.target.value)}
            style={{ width: '100%', padding: 8, marginTop: 5 }}
          />
        </div>

        <div>
          <label>Amount (SOL)</label>
          <input 
            type="number" 
            step="0.000000001"
            min="0"
            value={amountSol} 
            onChange={e => setAmountSol(e.target.value)}
            style={{ width: '100%', padding: 8, marginTop: 5 }}
          />
        </div>

        <button onClick={handleReview} style={{ padding: 10, background: 'blue', color: 'white', marginTop: 10 }}>
          Review
        </button>
      </div>
    </div>
  );
}
