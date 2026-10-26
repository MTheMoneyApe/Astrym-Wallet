import {
  Account,
  Asset,
  Horizon,
  Memo,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { STELLAR_TESTNET_HORIZON_URL } from '../read/StellarReadClient.js';
import {
  InsufficientXlmBalanceError,
  InvalidStellarAmountError,
  InvalidStellarDestinationError,
  InvalidStellarMemoError,
  StellarAccountNotFundedError,
  StellarFeeChangedError,
  StellarTransactionError,
  StellarTransactionFailedError,
  type IAccountMetadataProvider,
  type IStellarTransactionSigner,
  type SendXlmRequest,
  type StellarTransactionResult,
  type XlmTransferSummary,
} from './types.js';

export const STELLAR_BASE_RESERVE_XLM = 0.5;
export const STELLAR_MIN_ACCOUNT_RESERVE_XLM = 1.0; // 2 * 0.5 XLM
export const STROOPS_PER_XLM = 10_000_000;

export function stroopsToXlm(stroops: number): string {
  return (stroops / STROOPS_PER_XLM).toFixed(7);
}

export function assertPositiveIntegerStroops(stroops: number, label = 'fee stroops'): number {
  if (!Number.isInteger(stroops) || stroops <= 0) {
    throw new StellarTransactionError(`${label} must be a positive integer`);
  }
  return stroops;
}

/**
 * Encodes a Uint8Array to a standard Base64 string without using Node.js Buffer,
 * ensuring compatibility with browser extensions and Service Worker environments.
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.length;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export class StellarTransactionClient {
  private readonly _horizon: Horizon.Server;

  constructor(
    horizonUrl: string = STELLAR_TESTNET_HORIZON_URL,
    private readonly _keyManager: IAccountMetadataProvider,
    private readonly _signer: IStellarTransactionSigner,
    private readonly _networkPassphrase: string = Networks.TESTNET,
    serverInstance?: Horizon.Server,
  ) {
    this._horizon = serverInstance ?? new Horizon.Server(horizonUrl);
  }

  public validateDestination(destination: string, sourceAddress?: string): string {
    const trimmed = destination.trim();
    if (!trimmed) {
      throw new InvalidStellarDestinationError('Destination address cannot be empty');
    }
    if (!StrKey.isValidEd25519PublicKey(trimmed)) {
      throw new InvalidStellarDestinationError('Invalid Stellar destination address format');
    }
    if (sourceAddress && trimmed === sourceAddress) {
      throw new InvalidStellarDestinationError('Destination address cannot be the same as source address');
    }
    return trimmed;
  }

  public validateAmount(amountXlm: string): string {
    const trimmed = amountXlm.trim();
    if (!trimmed) {
      throw new InvalidStellarAmountError('Amount cannot be empty');
    }
    if (!/^\d+(\.\d{1,7})?$/.test(trimmed)) {
      throw new InvalidStellarAmountError('Amount must be a positive number with up to 7 decimal places');
    }
    const num = Number(trimmed);
    if (isNaN(num) || num <= 0) {
      throw new InvalidStellarAmountError('Amount must be greater than zero');
    }
    return trimmed;
  }

  public validateMemo(memo?: string): string | undefined {
    if (!memo) return undefined;
    const trimmed = memo.trim();
    if (trimmed.length === 0) return undefined;
    const byteLength = new TextEncoder().encode(trimmed).length;
    if (byteLength > 28) {
      throw new InvalidStellarMemoError(`Memo text cannot exceed 28 bytes (got ${byteLength} bytes)`);
    }
    return trimmed;
  }

  public async getSourceAddress(accountIndex: number): Promise<string> {
    const accounts = await this._keyManager.getAccounts();
    const account = accounts.find((a) => a.index === accountIndex);
    if (!account) {
      throw new StellarTransactionError(`Source account index ${accountIndex} not found in wallet`);
    }
    return StrKey.encodeEd25519PublicKey(account.publicKey);
  }

  public async reviewXlmTransfer(request: SendXlmRequest): Promise<XlmTransferSummary> {
    const amount = this.validateAmount(request.amountXlm);
    const sourceAddress = await this.getSourceAddress(request.sourceAccountIndex);
    const destination = this.validateDestination(request.destination, sourceAddress);
    const memo = this.validateMemo(request.memo);

    let sourceAccountRecord: Horizon.AccountResponse;
    try {
      sourceAccountRecord = await this._horizon.loadAccount(sourceAddress);
    } catch (err: any) {
      if (err.response?.status === 404 || err.name === 'NotFoundError') {
        throw new StellarAccountNotFundedError(
          `Source account ${sourceAddress} is unfunded on Stellar Testnet. Fund it with Friendbot first.`,
        );
      }
      throw new StellarTransactionError(
        `Failed to query source account on Stellar Horizon: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }

    const nativeBalanceEntry = sourceAccountRecord.balances.find((b) => b.asset_type === 'native');
    const nativeBal = nativeBalanceEntry?.balance ?? '0';
    const subentryCount = sourceAccountRecord.subentry_count ?? 0;
    const minReserveXlm = (2 + subentryCount) * STELLAR_BASE_RESERVE_XLM;
    const availableBalanceXlm = Math.max(0, Number(nativeBal) - minReserveXlm);

    const baseFeeStroops =
      request.approvedFeeStroops !== undefined
        ? assertPositiveIntegerStroops(request.approvedFeeStroops, 'approvedFeeStroops')
        : await this._horizon.fetchBaseFee().catch(() => 100);
    const feeXlm = stroopsToXlm(baseFeeStroops);

    const totalRequired = Number(amount) + Number(feeXlm);
    if (totalRequired > availableBalanceXlm) {
      throw new InsufficientXlmBalanceError(
        `Insufficient available XLM. Transfer of ${amount} XLM + ${feeXlm} fee (${totalRequired.toFixed(7)} XLM) exceeds available balance of ${availableBalanceXlm.toFixed(7)} XLM (account reserve: ${minReserveXlm.toFixed(1)} XLM).`,
      );
    }

    let destinationExists = false;
    try {
      await this._horizon.loadAccount(destination);
      destinationExists = true;
    } catch (err: any) {
      if (err.response?.status === 404 || err.name === 'NotFoundError') {
        destinationExists = false;
      } else {
        // Horizon query failure for destination
        throw new StellarTransactionError(
          `Failed to check destination account status on Horizon: ${err instanceof Error ? err.message : String(err)}`,
          err,
        );
      }
    }

    if (!destinationExists && Number(amount) < STELLAR_MIN_ACCOUNT_RESERVE_XLM) {
      throw new InvalidStellarAmountError(
        `Destination account does not exist on Stellar Testnet. Minimum transfer to fund a new account is ${STELLAR_MIN_ACCOUNT_RESERVE_XLM.toFixed(1)} XLM.`,
      );
    }

    return {
      sourceAddress,
      destinationAddress: destination,
      amountXlm: amount,
      feeXlm,
      feeStroops: baseFeeStroops,
      balanceXlm: nativeBal,
      destinationExists,
      operationType: destinationExists ? 'payment' : 'createAccount',
      memo,
    };
  }

  public async sendXlm(
    request: SendXlmRequest & { approvedFeeStroops: number },
    onBeforeSign?: () => void,
  ): Promise<StellarTransactionResult> {
    const approvedFeeStroops = assertPositiveIntegerStroops(
      request.approvedFeeStroops,
      'approvedFeeStroops',
    );

    // Compare against live network minimum before any signing work.
    const currentFeeStroops = await this._horizon.fetchBaseFee().catch(() => 100);
    if (currentFeeStroops > approvedFeeStroops) {
      throw new StellarFeeChangedError(
        `Network base fee (${currentFeeStroops} stroops) exceeds approved fee (${approvedFeeStroops} stroops). Please review the transfer again.`,
      );
    }

    // Re-validate balance/destination using the fee that will actually be attached.
    const summary = await this.reviewXlmTransfer({
      ...request,
      approvedFeeStroops,
    });

    const sourceAccountRecord = await this._horizon.loadAccount(summary.sourceAddress);
    const baseFeeStroops = approvedFeeStroops;

    // Fetch timebounds from Horizon to avoid local clock skew issues
    const timebounds = await this._horizon.fetchTimebounds(300).catch(() => ({ minTime: 0, maxTime: 0 }));

    const builder = new TransactionBuilder(sourceAccountRecord, {
      fee: baseFeeStroops.toString(),
      networkPassphrase: this._networkPassphrase,
      timebounds,
    });

    if (summary.destinationExists) {
      builder.addOperation(
        Operation.payment({
          destination: summary.destinationAddress,
          asset: Asset.native(),
          amount: summary.amountXlm,
        }),
      );
    } else {
      builder.addOperation(
        Operation.createAccount({
          destination: summary.destinationAddress,
          startingBalance: summary.amountXlm,
        }),
      );
    }

    if (summary.memo) {
      builder.addMemo(Memo.text(summary.memo));
    }

    const tx = builder.build();

    // Call exit barrier / verification callback before accessing signer
    onBeforeSign?.();

    // Sign transaction hash through signer boundary
    const txHash = tx.hash();
    const signature = await this._signer.signTransaction(txHash, request.sourceAccountIndex);

    // Add signature to transaction envelope
    tx.addSignature(summary.sourceAddress, uint8ArrayToBase64(signature));

    try {
      const response = await this._horizon.submitTransaction(tx);
      return {
        hash: response.hash,
        ledger: response.ledger,
        status: 'confirmed',
      };
    } catch (err: any) {
      const codes = err.response?.data?.extras?.result_codes;
      const detail = err.response?.data?.detail ?? err.message;
      let extraInfo = '';
      if (codes) {
        extraInfo = ` (tx: ${codes.transaction}${codes.operations ? ', ops: ' + codes.operations.join(',') : ''})`;
      }
      throw new StellarTransactionFailedError(
        `Stellar transaction submission failed: ${detail}${extraInfo}`,
        err,
      );
    }
  }

  public async confirmTransaction(hash: string): Promise<{ hash: string; status: 'confirmed' | 'failed' | 'unknown'; ledger?: number }> {
    try {
      const tx = await this._horizon.transactions().transaction(hash).call();
      if (tx.successful) {
        return { hash, status: 'confirmed', ledger: tx.ledger_attr };
      }
      return { hash, status: 'failed', ledger: tx.ledger_attr };
    } catch (err: any) {
      if (err.response?.status === 404 || err.name === 'NotFoundError') {
        return { hash, status: 'unknown' };
      }
      return { hash, status: 'unknown' };
    }
  }
}
