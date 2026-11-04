/**
 * UI router for Stellar Private Payments inside Send.
 * Maps protocol outcomes to explicit wallet states; never falls back to public send.
 */

import type { SppPrivateOperation } from '@solanym/wallet-core/src/stellar/spp/sppNymOption.js';

export type PrivatePaymentUiStatus =
  | 'idle'
  | 'initializing'
  | 'ready'
  | 'insufficient_balance'
  | 'awaiting_authorization'
  | 'sending'
  | 'sent'
  | 'confirmed'
  | 'failed'
  | 'unknown';

export type PrivatePaymentRouteInput = {
  nymConnected: boolean;
  nymMode: 'direct' | 'nym';
  sppSelected: boolean;
  preparePhase: string;
  operation: SppPrivateOperation;
  hasDestination: boolean;
  hasAmount: boolean;
  authorized: boolean;
  inFlight: boolean;
  lastTxHash: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
};

export type PrivatePaymentRoute = {
  status: PrivatePaymentUiStatus;
  canAuthorize: boolean;
  canSubmit: boolean;
  /** True when UI must not offer a silent clearnet retry for this failure. */
  blockPublicFallback: boolean;
  message: string;
};

export function routePrivatePayment(input: PrivatePaymentRouteInput): PrivatePaymentRoute {
  const blockPublicFallback = true;

  if (!(input.nymMode === 'nym' && input.nymConnected && input.sppSelected)) {
    return {
      status: 'idle',
      canAuthorize: false,
      canSubmit: false,
      blockPublicFallback,
      message: 'Conecta Nym y activa pagos privados para continuar.',
    };
  }

  if (input.preparePhase === 'failed') {
    return {
      status: 'failed',
      canAuthorize: false,
      canSubmit: false,
      blockPublicFallback,
      message: input.lastErrorMessage ?? 'La preparación SPP falló. No se enviará por clearnet.',
    };
  }

  if (input.preparePhase !== 'ready') {
    return {
      status: 'initializing',
      canAuthorize: false,
      canSubmit: false,
      blockPublicFallback,
      message: 'Preparando Stellar Private Payments en segundo plano…',
    };
  }

  if (input.lastErrorCode === 'unknown' || input.lastErrorCode === 'SUBMISSION_UNKNOWN') {
    return {
      status: 'unknown',
      canAuthorize: false,
      canSubmit: false,
      blockPublicFallback,
      message:
        input.lastErrorMessage ??
        'Resultado desconocido. Verifica el estado de la transacción antes de reintentar.',
    };
  }

  if (input.lastTxHash && !input.inFlight && !input.lastErrorCode) {
    return {
      status: 'confirmed',
      canAuthorize: false,
      canSubmit: false,
      blockPublicFallback,
      message: 'Pago privado confirmado (hash disponible).',
    };
  }

  if (input.inFlight) {
    return {
      status: input.authorized ? 'sending' : 'awaiting_authorization',
      canAuthorize: false,
      canSubmit: false,
      blockPublicFallback,
      message: input.authorized
        ? 'Enviando por Nym (Soroban). Sin fallback a Horizon público.'
        : 'Esperando autorización…',
    };
  }

  if (input.lastErrorCode) {
    const insufficient =
      /insufficient|saldo/i.test(input.lastErrorMessage ?? '') ||
      input.lastErrorCode === 'INSUFFICIENT_BALANCE';
    return {
      status: insufficient ? 'insufficient_balance' : 'failed',
      canAuthorize: false,
      canSubmit: false,
      blockPublicFallback,
      message:
        input.lastErrorMessage ??
        'El pago privado falló. No se convertirá automáticamente en un pago público.',
    };
  }

  const needsRecipient = input.operation === 'transfer' || input.operation === 'withdraw';
  const formOk =
    input.hasAmount && (!needsRecipient || input.hasDestination || input.operation === 'withdraw');

  if (!formOk) {
    return {
      status: 'ready',
      canAuthorize: false,
      canSubmit: false,
      blockPublicFallback,
      message: 'Introduce importe y, si aplica, destinatario.',
    };
  }

  if (!input.authorized) {
    return {
      status: 'awaiting_authorization',
      canAuthorize: true,
      canSubmit: false,
      blockPublicFallback,
      message: 'Revisa y autoriza el movimiento de fondos privado.',
    };
  }

  return {
    status: 'ready',
    canAuthorize: false,
    canSubmit: true,
    blockPublicFallback,
    message: 'Autorizado. Confirma para ejecutar el pago privado.',
  };
}
