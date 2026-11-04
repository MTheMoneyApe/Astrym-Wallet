/**
 * Private SPP form embedded in Send. Never falls back to public Horizon send.
 */

import React, { useMemo, useState } from 'react';
import { StrKey } from '@solanym/wallet-core';
import { sendIpcMessage } from './ipc.js';
import {
  xlmToStroops,
  type SppPrivateOperation,
} from '@solanym/wallet-core/src/stellar/spp/sppNymOption.js';
import { routePrivatePayment } from './privatePaymentRouter.js';

const OPERATIONS: readonly SppPrivateOperation[] = ['deposit', 'transfer', 'withdraw'];

function operationLabel(operation: SppPrivateOperation): string {
  switch (operation) {
    case 'deposit':
      return 'Depositar al pool';
    case 'transfer':
      return 'Transferir en privado';
    case 'withdraw':
      return 'Retirar del pool';
    default: {
      const unexpected: never = operation;
      return unexpected;
    }
  }
}

export type SppPrivateSendProps = {
  poolContract: string;
  preparePhase: string;
  nymConnected: boolean;
  destination?: string;
  amount?: string;
  onDestinationChange?: (value: string) => void;
  onAmountChange?: (value: string) => void;
};

export function SppPrivateSend({
  poolContract,
  preparePhase,
  nymConnected,
  destination = '',
  amount = '',
  onDestinationChange,
  onAmountChange,
}: SppPrivateSendProps) {
  const [operation, setOperation] = useState<SppPrivateOperation>('transfer');
  const [localAmount, setLocalAmount] = useState(amount);
  const [localRecipient, setLocalRecipient] = useState(destination);
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const amountValue = onAmountChange ? amount : localAmount;
  const recipientValue = onDestinationChange ? destination : localRecipient;

  const route = useMemo(
    () =>
      routePrivatePayment({
        nymConnected,
        nymMode: nymConnected ? 'nym' : 'direct',
        sppSelected: true,
        preparePhase,
        operation,
        hasDestination: recipientValue.trim().length > 0,
        hasAmount: amountValue.trim().length > 0,
        authorized,
        inFlight: busy,
        lastTxHash: txHash,
        lastErrorCode: errorCode,
        lastErrorMessage: error,
      }),
    [
      nymConnected,
      preparePhase,
      operation,
      recipientValue,
      amountValue,
      authorized,
      busy,
      txHash,
      errorCode,
      error,
    ],
  );

  const submit = () => {
    setError(null);
    setErrorCode(null);
    setTxHash(null);
    if (!StrKey.isValidContract(poolContract.trim())) {
      setError('Configura un contrato de pool C… válido en Ajustes.');
      setErrorCode('INVALID_REQUEST');
      return;
    }
    let amountStroops: string;
    try {
      amountStroops = xlmToStroops(amountValue);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Importe inválido');
      setErrorCode('INVALID_REQUEST');
      return;
    }
    if (operation === 'transfer' && !StrKey.isValidEd25519PublicKey(recipientValue.trim())) {
      setError('La transferencia privada necesita un destinatario G…');
      setErrorCode('INVALID_REQUEST');
      return;
    }
    if (!authorized) {
      setAuthorized(true);
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
    if (operation !== 'deposit' && recipientValue.trim()) {
      payload.recipient = recipientValue.trim();
    }
    setBusy(true);
    void sendIpcMessage('SPP_PRIVATE_PAYMENT', payload)
      .then((result) => {
        setTxHash(result.txHash);
        setAuthorized(false);
      })
      .catch((cause: unknown) => {
        const message =
          cause instanceof Error ? cause.message : 'El pago privado no se pudo enviar';
        setError(message);
        setErrorCode(
          cause && typeof cause === 'object' && 'code' in cause
            ? String((cause as { code: unknown }).code)
            : 'EXECUTION_FAILED',
        );
        setAuthorized(false);
      })
      .finally(() => setBusy(false));
  };

  return (
    <section className="card" style={{ display: 'grid', gap: 10 }} data-testid="spp-private-send">
      <p className="text-secondary" style={{ margin: 0, fontSize: '0.8rem' }}>
        Pago privado SPP. Soroban va por Nym. Un fallo no se convierte en envío Horizon público.
      </p>
      <p data-testid="spp-private-route-status" data-status={route.status} style={{ margin: 0, fontSize: '0.78rem' }}>
        Estado: {route.status} — {route.message}
      </p>
      <label>
        Operación SPP
        <select
          className="input-field"
          style={{ width: '100%', marginTop: 4 }}
          value={operation}
          data-testid="spp-private-operation"
          disabled={busy || route.status === 'confirmed'}
          onChange={(event) => {
            setOperation(event.target.value as SppPrivateOperation);
            setAuthorized(false);
            setError(null);
            setErrorCode(null);
            setTxHash(null);
          }}
        >
          {OPERATIONS.map((item) => (
            <option key={item} value={item}>{operationLabel(item)}</option>
          ))}
        </select>
      </label>
      <label>
        Importe (XLM)
        <input
          className="input-field"
          style={{ width: '100%', marginTop: 4 }}
          value={amountValue}
          disabled={busy}
          onChange={(event) => {
            const next = event.target.value;
            if (onAmountChange) onAmountChange(next);
            else setLocalAmount(next);
            setAuthorized(false);
          }}
        />
      </label>
      {operation !== 'deposit' ? (
        <label>
          Destinatario G…
          <input
            className="input-field"
            style={{ width: '100%', marginTop: 4, fontFamily: 'monospace', fontSize: '0.78rem' }}
            value={recipientValue}
            disabled={busy}
            onChange={(event) => {
              const next = event.target.value;
              if (onDestinationChange) onDestinationChange(next);
              else setLocalRecipient(next);
              setAuthorized(false);
            }}
          />
        </label>
      ) : null}
      {error ? <p className="error-text" role="alert">{error}</p> : null}
      {txHash ? <p style={{ overflowWrap: 'anywhere' }}>Tx: {txHash}</p> : null}
      {route.status === 'unknown' ? (
        <p className="text-secondary" style={{ fontSize: '0.75rem' }}>
          No reintentes todavía: verifica el hash / estado en el explorador o en el host SPP.
        </p>
      ) : null}
      <button
        type="button"
        className="btn-primary"
        data-testid="spp-private-submit"
        disabled={
          busy ||
          route.status === 'initializing' ||
          route.status === 'confirmed' ||
          route.status === 'unknown' ||
          (!route.canAuthorize && !route.canSubmit && route.status !== 'awaiting_authorization')
        }
        onClick={submit}
      >
        {busy
          ? 'Enviando por Nym…'
          : !authorized
            ? 'Autorizar pago privado'
            : operationLabel(operation)}
      </button>
    </section>
  );
}
