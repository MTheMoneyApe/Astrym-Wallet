/**
 * solana/transaction/TransactionClient.ts — Transaction construction and signing (Phase 5c).
 *
 * Implements SOL transfers on Devnet.
 * Adheres strictly to security boundaries:
 * - Uses KeyManager to resolve account indices to public keys safely.
 * - Uses ISigner for all private key operations.
 * - Never extracts or logs private keys, seeds, or mnemonics.
 * - Enforces Devnet-only constraints and Phase 5a RPC allowlist.
 */

import {
  address,
  appendTransactionMessageInstruction,
  compileTransactionMessage,
  createTransactionMessage,
  getBase58Decoder,
  getBase64Decoder,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageEncoder,
  getCompiledTransactionMessageDecoder,
  getBase58Encoder,
  isAddress,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Instruction,
} from '@solana/kit';

import type { DevnetRpcClient } from '../rpc/RpcClient.js';
import {
  BlockhashExpiredError,
  InvalidDestinationError,
  InvalidTransactionAmountError,
  TransactionConfirmationTimeoutError,
  TransactionError,
  TransactionFailedError,
  type IAccountMetadataProvider,
  type ITransactionSigner,
  type SendSolRequest,
  type TransactionConfirmation,
  type TransactionSummary,
} from './types.js';

const SYSTEM_PROGRAM_ID = address('11111111111111111111111111111111');
const TRANSFER_INSTRUCTION_INDEX = 2;

export class TransactionClient {
  constructor(
    private readonly _rpc: DevnetRpcClient,
    private readonly _keyManager: IAccountMetadataProvider,
    private readonly _signer: ITransactionSigner,
  ) {}

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
   * Resolves the given account index to its base58 Address.
   * Throws an error if the account does not exist.
   */
  private async _getSourceAddress(index: number): Promise<Address> {
    const accounts = await this._keyManager.getAccounts();
    const account = accounts.find((a) => a.index === index);
    if (!account) {
      throw new TransactionError(`Source account index ${index} not found`);
    }
    const b58 = getBase58Decoder().decode(account.publicKey);
    return this._validateAddress(b58);
  }

  /**
   * Builds the System Program transfer instruction manually.
   */
  private _buildTransferInstruction(
    source: Address,
    destination: Address,
    lamports: bigint,
  ): Instruction {
    const data = new Uint8Array(12);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    view.setUint32(0, TRANSFER_INSTRUCTION_INDEX, true);
    view.setBigUint64(4, lamports, true);

    return {
      programAddress: SYSTEM_PROGRAM_ID,
      accounts: [
        { address: source, role: 3 }, // WritableSigner = 3
        { address: destination, role: 1 }, // WritableNonSigner = 1 (Wait, is it 1 or 2? Writable=1)
      ],
      data,
    };
  }

