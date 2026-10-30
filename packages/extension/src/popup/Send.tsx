import React, { useEffect, useRef, useState } from 'react';
import { isAddress } from '@solana/kit';
import { StrKey } from '@solanym/wallet-core';
import { sendIpcMessage } from './ipc.js';
import type { 
  EstimateTransferResponse, 
  ReviewTransferResponse,
  EstimateStellarTransferResponse,
  ReviewStellarTransferResponse,
} from '../shared/ipcTypes.js';
import { parseSolToLamports } from '../shared/solToLamports.js';

type SendStatus = 'idle' | 'preparing' | 'ready' | 'sending' | 'pending' | 'confirmed' | 'failed' | 'unknown';

export function formatLamportsAsSol(lamports: bigint): string {
  const whole = lamports / 1_000_000_000n;
  const fraction = (lamports % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function calculateTransferTotals(amountLamports: string, feeLamports: string, balanceLamports: string) {
  const amount = BigInt(amountLamports);
  const fee = BigInt(feeLamports);
  const balance = BigInt(balanceLamports);
  return { amount, fee, total: amount + fee, balance, sufficient: amount + fee <= balance };
}

export function validateSolTransferInput(destination: string, amount: string): string | null {
  if (!destination.trim()) return 'Introduce la dirección destinataria.';
  if (!isAddress(destination.trim())) return 'La dirección destinataria no es válida.';
  try {
    parseSolToLamports(amount);
  } catch {
    return 'Introduce un importe SOL positivo con hasta 9 decimales.';
  }
  return null;
}

export function validateXlmTransferInput(destination: string, amount: string, sourceAddress?: string): string | null {
  const destTrim = destination.trim();
  if (!destTrim) return 'Introduce la dirección destinataria de Stellar.';
  if (!StrKey.isValidEd25519PublicKey(destTrim)) return 'La dirección Stellar no es válida (debe ser un StrKey G... de 56 caracteres).';
  if (sourceAddress && destTrim === sourceAddress) return 'La dirección destinataria no puede ser la misma que la cuenta de origen.';
  const amtTrim = amount.trim();
  if (!amtTrim) return 'Introduce un importe en XLM.';
  if (!/^\d+(\.\d{1,7})?$/.test(amtTrim)) return 'Introduce un importe XLM positivo con hasta 7 decimales.';
  const num = Number(amtTrim);
  if (isNaN(num) || num <= 0) return 'El importe debe ser mayor que cero.';
  return null;
}

export function validateStellarMemo(memo: string): string | null {
  if (!memo) return null;
  const trimmed = memo.trim();
  if (!trimmed) return null;
  const byteLength = new TextEncoder().encode(trimmed).length;
  if (byteLength > 28) return `El memo no puede superar los 28 bytes (actual: ${byteLength} bytes).`;
  return null;
}

export function createSendOperationGate() {
  let busy = false;
  return {
    acquire: () => {
      if (busy) return false;
      busy = true;
      return true;
    },
    release: () => { busy = false; },
  };
}

/** Pure UI policy for Stellar SEND failures — keeps fee-changed handling testable without mounting Send. */
export function resolveStellarSendFailure(error: unknown): {
  clearStellarReview: boolean;
  status: 'idle' | 'unknown';
  errorMessage: string;
} {
  const e = error as { name?: string; message?: string } | null | undefined;
  if (e?.name === 'StellarFeeChangedError') {
    return {
      clearStellarReview: true,
      status: 'idle',
      errorMessage: 'La comisión de red cambió. Vuelve a revisar la operación.',
    };
  }
  return {
    clearStellarReview: false,
    status: 'unknown',
    errorMessage:
      (e && typeof e.message === 'string' && e.message) ||
      'Se perdió la conexión con Stellar Horizon. Comprueba la red antes de volver a enviar.',
  };
}

export function Send({ onBack, accountIndex, accountAddress, onComplete, onUsePrivatePayment }: {
  onBack: () => void;
  accountIndex: number;
  accountAddress: string;
  onComplete: () => void;
  onUsePrivatePayment?: () => void;
}) {
  const isStellar = accountAddress.startsWith('G') && accountAddress.length === 56;

  const [destination, setDestination] = useState('');
  const [amountSol, setAmountSol] = useState('');
  const [memo, setMemo] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Balance state (Stellar XLM or Solana SOL)
  const [balanceLamports, setBalanceLamports] = useState<string | null>(null);
  // Stellar Balance state
  const [balanceXlm, setBalanceXlm] = useState<string | null>(null);

  const [balanceError, setBalanceError] = useState('');
  const [balanceLoading, setBalanceLoading] = useState(true);

  // Solana-path estimation & review (Stellar uses stellarReview)
  const [estimate, setEstimate] = useState<EstimateTransferResponse | null>(null);
  const [review, setReview] = useState<ReviewTransferResponse | null>(null);

  // Stellar estimation & review
  const [stellarEstimate, setStellarEstimate] = useState<EstimateStellarTransferResponse | null>(null);
  const [stellarReview, setStellarReview] = useState<ReviewStellarTransferResponse | null>(null);

  const [estimateError, setEstimateError] = useState('');
  const [estimating, setEstimating] = useState(false);
  const [status, setStatus] = useState<SendStatus>('idle');
  const [signature, setSignature] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const estimateRequestId = useRef(0);
  const balanceRequestId = useRef(0);
  const operationGate = useRef<ReturnType<typeof createSendOperationGate> | null>(null);
  if (!operationGate.current) operationGate.current = createSendOperationGate();

  const memoError = isStellar && memo ? validateStellarMemo(memo) : null;
  const currentInputError = memoError || (isStellar
    ? validateXlmTransferInput(destination, amountSol, accountAddress)
    : validateSolTransferInput(destination, amountSol));

  const isEstimateCurrent = isStellar
    ? Boolean(
        stellarEstimate &&
        stellarEstimate.sourceAddress === accountAddress &&
        stellarEstimate.destinationAddress === destination.trim() &&
        stellarEstimate.amountXlm === amountSol.trim()
      )
    : Boolean(
        estimate &&
        estimate.sourceAddress === accountAddress &&
        estimate.destinationAddress === destination.trim() &&
        estimate.lamports === (() => {
          try { return parseSolToLamports(amountSol); } catch { return ''; }
        })()
      );

  const totals = !isStellar && isEstimateCurrent && estimate
    ? calculateTransferTotals(estimate.lamports, estimate.feeLamports, estimate.balanceLamports)
    : null;

  useEffect(() => {
    const requestId = ++balanceRequestId.current;
    setBalanceLoading(true);
    setBalanceError('');

    if (isStellar) {
      sendIpcMessage('GET_STELLAR_BALANCE', { address: accountAddress }).then((response) => {
        if (balanceRequestId.current !== requestId) return;
        setBalanceXlm(response.balance);
      }).catch((err: unknown) => {
        if (balanceRequestId.current !== requestId) return;
        setBalanceXlm(null);
        setBalanceError(err instanceof Error ? err.message : 'No se pudo consultar el saldo de XLM.');
      }).finally(() => {
        if (balanceRequestId.current === requestId) setBalanceLoading(false);
      });
    } else {
      sendIpcMessage('GET_BALANCE', { address: accountAddress }).then((response) => {
        if (balanceRequestId.current !== requestId) return;
        setBalanceLamports(response.lamports);
      }).catch((err: unknown) => {
        if (balanceRequestId.current !== requestId) return;
        setBalanceLamports(null);
        setBalanceError(err instanceof Error ? err.message : 'No se pudo consultar el saldo.');
      }).finally(() => {
        if (balanceRequestId.current === requestId) setBalanceLoading(false);
      });
    }

    return () => { balanceRequestId.current += 1; };
  }, [accountIndex, accountAddress, isStellar]);

  useEffect(() => {
    const requestId = ++estimateRequestId.current;
    setEstimate(null);
    setStellarEstimate(null);
    setEstimateError('');
    setEstimating(false);
    setReview(null);
    setStellarReview(null);
    setStatus((current) => current === 'sending' || current === 'pending' ? current : 'idle');

    if (currentInputError || balanceLoading || balanceError) return;

    const timeout = window.setTimeout(() => {
      setEstimating(true);
      if (isStellar) {
        sendIpcMessage('ESTIMATE_STELLAR_TRANSFER', {
          accountIndex,
          destination: destination.trim(),
          amountXlm: amountSol.trim(),
          memo: memo.trim() || undefined,
        }).then((response) => {
          if (estimateRequestId.current !== requestId) return;
          if (response.sourceAddress !== accountAddress || response.destinationAddress !== destination.trim()) {
            throw new Error('La cuenta o el destinatario cambiaron. Vuelve a revisar la operación.');
          }
          setStellarEstimate(response);
          setBalanceXlm(response.balanceXlm);
        }).catch((err: unknown) => {
          if (estimateRequestId.current !== requestId) return;
          setEstimateError(err instanceof Error ? err.message : 'Comisión no disponible.');
        }).finally(() => {
          if (estimateRequestId.current === requestId) setEstimating(false);
        });
      } else {
        sendIpcMessage('ESTIMATE_TRANSFER', {
          accountIndex,
          destination: destination.trim(),
          lamports: parseSolToLamports(amountSol),
        }).then((response) => {
          if (estimateRequestId.current !== requestId) return;
          if (response.sourceAddress !== accountAddress || response.destinationAddress !== destination.trim()) {
            throw new Error('La cuenta o el destinatario cambiaron. Vuelve a revisar la operación.');
          }
          setEstimate(response);
          setBalanceLamports(response.balanceLamports);
        }).catch((err: unknown) => {
          if (estimateRequestId.current !== requestId) return;
          setEstimateError(err instanceof Error ? err.message : 'Comisión no disponible.');
        }).finally(() => {
          if (estimateRequestId.current === requestId) setEstimating(false);
        });
      }
    }, 450);

    return () => {
      window.clearTimeout(timeout);
      estimateRequestId.current += 1;
    };
  }, [accountIndex, accountAddress, destination, amountSol, memo, currentInputError, balanceLoading, balanceError, isStellar]);

  const handleReview = async () => {
    if (!operationGate.current!.acquire()) return;
    if (isSubmitting || status === 'preparing' || currentInputError) {
      operationGate.current!.release();
      return;
    }

    setError(null);
    setStatus('preparing');

    if (isStellar) {
      try {
        const res = await sendIpcMessage('REVIEW_STELLAR_TRANSFER', {
          accountIndex,
          destination: destination.trim(),
          amountXlm: amountSol.trim(),
          memo: memo.trim() || undefined,
        });
        if (res.sourceAddress !== accountAddress) throw new Error('La cuenta de origen cambió.');
        setStellarReview(res);
        setBalanceXlm(res.balanceXlm);
        setStatus('ready');
      } catch (e: any) {
        setError(e.message || 'No se pudo preparar la transferencia de Stellar.');
        setStatus('idle');
      } finally {
        operationGate.current!.release();
      }
      return;
    }

    if (balanceLamports === null || !isEstimateCurrent || !totals?.sufficient) {
      operationGate.current!.release();
      return;
    }

    try {
      const lamports = parseSolToLamports(amountSol);
      const res = await sendIpcMessage('REVIEW_TRANSFER', {
        accountIndex,
        destination: destination.trim(),
        lamports
      });
      if (res.sourceAddress !== accountAddress) throw new Error('La cuenta de origen cambió. Vuelve a abrir el envío.');
      const finalTotals = calculateTransferTotals(res.lamports, res.feeLamports, res.balanceLamports);
      if (!finalTotals.sufficient) throw new Error('Saldo insuficiente para cubrir el importe y la comisión estimada.');
      setReview(res);
      setBalanceLamports(res.balanceLamports);
      setStatus('ready');
    } catch (e: any) {
      setError(e.message || 'No se pudo preparar la transferencia.');
      setStatus('idle');
    } finally {
      operationGate.current!.release();
    }
  };

  const handleSend = async () => {
    if (!operationGate.current!.acquire()) return;

    if (isStellar) {
      if (!stellarReview || isSubmitting) {
        operationGate.current!.release();
        return;
      }
      setError(null);
      setIsSubmitting(true);
      setStatus('sending');
      try {
        const res = await sendIpcMessage('SEND_STELLAR_TRANSFER', { id: stellarReview.id });
        setSignature(res.txHash);
        setStatus('pending');
        const confirmation = await sendIpcMessage('CONFIRM_STELLAR_TRANSFER', { txHash: res.txHash });
        setStatus(confirmation.status === 'CONFIRMED' ? 'confirmed' : confirmation.status === 'FAILED' ? 'failed' : 'unknown');
        if (confirmation.status === 'FAILED') setError('La red Stellar rechazó la transacción.');
        if (confirmation.status === 'UNKNOWN') setError('No se pudo determinar el resultado inmediato. Comprueba el estado en Stellar Testnet.');
      } catch (e: unknown) {
        const failure = resolveStellarSendFailure(e);
        if (failure.clearStellarReview) {
          setStellarReview(null);
        }
        setStatus(failure.status);
        setError(failure.errorMessage);
      } finally {
        setIsSubmitting(false);
        operationGate.current!.release();
      }
      return;
    }

    if (!review || isSubmitting) {
      operationGate.current!.release();
      return;
    }
    setError(null);
    setIsSubmitting(true);
    setStatus('sending');
    try {
      const res = await sendIpcMessage('SEND_TRANSFER', { id: review.id });
      setSignature(res.signature);
      setStatus('pending');
      const confirmation = await sendIpcMessage('CONFIRM_TRANSFER', { signature: res.signature });
      setStatus(confirmation.status === 'CONFIRMED' ? 'confirmed' : confirmation.status === 'FAILED' ? 'failed' : 'unknown');
      if (confirmation.status === 'FAILED') setError('La red rechazó la transacción.');
      if (confirmation.status === 'UNKNOWN') setError('No se pudo determinar el resultado. Comprueba la firma en la red antes de volver a enviar.');
    } catch (e: any) {
      setStatus('unknown');
      setError(e.message || 'Se perdió la conexión antes de confirmar el resultado. Comprueba la red antes de volver a enviar.');
    } finally {
      setIsSubmitting(false);
      operationGate.current!.release();
    }
  };

  const handleMax = () => {
    if (isStellar) {
      if (!balanceXlm) return;
      const bal = Number(balanceXlm);
      // Leave 1.0 XLM minimum reserve + 0.00001 fee
      const max = Math.max(0, bal - 1.00001);
      if (max <= 0) {
        setError('El saldo disponible no cubre la reserva mínima de Stellar (1 XLM) y la comisión de red.');
        return;
      }
      setError(null);
      const maxFloored = Math.floor(max * 10_000_000) / 10_000_000;
      const formattedMax = maxFloored.toFixed(7).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
      setAmountSol(formattedMax);
      return;
    }

    if (!totals || !isEstimateCurrent) return;
    const maxLamports = totals.balance - totals.fee;
    if (maxLamports <= 0n) {
      setError('El saldo disponible no cubre la comisión de red.');
      return;
    }
    setError(null);
    setAmountSol(formatLamportsAsSol(maxLamports));
  };

  const statusText: Record<SendStatus, string> = {
    idle: '',
    preparing: 'Preparando transferencia…',
    ready: 'Revisión lista',
    sending: isStellar ? 'Enviando a Stellar Horizon…' : 'Enviando al RPC…',
    pending: 'Pendiente de confirmación de la red…',
    confirmed: isStellar ? 'Transacción confirmada en Stellar Testnet' : 'Transacción confirmada',
    failed: 'Transacción fallida',
    unknown: 'Estado desconocido',
  };

  if (status === 'confirmed' || status === 'failed' || status === 'unknown' || status === 'sending' || status === 'pending') {
    return (
      <div className="view-container" style={{ overflowY: 'auto' }}>
        <div className="header">
          <button onClick={onBack} className="btn-icon" disabled={isSubmitting}>&larr; Volver</button>
          <h2>Enviar</h2>
          <span style={{ width: 52 }} />
        </div>
        <section className="card" aria-live="polite">
          <h3 style={{ marginTop: 0 }}>{statusText[status]}</h3>
          <p className="text-secondary" style={{ fontSize: '0.88rem' }}>
            {status === 'confirmed' && (isStellar ? 'Stellar Testnet confirmó esta transferencia.' : 'La red confirmó esta transferencia.')}
            {status === 'failed' && (isStellar ? 'Stellar Horizon informó que la transferencia falló.' : 'La red informó que la transferencia falló.')}
            {status === 'unknown' && 'No reenvíes todavía: el resultado puede tardar en conocerse.'}
            {status === 'sending' && (isStellar ? 'La solicitud se está firmando y transmitiendo a Stellar Testnet.' : 'La solicitud se está enviando mediante el servicio de transacciones del wallet.')}
            {status === 'pending' && 'Transacción enviada. Esperando confirmación del ledger de Stellar Testnet…'}
          </p>
          {signature && (
            <div style={{ marginTop: 10 }}>
              <span className="text-secondary" style={{ fontSize: '0.72rem' }}>{isStellar ? 'Hash de transacción' : 'Firma de transacción'}:</span>
              <p style={{ fontFamily: 'monospace', fontSize: '0.74rem', overflowWrap: 'anywhere', margin: '4px 0 8px' }}>{signature}</p>
              {isStellar && (
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${signature}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-outline"
                  style={{ display: 'inline-block', textAlign: 'center', width: '100%', padding: '6px 10px', fontSize: '0.78rem', textDecoration: 'none', color: 'var(--accent-color)' }}
                >
                  Ver en Stellar Expert Testnet &rarr;
                </a>
              )}
            </div>
          )}
          {error && <p role="alert" className="error-text" style={{ marginTop: 10 }}>{error}</p>}
          {(status === 'confirmed' || status === 'failed' || status === 'unknown') && (
            <button onClick={onComplete} className="btn-primary" style={{ width: '100%', marginTop: 12 }}>Listo</button>
          )}
        </section>
      </div>
    );
  }

  if (isStellar && stellarReview) {
    const totalXlm = (Number(stellarReview.amountXlm) + Number(stellarReview.feeXlm)).toFixed(7);
    return (
      <div className="view-container" style={{ overflowY: 'auto' }}>
        <div className="header">
          <button onClick={() => { setStellarReview(null); setStatus('idle'); }} className="btn-icon" disabled={isSubmitting}>&larr; Volver</button>
          <h2>Revisar envío XLM</h2>
          <span style={{ width: 52 }} />
        </div>
        {error && <p role="alert" className="error-text">{error}</p>}
        <section className="card" style={{ display: 'grid', gap: 12 }}>
          <div><span className="text-secondary">Red</span><div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--accent-color)' }}>Stellar Testnet</div></div>
          <div><span className="text-secondary">Operación</span><div style={{ fontSize: '0.82rem' }}>{stellarReview.operationType === 'createAccount' ? 'Crear y fondear cuenta (destino nuevo)' : 'Pago nativo XLM'}</div></div>
          <div><span className="text-secondary">Desde</span><div style={{ fontFamily: 'monospace', fontSize: '0.76rem', overflowWrap: 'anywhere' }}>{stellarReview.sourceAddress}</div></div>
          <div><span className="text-secondary">Destinatario</span><div style={{ fontFamily: 'monospace', fontSize: '0.76rem', overflowWrap: 'anywhere' }}>{stellarReview.destinationAddress}</div></div>
          {stellarReview.memo && (
            <div><span className="text-secondary">Memo</span><div style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{stellarReview.memo}</div></div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>Importe</span><strong>{stellarReview.amountXlm} XLM</strong></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>Comisión de red (XLM)</span><strong>{stellarReview.feeXlm} XLM</strong></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, paddingTop: 10, borderTop: '1px solid var(--border-dark)' }}><strong>Total estimado</strong><strong>{totalXlm} XLM</strong></div>
          <p className="text-secondary" style={{ margin: 0, fontSize: '0.74rem' }}>La transacción se firmará de forma segura con tu clave privada Stellar Testnet antes de enviarla a Horizon.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setStellarReview(null); setStatus('idle'); }} disabled={isSubmitting} className="btn-secondary" style={{ flex: 1 }}>Cancelar</button>
            <button onClick={handleSend} disabled={isSubmitting} className="btn-primary" style={{ flex: 1 }}>
              {isSubmitting ? 'Enviando…' : 'Confirmar envío'}
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (!isStellar && review) {
    const reviewTotals = calculateTransferTotals(review.lamports, review.feeLamports, review.balanceLamports);
    return (
      <div className="view-container" style={{ overflowY: 'auto' }}>
        <div className="header">
          <button onClick={() => { setReview(null); setStatus('idle'); }} className="btn-icon" disabled={isSubmitting}>&larr; Volver</button>
          <h2>Revisar envío</h2>
          <span style={{ width: 52 }} />
        </div>
        {error && <p role="alert" className="error-text">{error}</p>}
        <section className="card" style={{ display: 'grid', gap: 12 }}>
          <div><span className="text-secondary">Desde</span><div style={{ fontFamily: 'monospace', fontSize: '0.78rem', overflowWrap: 'anywhere' }}>{review.sourceAddress}</div></div>
          <div><span className="text-secondary">Destinatario</span><div style={{ fontFamily: 'monospace', fontSize: '0.78rem', overflowWrap: 'anywhere' }}>{review.destinationAddress}</div></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>Importe</span><strong>{formatLamportsAsSol(BigInt(review.lamports))} SOL</strong></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>Comisión estimada (SOL)</span><strong>{formatLamportsAsSol(BigInt(review.feeLamports))} SOL</strong></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, paddingTop: 10, borderTop: '1px solid var(--border-dark)' }}><strong>Total estimado</strong><strong>{formatLamportsAsSol(reviewTotals.total)} SOL</strong></div>
          <p className="text-secondary" style={{ margin: 0, fontSize: '0.76rem' }}>La comisión puede cambiar antes de que la red procese la transacción. El saldo se vuelve a validar antes de firmar.</p>
          {!reviewTotals.sufficient && <p role="alert" className="error-text">Saldo insuficiente para el importe y la comisión.</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setReview(null); setStatus('idle'); }} disabled={isSubmitting} className="btn-secondary" style={{ flex: 1 }}>Cancelar</button>
            <button onClick={handleSend} disabled={isSubmitting || !reviewTotals.sufficient} className="btn-primary" style={{ flex: 1 }}>
              {isSubmitting ? 'Enviando…' : 'Confirmar envío'}
            </button>
          </div>
        </section>
      </div>
    );
  }

  const isFormReady = isStellar
    ? Boolean(!currentInputError && !balanceLoading && balanceXlm && !estimating && isEstimateCurrent && !isSubmitting && status !== 'preparing')
    : Boolean(!currentInputError && !balanceLoading && balanceLamports !== null && !estimating && isEstimateCurrent && totals?.sufficient && !isSubmitting && status !== 'preparing');

  return (
    <div className="view-container" style={{ overflowY: 'auto' }}>
      <div className="header">
        <button onClick={onBack} className="btn-icon" disabled={status === 'preparing'}>&larr; Volver</button>
        <h2>Enviar {isStellar ? 'XLM' : 'SOL'}</h2>
        <span style={{ width: 52 }} />
      </div>

      <div style={{ display: 'grid', gap: 12, overflowY: 'auto', minHeight: 0 }}>
        <section className="card" style={{ padding: 14, display: 'grid', gap: 12 }}>
          <label style={{ display: 'grid', gap: 6, fontSize: '0.85rem' }}>
            Activo
            <div className="input-field" aria-label="Activo seleccionado">
              {isStellar ? (
                <>XLM <span className="text-secondary" style={{ float: 'right' }}>Stellar Testnet</span></>
              ) : (
                <>SOL <span className="text-secondary" style={{ float: 'right' }}>SPL no disponible</span></>
              )}
            </div>
          </label>
          {onUsePrivatePayment ? (
            <button type="button" className="btn-secondary" data-testid="use-spp-private-payment" onClick={onUsePrivatePayment}>
              Pago privado SPP (Nym)
            </button>
          ) : null}
          <label style={{ display: 'grid', gap: 6, fontSize: '0.85rem' }}>
            Destinatario
            <input
              type="text"
              autoComplete="off"
              spellCheck={false}
              inputMode="text"
              placeholder={isStellar ? 'Dirección Stellar (G...)' : 'Dirección Solana'}
              value={destination}
              aria-invalid={Boolean(destination) && Boolean(currentInputError)}
              onChange={(event) => { setDestination(event.target.value); setError(null); }}
              disabled={status === 'preparing'}
              className="input-field"
              style={{ width: '100%', minWidth: 0, fontFamily: 'monospace', fontSize: '0.78rem' }}
            />
          </label>
          <label style={{ display: 'grid', gap: 6, fontSize: '0.85rem' }}>
            Importe ({isStellar ? 'XLM' : 'SOL'})
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                value={amountSol}
                aria-invalid={Boolean(amountSol) && Boolean(currentInputError)}
                onChange={(event) => { setAmountSol(event.target.value); setError(null); }}
                disabled={status === 'preparing'}
                className="input-field"
                style={{ width: '100%', minWidth: 0 }}
              />
              <button
                type="button"
                onClick={handleMax}
                disabled={balanceLoading || estimating || isSubmitting || status === 'preparing'}
                className="btn-secondary"
                style={{ padding: '8px 10px' }}
              >
                Máximo
              </button>
            </div>
          </label>
          {isStellar && (
            <label style={{ display: 'grid', gap: 6, fontSize: '0.85rem' }}>
              Memo (opcional, máx 28 car.)
              <input
                type="text"
                autoComplete="off"
                spellCheck={false}
                maxLength={28}
                placeholder="Texto opcional"
                value={memo}
                onChange={(event) => setMemo(event.target.value)}
                disabled={status === 'preparing'}
                className="input-field"
                style={{ width: '100%', minWidth: 0 }}
              />
            </label>
          )}
          <div style={{ minHeight: 18, display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: '0.76rem' }}>
            <span className="text-secondary">Saldo disponible</span>
            <span>
              {balanceLoading
                ? 'Consultando…'
                : isStellar
                  ? balanceXlm === null ? 'No disponible' : `${balanceXlm} XLM`
                  : balanceLamports === null ? 'No disponible' : `${formatLamportsAsSol(BigInt(balanceLamports))} SOL`}
            </span>
          </div>
          {balanceError && <p role="alert" className="error-text" style={{ margin: 0, fontSize: '0.8rem' }}>No se pudo verificar el saldo: {balanceError}</p>}
        </section>

        {error && <p role="alert" className="error-text" style={{ margin: 0 }}>{error}</p>}
        {currentInputError && (destination || amountSol) && <p role="alert" className="error-text" style={{ margin: 0, fontSize: '0.8rem' }}>{currentInputError}</p>}

        <section className="card" aria-live="polite" style={{ padding: 14, display: 'grid', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: '0.94rem' }}>Resumen estimado</h3>
          {estimating ? (
            <p className="text-secondary" style={{ margin: 0 }}>Calculando importe y comisión…</p>
          ) : isStellar && stellarEstimate ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>Importe</span><span>{stellarEstimate.amountXlm} XLM</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>Comisión de red</span><span>{stellarEstimate.feeXlm} XLM</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span>Tipo de operación</span>
                <span style={{ color: 'var(--accent-color)' }}>
                  {stellarEstimate.destinationExists ? 'Pago existente' : 'Crear cuenta (nueva)'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, paddingTop: 6, borderTop: '1px solid var(--border-dark)', fontWeight: 700 }}>
                <span>Total estimado</span>
                <span>{(Number(stellarEstimate.amountXlm) + Number(stellarEstimate.feeXlm)).toFixed(7)} XLM</span>
              </div>
              <p className="text-secondary" style={{ margin: 0, fontSize: '0.72rem' }}>Reserva mínima de cuenta: 1 XLM. Operación en Stellar Testnet.</p>
            </>
          ) : !isStellar && totals ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>Importe</span><span>{formatLamportsAsSol(totals.amount)} SOL</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>Comisión de red (SOL)</span><span>{formatLamportsAsSol(totals.fee)} SOL</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, paddingTop: 6, borderTop: '1px solid var(--border-dark)', fontWeight: 700 }}><span>Total estimado</span><span>{formatLamportsAsSol(totals.total)} SOL</span></div>
              {!totals.sufficient && <p role="alert" className="error-text" style={{ margin: 0 }}>Saldo insuficiente para cubrir el importe y la comisión.</p>}
            </>
          ) : (
            <p className="text-secondary" style={{ margin: 0 }}>{estimateError || (currentInputError ? 'Introduce un destinatario y un importe válidos.' : 'Comisión no disponible hasta completar los datos.')}</p>
          )}
        </section>

        <div aria-live="polite" className="text-secondary" style={{ minHeight: 18, fontSize: '0.76rem' }}>{status !== 'idle' ? statusText[status] : ''}</div>
        <button
          type="button"
          onClick={handleReview}
          disabled={!isFormReady}
          className="btn-primary"
          style={{ width: '100%' }}
        >
          {status === 'preparing' ? 'Preparando…' : 'Revisar envío'}
        </button>
        {estimateError && <p role="alert" className="error-text" style={{ margin: 0, fontSize: '0.76rem' }}>No se puede enviar sin una comisión fiable: {estimateError}</p>}
      </div>
    </div>
  );
}
