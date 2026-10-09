import { describe, expect, it } from 'vitest';
import { TransactionValidator } from '../../../src/solana/transaction/TransactionValidator.js';
import {
  address,
  Address,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageEncoder,
  createTransactionMessage, compressTransactionMessageUsingAddressLookupTables,
  setTransactionMessageFeePayer,
  appendTransactionMessageInstruction,
  setTransactionMessageLifetimeUsingBlockhash,
  compileTransactionMessage,
  AccountRole,
  getU64Encoder,
  SignatureBytes,
  Blockhash,
  getBase64Encoder,
  getTransactionDecoder,
  getCompiledTransactionMessageDecoder
} from '@solana/kit';
import { InvalidTransactionStructureError, InvalidTransactionAmountError } from '../../../src/solana/transaction/types.js';

describe('TransactionValidator', () => {
  const validator = new TransactionValidator();

  const sourceAddr = address('5MhxctG6wFymx3i3gZ87J9RzyMow8yB4G2W3q3nS6h8Z');
  const destAddr = address('G3GvQxTfBfQfV9zY1U1yF1QyB4G2W3q3nS6h8Z1U1yF1');
  const programId = address('11111111111111111111111111111111');
  const dummyBlockhash = '44444444444444444444444444444444' as Blockhash;
  const mockSignature = new Uint8Array(64).fill(1) as SignatureBytes;

  function createMockBase64Tx(lamports: bigint, progId = programId, dataBytes?: Uint8Array, accounts = [{ address: sourceAddr, role: AccountRole.WRITABLE_SIGNER }, { address: destAddr, role: AccountRole.WRITABLE }]) {
    const data = dataBytes || new Uint8Array([2, 0, 0, 0, ...getU64Encoder().encode(lamports)]);
    const instruction = {
      programAddress: progId,
      accounts: accounts,
      data: data,
    };

    let msg = createTransactionMessage({ version: 0 }) as any;
    const feePayer = accounts.find(a => a.role === AccountRole.WRITABLE_SIGNER || a.role === AccountRole.READONLY_SIGNER)?.address || sourceAddr;
    
    msg = setTransactionMessageFeePayer(feePayer, msg);
    msg = setTransactionMessageLifetimeUsingBlockhash({ blockhash: dummyBlockhash, lastValidBlockHeight: 123n }, msg);
    msg = appendTransactionMessageInstruction(instruction, msg);

    const compiledMessage = compileTransactionMessage(msg);
    const messageBytes = getCompiledTransactionMessageEncoder().encode(compiledMessage);
    
    const signatures: Record<Address, SignatureBytes> = {};
    if (compiledMessage.header.numSignerAccounts > 0) {
      for (let i = 0; i < compiledMessage.header.numSignerAccounts; i++) {
        signatures[compiledMessage.staticAccounts[i] as Address] = mockSignature;
      }
    }
    
    const signedTx = { messageBytes, signatures };
    return getBase64EncodedWireTransaction(signedTx as any);
  }

  function createDoubleInstructionBase64Tx(lamports: bigint) {
    const data = new Uint8Array([2, 0, 0, 0, ...getU64Encoder().encode(lamports)]);
    const instruction = {
      programAddress: programId,
      accounts: [{ address: sourceAddr, role: AccountRole.WRITABLE_SIGNER }, { address: destAddr, role: AccountRole.WRITABLE }],
      data: data,
    };

    const msg0 = createTransactionMessage({ version: 0 });
      const msg1 = setTransactionMessageFeePayer(sourceAddr, msg0);
      const msg2 = setTransactionMessageLifetimeUsingBlockhash({ blockhash: dummyBlockhash, lastValidBlockHeight: 123n }, msg1);
      const msg3 = appendTransactionMessageInstruction(instruction, msg2);
    const msg = appendTransactionMessageInstruction(instruction, msg3);

    const compiledMessage = compileTransactionMessage(msg);
    const messageBytes = getCompiledTransactionMessageEncoder().encode(compiledMessage);
    const signedTx = { messageBytes, signatures: { [sourceAddr]: mockSignature } };
    return getBase64EncodedWireTransaction(signedTx as any);
  }

  it('validates a correct System Program SOL transfer', () => {
    const b64 = createMockBase64Tx(1500000n);
    const result = validator.validateExternalTransaction(b64);
    expect(result.sourceAddress).toBe(sourceAddr);
    expect(result.destinationAddress).toBe(destAddr);
    expect(result.lamports).toBe(1500000n);
  });

  it('rejects multiple instructions', () => {
    const b64 = createDoubleInstructionBase64Tx(1000n);
    expect(() => validator.validateExternalTransaction(b64)).toThrowError(/exactly one instruction/);
  });

  it('rejects non-System program', () => {
    const b64 = createMockBase64Tx(1000n, address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') as any);
    expect(() => validator.validateExternalTransaction(b64)).toThrowError(/Only System Program is allowed/);
  });

  it('rejects malformed instruction data length', () => {
    const b64 = createMockBase64Tx(1000n, programId, new Uint8Array(10).fill(2));
    expect(() => validator.validateExternalTransaction(b64)).toThrowError(/Expected 12 bytes/);
  });

  it('rejects non-transfer instruction (wrong discriminator)', () => {
    const data = new Uint8Array([3, 0, 0, 0, ...getU64Encoder().encode(100n)]);
    const b64 = createMockBase64Tx(1000n, programId, data);
    expect(() => validator.validateExternalTransaction(b64)).toThrowError(/Only System Transfer is allowed/);
  });

  it('rejects zero or negative lamports', () => {
    const b64 = createMockBase64Tx(0n);
    expect(() => validator.validateExternalTransaction(b64)).toThrowError(InvalidTransactionAmountError);
  });

  it('rejects source account if it is not a signer', () => {
    const b64 = createMockBase64Tx(100n, programId, undefined, [
      { address: sourceAddr, role: AccountRole.WRITABLE }, 
      { address: destAddr, role: AccountRole.WRITABLE_SIGNER }
    ]);
    expect(() => validator.validateExternalTransaction(b64)).toThrowError(/Source account must be a signer/);
  });

  it('rejects if invalid base64 is passed', () => {
    expect(() => validator.validateExternalTransaction('!@#$%^')).toThrowError(/Invalid base64/);
  });

  it('rejects duplicate account index (source == dest)', () => {
    const b64 = createMockBase64Tx(100n, programId, undefined, [
      { address: sourceAddr, role: AccountRole.WRITABLE_SIGNER }, 
      { address: sourceAddr, role: AccountRole.WRITABLE }
    ]);
    expect(() => validator.validateExternalTransaction(b64)).toThrowError(/cannot be identical/);
  });

  it('rejects if source account is not writable', () => {
    const data = new Uint8Array([2, 0, 0, 0, ...getU64Encoder().encode(100n)]);
    const instruction = {
      programAddress: programId,
      accounts: [
        { address: sourceAddr, role: AccountRole.READONLY_SIGNER }, 
        { address: destAddr, role: AccountRole.WRITABLE }
      ],
      data: data,
    };

    const msg0 = createTransactionMessage({ version: 0 });
      const msg1 = setTransactionMessageFeePayer(destAddr, msg0);
      const msg2 = setTransactionMessageLifetimeUsingBlockhash({ blockhash: dummyBlockhash, lastValidBlockHeight: 123n }, msg1);
      const msg = appendTransactionMessageInstruction(instruction, msg2);

    const compiledMessage = compileTransactionMessage(msg);
    const messageBytes = getCompiledTransactionMessageEncoder().encode(compiledMessage);
    
    const signatures: Record<Address, SignatureBytes> = {};
    for (let i = 0; i < compiledMessage.header.numSignerAccounts; i++) {
      signatures[compiledMessage.staticAccounts[i] as Address] = mockSignature;
    }
    
    const signedTx = { messageBytes, signatures };
    const b64 = getBase64EncodedWireTransaction(signedTx as any);
    
    expect(() => validator.validateExternalTransaction(b64)).toThrowError(/Source account must be writable/);
  });

  it('rejects if destination account is not writable', () => {
    const b64 = createMockBase64Tx(100n, programId, undefined, [
      { address: sourceAddr, role: AccountRole.WRITABLE_SIGNER }, 
      { address: destAddr, role: AccountRole.READONLY }
    ]);
    expect(() => validator.validateExternalTransaction(b64)).toThrowError(/Destination account must be writable/);
  });

  it('rejects instruction data longer than 12 bytes', () => {
    const data = new Uint8Array([2, 0, 0, 0, ...getU64Encoder().encode(100n), 0, 0, 0, 0]);
    const b64 = createMockBase64Tx(100n, programId, data);
    expect(() => validator.validateExternalTransaction(b64)).toThrowError(/Expected 12 bytes/);
  });

  it('rejects missing or wrong accounts length', () => {
    const b64 = createMockBase64Tx(100n, programId, undefined, [{ address: sourceAddr, role: AccountRole.WRITABLE_SIGNER }]);
    expect(() => validator.validateExternalTransaction(b64)).toThrowError(/must specify exactly 2 accounts/);
  });

  it('handles very large u64 lamport values without precision loss', () => {
    const b64 = createMockBase64Tx(18446744073709551615n);
    const result = validator.validateExternalTransaction(b64);
    expect(result.lamports).toBe(18446744073709551615n);
  });

      it('rejects transactions using Address Lookup Tables (V0) - canonical construction', () => {
    const instruction = {
      programAddress: programId,
      accounts: [
        { address: sourceAddr, role: AccountRole.WRITABLE_SIGNER },
        { address: destAddr, role: AccountRole.WRITABLE }
      ],
      data: new Uint8Array([2, 0, 0, 0, ...getU64Encoder().encode(50n)])
    };

    const msg0 = createTransactionMessage({ version: 0 });
      const msg1 = setTransactionMessageFeePayer(sourceAddr, msg0);
      const msg2 = setTransactionMessageLifetimeUsingBlockhash({ blockhash: dummyBlockhash, lastValidBlockHeight: 123n }, msg1);
      const msg3 = appendTransactionMessageInstruction(instruction, msg2);

    const lookupTableAddress = address('ALTGvQxTfBfQfV9zY1U1yF1QyB4G2W3q3nS6h8Z1U1yF');
    const msg = compressTransactionMessageUsingAddressLookupTables(msg3, { [lookupTableAddress]: [destAddr] });

    const compiledMessage = compileTransactionMessage(msg);
    const messageBytes = getCompiledTransactionMessageEncoder().encode(compiledMessage);
    const signedTx = { messageBytes, signatures: { [sourceAddr]: mockSignature } };
    const b64 = getBase64EncodedWireTransaction(signedTx as any);

    expect(() => validator.validateExternalTransaction(b64)).toThrowError(/Transactions with Address Lookup Tables are not supported/);
  });

  it('rejects transactions with unused Address Lookup Tables', () => {
    const msgBytes = [
      0x80, // version 0
      1, // numSignerAccounts
      0, // numReadonlySignerAccounts
      1, // numReadonlyNonSignerAccounts
      2, // 2 static accounts
      ...new Uint8Array(32).fill(2), // source account
      ...new Uint8Array(32).fill(0), // system program
      ...new Uint8Array(32).fill(3), // fake blockhash
      1, // 1 instruction
      1, // program index (SYSTEM_PROGRAM_ID)
      2, // 2 account indices
      0, 1, // 0 = source, 1 = system program (valid static accounts)
      12, // data length
      2, 0, 0, 0, 50, 0, 0, 0, 0, 0, 0, 0, // transfer data
      1, // 1 address table lookup
      ...new Uint8Array(32).fill(4), // ALT address
      1, // 1 writable index
      0, // index 0 in ALT
      0 // 0 readonly indices
    ];

    const signedTx = {
      messageBytes: new Uint8Array(msgBytes),
      signatures: {
        [sourceAddr]: mockSignature
      }
    };
    const unusedAltBase64 = getBase64EncodedWireTransaction(signedTx as any);

    // Decode and verify the structure before testing rejection
    const wireBytes = getBase64Encoder().encode(unusedAltBase64) as unknown as Uint8Array;
    const decodedTx = getTransactionDecoder().decode(wireBytes);
    const decodedMsg = getCompiledTransactionMessageDecoder().decode(decodedTx.messageBytes);

    expect(decodedMsg.version).toBe(0);
    expect(decodedMsg.staticAccounts.length).toBe(2);
    expect(decodedMsg.header.numSignerAccounts).toBe(1);

    const signerAddress = decodedMsg.staticAccounts[0];
    expect(signerAddress).toBe(Object.keys(decodedTx.signatures)[0]);

    // Instruction account indices [0, 1] - NOT using the lookup table
    const instr = (decodedMsg as any).instructions[0];
    expect(instr.programAddressIndex).toBe(1);
    expect(instr.accountIndices).toEqual([0, 1]);

    // But lookup table IS present
    const lookups = (decodedMsg as any).addressTableLookups;
    expect(lookups.length).toBe(1);
    expect(lookups[0].writableIndexes).toEqual([0]);

    expect(() => {
      validator.validateExternalTransaction(unusedAltBase64);
    }).toThrowError(/Transactions with Address Lookup Tables are not supported/);
  });
    it('rejects undecodable/corrupted messages', () => {
    expect(() => validator.validateExternalTransaction('AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQGAAQABAgICAgICAgICAgIC')).toThrowError(/Failed to decode/);
  });
});

