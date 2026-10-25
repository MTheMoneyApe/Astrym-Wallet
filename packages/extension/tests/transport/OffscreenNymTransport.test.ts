import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createOffscreenNymTransport } from '../../src/background/transport/OffscreenNymTransport.js';
import { RpcMethodNotAllowedError, RpcTimeoutError } from '@solanym/wallet-core/src/solana/transport/HttpTransport.js';
import browser from 'webextension-polyfill';

describe('OffscreenNymTransport', () => {
  const config = { network: 'devnet', rpcUrl: 'https://api.devnet.solana.com' };

  beforeEach(() => {
    vi.resetAllMocks();
    global.chrome = {
      runtime: {
        getContexts: vi.fn().mockResolvedValue([]),
        getURL: vi.fn().mockReturnValue('chrome-extension://id/offscreen.html'),
        sendMessage: vi.fn(),
        lastError: undefined,
        ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' }
      },
      offscreen: {
        createDocument: vi.fn().mockResolvedValue(undefined),
        Reason: { WORKERS: 'WORKERS' }
      }
    } as any;
  });

  it('rejects unsupported networks immediately', () => {
    expect(() => createOffscreenNymTransport({ network: 'mainnet' } as any)).toThrow('network must be devnet');
  });

  it('rejects disallowed methods without invoking offscreen', async () => {
    const transport = createOffscreenNymTransport(config as any);
    await expect(transport({ payload: { jsonrpc: '2.0', id: 1, method: 'requestAirdrop' } }))
      .rejects.toThrow(RpcMethodNotAllowedError);
    expect(chrome.offscreen.createDocument).not.toHaveBeenCalled();
  });

  it('creates offscreen document if missing and sends message', async () => {
    const transport = createOffscreenNymTransport(config as any);
    const promise = transport({ payload: { jsonrpc: '2.0', id: 1, method: 'getBalance', params: ['83astBRguLMdt2h5U1Tpdq5tjFoJ6noeGwaY3mDLVcri'] } });
    
    await new Promise(r => process.nextTick(r));
    
    expect(chrome.offscreen.createDocument).toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'NYM_RPC_REQUEST', data: expect.objectContaining({ rpcUrl: 'https://api.devnet.solana.com' }) }),
      expect.any(Function)
    );
  });

  it('resolves on successful message response', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(
      (extensionId: string | null | undefined | unknown, message?: unknown, options?: unknown, callback?: unknown) => {
        const cb = (typeof extensionId === 'function' ? extensionId : typeof message === 'function' ? message : typeof options === 'function' ? options : callback) as ((response: unknown) => void) | undefined;
        if (cb) cb({ success: true, data: { result: 'ok' } });
      }
    );
    
    const transport = createOffscreenNymTransport(config as any);
    const result = await transport({ payload: { jsonrpc: '2.0', id: 1, method: 'getBalance', params: ['83astBRguLMdt2h5U1Tpdq5tjFoJ6noeGwaY3mDLVcri'] } });
    expect(result).toEqual({ result: 'ok' });
  });

  it('rejects on explicit nym failure', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(
      (extensionId: string | null | undefined | unknown, message?: unknown, options?: unknown, callback?: unknown) => {
        const cb = (typeof extensionId === 'function' ? extensionId : typeof message === 'function' ? message : typeof options === 'function' ? options : callback) as ((response: unknown) => void) | undefined;
        if (cb) cb({ success: false, error: 'Mixnet disconnected' });
      }
    );
    
    const transport = createOffscreenNymTransport(config as any);
    await expect(transport({ payload: { jsonrpc: '2.0', id: 1, method: 'getBalance', params: ['83astBRguLMdt2h5U1Tpdq5tjFoJ6noeGwaY3mDLVcri'] } }))
      .rejects.toThrow('Mixnet disconnected');
  });

  it('times out safely', async () => {
    const transport = createOffscreenNymTransport(config as any, { timeoutMs: 50 });
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(() => {});
    
    await expect(transport({ payload: { jsonrpc: '2.0', id: 1, method: 'getBalance', params: ['83astBRguLMdt2h5U1Tpdq5tjFoJ6noeGwaY3mDLVcri'] } }))
      .rejects.toThrow(RpcTimeoutError);
  });
});

