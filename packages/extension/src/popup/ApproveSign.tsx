import React, { useEffect, useState } from 'react';
import { sendIpcMessage } from './ipc.js';
import { DappTransactionReview } from '../shared/ipcTypes.js';

export function ApproveSign({ onComplete }: { onComplete: () => void }) {
  const [review, setReview] = useState<DappTransactionReview | null>(null);

  useEffect(() => {
    sendIpcMessage('GET_PENDING_APPROVALS', {}).then(res => {
      if (res.signRequest) {
        setReview(res.signRequest);
      }
    });
  }, []);

  const handleApprove = async () => {
    if (!review) return;
    await sendIpcMessage('APPROVE_DAPP_REQUEST', { id: review.internalRequestId, approved: true });
    onComplete();
  };

  const handleReject = async () => {
    if (!review) return;
    await sendIpcMessage('APPROVE_DAPP_REQUEST', { id: review.internalRequestId, approved: false });
    onComplete();
  };

  if (!review) return <div style={{ padding: 20 }}>Loading request...</div>;

  const lamportsToSol = (lamports: string) => (BigInt(lamports) / 1_000_000_000n).toString();

  return (
    <div style={{ padding: 20 }}>
      <h2 style={{ textAlign: 'center' }}>Signature Request</h2>
      <p style={{ textAlign: 'center' }}><strong>{review.origin}</strong></p>
      
      <div style={{ background: '#f5f5f5', padding: 15, borderRadius: 8, margin: '20px 0' }}>
        <p><strong>Action:</strong> {review.program}</p>
        <p><strong>From:</strong> {review.account.slice(0, 4)}...{review.account.slice(-4)}</p>
        <p><strong>To:</strong> {review.destination.slice(0, 4)}...{review.destination.slice(-4)}</p>
        <p><strong>Amount:</strong> {lamportsToSol(review.amountLamports)} SOL</p>
        <p><strong>Network Fee:</strong> {lamportsToSol(review.estimatedFeeLamports)} SOL</p>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={handleReject} style={{ flex: 1, padding: 10, background: '#eee' }}>Reject</button>
        <button onClick={handleApprove} style={{ flex: 1, padding: 10, background: 'blue', color: 'white' }}>Approve</button>
      </div>
    </div>
  );
}
