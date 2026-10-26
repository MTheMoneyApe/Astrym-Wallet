import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  Send,
  resolveStellarSendFailure,
  validateXlmTransferInput,
  validateStellarMemo,
} from '../../src/popup/Send.js';

vi.mock('../../src/popup/ipc.js', () => ({ sendIpcMessage: vi.fn().mockResolvedValue({}) }));

const STELLAR_SOURCE = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const STELLAR_DESTINATION = 'GDOOZOX54XD7PAOHO6EXLH4OZC4JRBU4HLRM5RBD7A2DRBZJFDPFPBRE';

describe('Send XLM screen (Stellar mode)', () => {
  it('renders the Stellar send fields with XLM labels, memo input, and Testnet badge', () => {
    const markup = renderToStaticMarkup(React.createElement(Send, {
      onBack: vi.fn(),
      accountIndex: 0,
      accountAddress: STELLAR_SOURCE,
      onComplete: vi.fn(),
    }));

    expect(markup).toContain('Enviar XLM');
    expect(markup).toContain('Stellar Testnet');
    expect(markup).toContain('Dirección Stellar (G...)');
    expect(markup).toContain('Importe (XLM)');
    expect(markup).toContain('Memo (opcional, máx 28 car.)');
    expect(markup).toContain('Máximo');
    expect(markup).toContain('Saldo disponible');
    expect(markup).toContain('Resumen estimado');
    expect(markup).not.toContain('SPL no disponible');
  });

  it('validates Stellar recipient and XLM amount correctly', () => {
    expect(validateXlmTransferInput(STELLAR_DESTINATION, '10.5', STELLAR_SOURCE)).toBeNull();
    expect(validateXlmTransferInput('', '1', STELLAR_SOURCE)).toContain('destinataria de Stellar');
    expect(validateXlmTransferInput('invalid-address', '1', STELLAR_SOURCE)).toContain('StrKey G...');
    expect(validateXlmTransferInput(STELLAR_SOURCE, '1', STELLAR_SOURCE)).toContain('misma que la cuenta de origen');
    expect(validateXlmTransferInput(STELLAR_DESTINATION, '', STELLAR_SOURCE)).toContain('importe en XLM');
    expect(validateXlmTransferInput(STELLAR_DESTINATION, '0', STELLAR_SOURCE)).toContain('mayor que cero');
    expect(validateXlmTransferInput(STELLAR_DESTINATION, '-5', STELLAR_SOURCE)).toContain('positivo');
    expect(validateXlmTransferInput(STELLAR_DESTINATION, '1.12345678', STELLAR_SOURCE)).toContain('hasta 7 decimales');
    expect(validateXlmTransferInput(STELLAR_DESTINATION, '1.1234567', STELLAR_SOURCE)).toBeNull();
  });

  it('validates Stellar memo length byte limit (28 bytes)', () => {
    expect(validateStellarMemo('')).toBeNull();
    expect(validateStellarMemo('Short memo')).toBeNull();
    expect(validateStellarMemo('1234567890123456789012345678')).toBeNull(); // 28 chars ASCII
    expect(validateStellarMemo('12345678901234567890123456789')).toContain('no puede superar los 28 bytes'); // 29 chars ASCII
  });

  it('on StellarFeeChangedError clears review, returns to idle, and asks the user to review again', () => {
    const feeErr = new Error('Network base fee (500 stroops) exceeds approved fee (100 stroops).');
    feeErr.name = 'StellarFeeChangedError';

    expect(resolveStellarSendFailure(feeErr)).toEqual({
      clearStellarReview: true,
      status: 'idle',
      errorMessage: 'La comisión de red cambió. Vuelve a revisar la operación.',
    });
  });

  it('on other send errors keeps the review screen path (unknown) without clearing via fee policy', () => {
    const netErr = new Error('Horizon unreachable');
    netErr.name = 'Error';

    expect(resolveStellarSendFailure(netErr)).toEqual({
      clearStellarReview: false,
      status: 'unknown',
      errorMessage: 'Horizon unreachable',
    });
  });
});
