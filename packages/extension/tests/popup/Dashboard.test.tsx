import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createNymStatusRequestCoordinator,
  requestNymStatus,
  sendIpcMessage,
} from '../../src/popup/ipc.js';
import {
  AccountMenu,
  Dashboard,
  createAccountOperationGate,
  copyPublicAddress,
  coerceNymUiSnapshot,
  hasConfirmedTransportPreference,
  dismissAccountMenuOnEscape,
  formatPublicAddress,
  includeCreatedAccount,
  isCurrentBalanceResponse,
  resolveRestoredAccountSelection,
  selectMenuAccount,
} from '../../src/popup/Dashboard.js';

const hookHarness = vi.hoisted(() => ({
  active: false,
  index: 0,
  slots: [] as Array<{
    kind: string;
    value?: unknown;
    deps: React.DependencyList | undefined;
    cleanup: (() => void) | undefined;
  }>,
  pendingEffects: [] as Array<{ index: number; callback: () => void | (() => void) }>,
}));
type DashboardHarnessInstance = {
  slots: typeof hookHarness.slots;
  pendingEffects: typeof hookHarness.pendingEffects;
};
const concurrentDashboardInstances: DashboardHarnessInstance[] = [];

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const sameDependencies = (
    left: React.DependencyList | undefined,
    right: React.DependencyList | undefined,
  ) =>
    left !== undefined &&
    right !== undefined &&
    left.length === right.length &&
    left.every((value, index) => Object.is(value, right[index]));
  const nextSlot = (kind: string) => {
    const index = hookHarness.index++;
    let slot = hookHarness.slots[index];
    if (!slot) {
      slot = { kind, deps: undefined, cleanup: undefined };
      hookHarness.slots[index] = slot;
    }
    return { index, slot };
  };
  return {
    ...actual,
    default: actual,
    useState: (initial: unknown) => {
      if (!hookHarness.active) return actual.useState(initial);
      const { slot } = nextSlot('state');
      if (!('value' in slot)) {
        slot.value = typeof initial === 'function'
          ? (initial as () => unknown)()
          : initial;
      }
      return [
        slot.value,
        (next: unknown) => {
          slot.value = typeof next === 'function'
            ? (next as (previous: unknown) => unknown)(slot.value)
            : next;
        },
      ];
    },
    useRef: (initial: unknown) => {
      if (!hookHarness.active) return actual.useRef(initial);
      const { slot } = nextSlot('ref');
      if (!('value' in slot)) slot.value = { current: initial };
      return slot.value;
    },
    useMemo: (factory: () => unknown, deps?: React.DependencyList) => {
      if (!hookHarness.active) return actual.useMemo(factory, deps ?? []);
      const { slot } = nextSlot('memo');
      if (!('value' in slot) || !sameDependencies(slot.deps, deps)) {
        slot.value = factory();
        slot.deps = deps;
      }
      return slot.value;
    },
    useEffect: (callback: () => void | (() => void), deps?: React.DependencyList) => {
      if (!hookHarness.active) return actual.useEffect(callback, deps);
      const { index, slot } = nextSlot('effect');
      if (!sameDependencies(slot.deps, deps)) {
        slot.cleanup?.();
        slot.cleanup = undefined;
        slot.deps = deps;
        hookHarness.pendingEffects.push({ index, callback });
      }
    },
  };
});

vi.mock('../../src/popup/ipc.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/popup/ipc.js')>();
  return {
    ...actual,
    requestNymStatus: vi.fn(),
    sendIpcMessage: vi.fn(),
  };
});
vi.mock('webextension-polyfill', () => ({
  default: { runtime: { sendMessage: vi.fn() } },
}));
vi.mock('@solanym/wallet-core/src/stellar/spp/SppIntegrationStatus.js', () => ({
  SPP_SESSION_STATUS_STORAGE_KEY: 'spp-session-status',
  SppIntegrationStatus: class {
    snapshot() {
      return {
        availability: 'unavailable',
        capabilities: { private_payments: false, read_only_session: false },
        facadePackaged: false,
        sessionState: null,
        error: null,
      };
    }
  },
  applyStoredSppSessionClearIfNewer: () => ({ applied: false, generation: 0, handle: null }),
  createPopupSppIntegrationProbe: () => ({}),
  describeSppIntegrationAvailability: () => 'Unavailable',
  probeSppFacadePackaged: vi.fn().mockResolvedValue(false),
}));

const accounts = [
  { index: 0, publicKey: '8xK2eFqvDzwsC1mYpd9Yw7GhBm6tR3nK2s4f5v6pQ7mA', label: 'Account 1' },
  { index: 1, publicKey: '9Nd1mBQtrCGZXm3XgMy5b2nStJcQG3FmPkWG3wVvjT8Q', label: 'Account 2' },
];

const baseMenuProps = {
  accounts,
  activeIndex: 0,
  activeAccount: { address: accounts[0]!.publicKey, label: accounts[0]!.label, index: 0 },
  open: false,
  loading: false,
  busy: false,
  error: '',
  notice: '',
  onToggle: vi.fn(),
  onClose: vi.fn(),
  onSelect: vi.fn().mockResolvedValue(true),
  onCreate: vi.fn().mockResolvedValue(true),
  onRename: vi.fn().mockResolvedValue(true),
};

const stellarAccount = {
  index: 0,
  publicKey: `G${'A'.repeat(55)}`,
  label: 'Account 1',
};

type NymSnapshotInput = Parameters<typeof coerceNymUiSnapshot>[0];

