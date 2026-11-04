import {
  OffscreenMixFetchBridge,
  type OffscreenMixFetchBridgeAuthenticationDiagnostic,
  type OffscreenMixFetchBridgeDiagnostic,
} from '../../../src/background/nym/OffscreenMixFetchBridge.js';
import {
  NYM_OFFSCREEN_PORT_NAME,
  isNymOffscreenBridgeAuthenticatedSignal,
  isNymOffscreenRequest,
  type NymOffscreenRequest,
} from '../../../src/nym-offscreen/protocol.js';

export const OFFSCREEN_TEST_DOCUMENT_ID = '123e4567-e89b-12d3-a456-426614174000';
export const OFFSCREEN_TEST_COMPACT_DOCUMENT_ID = 'BC27AD52A2703D75D5B54770A8DD2726';
export const OFFSCREEN_TEST_URL =
  'chrome-extension://test-extension/nym-offscreen.html';

type Sender = Pick<chrome.runtime.MessageSender, 'id' | 'url' | 'documentId'>;

type PortOptions = {
  name?: string;
  sender?: Sender | null;
};

type HarnessOptions = {
  documentOpen?: boolean;
  sender?: Sender | null;
  portName?: string;
  rpcTimeoutMs?: number;
  readinessTimeoutMs?: number;
  autoConnect?: boolean;
  createDocument?: () => Promise<void>;
  contexts?: chrome.runtime.ExtensionContext[];
  getContexts?: (
    filter: chrome.runtime.ContextFilter,
  ) => Promise<chrome.runtime.ExtensionContext[]>;
  getContextsAvailable?: boolean;
  onAuthenticated?: (
    diagnostic: OffscreenMixFetchBridgeAuthenticationDiagnostic,
  ) => void | Promise<void>;
  onDiagnostic?: (
    diagnostic: OffscreenMixFetchBridgeDiagnostic,
  ) => void | Promise<void>;
};

type HarnessPort = chrome.runtime.Port & {
  requests: NymOffscreenRequest[];
  messagesSent: unknown[];
  events: string[];
  deliver: (message: unknown) => void;
  deliverDisconnect: () => void;
  disconnect: () => void;
  isDisconnected: () => boolean;
};

export type OffscreenBridgeTestHarness = {
  bridge: OffscreenMixFetchBridge;
  ports: HarnessPort[];
  connectPort: (options?: PortOptions) => HarnessPort;
  getConnectListenerCount: () => number;
};

export function createOffscreenExtensionContext(
  overrides: Partial<chrome.runtime.ExtensionContext> = {},
): chrome.runtime.ExtensionContext {
  return {
    contextId: 'test-offscreen-context',
    contextType: 'OFFSCREEN_DOCUMENT',
    documentId: OFFSCREEN_TEST_DOCUMENT_ID,
    documentOrigin: 'chrome-extension://test-extension',
    documentUrl: OFFSCREEN_TEST_URL,
    frameId: -1,
    incognito: false,
    tabId: -1,
    windowId: -1,
    ...overrides,
  };
}

export function createOffscreenBridgeTestHarness(
  respond: (request: NymOffscreenRequest) => Promise<unknown>,
  options: HarnessOptions = {},
): OffscreenBridgeTestHarness {
  const connectListeners = new Set<(port: chrome.runtime.Port) => void>();
  const runtime = {
    id: 'test-extension',
    getURL: (path: string) => `chrome-extension://test-extension/${path}`,
    ContextType: {
      OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT',
    },
    onConnect: {
      addListener: (listener: (port: chrome.runtime.Port) => void) => {
        connectListeners.add(listener);
      },
    },
    ...(options.getContextsAvailable === false
      ? {}
      : {
          getContexts:
            options.getContexts ??
            (async () =>
              options.contexts ?? [createOffscreenExtensionContext()]),
        }),
  };
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      runtime,
      offscreen: {
        hasDocument: async () => options.documentOpen !== false,
        createDocument: options.createDocument ?? (async () => undefined),
        closeDocument: async () => undefined,
      },
    },
  });

  const bridge = new OffscreenMixFetchBridge(
    {
      ...(options.rpcTimeoutMs === undefined
        ? {}
        : { rpcTimeoutMs: options.rpcTimeoutMs }),
      ...(options.readinessTimeoutMs === undefined
        ? {}
        : { readinessTimeoutMs: options.readinessTimeoutMs }),
      ...(options.onAuthenticated === undefined
        ? {}
        : {
            onAuthenticated: (diagnostic: OffscreenMixFetchBridgeAuthenticationDiagnostic) => {
              return options.onAuthenticated?.(diagnostic);
            },
          }),
      ...(options.onDiagnostic === undefined
        ? {}
        : { onDiagnostic: options.onDiagnostic }),
    },
  );
  const ports: HarnessPort[] = [];
  const connectPort = (portOptions: PortOptions = {}): HarnessPort => {
    const messageListeners = new Set<(message: unknown) => void>();
    const disconnectListeners = new Set<() => void>();
    const sender = Object.prototype.hasOwnProperty.call(portOptions, 'sender')
      ? portOptions.sender
      : options.sender === undefined
        ? {
            id: 'test-extension',
            url: OFFSCREEN_TEST_URL,
            documentId: OFFSCREEN_TEST_DOCUMENT_ID,
          }
        : options.sender;
    let disconnected = false;
    const port = {
      name: portOptions.name ?? options.portName ?? NYM_OFFSCREEN_PORT_NAME,
      sender: sender ?? undefined,
      requests: [],
      messagesSent: [],
      events: [],
      onMessage: {
        addListener: (listener: (message: unknown) => void) => {
          port.events.push('message_listener_added');
          messageListeners.add(listener);
        },
      },
      onDisconnect: {
        addListener: (listener: () => void) => {
          disconnectListeners.add(listener);
        },
      },
      postMessage: (message: unknown) => {
        port.messagesSent.push(message);
        port.events.push(
          isNymOffscreenRequest(message)
            ? `request:${message.type}`
            : isNymOffscreenBridgeAuthenticatedSignal(message)
              ? 'bridgeAuthenticatedSignal'
              : 'other_message',
        );
        if (isNymOffscreenRequest(message)) {
          port.requests.push(message);
          void respond(message).then(
            (response) => port.deliver(response),
            () => port.disconnect(),
          );
        }
      },
      deliver: (message: unknown) => {
        // Allows simulating a queued delivery racing with Port disconnection.
        messageListeners.forEach((listener) => listener(message));
      },
      deliverDisconnect: () => {
        disconnectListeners.forEach((listener) => listener());
      },
      isDisconnected: () => disconnected,
      disconnect: () => {
        if (disconnected) return;
        disconnected = true;
        port.deliverDisconnect();
      },
    } as unknown as HarnessPort;
    ports.push(port);
    connectListeners.forEach((listener) => listener(port));
    return port;
  };

  if (options.documentOpen !== false && options.autoConnect !== false) {
    connectPort();
  }
  return {
    bridge,
    ports,
    connectPort,
    getConnectListenerCount: () => connectListeners.size,
  };
}

export function createOffscreenBridgeHarness(
  respond: (request: NymOffscreenRequest) => Promise<unknown>,
  options: HarnessOptions = {},
): OffscreenMixFetchBridge {
  return createOffscreenBridgeTestHarness(respond, options).bridge;
}