  /**
   * Review a transaction before signing it, exposing the fee and details.
   */
  async reviewSolTransfer(request: SendSolRequest): Promise<TransactionSummary> {
    if (request.lamports <= 0n) {
      throw new InvalidTransactionAmountError('Transfer amount must be strictly positive');
    }

    const sourceAddress = await this._getSourceAddress(request.sourceAccountIndex);
    const destinationAddress = this._validateAddress(request.destination);

    // Get the latest blockhash to construct an exact test message
    const blockhashResponse = await this._rpc.getLatestBlockhash().send().catch((e) => {
      throw new TransactionError('Failed to retrieve latest blockhash', e);
    });

    const instruction = this._buildTransferInstruction(
      sourceAddress,
      destinationAddress,
      request.lamports,
    );

    const txMsg2 = appendTransactionMessageInstruction(instruction, setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhashResponse.value.blockhash, lastValidBlockHeight: blockhashResponse.value.lastValidBlockHeight }, setTransactionMessageFeePayer(sourceAddress, createTransactionMessage({ version: 0 }))));

    const compiledMessage = compileTransactionMessage(txMsg2);
    const messageBytes = getCompiledTransactionMessageEncoder().encode(compiledMessage);
    // Base64 encode the message bytes as required by getFeeForMessage
    const base64Message = getBase64Decoder().decode(messageBytes);

    const [feeResponse, balanceResponse] = await Promise.all([
      this._rpc.getFeeForMessage(base64Message as any).send().catch((e) => {
        throw new TransactionError('Failed to estimate transaction fee', e);
      }),
      this._rpc.getBalance(sourceAddress).send().catch((e) => {
        throw new TransactionError('Failed to fetch source account balance', e);
      }),
    ]);

    if (feeResponse.value === null) {
      throw new TransactionError('Network fee estimate unavailable');
    }

    return {
      sourceAddress,
      destinationAddress,
      lamports: request.lamports,
      feeLamports: feeResponse.value,
      balanceLamports: balanceResponse.value,
    };
  }

  /**
   * Constructs, signs, and sends the SOL transfer transaction.
   * Does NOT auto-retry.
   */
  async sendSol(request: SendSolRequest, assertAuthorized?: () => void): Promise<string> {
    assertAuthorized?.();
    if (request.lamports <= 0n) {
      throw new InvalidTransactionAmountError('Transfer amount must be strictly positive');
    }

    const sourceAddress = await this._getSourceAddress(request.sourceAccountIndex);
    assertAuthorized?.();
    const destinationAddress = this._validateAddress(request.destination);

    const blockhashResponse = await this._rpc.getLatestBlockhash().send().catch((e) => {
      throw new TransactionError('Failed to retrieve latest blockhash', e);
    });
    assertAuthorized?.();

    const instruction = this._buildTransferInstruction(
      sourceAddress,
      destinationAddress,
      request.lamports,
    );

    const txMsg2 = appendTransactionMessageInstruction(instruction, setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhashResponse.value.blockhash, lastValidBlockHeight: blockhashResponse.value.lastValidBlockHeight }, setTransactionMessageFeePayer(sourceAddress, createTransactionMessage({ version: 0 }))));

    const compiledMessage = compileTransactionMessage(txMsg2);
    const encoder = getCompiledTransactionMessageEncoder();
    const messageBytes = encoder.encode(compiledMessage);
    const base64Message = getBase64Decoder().decode(messageBytes);

    const [feeResponse, balanceResponse] = await Promise.all([
      this._rpc.getFeeForMessage(base64Message as any).send().catch((e) => {
        throw new TransactionError('Failed to estimate transaction fee before signing', e);
      }),
      this._rpc.getBalance(sourceAddress).send().catch((e) => {
        throw new TransactionError('Failed to verify source account balance before signing', e);
      }),
    ]);
    assertAuthorized?.();

    if (feeResponse.value === null) {
      throw new TransactionError('Network fee estimate unavailable; transaction not signed');
    }
    if (request.lamports + feeResponse.value > balanceResponse.value) {
      throw new TransactionError('Insufficient SOL to cover the transfer and network fee');
    }

    // ISigner securely produces the 64-byte Ed25519 signature
    let signatureBytes: Uint8Array;
    assertAuthorized?.();
    try {
      signatureBytes = await this._signer.sign(request.sourceAccountIndex, messageBytes as unknown as Uint8Array);
    } catch (e) {
      throw new TransactionError('Failed to sign transaction. Ensure vault is unlocked.', e);
    }
    assertAuthorized?.();

    // Assemble the fully signed Transaction object natively
    const signedTx = {
      messageBytes,
      signatures: {
        [sourceAddress]: signatureBytes,
      },
    };

    const wireFormat = getBase64EncodedWireTransaction(signedTx as any);

    try {
      // Send the transaction (Kit sendTransaction API accepts base64 format directly)
      const signature = await this._rpc.sendTransaction(wireFormat, { encoding: 'base64' }).send();
      return signature;
    } catch (e) {
      throw new TransactionError('Failed to send transaction', e);
    }
  }

  /**
   * Polls the network to confirm a transaction signature.
   * Returns when confirmed, failed, or expired/timeout.
   */
  async confirmTransaction(
    signature: string,
    timeoutMs: number = 30000,
  ): Promise<TransactionConfirmation> {
    const startTime = Date.now();
    
    // Simple polling loop with a strict timeout bounds check
    while (Date.now() - startTime < timeoutMs) {
      const response = await this._rpc
        .getSignatureStatuses([signature as import("@solana/kit").Signature], { searchTransactionHistory: true })
        .send()
        .catch(() => null);

      if (response && response.value && response.value.length > 0) {
        const status = response.value[0];
        if (status !== null) {
          if (status?.err !== null) {
            return { signature, status: 'failed' };
          }
          if (
            status.confirmationStatus === 'confirmed' ||
            status.confirmationStatus === 'finalized'
          ) {
            return { signature, status: (status?.err ? 'failed' : 'confirmed') };
          }
        }
      }

      // Delay 1.5 seconds between polling attempts using AbortSignal.timeout instead of setTimeout
      try {
        await new Promise((_, reject) => {
          const signal = AbortSignal.timeout(1500);
          signal.addEventListener('abort', () => reject(signal.reason));
        });
      } catch {
        // Expected DOMException from timeout
      }
    }

    return { signature, status: 'timeout' };
  }

  /**
   * Signs the exact messageBytes using the specified account index.
   * Returns a fully formed base64 encoded wire transaction containing the signature.
   * DOES NOT broadcast.
   */
  async signTransaction(
    accountIndex: number,
    messageBytes: Uint8Array,
    assertAuthorized?: () => void,
  ): Promise<{ signature: string, transactionBase64: string }> {
    assertAuthorized?.();
    if (!messageBytes || messageBytes.length === 0) {
      throw new TransactionError('messageBytes cannot be empty');
    }

    const sourceAddress = await this._getSourceAddress(accountIndex);
    assertAuthorized?.();

    // Verify the messageBytes actually expects this sourceAddress as the primary signer
    let decodedMsg;
    try {
      decodedMsg = getCompiledTransactionMessageDecoder().decode(messageBytes);
    } catch (e) {
      throw new TransactionError('Failed to decode messageBytes to verify signer', e);
    }

    if (!decodedMsg.staticAccounts || decodedMsg.staticAccounts.length === 0) {
      throw new TransactionError('Malformed messageBytes: no static accounts');
    }

    const expectedSigner = decodedMsg.staticAccounts[0];
    if (expectedSigner !== sourceAddress) {
      throw new TransactionError(`Account mismatch: message expects signer ${expectedSigner} but account index ${accountIndex} resolved to ${sourceAddress}`);
    }

    // Sign the EXACT message bytes
    let signatureBytes: Uint8Array;
    assertAuthorized?.();
    try {
      signatureBytes = await this._signer.sign(accountIndex, messageBytes);
    } catch (e) {
      throw new TransactionError('Failed to sign transaction. Ensure vault is unlocked.', e);
    }
    assertAuthorized?.();

    // Assemble the fully signed Transaction object
    const signedTx = {
      messageBytes,
      signatures: {
        [sourceAddress]: signatureBytes,
      },
    };

    let wireFormat: string;
    try {
      wireFormat = getBase64EncodedWireTransaction(signedTx as any);
    } catch (e) {
      throw new TransactionError('Failed to encode signed transaction to base64', e);
    }

    // Convert signature bytes to base58 for the signature string return
    let signatureString: string;
    try {
      signatureString = getBase58Decoder().decode(signatureBytes);
    } catch (e) {
      throw new TransactionError('Failed to encode signature to base58', e);
    }

    return {
      signature: signatureString,
      transactionBase64: wireFormat
    };
  }
}
