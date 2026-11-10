import { describe, expect, it } from 'vitest';
import {
  SppPoolExecuteError,
  mapSdkPoolExecuteResult,
} from '../../src/spp-host/sppHostWritePoolFactory.js';

describe('mapSdkPoolExecuteResult', () => {
  it('keeps every completed hash and does not confirm a prefix', () => {
    const failed = () => mapSdkPoolExecuteResult({
      status: 'failed',
      hashes: ['step-1', 'step-2'],
      message: 'submit stopped',
    });
    expect(failed).toThrow(SppPoolExecuteError);
    try {
      failed();
    } catch (cause) {
      expect(cause).toBeInstanceOf(SppPoolExecuteError);
      if (cause instanceof SppPoolExecuteError) {
        expect(cause.txHashes).toEqual(['step-1', 'step-2']);
        expect(cause.message).toContain('step-1');
        expect(cause.message).toContain('step-2');
      }
    }
    expect(mapSdkPoolExecuteResult({
      status: 'ok',
      hashes: ['only'],
    })).toEqual({ txHash: 'only', txHashes: ['only'] });
    expect(mapSdkPoolExecuteResult({
      status: 'ok',
      hashes: ['first', 'second'],
    })).toEqual({ txHash: null, txHashes: ['first', 'second'] });
  });
});
