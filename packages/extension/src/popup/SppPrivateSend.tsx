import React, { useState } from 'react';
import { StrKey } from '@solanym/wallet-core';
import { sendIpcMessage } from './ipc.js';
import {
  xlmToStroops,
  type SppPrivateOperation,
} from '@solanym/wallet-core/src/stellar/spp/sppNymOption.js';

const OPERATIONS: readonly SppPrivateOperation[] = ['deposit', 'transfer', 'withdraw'];

function operationLabel(operation: SppPrivateOperation): string {
  switch (operation) {
    case 'deposit':
      return 'Depositar';
    case 'transfer':
      return 'Transferir en privado';
    case 'withdraw':
      return 'Retirar';
    default: {
      const unexpected: never = operation;
      return unexpected;
    }
  }
}

export function SppPrivateSend({ onBack }: { onBack: () => void }) {
  const [operation, setOperation] = useState<SppPrivateOperation>('deposit');
  const [poolContract, setPoolContract] = useState('');
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = () => {
    setError(null);
    setTxHash(null);
    if (!StrKey.isValidContract(poolContract.trim())) {
      setError('El contrato del pool debe ser un StrKey C…');
      return;
    }
    let amountStroops: string;
    try {
      amountStroops = xlmToStroops(amount);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Importe inválido');
      return;
    }
    if (operation === 'transfer' && !StrKey.isValidEd25519PublicKey(recipient.trim())) {
      setError('La transferencia privada necesita un destinatario G…');
      return;
    }
    const payload: {
      enabled: true;
      operation: SppPrivateOperation;
      poolContract: string;
      amountStroops: string;
      recipient?: string;
    } = {
      enabled: true,
      operation,
      poolContract: poolContract.trim(),
      amountStroops,
    };
    if (operation !== 'deposit' && recipient.trim()) payload.recipient = recipient.trim();
    setBusy(true);
    void sendIpcMessage('SPP_PRIVATE_PAYMENT', payload)
      .then((result) => setTxHash(result.txHash))
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'El pago privado no se pudo enviar');
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="view-container" style={{ overflowY: 'auto' }} data-testid="spp-private-send">
      <div className="header">
        <button type="button" onClick={onBack} className="btn-icon">&larr; Volver</button>
        <h2>Pago privado</h2>
        <span style={{ width: 45 }} />
      </div>
      <section className="card" style={{ display: 'grid', gap: 10 }}>
        <p className="text-secondary" style={{ margin: 0, fontSize: '0.8rem' }}>
          Depósito, transferencia o retiro SPP. El RPC de Soroban va por Nym y no reintenta por clearnet.
        </p>
        <label>
          Operación
          <select
            className="input-field"
            style={{ width: '100%', marginTop: 4 }}
            value={operation}
            data-testid="spp-private-operation"
            onChange={(event) => setOperation(event.target.value as SppPrivateOperation)}
          >
            {OPERATIONS.map((item) => (
              <option key={item} value={item}>{operationLabel(item)}</option>
            ))}
          </select>
        </label>
        <label>
          Contrato del pool (C…)
          <input className="input-field" style={{ width: '100%', marginTop: 4 }} value={poolContract} onChange={(event) => setPoolContract(event.target.value)} />
        </label>
        <label>
          Importe (XLM)
          <input className="input-field" style={{ width: '100%', marginTop: 4 }} value={amount} onChange={(event) => setAmount(event.target.value)} />
        </label>
        {operation !== 'deposit' ? (
          <label>
            Destinatario G…
            <input className="input-field" style={{ width: '100%', marginTop: 4 }} value={recipient} onChange={(event) => setRecipient(event.target.value)} />
          </label>
        ) : null}
        {error ? <p className="error-text" role="alert">{error}</p> : null}
        {txHash ? <p style={{ overflowWrap: 'anywhere' }}>Tx: {txHash}</p> : null}
        <button type="button" className="btn-primary" disabled={busy} onClick={submit}>
          {busy ? 'Enviando por Nym…' : operationLabel(operation)}
        </button>
      </section>
    </div>
  );
}
