import { describe, expect, it, vi } from 'vitest';
import { SppHostRemoteSigner } from '../../src/spp-host/sppHostRemoteSigner.js';
import { SPP_HOST_BRIDGE_CHANNEL } from '../../src/shared/sppHostBridge.js';

describe('SppHostRemoteSigner', () => {
  const stellarAddress = 'GCAYPTSHBZPEI273NCQXVBPOFSBONLLWZBKYSRHRLQZQM6MZWVT5MTS7';

  it('routes signTransaction to SW and maps signedTxXdr', async () => {
    const send = vi.fn().mockImplementation(async (message: { id: string }) => ({
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_SIGN_RESULT',
      id: message.id,
      ok: true,
      kind: 'transaction',
      signatureBase64: 'signed-xdr-base64',
      signerAddress: stellarAddress,
    }));

    const signer = new SppHostRemoteSigner({
      stellarAddress,
      networkPassphrase: 'Test SDF Network ; September 2015',
      send,
    });

    const result = await signer.signTransaction('AAAA...');
    expect(result).toEqual({
      signedTxXdr: 'signed-xdr-base64',
      signerAddress: stellarAddress,
    });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]![0].payload.kind).toBe('transaction');
  });

  it('fails closed when SW refuses', async () => {
    const send = vi.fn().mockImplementation(async (message: { id: string }) => ({
      channel: SPP_HOST_BRIDGE_CHANNEL,
      type: 'SPP_HOST_SIGN_RESULT',
      id: message.id,
      ok: false,
      code: 'NYM_REQUIRED',
      message: 'Nym required',
    }));
    const signer = new SppHostRemoteSigner({
      stellarAddress,
      networkPassphrase: 'Test SDF Network ; September 2015',
      send,
    });
    await expect(signer.signMessage('hi')).rejects.toThrow(/NYM_REQUIRED/);
  });
});
