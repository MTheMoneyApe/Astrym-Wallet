import React, { useEffect, useState } from 'react';
import { sendIpcMessage } from './ipc.js';

export function ApproveConnect({ onComplete }: { onComplete: () => void }) {
  const [origin, setOrigin] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);

  useEffect(() => {
    sendIpcMessage('GET_PENDING_APPROVALS', {}).then(res => {
      if (res.connectRequest) {
        setOrigin(res.connectRequest.origin);
        setRequestId(res.connectRequest.internalRequestId);
      }
    });
  }, []);

  const handleApprove = async () => {
    if (!requestId) return;
    await sendIpcMessage('APPROVE_DAPP_REQUEST', { id: requestId, approved: true });
    onComplete();
  };

  const handleReject = async () => {
    if (!requestId) return;
    await sendIpcMessage('APPROVE_DAPP_REQUEST', { id: requestId, approved: false });
    onComplete();
  };

  if (!origin) return <div style={{ padding: 20 }}>Loading request...</div>;

  return (
    <div style={{ padding: 20, textAlign: 'center' }}>
      <h2>Connect Request</h2>
      <p><strong>{origin}</strong> would like to connect to your Astrym wallet.</p>
      <p style={{ fontSize: '0.9em', color: '#666' }}>
        This will allow the dApp to view your public key and request signatures. It cannot sign without your approval.
      </p>
      <div style={{ marginTop: 20, display: 'flex', gap: 10, justifyContent: 'center' }}>
        <button onClick={handleReject} style={{ flex: 1, padding: 10, background: '#eee' }}>Reject</button>
        <button onClick={handleApprove} style={{ flex: 1, padding: 10, background: 'blue', color: 'white' }}>Connect</button>
      </div>
    </div>
  );
}
