import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  calculateTransferTotals,
  createSendOperationGate,
  formatLamportsAsSol,
  Send,
  validateSolTransferInput,
} from '../../src/popup/Send.js';

vi.mock('../../src/popup/ipc.js', () => ({ sendIpcMessage: vi.fn() }));

const SOURCE = '4Nd1mBQtrCGZXm3XgMy5b2nStJcQG3FmPkWG3wVvjT8Q';
const DESTINATION = '9Nd1mBQtrCGZXm3XgMy5b2nStJcQG3FmPkWG3wVvjT8Q';

describe('Send SOL screen', () => {
  it('renders the Solanym send fields and does not present token sending as available', () => {
    const markup = renderToStaticMarkup(React.createElement(Send, {
      onBack: vi.fn(),
      accountIndex: 2,
      accountAddress: SOURCE,
      onComplete: vi.fn(),
    }));

    expect(markup).toContain('Enviar');
    expect(markup).toContain('Destinatario');
    expect(markup).toContain('Importe (SOL)');
    expect(markup).toContain('Máximo');
    expect(markup).toContain('Saldo disponible');
    expect(markup).toContain('Resumen estimado');
    expect(markup).toContain('SPL no disponible');
    expect(markup).toContain('Consultando…');
  });

  it('validates recipient and exact SOL amount input', () => {
    expect(validateSolTransferInput(DESTINATION, '0.125')).toBeNull();
    expect(validateSolTransferInput('', '1')).toContain('destinataria');
    expect(validateSolTransferInput('not-an-address', '1')).toContain('no es válida');
    expect(validateSolTransferInput(DESTINATION, '1e-3')).toContain('importe SOL');
    expect(validateSolTransferInput(DESTINATION, '0')).toContain('importe SOL');
  });

  it('formats lamports exactly without floating point conversion', () => {
    expect(formatLamportsAsSol(1n)).toBe('0.000000001');
    expect(formatLamportsAsSol(1_234_567_890n)).toBe('1.23456789');
    expect(formatLamportsAsSol(2_000_000_000n)).toBe('2');
  });

  it('calculates amount, fee, total, and available SOL sufficiency exactly', () => {
    expect(calculateTransferTotals('9000', '1000', '10000')).toEqual({
      amount: 9000n,
      fee: 1000n,
      total: 10000n,
      balance: 10000n,
      sufficient: true,
    });
    expect(calculateTransferTotals('9001', '1000', '10000').sufficient).toBe(false);
  });

  it('prevents overlapping review or send actions until the current action releases', () => {
    const gate = createSendOperationGate();

    expect(gate.acquire()).toBe(true);
    expect(gate.acquire()).toBe(false);
    gate.release();
    expect(gate.acquire()).toBe(true);
  });
});
