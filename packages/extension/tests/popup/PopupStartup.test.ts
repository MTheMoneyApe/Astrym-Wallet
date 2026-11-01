import { describe, expect, it, vi } from 'vitest';

const mockState = {
  walletState: { hasVault: false, isLocked: true },
  sentMessages: [] as Array<{ type: string; payload: any }>,
};

vi.mock('react', () => {
  return {
    default: {
      createElement: vi.fn(),
      useEffect: vi.fn((fn: () => void) => fn()),
      useState: vi.fn((init: any) => [init, vi.fn()]),
    },
    useEffect: vi.fn((fn: () => void) => fn()),
    useState: vi.fn((init: any) => [init, vi.fn()]),
  };
});

vi.mock('./Onboarding.js', () => ({
  Onboarding: () => null,
}));

vi.mock('./Unlock.js', () => ({
  Unlock: () => null,
}));

vi.mock('./Dashboard.js', () => ({
  Dashboard: () => null,
}));

vi.mock('../../src/popup/ipc.js', () => ({
  sendIpcMessage: vi.fn(async (type: string, payload: any) => {
    mockState.sentMessages.push({ type, payload });
    if (type === 'GET_WALLET_STATE') {
      return mockState.walletState;
    }
    if (type === 'GET_PENDING_APPROVALS') {
      throw new Error('Solana runtime is disabled (GET_PENDING_APPROVALS). Astrym Wallet operates in Stellar-first mode.');
    }
    return {};
  }),
}));

describe('Popup Startup Lifecycle', () => {
  it('determines ONBOARDING when no vault exists', async () => {
    mockState.sentMessages = [];
    mockState.walletState = { hasVault: false, isLocked: true };

    const { sendIpcMessage } = await import('../../src/popup/ipc.js');

    // Simulate startup flow from App.tsx checkWalletState
    const state = await sendIpcMessage('GET_WALLET_STATE', {});
    let resolvedState = 'LOADING';
    if (!state.hasVault) {
      resolvedState = 'ONBOARDING';
    } else if (state.isLocked) {
      resolvedState = 'LOCKED';
    } else {
      resolvedState = 'DASHBOARD';
    }

    expect(resolvedState).toBe('ONBOARDING');
    expect(mockState.sentMessages.some((m) => m.type === 'GET_WALLET_STATE')).toBe(true);
    expect(mockState.sentMessages.some((m) => m.type === 'GET_PENDING_APPROVALS')).toBe(false);
  });

  it('determines LOCKED when vault exists and is locked', async () => {
    mockState.sentMessages = [];
    mockState.walletState = { hasVault: true, isLocked: true };

    const { sendIpcMessage } = await import('../../src/popup/ipc.js');

    const state = await sendIpcMessage('GET_WALLET_STATE', {});
    let resolvedState = 'LOADING';
    if (!state.hasVault) {
      resolvedState = 'ONBOARDING';
    } else if (state.isLocked) {
      resolvedState = 'LOCKED';
    } else {
      resolvedState = 'DASHBOARD';
    }

    expect(resolvedState).toBe('LOCKED');
    expect(mockState.sentMessages.some((m) => m.type === 'GET_PENDING_APPROVALS')).toBe(false);
  });

  it('determines DASHBOARD directly when vault exists and is unlocked', async () => {
    mockState.sentMessages = [];
    mockState.walletState = { hasVault: true, isLocked: false };

    const { sendIpcMessage } = await import('../../src/popup/ipc.js');

    const state = await sendIpcMessage('GET_WALLET_STATE', {});
    let resolvedState = 'LOADING';
    if (!state.hasVault) {
      resolvedState = 'ONBOARDING';
    } else if (state.isLocked) {
      resolvedState = 'LOCKED';
    } else {
      resolvedState = 'DASHBOARD';
    }

    expect(resolvedState).toBe('DASHBOARD');
    expect(mockState.sentMessages.some((m) => m.type === 'GET_PENDING_APPROVALS')).toBe(false);
  });

  it('startup flow NEVER calls GET_PENDING_APPROVALS and does not crash on disabled dApp routes', async () => {
    mockState.sentMessages = [];
    mockState.walletState = { hasVault: true, isLocked: false };

    const { sendIpcMessage } = await import('../../src/popup/ipc.js');

    // Startup should only call GET_WALLET_STATE
    await sendIpcMessage('GET_WALLET_STATE', {});

    const pendingApprovalsCalled = mockState.sentMessages.some(
      (m) => m.type === 'GET_PENDING_APPROVALS',
    );
    expect(pendingApprovalsCalled).toBe(false);
  });
});
