import { beforeEach, describe, expect, it, vi } from 'vitest';

const DAPP_RESPONSE_PAYLOADS: Record<string, unknown> = {
  DAPP_CONNECT: { publicKey: 'synthetic-public-key' },
  DAPP_DISCONNECT: { success: true },
  DAPP_SIGN_TRANSACTION: { signature: 'synthetic-signature', transaction: 'synthetic-transaction' },
};

/** Partial window message doubles for content-bridge unit tests. */
function createTestMessageEvent(partial: {
  source: unknown;
  data: unknown;
}): MessageEvent<unknown> {
  return partial as unknown as MessageEvent<unknown>;
}

describe('content dApp message bridge', () => {
  let pageWindow: Window & typeof globalThis;
  let messageListener: ((event: MessageEvent<unknown>) => void) | undefined;
  let sendMessage: ReturnType<typeof vi.fn>;
  let postMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    messageListener = undefined;
    sendMessage = vi.fn().mockImplementation((message: { id: string; type: string }) =>
      Promise.resolve({
        id: message.id,
        type: message.type,
        payload: DAPP_RESPONSE_PAYLOADS[message.type],
      }),
    );
    postMessage = vi.fn();

    pageWindow = {
      addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
        if (type === 'message' && typeof listener === 'function') {
          messageListener = listener as unknown as (event: MessageEvent<unknown>) => void;
        }
      }),
      postMessage,
      location: { origin: 'https://dapp.example' },
    } as unknown as Window & typeof globalThis;

    const script = { src: '', onload: null as (() => void) | null, remove: vi.fn() };
    const document = {
      createElement: vi.fn(() => script),
      head: { appendChild: vi.fn() },
      documentElement: { appendChild: vi.fn() },
    };

    vi.stubGlobal('window', pageWindow);
    vi.stubGlobal('document', document);
    vi.stubGlobal('chrome', {
      runtime: {
        getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
        sendMessage,
      },
    });
  });

  async function loadBridge(): Promise<void> {
    await import('../../src/content/index.js');
    expect(messageListener).toBeDefined();
  }

  it.each([
    { type: 'DAPP_CONNECT', payload: { onlyIfTrusted: true } },
    { type: 'DAPP_DISCONNECT', payload: {} },
    { type: 'DAPP_SIGN_TRANSACTION', payload: { transactionBase64: 'A'.repeat(10) } },
  ])('forwards valid $type with its request ID and returns the response', async ({ type, payload }) => {
    const id = 'request-1';
    await loadBridge();

    messageListener?.(createTestMessageEvent({
      source: pageWindow,
      data: { source: 'solanym-provider', message: { id, type, payload } },
    }));

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce());
    expect(sendMessage).toHaveBeenCalledWith({ id, type, payload });
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        {
          source: 'solanym-content',
          message: { id, type, payload: DAPP_RESPONSE_PAYLOADS[type] },
        },
        'https://dapp.example',
      ),
    );
  });

  it.each(['DAPP_CONNECT', 'DAPP_DISCONNECT'])(
    'preserves the existing omitted-payload behavior for %s',
    async (type) => {
      const id = 'request-no-payload';
      await loadBridge();
      messageListener?.(createTestMessageEvent({
        source: pageWindow,
        data: { source: 'solanym-provider', message: { id, type } },
      }));

      await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce());
      expect(sendMessage).toHaveBeenCalledWith({ id, type, payload: {} });
    },
  );

  it('rejects an omitted payload when the request schema requires it', async () => {
    await loadBridge();
    messageListener?.(createTestMessageEvent({
      source: pageWindow,
      data: {
        source: 'solanym-provider',
        message: { id: 'request-required-payload', type: 'DAPP_SIGN_TRANSACTION' },
      },
    }));

    expect(sendMessage).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'solanym-content',
          message: expect.objectContaining({
            id: 'request-required-payload',
            type: 'ERROR',
            error: expect.objectContaining({ name: 'PayloadValidationError' }),
          }),
        }),
        'https://dapp.example',
      ),
    );
  });

  it.each(['GET_BALANCE', 'SEND_TRANSFER', 'NYM_RPC_REQUEST', 'UNKNOWN'])(
    'does not forward non-dApp type %s',
    async (type) => {
      await loadBridge();
      messageListener?.(createTestMessageEvent({
        source: pageWindow,
        data: {
          source: 'solanym-provider',
          message: { id: 'request-2', type, payload: {} },
        },
      }));

      expect(sendMessage).not.toHaveBeenCalled();
      expect(postMessage).not.toHaveBeenCalled();
    },
  );

  it.each([
    null,
    undefined,
    'not-an-envelope',
    { id: '', type: 'DAPP_CONNECT', payload: {} },
    { id: 'request-3', type: 'DAPP_CONNECT', payload: { onlyIfTrusted: 'yes' } },
    { id: 'request-4', type: 'DAPP_DISCONNECT', payload: 1 },
    { id: 'request-5', type: 'DAPP_SIGN_TRANSACTION', payload: { transactionBase64: 'short' } },
    { id: 'request-6', type: 'DAPP_SIGN_TRANSACTION', payload: { transactionBase64: 123 } },
  ])('rejects malformed request without forwarding: %j', async (message) => {
    await loadBridge();
    messageListener?.(createTestMessageEvent({
      source: pageWindow,
      data: { source: 'solanym-provider', message },
    }));

    expect(sendMessage).not.toHaveBeenCalled();
    if (
      typeof message === 'object' &&
      message !== null &&
      'id' in message &&
      typeof message.id === 'string' &&
      message.id.length > 0 &&
      'type' in message &&
      ['DAPP_CONNECT', 'DAPP_DISCONNECT', 'DAPP_SIGN_TRANSACTION'].includes(String(message.type))
    ) {
      await vi.waitFor(() =>
        expect(postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            source: 'solanym-content',
            message: expect.objectContaining({
              id: message.id,
              type: 'ERROR',
              error: expect.objectContaining({ name: 'PayloadValidationError' }),
            }),
          }),
          'https://dapp.example',
        ),
      );
    } else {
      expect(postMessage).not.toHaveBeenCalled();
    }
  });

  it.each([null, false, 0, ''])(
    'rejects an explicitly present falsy payload: %j',
    async (payload) => {
      const id = 'request-falsy-payload';
      await loadBridge();
      messageListener?.(createTestMessageEvent({
        source: pageWindow,
        data: {
          source: 'solanym-provider',
          message: { id, type: 'DAPP_CONNECT', payload },
        },
      }));

      expect(sendMessage).not.toHaveBeenCalled();
      await vi.waitFor(() =>
        expect(postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            source: 'solanym-content',
            message: expect.objectContaining({
              id,
              type: 'ERROR',
              error: expect.objectContaining({ name: 'PayloadValidationError' }),
            }),
          }),
          'https://dapp.example',
        ),
      );
    },
  );

  it('rejects an explicitly present undefined payload while accepting an omitted connect payload', async () => {
    const id = 'request-undefined-payload';
    await loadBridge();
    messageListener?.(createTestMessageEvent({
      source: pageWindow,
      data: {
        source: 'solanym-provider',
        message: { id, type: 'DAPP_CONNECT', payload: undefined },
      },
    }));

    expect(sendMessage).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'solanym-content',
          message: expect.objectContaining({
            id,
            type: 'ERROR',
            error: expect.objectContaining({ name: 'PayloadValidationError' }),
          }),
        }),
        'https://dapp.example',
      ),
    );
  });

  it('does not forward a message from another window even with a forged source marker', async () => {
    await loadBridge();
    messageListener?.(createTestMessageEvent({
      source: {} as MessageEventSource,
      data: {
        source: 'solanym-provider',
        message: { id: 'request-7', type: 'DAPP_CONNECT', payload: {} },
      },
    }));

    expect(sendMessage).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it.each([null, undefined, 'invalid'])(
    'ignores malformed window event data: %j',
    async (data) => {
      await loadBridge();
      messageListener?.(createTestMessageEvent({
        source: pageWindow,
        data,
      }));

      expect(sendMessage).not.toHaveBeenCalled();
      expect(postMessage).not.toHaveBeenCalled();
    },
  );

  it('does not treat a same-window source marker as authentication', async () => {
    await loadBridge();
    messageListener?.(createTestMessageEvent({
      source: pageWindow,
      data: {
        source: 'solanym-provider',
        message: { id: 'request-10', type: 'DAPP_CONNECT', payload: {} },
      },
    }));

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce());
  });

  it('does not treat the source marker as authorization for internal messages', async () => {
    await loadBridge();
    messageListener?.(createTestMessageEvent({
      source: pageWindow,
      data: {
        source: 'solanym-provider',
        message: { id: 'request-8', type: 'GET_BALANCE', payload: { address: 'synthetic' } },
      },
    }));

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('returns a correlated error when forwarding fails', async () => {
    sendMessage.mockRejectedValueOnce(new Error('Extension context invalidated'));
    await loadBridge();
    messageListener?.(createTestMessageEvent({
      source: pageWindow,
      data: {
        source: 'solanym-provider',
        message: { id: 'request-9', type: 'DAPP_CONNECT', payload: {} },
      },
    }));

    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'solanym-content',
          message: expect.objectContaining({
            id: 'request-9',
            type: 'ERROR',
            error: expect.objectContaining({ name: 'ContentScriptError' }),
          }),
        }),
        'https://dapp.example',
      ),
    );
  });

  it('returns a correlated error for a malformed wallet response', async () => {
    sendMessage.mockResolvedValueOnce({
      id: 'request-11',
      type: 'DAPP_CONNECT',
      payload: {},
    });
    await loadBridge();
    messageListener?.(createTestMessageEvent({
      source: pageWindow,
      data: {
        source: 'solanym-provider',
        message: { id: 'request-11', type: 'DAPP_CONNECT', payload: {} },
      },
    }));

    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'solanym-content',
          message: expect.objectContaining({
            id: 'request-11',
            type: 'ERROR',
            error: expect.objectContaining({ name: 'InvalidResponseError' }),
          }),
        }),
        'https://dapp.example',
      ),
    );
  });

  it.each(['DAPP_CONNECT', 'ERROR'])(
    'forwards a valid error response with type %s',
    async (responseType) => {
      const response = {
        id: 'request-error',
        type: responseType,
        error: { name: 'UnauthorizedSenderError', message: 'Not authorized' },
      };
      sendMessage.mockResolvedValueOnce(response);
      await loadBridge();
      messageListener?.(createTestMessageEvent({
        source: pageWindow,
        data: {
          source: 'solanym-provider',
          message: { id: 'request-error', type: 'DAPP_CONNECT', payload: {} },
        },
      }));

      await vi.waitFor(() =>
        expect(postMessage).toHaveBeenCalledWith(
          { source: 'solanym-content', message: response },
          'https://dapp.example',
        ),
      );
    },
  );

  it.each([
    {
      name: 'unrelated error type',
      response: {
        id: 'request-invalid-response',
        type: 'DAPP_DISCONNECT',
        error: { name: 'Error', message: 'Unrelated' },
      },
    },
    {
      name: 'wrong ID',
      response: {
        id: 'different-id',
        type: 'DAPP_CONNECT',
        payload: { publicKey: 'synthetic-public-key' },
      },
    },
    {
      name: 'unrelated success type',
      response: {
        id: 'request-invalid-response',
        type: 'DAPP_DISCONNECT',
        payload: { success: true },
      },
    },
    {
      name: 'malformed error envelope',
      response: {
        id: 'request-invalid-response',
        type: 'ERROR',
        error: { name: 1, message: 'Invalid' },
      },
    },
  ])('rejects $name without forwarding the response as valid', async ({ response }) => {
    const id = 'request-invalid-response';
    sendMessage.mockResolvedValueOnce(response);
    await loadBridge();
    messageListener?.(createTestMessageEvent({
      source: pageWindow,
      data: {
        source: 'solanym-provider',
        message: { id, type: 'DAPP_CONNECT', payload: {} },
      },
    }));

    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'solanym-content',
          message: expect.objectContaining({
            id,
            type: 'ERROR',
            error: expect.objectContaining({ name: 'InvalidResponseError' }),
          }),
        }),
        'https://dapp.example',
      ),
    );
    expect(postMessage).not.toHaveBeenCalledWith(
      { source: 'solanym-content', message: response },
      'https://dapp.example',
    );
  });
});
