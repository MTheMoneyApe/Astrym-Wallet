/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getNethermindPublicTestnetContractConfig } from '@solanym/wallet-core/src/stellar/spp/nethermind/nethermindPublicTestnet.js';
import { sppKeyDerivationMessage } from '@solanym/wallet-core/src/stellar/spp/sppSignGate.js';

const sendMessage = vi.hoisted(() => vi.fn());

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: {
      sendMessage: (...args: unknown[]) => sendMessage(...args),
    },
  },
}));

import { SppAccountPanel } from '../../src/popup/SppAccountPanel.js';

const HELD_NOTE = 'Registro retenido: aún no hay firma Registration v1';

describe('SppAccountPanel register', () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    sendMessage.mockReset();
  });

  it('holds the v3 review after two clicks when the real IPC error carries the broadcast code', async () => {
    sendMessage.mockResolvedValue({
      id: 'register-held',
      type: 'SPP_REGISTER_PUBLIC_KEYS',
      error: {
        name: 'UNAUTHORIZED',
        message: 'SPP_BROADCAST_AWAITING_APPROVAL',
        code: 'BROADCAST_AWAITING_APPROVAL',
      },
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(
        <SppAccountPanel preparePhase="ready" nymConnected prepareGeneration={1} />,
      );
    });

    const button = host.querySelector('[data-testid="spp-account-register"]') as HTMLButtonElement;
    const v3 = sppKeyDerivationMessage(getNethermindPublicTestnetContractConfig().kdf_domain);
    expect(host.querySelector('[data-spp-register-state="idle"]')).not.toBeNull();

    await act(async () => {
      button.click();
    });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="spp-register-message"]')?.textContent).toContain(v3);

    await act(async () => {
      button.click();
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll('[data-spp-register-state]')).toHaveLength(1);
    expect(host.querySelector('[data-spp-register-state="sign-blocked"]')).not.toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toContain(HELD_NOTE);
    expect(host.querySelector('[data-testid="spp-register-message"]')?.textContent).toContain(v3);
    expect(host.querySelector('[data-testid="spp-account-error"]')).toBeNull();
    expect(host.textContent).not.toContain('on-chain ok');
    expect(host.textContent).not.toContain('broadcast apagado');

    const fields = [...host.querySelectorAll('input, textarea')];
    expect(fields).toHaveLength(1);
    expect(fields[0]?.getAttribute('data-testid')).toBe('spp-lookup-address');

    const cancel = host.querySelector('[data-testid="spp-register-cancel"]') as HTMLButtonElement;
    expect(cancel.disabled).toBe(false);
    await act(async () => {
      cancel.click();
    });
    expect(host.querySelector('[data-testid="spp-register-review"]')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent ?? '').not.toContain(HELD_NOTE);
    expect(host.querySelector('[data-spp-register-state="idle"]')).not.toBeNull();
  });

  it('disables cancel while the register request is in flight', async () => {
    let resolveSend: (value: unknown) => void = () => {};
    sendMessage.mockImplementation(
      () => new Promise((resolve) => {
        resolveSend = resolve;
      }),
    );
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(
        <SppAccountPanel preparePhase="ready" nymConnected prepareGeneration={1} />,
      );
    });
    const button = host.querySelector('[data-testid="spp-account-register"]') as HTMLButtonElement;
    await act(async () => {
      button.click();
    });
    await act(async () => {
      button.click();
    });
    const cancel = host.querySelector('[data-testid="spp-register-cancel"]') as HTMLButtonElement;
    expect(cancel.disabled).toBe(true);
    expect(host.querySelector('[data-spp-register-state="busy"]')).not.toBeNull();
    await act(async () => {
      resolveSend({
        id: 'register-held',
        type: 'SPP_REGISTER_PUBLIC_KEYS',
        error: {
          name: 'UNAUTHORIZED',
          message: 'SPP_BROADCAST_AWAITING_APPROVAL',
          code: 'BROADCAST_AWAITING_APPROVAL',
        },
      });
    });
    expect((host.querySelector('[data-testid="spp-register-cancel"]') as HTMLButtonElement).disabled).toBe(false);
  });
});
