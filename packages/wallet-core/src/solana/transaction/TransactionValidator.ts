import { 
  address, 
  getBase64Encoder, 
  getTransactionDecoder, 
  getCompiledTransactionMessageDecoder,
  isAddress,
  type Address
} from '@solana/kit';
import { InvalidTransactionStructureError, InvalidDestinationError, InvalidTransactionAmountError, TransactionError } from './types.js';

export interface ValidatedSolTransfer {
  sourceAddress: Address;
  destinationAddress: Address;
  lamports: bigint;
  messageBytes: Uint8Array;
}

const SYSTEM_PROGRAM_ID = address('11111111111111111111111111111111');
const TRANSFER_INSTRUCTION_INDEX = 2;

export class TransactionValidator {
  /**
   * Safely decodes a base58 address string.
   */
  private _validateAddress(pubkey: string): Address {
    if (!isAddress(pubkey)) {
      throw new InvalidDestinationError('Invalid destination address format');
    }
    return address(pubkey);
  }

  /**
   * Validates an externally supplied base64 transaction string.
   * Ensures it is exactly a System Program SOL transfer.
   * Returns a sanitized object containing the exact message bytes to be signed.
   */
  validateExternalTransaction(base64Tx: string): ValidatedSolTransfer {
    let wireBytes: any;
    try {
      wireBytes = getBase64Encoder().encode(base64Tx) as unknown as Uint8Array;
    } catch (e) {
      throw new InvalidTransactionStructureError('Invalid base64 transaction encoding', e);
    }

    let decodedTx;
    try {
      decodedTx = getTransactionDecoder().decode(wireBytes);
    } catch (e) {
      throw new InvalidTransactionStructureError('Failed to decode Solana wire transaction', e);
    }

    let decodedMsg;
    try {
      decodedMsg = getCompiledTransactionMessageDecoder().decode(decodedTx.messageBytes);
    } catch (e) {
      throw new InvalidTransactionStructureError('Failed to decode compiled transaction message', e);
    }

    if (!(decodedMsg as any).instructions || (decodedMsg as any).instructions.length !== 1) {
      throw new InvalidTransactionStructureError('Transaction must contain exactly one instruction');
    }

    if ('addressTableLookups' in decodedMsg && Array.isArray((decodedMsg as any).addressTableLookups) && (decodedMsg as any).addressTableLookups.length > 0) {
      throw new InvalidTransactionStructureError('Transactions with Address Lookup Tables are not supported');
    }

    const instruction = (decodedMsg as any).instructions[0];
    const programId = decodedMsg.staticAccounts[instruction.programAddressIndex];

    if (programId !== SYSTEM_PROGRAM_ID) {
      throw new InvalidTransactionStructureError('Unsupported program: Only System Program is allowed');
    }

    if (instruction.data.length !== 12) {
      throw new InvalidTransactionStructureError('Invalid instruction data length: Expected 12 bytes');
    }

    const view = new DataView(instruction.data.buffer, instruction.data.byteOffset, instruction.data.byteLength);
    const discriminator = view.getUint32(0, true);

    if (discriminator !== TRANSFER_INSTRUCTION_INDEX) {
      throw new InvalidTransactionStructureError('Unsupported instruction: Only System Transfer is allowed');
    }

    const lamports = view.getBigUint64(4, true);
    if (lamports <= 0n) {
      throw new InvalidTransactionAmountError('Transfer amount must be strictly positive');
    }

    if (!instruction.accountIndices || instruction.accountIndices.length !== 2) {
      throw new InvalidTransactionStructureError('Invalid accounts: System Transfer must specify exactly 2 accounts');
    }

    const sourceIndex = instruction.accountIndices[0];
    const destIndex = instruction.accountIndices[1];

    if (sourceIndex === destIndex) {
      throw new InvalidTransactionStructureError('Source and destination accounts cannot be identical');
    }

    if (sourceIndex >= decodedMsg.staticAccounts.length || destIndex >= decodedMsg.staticAccounts.length) {
      throw new InvalidTransactionStructureError('Account index out of bounds');
    }

    // Source must be a signer. 
    // The first `numSignerAccounts` in staticAccounts are signers.
    if (sourceIndex >= decodedMsg.header.numSignerAccounts) {
      throw new InvalidTransactionStructureError('Source account must be a signer');
    }

    // Source must be writable.
    // The first `numSignerAccounts - numReadonlySignerAccounts` are writable signers.
    const writableSignersCount = decodedMsg.header.numSignerAccounts - decodedMsg.header.numReadonlySignerAccounts;
    if (sourceIndex >= writableSignersCount) {
      throw new InvalidTransactionStructureError('Source account must be writable');
    }

    // Destination must be writable.
    // Static accounts list structure: 
    // 1. Writable signers
    // 2. Readonly signers
    // 3. Writable non-signers
    // 4. Readonly non-signers
    // So destination must NOT be readonly.
    // It is writable if it is < writableSignersCount OR if it is in the writable non-signers block.
    // Writable non-signers start at index `numSignerAccounts` and end at `staticAccounts.length - numReadonlyNonSignerAccounts`.
    const readonlyNonSignersStartIndex = decodedMsg.staticAccounts.length - decodedMsg.header.numReadonlyNonSignerAccounts;
    const isWritableSigner = destIndex < writableSignersCount;
    const isWritableNonSigner = destIndex >= decodedMsg.header.numSignerAccounts && destIndex < readonlyNonSignersStartIndex;
    
    if (!isWritableSigner && !isWritableNonSigner) {
      throw new InvalidTransactionStructureError('Destination account must be writable');
    }

    const sourceAddress = this._validateAddress(decodedMsg.staticAccounts[sourceIndex] as string);
    const destinationAddress = this._validateAddress(decodedMsg.staticAccounts[destIndex] as string);

    return { sourceAddress, destinationAddress, lamports, messageBytes: (decodedTx.messageBytes as unknown) as Uint8Array };
  }
}
