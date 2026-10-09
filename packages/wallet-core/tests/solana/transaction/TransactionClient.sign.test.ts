import type { Blockhash } from '@solana/kit';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TransactionClient } from '../../../src/solana/transaction/TransactionClient.js';
import { TransactionError } from '../../../src/solana/transaction/types.js';
import { 
  address, 
  getCompiledTransactionMessageEncoder, 
  createTransactionMessage, 
  setTransactionMessageFeePayer, 
  appendTransactionMessageInstruction, 
  setTransactionMessageLifetimeUsingBlockhash, 
  compileTransactionMessage, 
  getBase58Encoder,
  getBase58Decoder,
  getTransactionDecoder,
  getBase64Decoder,
  getBase64Encoder
} from '@solana/kit';

describe('TransactionClient - signTransaction', () => {
  const dummyBlockhash = '44444444444444444444444444444444';
  const sourceAddr = address('5MhxctG6wFymx3i3gZ87J9RzyMow8yB4G2W3q3nS6h8Z'); 
  const destAddr = address('G3GvQxTfBfQfV9zY1U1yF1QyB4G2W3q3nS6h8Z1U1yF1');
  const programId = address('11111111111111111111111111111111');

  let mockRpc: any;
  let mockKeyManager: any;
  let mockSigner: any;
  let client: TransactionClient;

  beforeEach(() => {
    mockRpc = {
      sendTransaction: vi.fn(),
      getLatestBlockhash: vi.fn(),
    };

    mockKeyManager = {
      getAccounts: vi.fn().mockResolvedValue([
        { index: 0, publicKey: getBase58Encoder().encode(sourceAddr) },
        { index: 1, publicKey: getBase58Encoder().encode(destAddr) }
      ]),
    };

    mockSigner = {
      sign: vi.fn().mockImplementation((idx, bytes) => {
        // mock 64 byte signature
        return Promise.resolve(new Uint8Array(64).fill(idx + 1));
      })
    };

    client = new TransactionClient(mockRpc, mockKeyManager, mockSigner);
  });

  function createValidMessageBytes(feePayer: string = sourceAddr) {
    const instruction = {
      programAddress: programId,
      accounts: [
        { address: sourceAddr, role: 3 },
        { address: destAddr, role: 1 }
      ] as any,
      data: new Uint8Array([2, 0, 0, 0, 100, 0, 0, 0, 0, 0, 0, 0]),
    };

    const txMsg0 = createTransactionMessage({ version: 0 });
    const txMsg1 = setTransactionMessageFeePayer(address(feePayer), txMsg0);
    const txMsg2 = setTransactionMessageLifetimeUsingBlockhash({ blockhash: dummyBlockhash as Blockhash, lastValidBlockHeight: 123n }, txMsg1);
    const txMsg3 = appendTransactionMessageInstruction(instruction, txMsg2);
    const compiledMessage = compileTransactionMessage(txMsg3);
    return getCompiledTransactionMessageEncoder().encode(compiledMessage);
  }

  it('valid sign-only transaction', async () => {
    const msgBytes = new Uint8Array(createValidMessageBytes(sourceAddr));
    const result = await client.signTransaction(0, msgBytes);
    
    expect(result.signature).toBeTruthy();
    expect(result.transactionBase64).toBeTruthy();
    
    // sign-only path never calls sendTransaction
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
    // exact messageBytes passed to SoftwareSigner
    expect(mockSigner.sign).toHaveBeenCalledWith(0, msgBytes);
  });

  it('CRITICAL BYTE-INTEGRITY TEST: returned signed transaction contains exactly those messageBytes', async () => {
    const originalBytes = new Uint8Array(createValidMessageBytes(sourceAddr));
    
    // clone to ensure client doesn't mutate
    const clonedBytes = new Uint8Array(originalBytes);
    const result = await client.signTransaction(0, clonedBytes);
    
    // exact bytes passed to signer
    expect(mockSigner.sign).toHaveBeenCalledWith(0, originalBytes);
    
    // decode the returned base64 transaction
    const wireBytes = getBase64Encoder().encode(result.transactionBase64);
    const decodedTx = getTransactionDecoder().decode(wireBytes);
    
    // asserts its message bytes are byte-for-byte identical to the original
    expect(decodedTx.messageBytes).toEqual(originalBytes);
    
    // verifies the signature against the original message bytes (mock signature filled with 1s)
    const expectedSig = new Uint8Array(64).fill(1); // index 0 + 1 = 1
    const returnedSigInTx = decodedTx.signatures[sourceAddr];
    expect(returnedSigInTx).toEqual(expectedSig);
    
    // verifies the returned signature string matches
    expect(result.signature).toBe(getBase58Decoder().decode(expectedSig));
  });

  it('account mismatch rejected (message expects different signer)', async () => {
    // message fee payer is destAddr (index 1)
    const msgBytes = new Uint8Array(createValidMessageBytes(destAddr));
    
    // but we ask to sign with account index 0 (sourceAddr)
    await expect(client.signTransaction(0, msgBytes)).rejects.toThrowError(/Account mismatch/);
  });

  it('invalid account index rejected', async () => {
    const msgBytes = new Uint8Array(createValidMessageBytes(sourceAddr));
    await expect(client.signTransaction(99, msgBytes)).rejects.toThrowError(/not found/);
  });

  it('empty message rejected', async () => {
    await expect(client.signTransaction(0, new Uint8Array())).rejects.toThrowError(/empty/);
  });

  it('malformed message handling', async () => {
    const badBytes = new Uint8Array([1, 2, 3]);
    await expect(client.signTransaction(0, badBytes)).rejects.toThrowError(/Failed to decode messageBytes/);
  });

  it('existing sendSol() behavior remains unchanged', async () => {
    // mock getLatestBlockhash
    mockRpc.getLatestBlockhash.mockReturnValue({
      send: vi.fn().mockResolvedValue({ value: { blockhash: dummyBlockhash as Blockhash, lastValidBlockHeight: 123n } })
    });
    mockRpc.sendTransaction.mockReturnValue({
      send: vi.fn().mockResolvedValue('fake_signature')
    });
    
    const result = await client.sendSol({
      sourceAccountIndex: 0,
      destination: destAddr,
      lamports: 100n
    });
    
    expect(result).toBe('fake_signature');
    expect(mockRpc.sendTransaction).toHaveBeenCalled();
  });
});
