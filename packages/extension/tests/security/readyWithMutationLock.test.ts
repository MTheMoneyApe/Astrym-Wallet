import { describe, expect, it, vi, beforeEach } from 'vitest';
import { stateCoordinator } from '../../src/background/StateCoordinator.js';

vi.mock('webextension-polyfill', () => {
  return {
    default: {
      storage: {
        local: {
          get: vi.fn(),
          set: vi.fn(),
          remove: vi.fn()
        }
      },
      runtime: {
        id: 'test'
      }
    }
  };
});

describe('READY_WITH_MUTATION_LOCK security invariants', () => {
  beforeEach(() => {
    // Reset stateCoordinator internal state using any
    (stateCoordinator as any)._state = 'READY_WITH_MUTATION_LOCK';
  });

  it('authorizeSignature() throws when state is READY_WITH_MUTATION_LOCK', () => {
    expect(() => stateCoordinator.authorizeSignature()).toThrow('System is in a degraded or locked state');
  });
});
