import { describe, expect, it, vi } from 'vitest';
import { MessageRouter } from '../../src/background/MessageRouter.js';

vi.mock('webextension-polyfill', () => {
  return {
    default: {
      runtime: {
        id: 'test-extension-id',
        getURL: (path: string) => `chrome-extension://test-extension-id${path}`,
      }
    }
  };
});

const mockTrustedSender = {
  id: 'test-extension-id',
  url: 'chrome-extension://test-extension-id/popup.html'
} as any;

describe('MessageRouter', () => {
  it('rejects unauthorized senders', async () => {
    const router = new MessageRouter();
    const result = await router.routeMessage({ id: '1', type: 'UNLOCK_VAULT' }, { id: 'other', url: 'https://evil.com' } as any);
    expect(result.error?.name).toBe('UnauthorizedSenderError');
  });

  it('rejects malformed envelopes', async () => {
    const router = new MessageRouter();
    const result = await router.routeMessage({ totally: 'invalid' }, mockTrustedSender);
    expect(result.type).toBe('ERROR');
    expect(result.error?.name).toBe('MalformedEnvelopeError');
  });

  it('rejects unknown message types', async () => {
    const router = new MessageRouter();
    const result = await router.routeMessage({ id: '123', type: 'SOME_UNKNOWN_TYPE' }, mockTrustedSender);
    expect(result.error?.name).toBe('UnknownMessageTypeError');
  });

  it('rejects unhandled message types even if in schema', async () => {
    const router = new MessageRouter();
    const result = await router.routeMessage({ id: '123', type: 'UNLOCK_VAULT' }, mockTrustedSender);
    // It's in the schema, but no handler was registered
    expect(result.error?.name).toBe('UnknownMessageTypeError');
  });

  it('rejects malformed payloads based on Zod schema', async () => {
    const router = new MessageRouter();
    router.registerHandler('UNLOCK_VAULT', vi.fn());
    
    // UNLOCK_VAULT requires { password: string(min 1) }
    const result1 = await router.routeMessage({ id: '123', type: 'UNLOCK_VAULT', payload: {} }, mockTrustedSender);
    expect(result1.error?.name).toBe('PayloadValidationError');

    const result2 = await router.routeMessage({ id: '124', type: 'UNLOCK_VAULT', payload: { password: '' } }, mockTrustedSender);
    expect(result2.error?.name).toBe('PayloadValidationError');
  });

  it('routes valid messages to handler and returns validated response', async () => {
    const router = new MessageRouter();
    const mockHandler = vi.fn().mockResolvedValue({ success: true });
    router.registerHandler('UNLOCK_VAULT', mockHandler);

    const result = await router.routeMessage({
      id: 'msg-1',
      type: 'UNLOCK_VAULT',
      payload: { password: 'my-password' }
    }, mockTrustedSender);

    expect(mockHandler).toHaveBeenCalledWith({ password: 'my-password' }, mockTrustedSender);
    expect(result.id).toBe('msg-1');
    expect(result.type).toBe('UNLOCK_VAULT');
    expect(result.payload).toEqual({ success: true });
    expect(result.error).toBeUndefined();
  });

  it('safely serializes handler errors without stack traces', async () => {
    const router = new MessageRouter();
    
    class CustomError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'CustomError';
      }
    }

    const mockHandler = vi.fn().mockRejectedValue(new CustomError('Failed to unlock'));
    router.registerHandler('UNLOCK_VAULT', mockHandler);

    const result = await router.routeMessage({
      id: 'msg-2',
      type: 'UNLOCK_VAULT',
      payload: { password: 'my-password' }
    }, mockTrustedSender);

    expect(result.id).toBe('msg-2');
    expect(result.type).toBe('UNLOCK_VAULT');
    expect(result.payload).toBeUndefined();
    expect(result.error).toEqual({
      name: 'CustomError',
      message: 'Failed to unlock'
    });
    // Ensure stack trace is completely absent
    expect((result.error as any).stack).toBeUndefined();
  });

  it('fails if handler returns payload that violates response schema', async () => {
    const router = new MessageRouter();
    // UNLOCK_VAULT response schema expects { success: boolean }
    const mockHandler = vi.fn().mockResolvedValue({ success: 'not-a-boolean' });
    router.registerHandler('UNLOCK_VAULT', mockHandler as any);

    const result = await router.routeMessage({
      id: 'msg-3',
      type: 'UNLOCK_VAULT',
      payload: { password: 'my-password' }
    }, mockTrustedSender);

    // Zod should catch the invalid response and error out safely
    expect(result.error?.name).toBe('ZodError');
    expect(result.payload).toBeUndefined();
  });

  describe('Internal vs DApp Route Security', () => {
    const dAppSender = { id: 'other', url: 'https://dapp.com' } as any;

    it('rejects HTTP/HTTPS senders from accessing REVIEW_TRANSFER', async () => {
      const router = new MessageRouter();
      const result = await router.routeMessage({ id: '1', type: 'REVIEW_TRANSFER', payload: { accountIndex: 0, destination: '11111111111111111111111111111111', lamports: '1000' } }, dAppSender);
      expect(result.error?.name).toBe('UnauthorizedSenderError');
    });

    it('rejects HTTP/HTTPS senders from accessing SEND_TRANSFER', async () => {
      const router = new MessageRouter();
      const result = await router.routeMessage({ id: '2', type: 'SEND_TRANSFER', payload: { id: 'some-uuid' } }, dAppSender);
      expect(result.error?.name).toBe('UnauthorizedSenderError');
    });

    it('allows internal sender to access REVIEW_TRANSFER (assuming handler registered)', async () => {
      const router = new MessageRouter();
      const result = await router.routeMessage({ id: '3', type: 'REVIEW_TRANSFER', payload: { accountIndex: 0, destination: '11111111111111111111111111111111', lamports: '1000' } }, mockTrustedSender);
      expect(result.error?.name).toBe('UnknownMessageTypeError'); // Correctly authorized, but handler missing in test
    });

    describe('recovery phrase reveal authorization', () => {
      const validRevealRequest = {
        id: 'reveal-1',
        type: 'REVEAL_RECOVERY_PHRASE',
        payload: { auth: 'user-password' },
      };

      it.each([
        { id: 'other-extension', url: 'chrome-extension://test-extension-id/popup.html' },
        { id: 'test-extension-id', url: 'chrome-extension://test-extension-id/options.html' },
        { id: 'test-extension-id', url: 'https://example.com/popup.html' },
      ])('rejects a non-popup sender without invoking the handler: %j', async (sender) => {
        const router = new MessageRouter();
        const handler = vi.fn().mockResolvedValue({
          recoveryPhrase: Array.from({ length: 24 }, (_, index) => `synthetic-${index}`),
        });
        router.registerHandler('REVEAL_RECOVERY_PHRASE', handler);

        const result = await router.routeMessage(validRevealRequest, sender as any);

        expect(result.error?.name).toBe('UnauthorizedSenderError');
        expect(handler).not.toHaveBeenCalled();
      });

      it('allows the full-tab webapp to reveal the recovery phrase', async () => {
        const router = new MessageRouter();
        const handler = vi.fn().mockResolvedValue({
          recoveryPhrase: Array.from({ length: 24 }, (_, index) => `synthetic-${index}`),
        });
        router.registerHandler('REVEAL_RECOVERY_PHRASE', handler);
        const sender = {
          id: 'test-extension-id',
          url: 'chrome-extension://test-extension-id/webapp.html',
        };

        const result = await router.routeMessage(validRevealRequest, sender as any);

        expect(handler).toHaveBeenCalledWith(validRevealRequest.payload, sender);
        expect(result.error).toBeUndefined();
      });

      it('allows the exact popup context to invoke the registered handler', async () => {
        const router = new MessageRouter();
        const handler = vi.fn().mockResolvedValue({
          recoveryPhrase: Array.from({ length: 24 }, (_, index) => `synthetic-${index}`),
        });
        router.registerHandler('REVEAL_RECOVERY_PHRASE', handler);

        const result = await router.routeMessage(validRevealRequest, mockTrustedSender);

        expect(handler).toHaveBeenCalledWith(validRevealRequest.payload, mockTrustedSender);
        expect(result.error).toBeUndefined();
        expect(result.payload).toEqual({
          recoveryPhrase: Array.from({ length: 24 }, (_, index) => `synthetic-${index}`),
        });
      });
    });
  });
});

describe('IPC safety � absent response guard (sendIpcMessage contract)', () => {
  // The background listener is async. Chrome MV3 Service Workers can return
  // undefined when woken up: the popup must not crash on a missing response.

  it('routeMessage always returns a structured envelope (never undefined)', async () => {
    // Even with malformed input, routeMessage must return an envelope
    const router = new MessageRouter();
    const result = await router.routeMessage(null, mockTrustedSender);
    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
    expect(result.error).toBeDefined();
  });

  it('routeMessage returns error envelope when handler rejects during init', async () => {
    const router = new MessageRouter();
    const failHandler = vi.fn().mockRejectedValue(new Error('Service not ready'));
    router.registerHandler('GET_WALLET_STATE', failHandler as any);
    const result = await router.routeMessage(
      { id: 'init-race', type: 'GET_WALLET_STATE', payload: {} },
      mockTrustedSender
    );
    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('Service not ready');
    // The error must never include stack traces
    expect((result.error as any)?.stack).toBeUndefined();
  });
});
