import { describe, expect, it, vi } from 'vitest';
import {
  Account,
  Address,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk';
import { SppHostRemoteSigner } from '../../src/spp-host/sppHostRemoteSigner.js';
import { runWithSppHostFeeScope } from '../../src/spp-host/sppHostFeeScope.js';
import { SPP_HOST_BRIDGE_CHANNEL } from '../../src/shared/sppHostBridge.js';

const ACCOUNT = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';
const POOL = 'CAMWBUWHYXEGBM3Q7M5DBGW7LLJL3I4QGANQEZFEWLRNTOJMTT2WG24U';

function txXdr(fee: string): string {
  const ext = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('ext_amount'),
      val: nativeToScVal(10n, { type: 'i256' }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('recipient'),
      val: Address.fromString(ACCOUNT).toScVal(),
    }),
  ]);
  return new TransactionBuilder(new Account(ACCOUNT, '1'), {
    fee,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.invokeContractFunction({
      contract: POOL,
      function: 'transact',
      args: [xdr.ScVal.scvBytes(Buffer.from([1])), ext, Address.fromString(ACCOUNT).toScVal()],
    }))
    .setTimeout(30)
    .build()
    .toXDR();
}

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

    const result = await runWithSppHostFeeScope({
      operation: 'deposit',
      approvedMaxFeeStroops: '8000000',
      minResourceFeeStroops: null,
      allowedContractId: POOL,
      networkPassphrase: Networks.TESTNET,
    }, () => signer.signTransaction(txXdr('100')));
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

  it('refuses an over-ceiling fee on the host path before forwarding', async () => {
    const send = vi.fn();
    const signer = new SppHostRemoteSigner({
      stellarAddress,
      networkPassphrase: Networks.TESTNET,
      send,
    });
    await expect(runWithSppHostFeeScope({
      operation: 'deposit',
      approvedMaxFeeStroops: '8000000',
      minResourceFeeStroops: '8718236',
      allowedContractId: POOL,
      networkPassphrase: Networks.TESTNET,
    }, () => signer.signTransaction(txXdr('100')))).rejects.toThrow(/minResourceFee/);
    expect(send).not.toHaveBeenCalled();
  });
});
