// @vitest-environment jsdom

import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: { sendMessage: vi.fn() },
  },
}));

vi.mock('../../src/popup/ipc.js', () => ({
  sendIpcMessage: vi.fn(async () => ({})),
}));

import { PopupErrorBoundary } from '../../src/popup/App.js';

function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Simulated Send view render failure');
  }
  return React.createElement('div', { 'data-testid': 'healthy-view' }, 'OK');
}

describe('PopupErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('catches unexpected render errors, displays the message, and recovers via Volver al inicio', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onReset = vi.fn();
    let shouldThrow = true;

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        React.createElement(
          PopupErrorBoundary,
          { onReset },
          React.createElement(ThrowingChild, { shouldThrow }),
        ),
      );
    });

    expect(container.querySelector('[data-testid="popup-error-boundary"]')).not.toBeNull();
    expect(container.textContent).toContain('Simulated Send view render failure');
    const resetBtn = container.querySelector(
      '[data-testid="popup-error-reset"]',
    ) as HTMLButtonElement | null;
    expect(resetBtn).not.toBeNull();
    expect(resetBtn?.textContent).toBe('Volver al inicio');

    shouldThrow = false;
    await act(async () => {
      root.render(
        React.createElement(
          PopupErrorBoundary,
          { onReset },
          React.createElement(ThrowingChild, { shouldThrow }),
        ),
      );
      resetBtn?.click();
    });

    expect(onReset).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-testid="healthy-view"]')?.textContent).toBe('OK');

    await act(async () => {
      root.unmount();
    });
    consoleErrorSpy.mockRestore();
  });
});
