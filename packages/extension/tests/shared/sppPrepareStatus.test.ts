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

  it('describes every prepare phase including missing config/keys', () => {
    expect(describeSppPreparePhase('ready')).toMatch(/Listo/i);
    expect(describeSppPreparePhase('awaiting_pool_config')).toMatch(/pool/i);
    expect(describeSppPreparePhase('missing_configuration')).toMatch(/deployments/i);
    expect(describeSppPreparePhase('missing_proving_keys')).toMatch(/proving/i);
    expect(describeSppPreparePhase('read_only')).toMatch(/lectura/i);
    expect(describeSppPreparePhase('failed')).toMatch(/fallida/i);
  });

  it('only write-ready when phase is ready', () => {
    expect(isSppWriteReady(createIdleSppPrepareStatus({ phase: 'assets_ready' }))).toBe(false);
    expect(isSppWriteReady(createIdleSppPrepareStatus({ phase: 'read_only' }))).toBe(false);
    expect(isSppWriteReady(createIdleSppPrepareStatus({ phase: 'ready' }))).toBe(true);
  });

  it('can carry Nethermind public ownership metadata without inventing ready', () => {
    const status = createIdleSppPrepareStatus({
      phase: 'assets_ready',
      deploymentOwnership: 'nethermind_public',
      deploymentLabel: 'Nethermind public Testnet (XLM)',
      poolContract: 'CAMWBUWHYXEGBM3Q7M5DBGW7LLJL3I4QGANQEZFEWLRNTOJMTT2WG24U',
    });
    expect(status.deploymentOwnership).toBe('nethermind_public');
    expect(isSppWriteReady(status)).toBe(false);
  });
});
