import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  whenPrivacyReady: vi.fn(),
  refreshStatus: vi.fn(),
  setMode: vi.fn(),
  syncGatewayConfigUi: vi.fn(),
  getSnapshot: vi.fn(),
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

describe('Nym handlers do not auto-open SPP host', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connect.mockResolvedValue(connectedSnapshot);
    mocks.whenPrivacyReady.mockResolvedValue(undefined);
    mocks.refreshStatus.mockResolvedValue(connectedSnapshot);
    mocks.setMode.mockResolvedValue(undefined);
    mocks.syncGatewayConfigUi.mockResolvedValue(undefined);
    mocks.getSnapshot.mockReturnValue(connectedSnapshot);
    mocks.getNymRuntimeController.mockReturnValue({
      connect: mocks.connect,
      whenPrivacyReady: mocks.whenPrivacyReady,
      refreshStatus: mocks.refreshStatus,
      setMode: mocks.setMode,
      syncGatewayConfigUi: mocks.syncGatewayConfigUi,
      getSnapshot: mocks.getSnapshot,
    });
    mocks.ensureSppAutoPrepareIfNeeded.mockResolvedValue(null);
  });

  it('does not auto-prepare or open spp-host on NYM_CONNECT even when connected in Nym mode', async () => {
    const { createNymConnectHandler } =
      await import('../../../src/background/handlers/nymHandlers.js');

    const result = await createNymConnectHandler()({} as never);

    expect(result.connected).toBe(true);
    expect(result.mode).toBe('nym');
    expect(mocks.ensureSppAutoPrepareIfNeeded).not.toHaveBeenCalled();
  });

  it('does not auto-prepare on NYM_STATUS or NYM_SET_MODE(nym)', async () => {
    const { createNymStatusHandler, createNymSetModeHandler } =
      await import('../../../src/background/handlers/nymHandlers.js');

    await createNymStatusHandler()({} as never);
    await createNymSetModeHandler()({ mode: 'nym' });

    expect(mocks.ensureSppAutoPrepareIfNeeded).not.toHaveBeenCalled();
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