function preferenceSnapshot(
  preferredMode: 'direct' | 'nym' | null,
  overrides: Partial<NymSnapshotInput> = {},
): NymSnapshotInput {
  return {
    state: 'disconnected',
    lastError: null,
    connected: false,
    implementation: 'mix-fetch-offscreen',
    mode: 'nym',
    preferredMode,
    preferenceLoaded: true,
    preferenceError: null,
    documentReady: false,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createPopupEventTarget() {
  const listeners = new Map<string, Set<(event?: unknown) => void>>();
  return {
    addEventListener: vi.fn((type: string, listener: (event?: unknown) => void) => {
      const callbacks = listeners.get(type) ?? new Set();
      callbacks.add(listener);
      listeners.set(type, callbacks);
    }),
    removeEventListener: vi.fn((type: string, listener: (event?: unknown) => void) => {
      listeners.get(type)?.delete(listener);
    }),
    dispatch(type: string) {
      for (const listener of listeners.get(type) ?? []) listener({ type });
    },
  };
}

let popupEvents: {
  document: ReturnType<typeof createPopupEventTarget> & { visibilityState: string };
  window: ReturnType<typeof createPopupEventTarget>;
};

function installChromeMocks() {
  const permissions = {
    request: vi.fn(
      (_permissions: { origins: string[] }, callback: (granted: boolean) => void) =>
        callback(true),
    ),
    contains: vi.fn(
      (_permissions: { origins: string[] }, callback: (granted: boolean) => void) =>
        callback(true),
    ),
  };
  vi.stubGlobal('chrome', {
    runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
    permissions,
    storage: {
      local: {
        get: (_keys: unknown, callback: (result: Record<string, unknown>) => void) => callback({}),
        set: vi.fn(),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
  const documentEvents = Object.assign(createPopupEventTarget(), {
    visibilityState: 'visible',
  });
  const windowEvents = createPopupEventTarget();
  vi.stubGlobal('document', documentEvents);
  vi.stubGlobal('window', windowEvents);
  popupEvents = { document: documentEvents, window: windowEvents };
  return { permissions, events: popupEvents };
}

function configureDashboardIpc(
  statusResponse: unknown | Promise<unknown>,
  overrides: Record<string, unknown> = {},
) {
  vi.mocked(sendIpcMessage).mockImplementation((async (type: string, payload: unknown) => {
    const responseOverrides = overrides['responses'] as Record<string, unknown> | undefined;
    const responseOverride = responseOverrides?.[type];
    if (responseOverride !== undefined) {
      return typeof responseOverride === 'function'
        ? await (responseOverride as (payload: unknown) => unknown)(payload)
        : await responseOverride;
    }
    if (type === 'NYM_STATUS') return await statusResponse;
    if (type === 'GET_ACCOUNTS') return [stellarAccount];
    if (type === 'GET_ACTIVE_ACCOUNT') return { status: 'VALID', index: 0 };
    if (type === 'GET_STELLAR_BALANCE') return { exists: true, balance: '42.5' };
    if (type === 'GET_AUTO_LOCK_TIMEOUT') return { timeoutMinutes: 5 };
    if (type === 'NYM_SET_MODE') {
      const responder = overrides['setMode'] as ((mode: 'direct' | 'nym') => unknown) | undefined;
      if (responder) return await responder((payload as { mode: 'direct' | 'nym' }).mode);
      const mode = (overrides['setModeResponse'] as { preferredMode?: string } | undefined)
        ?.preferredMode;
      return mode ? preferenceSnapshot(mode as 'direct' | 'nym') : preferenceSnapshot(null);
    }
    return {};
  }) as typeof sendIpcMessage);
  vi.mocked(requestNymStatus).mockImplementation(
    createNymStatusRequestCoordinator(() => sendIpcMessage('NYM_STATUS', {})),
  );
}

function renderDashboardHook() {
  hookHarness.active = true;
  hookHarness.index = 0;
  hookHarness.pendingEffects = [];
  try {
    return Dashboard({ onLock: vi.fn() });
  } finally {
    hookHarness.active = false;
  }
}

function createDashboardHarnessInstance(): DashboardHarnessInstance {
  const instance = { slots: [], pendingEffects: [] } as DashboardHarnessInstance;
  concurrentDashboardInstances.push(instance);
  return instance;
}

function renderDashboardInstance(instance: DashboardHarnessInstance) {
  const previousSlots = hookHarness.slots;
  const previousPendingEffects = hookHarness.pendingEffects;
  const previousIndex = hookHarness.index;
  hookHarness.slots = instance.slots;
  hookHarness.pendingEffects = instance.pendingEffects;
  hookHarness.index = 0;
  hookHarness.active = true;
  try {
    return Dashboard({ onLock: vi.fn() });
  } finally {
    instance.slots = hookHarness.slots;
    instance.pendingEffects = hookHarness.pendingEffects;
    hookHarness.active = false;
    hookHarness.slots = previousSlots;
    hookHarness.pendingEffects = previousPendingEffects;
    hookHarness.index = previousIndex;
  }
}

async function flushDashboardInstanceEffects(instance: DashboardHarnessInstance) {
  const previousSlots = hookHarness.slots;
  const previousPendingEffects = hookHarness.pendingEffects;
  const previousIndex = hookHarness.index;
  hookHarness.slots = instance.slots;
  hookHarness.pendingEffects = instance.pendingEffects;
  hookHarness.index = 0;
  try {
    await flushDashboardEffects();
    instance.slots = hookHarness.slots;
    instance.pendingEffects = hookHarness.pendingEffects;
  } finally {
    hookHarness.slots = previousSlots;
    hookHarness.pendingEffects = previousPendingEffects;
    hookHarness.index = previousIndex;
  }
}

async function openDashboardInstanceSettings(instance: DashboardHarnessInstance) {
  let root = renderDashboardInstance(instance);
  await flushDashboardInstanceEffects(instance);
  root = renderDashboardInstance(instance);
  const settingsButton = findButtonByText(root, 'Settings');
  if (!settingsButton || typeof settingsButton.props['onClick'] !== 'function') {
    throw new Error('Settings button was not found');
  }
  (settingsButton.props['onClick'] as () => void)();
  renderDashboardInstance(instance);
  await flushDashboardInstanceEffects(instance);
  return renderDashboardInstance(instance);
}

function unmountDashboardInstance(instance: DashboardHarnessInstance) {
  for (const slot of instance.slots) slot.cleanup?.();
  instance.slots = [];
  instance.pendingEffects = [];
}

function resetDashboardHookHarness() {
  for (const slot of hookHarness.slots) slot.cleanup?.();
  hookHarness.active = false;
  hookHarness.index = 0;
  hookHarness.slots = [];
  hookHarness.pendingEffects = [];
}

async function flushDashboardEffects() {
  const effects = hookHarness.pendingEffects.splice(0);
  for (const effect of effects) {
    const cleanup = effect.callback();
    if (typeof cleanup === 'function') {
      hookHarness.slots[effect.index]!.cleanup = cleanup;
    }
  }
  if (vi.isFakeTimers()) {
    await vi.advanceTimersByTimeAsync(0);
  } else {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function findTestElement(node: unknown, testId: string): { props: Record<string, unknown> } | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const match = findTestElement(item, testId);
      if (match) return match;
    }
    return null;
  }
  if (!node || typeof node !== 'object' || !('props' in node)) return null;
  const element = node as { props: Record<string, unknown> };
  if (element.props['data-testid'] === testId) return element;
  return findTestElement(element.props['children'], testId);
}

function elementText(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(elementText).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    return elementText((node as { props: Record<string, unknown> }).props['children']);
  }
  return '';
}

function findButtonByText(node: unknown, text: string): { props: Record<string, unknown> } | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const match = findButtonByText(item, text);
      if (match) return match;
    }
    return null;
  }
  if (!node || typeof node !== 'object' || !('type' in node) || !('props' in node)) {
    return null;
  }
  const element = node as { type: unknown; props: Record<string, unknown> };
  if (element.type === 'button' && elementText(element.props['children']).trim() === text) {
    return { props: element.props };
  }
  return findButtonByText(element.props['children'], text);
}

function findComponentElement(
  node: unknown,
  componentName: string,
): { props: Record<string, unknown> } | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const match = findComponentElement(item, componentName);
      if (match) return match;
    }
    return null;
  }
  if (!node || typeof node !== 'object' || !('type' in node) || !('props' in node)) {
    return null;
  }
  const element = node as { type: unknown; props: Record<string, unknown> };
  if (typeof element.type === 'function' && element.type.name === componentName) {
    return { props: element.props };
  }
  return findComponentElement(element.props['children'], componentName);
}

