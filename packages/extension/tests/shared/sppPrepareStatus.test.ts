import { describe, expect, it } from 'vitest';
import {
  createIdleSppPrepareStatus,
  describeSppPreparePhase,
  isSppWriteReady,
} from '../../src/shared/sppPrepareStatus.js';

describe('sppPrepareStatus', () => {
  it('creates idle status without inventing ready', () => {
    const status = createIdleSppPrepareStatus();
    expect(status.phase).toBe('idle');
    expect(isSppWriteReady(status)).toBe(false);
  });

  it('describes every prepare phase', () => {
    expect(describeSppPreparePhase('ready')).toMatch(/Listo/i);
    expect(describeSppPreparePhase('awaiting_pool_config')).toMatch(/pool/i);
    expect(describeSppPreparePhase('failed')).toMatch(/fallida/i);
  });

  it('only write-ready when phase is ready', () => {
    expect(isSppWriteReady(createIdleSppPrepareStatus({ phase: 'assets_ready' }))).toBe(false);
    expect(isSppWriteReady(createIdleSppPrepareStatus({ phase: 'ready' }))).toBe(true);
  });
});
