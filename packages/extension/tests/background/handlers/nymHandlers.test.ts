import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  getNymRuntimeController: vi.fn(),
  ensureSppAutoPrepareIfNeeded: vi.fn(),
  clearSppAutoPrepareOnNymDisconnect: vi.fn(),
  clearSppPrivatePool: vi.fn(),
  revokeSppSignApprovals: vi.fn(),
}));

vi.mock('../../../src/background/nym/NymRuntimeController.js', () => ({
  getNymRuntimeController: mocks.getNymRuntimeController,
}));
vi.mock('../../../src/background/spp/sppAutoPrepare.js', () => ({
  clearSppAutoPrepareOnNymDisconnect: mocks.clearSppAutoPrepareOnNymDisconnect,
  ensureSppAutoPrepareIfNeeded: mocks.ensureSppAutoPrepareIfNeeded,
}));
vi.mock('../../../src/background/spp/sppPrivatePoolRegistry.js', () => ({
  clearSppPrivatePool: mocks.clearSppPrivatePool,
}));
vi.mock('@solanym/wallet-core/src/stellar/spp/sppSignGate.js', () => ({
  revokeSppSignApprovals: mocks.revokeSppSignApprovals,
}));
vi.mock('../../../src/background/nym/NymLiveSmoke.js', () => ({
  runNymLiveSmoke: vi.fn(),
}));

const connectedSnapshot = {
  state: 'connected',
  lastError: null,
  connected: true,
  implementation: 'mixfetch',
  selfAddress: null,
  mode: 'nym',
  documentReady: true,
  diagnosticCode: 'OK',
  diagnosticStage: null,
  assetsReady: true,
  gatewayAllowlistConfigured: true,
  selectedGateway: 'wss://gateway.example',
  gatewayIdentityKey: 'gateway-identity-key',
  gatewayHostPermissionGranted: true,
  gatewayHostPermissionPattern: 'wss://gateway.example/*',
};

describe('NYM_CONNECT SPP prepare trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connect.mockResolvedValue(connectedSnapshot);
    mocks.getNymRuntimeController.mockReturnValue({ connect: mocks.connect });
    mocks.ensureSppAutoPrepareIfNeeded.mockResolvedValue(null);
  });

  it('uses the idempotent prepare entry only after Nym is connected in Nym mode', async () => {
    const { createNymConnectHandler } =
      await import('../../../src/background/handlers/nymHandlers.js');

    await createNymConnectHandler()({} as never);

    expect(mocks.ensureSppAutoPrepareIfNeeded).toHaveBeenCalledTimes(1);
    expect(mocks.ensureSppAutoPrepareIfNeeded).toHaveBeenCalledWith({
      nymConnected: true,
      nymMode: 'nym',
    });
  });

  it('does not start SPP preparation when Nym connection did not become ready', async () => {
    mocks.connect.mockResolvedValue({
      ...connectedSnapshot,
      state: 'error',
      connected: false,
    });
    const { createNymConnectHandler } =
      await import('../../../src/background/handlers/nymHandlers.js');

    await createNymConnectHandler()({} as never);

    expect(mocks.ensureSppAutoPrepareIfNeeded).not.toHaveBeenCalled();
  });
});