async function clickTestButton(root: unknown, testId: string) {
  const element = findTestElement(root, testId);
  if (!element || typeof element.props['onClick'] !== 'function') {
    throw new Error(`Button ${testId} was not found`);
  }
  (element.props['onClick'] as () => unknown)();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function renderDashboardMarkup() {
  return renderToStaticMarkup(renderDashboardHook());
}

async function openNymSettings() {
  const dashboard = renderDashboardHook();
  const settingsButton = findButtonByText(dashboard, 'Settings');
  if (!settingsButton || typeof settingsButton.props['onClick'] !== 'function') {
    throw new Error('Settings button was not found');
  }
  (settingsButton.props['onClick'] as () => void)();
  renderDashboardHook();
  await flushDashboardEffects();
  return renderDashboardHook();
}

async function invokeNymHttpSmoke() {
  const panel = findComponentElement(renderDashboardHook(), 'NymTransportPanel');
  if (!panel || typeof panel.props['onHttpSmoke'] !== 'function') {
    throw new Error('HTTP Smoke action was not found');
  }
  await (panel.props['onHttpSmoke'] as () => Promise<void>)();
  return renderDashboardHook();
}

function connectedNymSnapshot(revision: number) {
  return preferenceSnapshot('nym', {
    state: 'connected',
    connected: true,
    documentReady: true,
    readinessToken: { controllerEpoch: 'worker-current', readinessRevision: revision },
  });
}

describe('Dashboard account menu', () => {
  afterEach(() => {
    for (const instance of concurrentDashboardInstances) {
      unmountDashboardInstance(instance);
    }
    concurrentDashboardInstances.length = 0;
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resetDashboardHookHarness();
    installChromeMocks();
  });

  it('renders the compact active-account trigger accessibly', () => {
    const markup = renderToStaticMarkup(React.createElement(AccountMenu, baseMenuProps));

    expect(markup).toContain('Account menu, active Account 1');
    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('Account 1');
  });

  it('shows existing accounts, abbreviated addresses, create, and unavailable import when open', () => {
    const markup = renderToStaticMarkup(React.createElement(AccountMenu, { ...baseMenuProps, open: true }));

    expect(markup).toContain('role="menu"');
    expect(markup).toContain('Active account: Account 1');
    expect(markup).toContain('Select account: Account 2');
    expect(markup).toContain('Copy full public address for Account 1');
    expect(markup).toContain('8xK2...Q7mA');
    expect(markup).toContain('9Nd1...jT8Q');
    expect(markup).toContain('Create account');
    expect(markup).toContain('Import account');
    expect(markup).toContain('Account import is not available yet.');
  });

  it('keeps account import disabled and prevents menu actions while busy', () => {
    const markup = renderToStaticMarkup(React.createElement(AccountMenu, { ...baseMenuProps, open: true, busy: true }));

    expect(markup).toContain('Working...');
    expect(markup).toContain('disabled=""');
  });

  it('shows loading and disables account operations before hydration completes', () => {
    const markup = renderToStaticMarkup(React.createElement(AccountMenu, { ...baseMenuProps, open: true, loading: true }));

    expect(markup).toContain('Loading accounts...');
    expect(markup).not.toContain('No accounts yet.');
    expect(markup).toContain('aria-busy="true"');
  });

  it('restores only the backend-confirmed account and leaves INVALID neutral', () => {
    expect(resolveRestoredAccountSelection(accounts, { status: 'VALID', index: 1 }).selectedIndex).toBe(1);
    expect(resolveRestoredAccountSelection(accounts, { status: 'INVALID', index: null }).account).toBeNull();
    expect(resolveRestoredAccountSelection([], { status: 'NONE', index: null }).account).toBeNull();
  });

  it('formats public addresses without exposing more than the requested prefix and suffix', () => {
    expect(formatPublicAddress(accounts[0]!.publicKey)).toBe('8xK2...Q7mA');
  });

  it('copies the complete address and returns the success confirmation', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const selectAccount = vi.fn();

    await expect(copyPublicAddress(accounts[0]!.publicKey, writeText)).resolves.toBe('¡Dirección copiada!');
    expect(writeText).toHaveBeenCalledWith(accounts[0]!.publicKey);
    expect(sendIpcMessage).not.toHaveBeenCalled();
    expect(selectAccount).not.toHaveBeenCalled();
  });

  it('reports clipboard writer failures without swallowing them', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('Clipboard unavailable'));

    await expect(copyPublicAddress(accounts[1]!.publicKey, writeText)).rejects.toThrow('Clipboard unavailable');
    expect(writeText).toHaveBeenCalledWith(accounts[1]!.publicKey);
  });

  it('adds a created account to the list without changing the active account', () => {
    const created = { index: 2, publicKey: '7Nd1mBQtrCGZXm3XgMy5b2nStJcQG3FmPkWG3wVvjT8Q', label: 'Account 3' };

    expect(includeCreatedAccount(accounts, created)).toEqual([...accounts, created]);
    expect(baseMenuProps.activeIndex).toBe(0);
  });

  it('allows only one account mutation at a time', () => {
    const gate = createAccountOperationGate();

    expect(gate.acquire()).toBe(true);
    expect(gate.acquire()).toBe(false);
    gate.release();
    expect(gate.acquire()).toBe(true);
  });

  it('closes and restores focus only after a successful account selection', async () => {
    vi.mocked(sendIpcMessage).mockResolvedValue({ success: true } as never);
    const select = vi.fn(async (index: number) => {
      await sendIpcMessage('SET_ACTIVE_ACCOUNT', { index });
      return true;
    });
    const close = vi.fn();
    const focus = vi.fn();

    await expect(selectMenuAccount(1, select, close, focus)).resolves.toBe(true);
    expect(select).toHaveBeenCalledWith(1);
    expect(sendIpcMessage).toHaveBeenCalledWith('SET_ACTIVE_ACCOUNT', { index: 1 });
    expect(close).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
  });

  it('keeps the menu open when account selection fails', async () => {
    const close = vi.fn();
    const focus = vi.fn();

    await expect(selectMenuAccount(1, vi.fn().mockResolvedValue(false), close, focus)).resolves.toBe(false);
    expect(close).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  });

  it('closes on Escape and returns focus to the trigger', () => {
    const close = vi.fn();
    const focus = vi.fn();

    expect(dismissAccountMenuOnEscape('Escape', close, focus)).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
    expect(dismissAccountMenuOnEscape('Enter', close, focus)).toBe(false);
  });

  it('rejects out-of-order balance responses and responses for a different selection', () => {
    expect(isCurrentBalanceResponse(1, 2, 0, 1)).toBe(false);
    expect(isCurrentBalanceResponse(2, 2, 0, 1)).toBe(false);
    expect(isCurrentBalanceResponse(2, 2, 1, 1)).toBe(true);
    expect(isCurrentBalanceResponse(2, 2, 1, null)).toBe(false);
  });

  it('preserves only valid backend preference fields and never infers preference from mode', () => {
    const snapshot = coerceNymUiSnapshot(
      preferenceSnapshot(null, { mode: 'direct' }),
    );
    expect(snapshot.mode).toBe('direct');
    expect(snapshot.preferredMode).toBeNull();
    expect(snapshot.preferenceLoaded).toBe(true);
    expect(hasConfirmedTransportPreference(snapshot)).toBe(false);
    expect(
      hasConfirmedTransportPreference(
        coerceNymUiSnapshot(preferenceSnapshot('nym')),
      ),
    ).toBe(true);
    expect(
      coerceNymUiSnapshot(
        preferenceSnapshot('nym', { preferenceError: 'UNRECOGNIZED' }),
      ),
    ).toMatchObject({
      preferredMode: 'nym',
      preferenceLoaded: false,
      preferenceError: 'INVALID_STORED_VALUE',
    });
  });

  it('preserves only a well-formed readiness token from the background snapshot', () => {
    expect(
      coerceNymUiSnapshot(
        preferenceSnapshot('nym', {
          readinessToken: {
            controllerEpoch: 'worker-1',
            readinessRevision: 7,
          },
        }),
      ).readinessToken,
    ).toEqual({ controllerEpoch: 'worker-1', readinessRevision: 7 });

    expect(
      coerceNymUiSnapshot(
        preferenceSnapshot('nym', {
          readinessToken: {
            controllerEpoch: '',
            readinessRevision: -1,
          },
        }),
      ).readinessToken,
    ).toBeUndefined();
  });

  it('waits for initial preference status before balance requests and shows the first-run notice', async () => {
    const status = deferred<unknown>();
    configureDashboardIpc(status.promise);

    let root = renderDashboardHook();
    expect(renderToStaticMarkup(root)).toContain('transport-preference-loading');
    await flushDashboardEffects();
    expect(sendIpcMessage).toHaveBeenCalledWith('GET_ACCOUNTS', {});
    expect(sendIpcMessage).not.toHaveBeenCalledWith(
      'GET_STELLAR_BALANCE',
      expect.anything(),
    );

    status.resolve(preferenceSnapshot(null));
    await new Promise((resolve) => setTimeout(resolve, 0));
    root = renderDashboardHook();
    const markup = renderToStaticMarkup(root);
    expect(markup).toContain('transport-choice-notice');
    expect(markup).toContain('Protect your connection metadata');
    expect(sendIpcMessage).not.toHaveBeenCalledWith(
      'GET_STELLAR_BALANCE',
      expect.anything(),
    );
  });

  it('does not present an unselected choice when status is unloaded or unavailable', async () => {
    configureDashboardIpc(
      preferenceSnapshot(null, {
        preferenceLoaded: false,
        preferenceError: 'STORAGE_READ_FAILED',
      }),
    );
    renderDashboardHook();
    await flushDashboardEffects();
    let markup = renderDashboardMarkup();
    expect(markup).not.toContain('transport-choice-notice');
    expect(markup).toContain('transport-preference-error');
    expect(markup).toContain('Could not load the saved transport preference.');

    vi.clearAllMocks();
    installChromeMocks();
    resetDashboardHookHarness();
    const failedStatus = deferred<unknown>();
    configureDashboardIpc(failedStatus.promise);
    renderDashboardHook();
    await flushDashboardEffects();
    failedStatus.reject(new Error('private raw storage detail'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    markup = renderDashboardMarkup();
    expect(markup).not.toContain('transport-choice-notice');
    expect(markup).toContain('transport-preference-error');
    expect(markup).not.toContain('private raw storage detail');
  });

  it('sends an explicit Nym choice and navigates only after persisted confirmation', async () => {
    const write = deferred<unknown>();
    configureDashboardIpc(preferenceSnapshot(null), {
      setMode: () => write.promise,
    });
    let root = renderDashboardHook();
    await flushDashboardEffects();
    root = renderDashboardHook();

    await clickTestButton(root, 'transport-choice-nym');
    root = renderDashboardHook();
    let markup = renderToStaticMarkup(root);
    expect(markup).toContain('transport-choice-notice');
    expect(markup).not.toContain('<h2>Settings</h2>');
    expect(sendIpcMessage).toHaveBeenCalledWith('NYM_SET_MODE', { mode: 'nym' });

    write.resolve(preferenceSnapshot('nym'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    root = renderDashboardHook();
    markup = renderToStaticMarkup(root);
    expect(markup).toContain('<h2>Settings</h2>');
    expect(markup).toContain('Transporte preferido: Nym');
    expect(markup).toContain('data-nym-connected="false"');
    expect(sendIpcMessage).not.toHaveBeenCalledWith('NYM_CONNECT', {});
  });

  it('does not navigate or optimistically select Nym when the preference write fails', async () => {
    configureDashboardIpc(preferenceSnapshot(null), {
      setMode: () => Promise.reject(new Error('private write details')),
    });
    let root = renderDashboardHook();
    await flushDashboardEffects();
    root = renderDashboardHook();

    await clickTestButton(root, 'transport-choice-nym');
    root = renderDashboardHook();
    const markup = renderToStaticMarkup(root);
    expect(markup).not.toContain('<h2>Settings</h2>');
    expect(markup).toContain('Could not save the transport preference. Please retry.');
    expect(markup).not.toContain('Preferred transport: Nym');
    expect(findTestElement(root, 'transport-choice-nym-retry')).not.toBeNull();
    expect(markup).not.toContain('private write details');
  });

  it('sends the explicit Direct choice and fetches balance only after confirmation', async () => {
    const status = deferred<unknown>();
    const write = deferred<unknown>();
    configureDashboardIpc(status.promise, { setMode: () => write.promise });
    let root = renderDashboardHook();
    await flushDashboardEffects();
    expect(sendIpcMessage).not.toHaveBeenCalledWith(
      'GET_STELLAR_BALANCE',
      expect.anything(),
    );

    status.resolve(preferenceSnapshot(null));
    await new Promise((resolve) => setTimeout(resolve, 0));
    root = renderDashboardHook();
    await clickTestButton(root, 'transport-choice-direct');
    expect(sendIpcMessage).toHaveBeenCalledWith('NYM_SET_MODE', { mode: 'direct' });
    expect(sendIpcMessage).not.toHaveBeenCalledWith(
      'GET_STELLAR_BALANCE',
      expect.anything(),
    );

    write.resolve(preferenceSnapshot('direct'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    root = renderDashboardHook();
    expect(renderToStaticMarkup(root)).toContain('data-preferred-mode="direct"');
    expect(
      vi.mocked(sendIpcMessage).mock.calls.filter(([type]) => type === 'GET_STELLAR_BALANCE'),
    ).toHaveLength(1);
    renderDashboardHook();
    expect(
      vi.mocked(sendIpcMessage).mock.calls.filter(([type]) => type === 'GET_STELLAR_BALANCE'),
    ).toHaveLength(1);
  });

  it('confirms both Direct origins before sending the preference IPC', async () => {
    const requestGate = deferred<boolean>();
    const containsGate = deferred<boolean>();
    const { permissions } = installChromeMocks();
    permissions.request.mockImplementation((_permissions, callback) => {
      void requestGate.promise.then(callback);
    });
    permissions.contains.mockImplementation((_permissions, callback) => {
      void containsGate.promise.then(callback);
    });
    configureDashboardIpc(preferenceSnapshot(null), {
      setMode: () => preferenceSnapshot('direct'),
    });

    let root = renderDashboardHook();
    await flushDashboardEffects();
    root = renderDashboardHook();
    const directButton = findTestElement(root, 'transport-choice-direct');
    expect(directButton).not.toBeNull();

    (directButton!.props['onClick'] as () => unknown)();
    expect(permissions.request).toHaveBeenCalledOnce();
    expect(permissions.request.mock.calls[0]![0]).toEqual({
      origins: [
        'https://horizon-testnet.stellar.org/*',
        'https://friendbot.stellar.org/*',
      ],
    });
    expect(sendIpcMessage).not.toHaveBeenCalledWith(
      'NYM_SET_MODE',
      expect.anything(),
    );

    requestGate.resolve(true);
    await vi.waitFor(() => expect(permissions.contains).toHaveBeenCalledOnce());
    expect(sendIpcMessage).not.toHaveBeenCalledWith(
      'NYM_SET_MODE',
      expect.anything(),
    );

    containsGate.resolve(true);
    await vi.waitFor(() =>
      expect(sendIpcMessage).toHaveBeenCalledWith('NYM_SET_MODE', { mode: 'direct' }),
    );
    expect(permissions.request.mock.invocationCallOrder[0]).toBeLessThan(
      permissions.contains.mock.invocationCallOrder[0]!,
    );
    expect(permissions.contains.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(sendIpcMessage).mock.invocationCallOrder.find(
        (order, index) => vi.mocked(sendIpcMessage).mock.calls[index]?.[0] === 'NYM_SET_MODE',
      )!,
    );
  });

  it.each([
    { name: 'denied', requestGranted: false, containsGranted: true },
    { name: 'partially granted', requestGranted: true, containsGranted: false },
    { name: 'contains check fails', requestGranted: true, containsError: true },
    { name: 'permission request fails', requestGranted: false, requestError: true },
  ])('does not send Direct preference IPC when permission is $name', async (scenario) => {
    const { permissions } = installChromeMocks();
    permissions.request.mockImplementation((_permissions, callback) => {
      if (scenario.requestError) throw new Error('private permission detail');
      callback(scenario.requestGranted ?? false);
    });
    permissions.contains.mockImplementation((_permissions, callback) => {
      if (scenario.containsError) throw new Error('private contains detail');
      callback(scenario.containsGranted ?? false);
    });
    configureDashboardIpc(preferenceSnapshot(null));

    let root = renderDashboardHook();
    await flushDashboardEffects();
    root = renderDashboardHook();
    await clickTestButton(root, 'transport-choice-direct');

    expect(permissions.request).toHaveBeenCalledOnce();
    expect(sendIpcMessage).not.toHaveBeenCalledWith(
      'NYM_SET_MODE',
      expect.anything(),
    );
    root = renderDashboardHook();
    const markup = renderToStaticMarkup(root);
    expect(markup).toContain('data-testid="direct-permission-error"');
    expect(markup).toContain(
      'Direct mode requires Chrome permissions for Stellar Testnet Horizon and Friendbot.',
    );
    expect(markup).not.toContain('data-preferred-mode="direct"');
    expect(markup).not.toContain('private permission detail');
    expect(markup).not.toContain('private contains detail');
  });

  it('preserves the previous Nym preference when Direct permissions are denied', async () => {
    const { permissions } = installChromeMocks();
    permissions.request.mockImplementation((_permissions, callback) => callback(false));
    permissions.contains.mockImplementation((_permissions, callback) => callback(false));
    configureDashboardIpc(preferenceSnapshot('nym'));

    let root = renderDashboardHook();
    await flushDashboardEffects();
    root = renderDashboardHook();
    const settingsButton = findButtonByText(root, 'Settings');
    expect(settingsButton).not.toBeNull();
    (settingsButton!.props['onClick'] as () => unknown)();
    root = renderDashboardHook();

    const panelProps = findComponentElement(root, 'NymTransportPanel')?.props;
    await (panelProps?.['onSetMode'] as (mode: 'direct' | 'nym') => Promise<void>)('direct');

    root = renderDashboardHook();
    const markup = renderToStaticMarkup(root);
    expect(markup).toContain('data-nym-preferred-mode="nym"');
    expect(markup).toContain('Transporte preferido: Nym');
    expect(markup).not.toContain('Transporte preferido: Direct');
    expect(markup).toContain('data-testid="direct-permission-error"');
    expect(sendIpcMessage).not.toHaveBeenCalledWith(
      'NYM_SET_MODE',
      expect.anything(),
    );
  });

  it('does not show Direct optimistically when preference persistence fails after permission grant', async () => {
    const { permissions } = installChromeMocks();
    configureDashboardIpc(preferenceSnapshot(null), {
      setMode: () =>
        preferenceSnapshot(null, { preferenceError: 'STORAGE_WRITE_FAILED' }),
    });

    let root = renderDashboardHook();
    await flushDashboardEffects();
    root = renderDashboardHook();
    await clickTestButton(root, 'transport-choice-direct');
    root = renderDashboardHook();

    expect(permissions.request).toHaveBeenCalledOnce();
    expect(permissions.contains).toHaveBeenCalledOnce();
    expect(sendIpcMessage).toHaveBeenCalledWith('NYM_SET_MODE', { mode: 'direct' });
    const markup = renderToStaticMarkup(root);
    expect(markup).not.toContain('data-preferred-mode="direct"');
    expect(markup).toContain('Could not save the transport preference. Please retry.');
  });

  it('refreshes the selected account after an A to B to A switch with stale requests in flight', async () => {
    const status = deferred<unknown>();
    const directPreferenceWrite = deferred<unknown>();
    const accountB = {
      index: 1,
      publicKey: `G${'B'.repeat(55)}`,
      label: 'Account 2',
    };
    const a1 = deferred<unknown>();
    const b1 = deferred<unknown>();
    const a2 = deferred<unknown>();
    const pendingBalances = new Map<string, Array<Promise<unknown>>>([
      [stellarAccount.publicKey, [a1.promise, a2.promise]],
      [accountB.publicKey, [b1.promise]],
    ]);

    configureDashboardIpc(status.promise, {
      setMode: () => directPreferenceWrite.promise,
      responses: {
        GET_ACCOUNTS: [stellarAccount, accountB],
        GET_ACTIVE_ACCOUNT: { status: 'VALID', index: 0 },
        SET_ACTIVE_ACCOUNT: { success: true },
        GET_STELLAR_BALANCE: (payload: unknown) => {
          const address = (payload as { address: string }).address;
          const nextRequest = pendingBalances.get(address)?.shift();
          if (!nextRequest) throw new Error(`Unexpected balance request for ${address}`);
          return nextRequest;
        },
      },
    });

    let root = renderDashboardHook();
    await flushDashboardEffects();
    expect(sendIpcMessage).not.toHaveBeenCalledWith(
      'GET_STELLAR_BALANCE',
      expect.anything(),
    );

    status.resolve(preferenceSnapshot(null));
    await new Promise((resolve) => setTimeout(resolve, 0));
    root = renderDashboardHook();
    expect(renderToStaticMarkup(root)).toContain('transport-choice-notice');
    expect(sendIpcMessage).not.toHaveBeenCalledWith(
      'GET_STELLAR_BALANCE',
      expect.anything(),
    );

    await clickTestButton(root, 'transport-choice-direct');
    expect(sendIpcMessage).toHaveBeenCalledWith('NYM_SET_MODE', { mode: 'direct' });
    expect(sendIpcMessage).not.toHaveBeenCalledWith(
      'GET_STELLAR_BALANCE',
      expect.anything(),
    );

    directPreferenceWrite.resolve(preferenceSnapshot('direct'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    root = renderDashboardHook();
    expect(
      vi.mocked(sendIpcMessage).mock.calls.filter(
        ([type, payload]) =>
          type === 'GET_STELLAR_BALANCE' &&
          (payload as { address: string }).address === stellarAccount.publicKey,
      ),
    ).toHaveLength(1);

    const selectAccount = async (index: number) => {
      const menuProps = findComponentElement(root, 'AccountMenu')?.props;
      expect(menuProps).toBeDefined();
      await (menuProps?.['onSelect'] as (selectedIndex: number) => Promise<boolean>)(index);
      root = renderDashboardHook();
    };

    await selectAccount(1);
    await selectAccount(0);

    const balanceCallsFor = (address: string) =>
      vi.mocked(sendIpcMessage).mock.calls.filter(
        ([type, payload]) =>
          type === 'GET_STELLAR_BALANCE' &&
          (payload as { address: string }).address === address,
      );
    expect(balanceCallsFor(stellarAccount.publicKey)).toHaveLength(2);
    expect(balanceCallsFor(accountB.publicKey)).toHaveLength(1);

    renderDashboardHook();
    expect(balanceCallsFor(stellarAccount.publicKey)).toHaveLength(2);

    a1.resolve({ exists: true, balance: '11.11' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await selectAccount(0);
    expect(balanceCallsFor(stellarAccount.publicKey)).toHaveLength(2);

    b1.resolve({ exists: true, balance: '22.22' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    let markup = renderToStaticMarkup(renderDashboardHook());
    expect(markup).not.toContain('11.11');
    expect(markup).not.toContain('22.22');

    a2.resolve({ exists: true, balance: '33.33' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    markup = renderToStaticMarkup(renderDashboardHook());
    expect(markup).toContain('33.33');
    expect(markup).not.toContain('11.11');
    expect(markup).not.toContain('22.22');
  });

  it('starts a new balance request when account restoration changes the selection', async () => {
    const accountB = {
      index: 1,
      publicKey: `G${'B'.repeat(55)}`,
      label: 'Account 2',
    };
    const aBalance = deferred<unknown>();
    const bBalance = deferred<unknown>();
    let accountLoadCount = 0;
    let activeAccountLoadCount = 0;
    configureDashboardIpc(preferenceSnapshot('direct'), {
      responses: {
        GET_ACCOUNTS: () => {
          accountLoadCount += 1;
          return [stellarAccount, accountB];
        },
        GET_ACTIVE_ACCOUNT: () => {
          activeAccountLoadCount += 1;
          return {
            status: 'VALID',
            index: activeAccountLoadCount === 1 ? 0 : 1,
          };
        },
        GET_STELLAR_BALANCE: (payload: unknown) => {
          const address = (payload as { address: string }).address;
          if (address === stellarAccount.publicKey) return aBalance.promise;
          if (address === accountB.publicKey) return bBalance.promise;
          throw new Error(`Unexpected balance request for ${address}`);
        },
      },
    });

    let root = renderDashboardHook();
    await flushDashboardEffects();
    const balanceCallsFor = (address: string) =>
      vi.mocked(sendIpcMessage).mock.calls.filter(
        ([type, payload]) =>
          type === 'GET_STELLAR_BALANCE' &&
          (payload as { address: string }).address === address,
      );
    expect(balanceCallsFor(stellarAccount.publicKey)).toHaveLength(1);
    expect(balanceCallsFor(accountB.publicKey)).toHaveLength(0);

    const returnToDashboard = async () => {
      root = renderDashboardHook();
      const settingsButton = findButtonByText(root, 'Settings');
      expect(settingsButton).not.toBeNull();
      (settingsButton!.props['onClick'] as () => unknown)();
      root = renderDashboardHook();
      await flushDashboardEffects();

      root = renderDashboardHook();
      const backButton = findButtonByText(root, '← Back');
      expect(backButton).not.toBeNull();
      (backButton!.props['onClick'] as () => unknown)();
      root = renderDashboardHook();
      await flushDashboardEffects();
    };

    await returnToDashboard();
    expect(accountLoadCount).toBe(2);
    expect(balanceCallsFor(accountB.publicKey)).toHaveLength(1);

    await returnToDashboard();
    expect(accountLoadCount).toBe(3);
    expect(balanceCallsFor(accountB.publicKey)).toHaveLength(1);

    aBalance.resolve({ exists: true, balance: '11.11' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    let markup = renderToStaticMarkup(renderDashboardHook());
    expect(markup).not.toContain('11.11');
    expect(markup).not.toContain('22.22');

    bBalance.resolve({ exists: true, balance: '22.22' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    markup = renderToStaticMarkup(renderDashboardHook());
    expect(markup).toContain('22.22');
    expect(markup).not.toContain('11.11');
  });

  it('preserves a previously confirmed preference after a failed change and allows retry', async () => {
    let failWrite = true;
    configureDashboardIpc(preferenceSnapshot('direct'), {
      setMode: (mode: 'direct' | 'nym') => {
        if (failWrite) {
          return preferenceSnapshot('direct', { preferenceError: 'STORAGE_WRITE_FAILED' });
        }
        return preferenceSnapshot(mode);
      },
    });
    let root = renderDashboardHook();
    await flushDashboardEffects();
    root = renderDashboardHook();
    const settingsButton = findButtonByText(root, 'Settings');
    expect(settingsButton).not.toBeNull();
    (settingsButton!.props['onClick'] as () => unknown)();
    root = renderDashboardHook();

    const panelProps = findComponentElement(root, 'NymTransportPanel')?.props;
    expect(panelProps).toBeDefined();
    await (panelProps?.['onSetMode'] as (mode: 'direct' | 'nym') => Promise<void>)('nym');
    root = renderDashboardHook();
    let markup = renderToStaticMarkup(root);
    expect(markup).toContain('Transporte preferido: Direct');
    expect(markup).toContain('STORAGE_WRITE_FAILED');
    expect(markup).not.toContain('Transporte preferido: Nym');

    failWrite = false;
    const retryProps = findComponentElement(root, 'NymTransportPanel')?.props;
    await (retryProps?.['onSetMode'] as (mode: 'direct' | 'nym') => Promise<void>)('nym');
    root = renderDashboardHook();
    markup = renderToStaticMarkup(root);
    expect(markup).toContain('Transporte preferido: Nym');
    expect(markup).not.toContain('STORAGE_WRITE_FAILED');
  });

  it('keeps Nym preferred across connect and disconnect responses', async () => {
    configureDashboardIpc(preferenceSnapshot('nym'), {
      responses: {
        NYM_CONNECT: preferenceSnapshot('nym', {
          state: 'connected',
          connected: true,
          documentReady: true,
        }),
        NYM_DISCONNECT: preferenceSnapshot('nym', {
          state: 'disconnected',
          connected: false,
          documentReady: false,
        }),
      },
    });
    renderDashboardHook();
    await flushDashboardEffects();
    let root = renderDashboardHook();
    const settingsButton = findButtonByText(root, 'Settings');
    expect(settingsButton).not.toBeNull();
    (settingsButton!.props['onClick'] as () => unknown)();
    root = renderDashboardHook();

    let panelProps = findComponentElement(root, 'NymTransportPanel')?.props;
    await (panelProps?.['onConnect'] as () => Promise<void>)();
    root = renderDashboardHook();
    panelProps = findComponentElement(root, 'NymTransportPanel')?.props;
    expect(panelProps?.['snapshot']).toMatchObject({
      preferredMode: 'nym',
      connected: true,
      state: 'connected',
    });

    await (panelProps?.['onDisconnect'] as () => Promise<void>)();
    root = renderDashboardHook();
    panelProps = findComponentElement(root, 'NymTransportPanel')?.props;
    expect(panelProps?.['snapshot']).toMatchObject({
      preferredMode: 'nym',
      connected: false,
      state: 'disconnected',
    });
  });

  it('hides Ready while status refresh is pending and restores it from the fresh response', async () => {
    let statusResponder: () => unknown = () => connectedNymSnapshot(1);
    configureDashboardIpc(connectedNymSnapshot(1), {
      responses: { NYM_STATUS: () => statusResponder() },
    });
    await openNymSettings();
    expect(renderDashboardMarkup()).toContain('data-nym-mixfetch-ready="true"');

    const pending = deferred<unknown>();
    statusResponder = () => pending.promise;
    vi.useFakeTimers();
    popupEvents.window.dispatch('focus');
    expect(renderDashboardMarkup()).toContain('data-nym-mixfetch-ready="false"');
    expect(renderDashboardMarkup()).toContain('Mixnet status not verified');

    await vi.advanceTimersByTimeAsync(120);
    pending.resolve(connectedNymSnapshot(2));
    await vi.advanceTimersByTimeAsync(0);
    expect(renderDashboardMarkup()).toContain('data-nym-mixfetch-ready="true"');
  });

  it('clears Ready and reports an error when status refresh fails', async () => {
    let statusResponder: () => unknown = () => connectedNymSnapshot(1);
    configureDashboardIpc(connectedNymSnapshot(1), {
      responses: { NYM_STATUS: () => statusResponder() },
    });
    await openNymSettings();
    expect(renderDashboardMarkup()).toContain('data-nym-mixfetch-ready="true"');

    statusResponder = () => Promise.reject(new Error('background unavailable'));
    vi.useFakeTimers();
    popupEvents.window.dispatch('focus');
    await vi.advanceTimersByTimeAsync(120);

    const markup = renderDashboardMarkup();
    expect(markup).toContain('data-nym-mixfetch-ready="false"');
    expect(markup).toContain('Could not refresh Nym status. Please retry.');
    expect(markup).not.toContain('Ready (Mixnet)');
  });

  it('refreshes status when visibility returns and when the popup regains focus', async () => {
    let statusRequests = 0;
    configureDashboardIpc(connectedNymSnapshot(1), {
      responses: {
        NYM_STATUS: () => {
          statusRequests += 1;
          return connectedNymSnapshot(statusRequests);
        },
      },
    });
    await openNymSettings();
    expect(statusRequests).toBe(1);
    vi.useFakeTimers();

    popupEvents.document.visibilityState = 'hidden';
    popupEvents.document.dispatch('visibilitychange');
    popupEvents.window.dispatch('focus');
    expect(statusRequests).toBe(1);

    popupEvents.document.visibilityState = 'visible';
    popupEvents.document.dispatch('visibilitychange');
    expect(statusRequests).toBe(1);
    popupEvents.window.dispatch('focus');
    await vi.advanceTimersByTimeAsync(120);
    expect(statusRequests).toBe(2);

    popupEvents.window.dispatch('focus');
    await vi.advanceTimersByTimeAsync(120);
    expect(statusRequests).toBe(3);
  });

  it('queues one refresh behind an in-flight status request and ignores its stale response', async () => {
    const older = deferred<unknown>();
    const newer = deferred<unknown>();
    let statusRequests = 0;
    let activeStatusRequests = 0;
    let maximumActiveStatusRequests = 0;
    const responses = [older, newer];
    configureDashboardIpc(connectedNymSnapshot(1), {
      responses: {
        NYM_STATUS: () => {
          statusRequests += 1;
          activeStatusRequests += 1;
          maximumActiveStatusRequests = Math.max(
            maximumActiveStatusRequests,
            activeStatusRequests,
          );
          return responses.shift()!.promise.finally(() => {
            activeStatusRequests -= 1;
          });
        },
      },
    });
    vi.useFakeTimers();
    await openNymSettings();
    expect(statusRequests).toBe(1);
    popupEvents.window.dispatch('focus');
    popupEvents.document.dispatch('visibilitychange');
    popupEvents.window.dispatch('focus');
    await vi.advanceTimersByTimeAsync(120);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(statusRequests).toBe(1);
    expect(activeStatusRequests).toBe(1);

    older.resolve(connectedNymSnapshot(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(statusRequests).toBe(2);
    expect(activeStatusRequests).toBe(1);
    expect(renderDashboardMarkup()).toContain('data-nym-mixfetch-ready="false"');

    newer.resolve(connectedNymSnapshot(2));
    await vi.advanceTimersByTimeAsync(0);
    expect(renderDashboardMarkup()).toContain('data-nym-mixfetch-ready="true"');
    expect(findComponentElement(renderDashboardHook(), 'NymTransportPanel')?.props['snapshot'])
      .toMatchObject({ readinessToken: { readinessRevision: 2 } });

    expect(maximumActiveStatusRequests).toBe(1);
    expect(statusRequests).toBe(2);
  });

  it('only lets the latest concurrent Dashboard instance apply a status response', async () => {
    const activeStatus = deferred<unknown>();
    const pendingStatus = deferred<unknown>();
    const responses = [activeStatus, pendingStatus];
    let activeRequests = 0;
    let maximumActiveRequests = 0;
    configureDashboardIpc(connectedNymSnapshot(1), {
      responses: {
        NYM_STATUS: () => {
          activeRequests += 1;
          maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
          return responses.shift()!.promise.finally(() => {
            activeRequests -= 1;
          });
        },
      },
    });
    vi.useFakeTimers();
    const instanceA = createDashboardHarnessInstance();
    const instanceB = createDashboardHarnessInstance();

    await openDashboardInstanceSettings(instanceA);
    expect(activeRequests).toBe(1);

    await openDashboardInstanceSettings(instanceB);
    expect(activeRequests).toBe(1);
    expect(vi.mocked(sendIpcMessage).mock.calls.filter(([type]) => type === 'NYM_STATUS'))
      .toHaveLength(1);

    activeStatus.resolve(connectedNymSnapshot(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(activeRequests).toBe(1);
    expect(vi.mocked(sendIpcMessage).mock.calls.filter(([type]) => type === 'NYM_STATUS'))
      .toHaveLength(2);
    const stalePanel = findComponentElement(renderDashboardInstance(instanceA), 'NymTransportPanel');
    expect(stalePanel?.props['readinessCurrent']).toBe(false);
    expect(stalePanel?.props['snapshot']).toMatchObject({
      state: 'disconnected',
      connected: false,
    });

    pendingStatus.resolve(connectedNymSnapshot(2));
    await vi.advanceTimersByTimeAsync(0);
    const currentPanel = findComponentElement(renderDashboardInstance(instanceB), 'NymTransportPanel');
    expect(currentPanel?.props['readinessCurrent']).toBe(true);
    expect(currentPanel?.props['snapshot']).toMatchObject({
      state: 'connected',
      connected: true,
      readinessToken: { readinessRevision: 2 },
    });
    expect(maximumActiveRequests).toBe(1);
    expect(activeRequests).toBe(0);
  });

  it('keeps one physical status request across Dashboard unmount and remount', async () => {
    const originalRequest = deferred<unknown>();
    const freshRequest = deferred<unknown>();
    const responses = [originalRequest, freshRequest];
    configureDashboardIpc(connectedNymSnapshot(1), {
      responses: { NYM_STATUS: () => responses.shift()!.promise },
    });

    renderDashboardHook();
    await flushDashboardEffects();
    expect(
      vi.mocked(sendIpcMessage).mock.calls.filter(([type]) => type === 'NYM_STATUS'),
    ).toHaveLength(1);

    resetDashboardHookHarness();
    renderDashboardHook();
    await flushDashboardEffects();
    expect(
      vi.mocked(sendIpcMessage).mock.calls.filter(([type]) => type === 'NYM_STATUS'),
    ).toHaveLength(1);

    const settingsButton = findButtonByText(renderDashboardHook(), 'Settings');
    expect(settingsButton).not.toBeNull();
    (settingsButton!.props['onClick'] as () => void)();
    renderDashboardHook();
    await flushDashboardEffects();
    expect(
      vi.mocked(sendIpcMessage).mock.calls.filter(([type]) => type === 'NYM_STATUS'),
    ).toHaveLength(1);

    originalRequest.resolve(connectedNymSnapshot(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      vi.mocked(sendIpcMessage).mock.calls.filter(([type]) => type === 'NYM_STATUS'),
    ).toHaveLength(2);

    freshRequest.resolve(connectedNymSnapshot(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(renderDashboardMarkup()).toContain('data-nym-mixfetch-ready="true"');
    expect(findComponentElement(renderDashboardHook(), 'NymTransportPanel')?.props['snapshot'])
      .toMatchObject({ readinessToken: { readinessRevision: 2 } });
  });

  it('starts the queued mount refresh after an earlier status request rejects', async () => {
    const originalRequest = deferred<unknown>();
    const freshRequest = deferred<unknown>();
    const responses = [originalRequest, freshRequest];
    configureDashboardIpc(connectedNymSnapshot(1), {
      responses: { NYM_STATUS: () => responses.shift()!.promise },
    });

    renderDashboardHook();
    await flushDashboardEffects();
    resetDashboardHookHarness();
    await openNymSettings();
    expect(
      vi.mocked(sendIpcMessage).mock.calls.filter(([type]) => type === 'NYM_STATUS'),
    ).toHaveLength(1);

    originalRequest.reject(new Error('old popup request failed'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      vi.mocked(sendIpcMessage).mock.calls.filter(([type]) => type === 'NYM_STATUS'),
    ).toHaveLength(2);

    freshRequest.resolve(connectedNymSnapshot(3));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(renderDashboardMarkup()).toContain('data-nym-mixfetch-ready="true"');
    expect(findComponentElement(renderDashboardHook(), 'NymTransportPanel')?.props['snapshot'])
      .toMatchObject({ readinessToken: { readinessRevision: 3 } });
  });

  it('invalidates old Ready on STALE_READINESS and applies only its valid fresh snapshot', async () => {
    const freshDisconnected = preferenceSnapshot('nym', {
      state: 'disconnected',
      connected: false,
      documentReady: true,
      readinessToken: { controllerEpoch: 'worker-current', readinessRevision: 2 },
    });
    configureDashboardIpc(connectedNymSnapshot(1), {
      responses: {
        NYM_HTTP_SMOKE: {
          state: 'error',
          code: 'STALE_READINESS',
          url: 'https://postman-echo.com/post',
          probeId: '',
          durationMs: 0,
          httpStatus: null,
          httpOk: null,
          probeMatched: false,
          echoedProbeId: null,
          message: 'MixFetch readiness changed',
          mixFetchInvoked: false,
          snapshot: freshDisconnected,
        },
      },
    });
    await openNymSettings();
    expect(renderDashboardMarkup()).toContain('data-nym-mixfetch-ready="true"');

    const panel = findComponentElement(renderDashboardHook(), 'NymTransportPanel');
    await (panel?.props['onHttpSmoke'] as () => Promise<void>)();
    const root = renderDashboardHook();
    expect(renderToStaticMarkup(root)).toContain('data-nym-mixfetch-ready="false"');
    expect(findComponentElement(root, 'NymTransportPanel')?.props['snapshot'])
      .toMatchObject({
        connected: false,
        readinessToken: { readinessRevision: 2 },
      });
  });

  it('shows Nym preference rejection distinctly without changing connection readiness', async () => {
    const preferenceError = Object.assign(
      new Error('HTTP Smoke requires a valid persisted Nym transport preference'),
      { name: 'NymPreferenceRequiredError' },
    );
    configureDashboardIpc(connectedNymSnapshot(1), {
      responses: {
        NYM_HTTP_SMOKE: () => {
          throw preferenceError;
        },
      },
    });
    await openNymSettings();
    const before = findComponentElement(renderDashboardHook(), 'NymTransportPanel');
    expect(before?.props['snapshot']).toMatchObject({
      connected: true,
      readinessToken: { controllerEpoch: 'worker-current', readinessRevision: 1 },
    });

    const root = await invokeNymHttpSmoke();
    const markup = renderToStaticMarkup(root);
    expect(markup).toContain('data-testid="nym-http-smoke-preference-error"');
    expect(markup).toContain('data-error-name="NymPreferenceRequiredError"');
    expect(markup).toContain('HTTP Smoke requires a valid persisted Nym transport preference');
    expect(markup).toContain('data-nym-mixfetch-ready="true"');
    expect(findComponentElement(root, 'NymTransportPanel')?.props['snapshot']).toMatchObject({
      connected: true,
      readinessToken: { controllerEpoch: 'worker-current', readinessRevision: 1 },
    });
  });

  it('continues to show a generic HTTP Smoke IPC error message', async () => {
    const genericError = new Error('Unexpected background failure');
    configureDashboardIpc(connectedNymSnapshot(1), {
      responses: {
        NYM_HTTP_SMOKE: () => {
          throw genericError;
        },
      },
    });
    await openNymSettings();

    const root = await invokeNymHttpSmoke();
    const markup = renderToStaticMarkup(root);
    expect(markup).toContain('Unexpected background failure');
    expect(markup).not.toContain('nym-http-smoke-preference-error');
    expect(markup).toContain('data-nym-mixfetch-ready="true"');
  });

  it('continues to show IpcConnectionError messages without changing readiness', async () => {
    const connectionError = Object.assign(
      new Error('No response received from background script'),
      { name: 'IpcConnectionError' },
    );
    configureDashboardIpc(connectedNymSnapshot(1), {
      responses: {
        NYM_HTTP_SMOKE: () => {
          throw connectionError;
        },
      },
    });
    await openNymSettings();

    const root = await invokeNymHttpSmoke();
    const markup = renderToStaticMarkup(root);
    expect(markup).toContain('No response received from background script');
    expect(markup).not.toContain('nym-http-smoke-preference-error');
    expect(markup).toContain('data-nym-mixfetch-ready="true"');
    expect(findComponentElement(root, 'NymTransportPanel')?.props['snapshot']).toMatchObject({
      connected: true,
      readinessToken: { controllerEpoch: 'worker-current', readinessRevision: 1 },
    });
  });

  it('handles a non-Error rejection without breaking HTTP Smoke UI', async () => {
    configureDashboardIpc(connectedNymSnapshot(1), {
      responses: {
        NYM_HTTP_SMOKE: () => {
          throw 'unexpected rejection';
        },
      },
    });
    await openNymSettings();

    const root = await invokeNymHttpSmoke();
    const markup = renderToStaticMarkup(root);
    expect(markup).toContain('NYM_HTTP_SMOKE failed');
    expect(markup).not.toContain('nym-http-smoke-preference-error');
    expect(markup).toContain('data-nym-mixfetch-ready="true"');
  });

  it('does not show Ready for an invalid status response and restores it only after a valid refresh', async () => {
    let statusResponder: () => unknown = () =>
      preferenceSnapshot('nym', {
        state: 'connected',
        connected: true,
        readinessToken: { controllerEpoch: '', readinessRevision: -1 },
      });
    configureDashboardIpc(connectedNymSnapshot(1), {
      responses: { NYM_STATUS: () => statusResponder() },
    });
    await openNymSettings();
    expect(renderDashboardMarkup()).toContain('data-nym-mixfetch-ready="false"');
    expect(renderDashboardMarkup()).toContain('Could not refresh Nym status. Please retry.');

    statusResponder = () => connectedNymSnapshot(3);
    vi.useFakeTimers();
    popupEvents.window.dispatch('focus');
    await vi.advanceTimersByTimeAsync(120);
    expect(renderDashboardMarkup()).toContain('data-nym-mixfetch-ready="true"');
  });

  it('does not apply a delayed Connect response after a newer status reports disconnected', async () => {
    const connect = deferred<unknown>();
    let statusResponse: unknown = connectedNymSnapshot(1);
    configureDashboardIpc(connectedNymSnapshot(1), {
      responses: {
        NYM_STATUS: () => statusResponse,
        NYM_CONNECT: () => connect.promise,
      },
    });
    await openNymSettings();
    const initialPanel = findComponentElement(renderDashboardHook(), 'NymTransportPanel');
    const connectPromise = (initialPanel?.props['onConnect'] as () => Promise<void>)();
    const disconnected = preferenceSnapshot('nym', {
      state: 'disconnected',
      connected: false,
      documentReady: false,
    });
    statusResponse = disconnected;
    vi.useFakeTimers();
    popupEvents.window.dispatch('focus');
    await vi.advanceTimersByTimeAsync(120);

    expect(renderDashboardMarkup()).toContain('data-nym-mixfetch-ready="false"');
    connect.resolve(connectedNymSnapshot(2));
    await vi.advanceTimersByTimeAsync(0);
    await connectPromise;

    const panel = findComponentElement(renderDashboardHook(), 'NymTransportPanel');
    expect(panel?.props['snapshot']).toMatchObject({
      state: 'disconnected',
      connected: false,
    });
    expect(renderToStaticMarkup(renderDashboardHook())).toContain(
      'data-nym-mixfetch-ready="false"',
    );
  });

  it('does not let a rejected stale Connect overwrite a newer status response', async () => {
    const connect = deferred<unknown>();
    let statusResponse: unknown = connectedNymSnapshot(1);
    configureDashboardIpc(connectedNymSnapshot(1), {
      responses: {
        NYM_STATUS: () => statusResponse,
        NYM_CONNECT: () => connect.promise,
      },
    });
    await openNymSettings();
    const initialPanel = findComponentElement(renderDashboardHook(), 'NymTransportPanel');
    const connectPromise = (initialPanel?.props['onConnect'] as () => Promise<void>)();
    statusResponse = preferenceSnapshot('nym', {
      state: 'disconnected',
      connected: false,
      documentReady: false,
    });
    vi.useFakeTimers();
    popupEvents.window.dispatch('focus');
    await vi.advanceTimersByTimeAsync(120);

    connect.reject(new Error('stale Connect failure'));
    await vi.advanceTimersByTimeAsync(0);
    await connectPromise;

    const panel = findComponentElement(renderDashboardHook(), 'NymTransportPanel');
    expect(panel?.props['snapshot']).toMatchObject({
      state: 'disconnected',
      connected: false,
      lastError: null,
    });
    expect(renderToStaticMarkup(renderDashboardHook())).not.toContain('stale Connect failure');
  });

  it('invalidates a pending Connect on view transition', async () => {
    const connect = deferred<unknown>();
    const disconnected = preferenceSnapshot('nym', {
      state: 'disconnected',
      connected: false,
      documentReady: false,
    });
    configureDashboardIpc(connectedNymSnapshot(1), {
      responses: {
        NYM_STATUS: () => disconnected,
        NYM_CONNECT: () => connect.promise,
      },
    });
    await openNymSettings();
    const panel = findComponentElement(renderDashboardHook(), 'NymTransportPanel');
    const connectPromise = (panel?.props['onConnect'] as () => Promise<void>)();
    const backButton = findButtonByText(renderDashboardHook(), '← Back');
    expect(backButton).not.toBeNull();
    (backButton!.props['onClick'] as () => void)();
    renderDashboardHook();
    await flushDashboardEffects();

    connect.resolve(connectedNymSnapshot(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await connectPromise;

    const dashboard = renderDashboardHook();
    const settingsButton = findButtonByText(dashboard, 'Settings');
    expect(settingsButton).not.toBeNull();
    (settingsButton!.props['onClick'] as () => void)();
    renderDashboardHook();
    await flushDashboardEffects();
    expect(findComponentElement(renderDashboardHook(), 'NymTransportPanel')?.props['snapshot'])
      .toMatchObject({ state: 'disconnected', connected: false });
  });

  it('periodically invalidates readiness and keeps it unverified after status failure', async () => {
    let statusRequests = 0;
    let failStatus = false;
    configureDashboardIpc(connectedNymSnapshot(1), {
      responses: {
        NYM_STATUS: () => {
          statusRequests += 1;
          if (failStatus) throw new Error('background unavailable');
          return connectedNymSnapshot(statusRequests);
        },
      },
    });
    vi.useFakeTimers();
    await openNymSettings();
    expect(renderDashboardMarkup()).toContain('data-nym-mixfetch-ready="true"');
    failStatus = true;

    await vi.advanceTimersByTimeAsync(30_000);

    expect(statusRequests).toBe(2);
    expect(renderDashboardMarkup()).toContain('data-nym-mixfetch-ready="false"');
    expect(renderDashboardMarkup()).toContain('Could not refresh Nym status. Please retry.');
  });

  it('stops periodic status refresh after the Dashboard view becomes inactive', async () => {
    let statusRequests = 0;
    configureDashboardIpc(connectedNymSnapshot(1), {
      responses: {
        NYM_STATUS: () => {
          statusRequests += 1;
          return connectedNymSnapshot(statusRequests);
        },
      },
    });
    vi.useFakeTimers();
    renderDashboardHook();
    await flushDashboardEffects();
    expect(statusRequests).toBe(1);

    const sendButton = findButtonByText(renderDashboardHook(), 'Send');
    expect(sendButton).not.toBeNull();
    (sendButton!.props['onClick'] as () => void)();
    renderDashboardHook();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(statusRequests).toBe(1);
  });

  it('stops periodic status refresh after the Dashboard hook unmounts', async () => {
    let statusRequests = 0;
    configureDashboardIpc(connectedNymSnapshot(1), {
      responses: {
        NYM_STATUS: () => {
          statusRequests += 1;
          return connectedNymSnapshot(statusRequests);
        },
      },
    });
    vi.useFakeTimers();
    await openNymSettings();
    expect(statusRequests).toBe(1);

    resetDashboardHookHarness();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(statusRequests).toBe(1);
  });
});
