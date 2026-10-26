import { describe, expect, it } from 'vitest';

import {
  isNymOffscreenRequest,
  nymOffscreenError,
  nymOffscreenOk,
  NYM_OFFSCREEN_CHANNEL,
  NYM_OFFSCREEN_TARGET,
} from '../../src/nym-offscreen/protocol.js';

describe('Nym offscreen protocol validation', () => {
  it('accepts well-formed connect/status/fetch requests', () => {
    expect(
      isNymOffscreenRequest({
        channel: NYM_OFFSCREEN_CHANNEL,
        target: NYM_OFFSCREEN_TARGET,
        type: 'connect',
        id: '1',
      }),
    ).toBe(true);
    expect(
      isNymOffscreenRequest({
        channel: NYM_OFFSCREEN_CHANNEL,
        target: NYM_OFFSCREEN_TARGET,
        type: 'status',
        id: '2',
      }),
    ).toBe(true);
    expect(
      isNymOffscreenRequest({
        channel: NYM_OFFSCREEN_CHANNEL,
        target: NYM_OFFSCREEN_TARGET,
        type: 'fetch',
        id: '3',
        url: 'https://example.invalid/accounts/G',
      }),
    ).toBe(true);
  });

  it('rejects malformed messages', () => {
    expect(isNymOffscreenRequest(null)).toBe(false);
    expect(isNymOffscreenRequest({ channel: 'other', target: NYM_OFFSCREEN_TARGET, type: 'ping', id: '1' })).toBe(
      false,
    );
    expect(
      isNymOffscreenRequest({
        channel: NYM_OFFSCREEN_CHANNEL,
        target: NYM_OFFSCREEN_TARGET,
        type: 'fetch',
        id: '1',
      }),
    ).toBe(false);
    expect(
      isNymOffscreenRequest({
        channel: NYM_OFFSCREEN_CHANNEL,
        target: NYM_OFFSCREEN_TARGET,
        type: 'explode',
        id: '1',
      }),
    ).toBe(false);
  });

  it('builds typed ok/error responses', () => {
    expect(nymOffscreenOk('a', { pong: true })).toMatchObject({
      ok: true,
      id: 'a',
      channel: NYM_OFFSCREEN_CHANNEL,
    });
    expect(nymOffscreenError('b', 'NOT_CONNECTED', 'nope')).toMatchObject({
      ok: false,
      error: { code: 'NOT_CONNECTED' },
    });
  });
});
