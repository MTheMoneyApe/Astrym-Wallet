/**
 * Private SPP form embedded in Send. Never falls back to public Horizon send.
 */

import React, { useMemo, useState } from 'react';
import { StrKey } from '@solanym/wallet-core';
import {
  xlmToStroops,
  type SppPrivateOperation,
} from '@solanym/wallet-core/src/stellar/spp/sppNymOption.js';
import { routePrivatePayment } from './privatePaymentRouter.js';
import { maxFeeStroopsForOperation } from '@solanym/wallet-core/src/stellar/spp/sppFeePolicy.js';

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
  const busy = false;

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
    try {
      xlmToStroops(amountValue);
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
    setAuthorized(false);
    setErrorCode('SPP_POOL_ECONOMICS_NOT_VERIFIED');
    setError(
      'BLOCKED SPP_POOL_ECONOMICS_NOT_VERIFIED: el importe y el techo de tx.fee no fijan public_amount = ext_amount - pool fee, ni los commitments del destinatario privado, ni los pasos. No se estima un fee ni se nombra un beneficiario. Aprobación bloqueada.',
    );
  };

  return (
    <section className="card" style={{ display: 'grid', gap: 10 }} data-testid="spp-private-send">
      <p className="text-secondary" style={{ margin: 0, fontSize: '0.8rem' }}>
        Pago privado SPP. Soroban va por Nym. Un fallo no se convierte en envío Horizon público.
      </p>
      <p data-testid="spp-private-route-status" data-status={route.status} style={{ margin: 0, fontSize: '0.78rem' }}>
        Estado: {route.status} — {route.message}
      </p>
      {authorized && !busy ? (
        <div
          className="card"
          data-testid="spp-private-auth-summary"
          style={{ padding: 12, fontSize: '0.78rem', display: 'grid', gap: 6 }}
        >
          <strong>Autorizar exactamente (Testnet):</strong>
          <span>Operación: {operationLabel(operation)}</span>
          <span className="address-wrap">Pool: {poolContract}</span>
          <span>Importe: {amountValue} XLM</span>
          {operation !== 'deposit' ? (
            <span className="address-wrap">Destinatario: {recipientValue || '(cuenta activa)'}</span>
          ) : null}
          <span>
            maxFee techo: {maxFeeStroopsForOperation(operation)} stroops (política centralizada, no unbounded)
          </span>
          <span className="text-secondary" data-testid="spp-pool-economics">
            BLOCKED. El techo es tx.fee, no el pool fee. public_amount = ext_amount - fee no está en esta aprobación. El admin del pool elige el claim recipient. No hay fee Astrym ni beneficiario fijo.
          </span>
        </div>
      ) : null}
      {errorCode === 'BROADCAST_AWAITING_APPROVAL' ||
      (error && error.includes('SPP_BROADCAST_AWAITING_APPROVAL')) ? (
        <p className="text-secondary" data-testid="spp-broadcast-awaiting" style={{ fontSize: '0.75rem' }}>
          Pago preparado y retenido. No se ha difundido ninguna transacción Testnet.
        </p>
      ) : null}
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
            className="input-field address-wrap"
            style={{ width: '100%', marginTop: 4 }}
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
      {txHash ? <p className="tx-hash">Tx: {txHash}</p> : null}
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
