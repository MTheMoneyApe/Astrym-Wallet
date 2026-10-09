import React, { useState } from 'react';

type TransportState = 'UNINITIALIZED' | 'INITIALIZING' | 'CONNECTED' | 'ERROR' | 'DISCONNECTED';

export function NymDiagnostic() {
  const [state, setState] = useState<TransportState>('UNINITIALIZED');
  const [errorMsg, setErrorMsg] = useState('');

  const simulateInitialization = () => {
    setState('INITIALIZING');
    setErrorMsg('');
    
    // Simulate warm-up latency without setTimeout (forbidden by invariant)
    Promise.resolve().then(() => {
      setState('CONNECTED');
    });
  };

  const simulateError = () => {
    setState('ERROR');
    setErrorMsg('Could not establish TCP connection to Mixnode');
  };

  const simulateDisconnect = () => {
    setState('DISCONNECTED');
  };

  const getStatusColor = () => {
    switch (state) {
      case 'UNINITIALIZED': return 'gray';
      case 'INITIALIZING': return 'orange';
      case 'CONNECTED': return 'green';
      case 'ERROR': return 'red';
      case 'DISCONNECTED': return 'black';
    }
  };

  return (
    <div style={{ padding: 20, border: '2px solid #ccc', borderRadius: 8, margin: '20px 0' }}>
      <h2>Transport Diagnostic Bench</h2>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '15px 0' }}>
        <div style={{ width: 15, height: 15, borderRadius: '50%', backgroundColor: getStatusColor() }} />
        <strong>Status: {state}</strong>
      </div>
      
      {state === 'ERROR' && <p style={{ color: 'red' }}>{errorMsg}</p>}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button onClick={simulateInitialization} disabled={state === 'INITIALIZING' || state === 'CONNECTED'}>
          Simulate Init
        </button>
        <button onClick={simulateError}>
          Simulate Error
        </button>
        <button onClick={simulateDisconnect} disabled={state !== 'CONNECTED'}>
          Simulate Disconnect
        </button>
      </div>
    </div>
  );
}
