import browser from 'webextension-polyfill';
import { 
  DappConnectRequest, 
  DappConnectResponse, 
  DappDisconnectRequest, 
  DappDisconnectResponse, 
  DappSignRequest, 
  DappSignResponse,
  GetPendingApprovalsRequest,
  GetPendingApprovalsResponse,
  ApprovePendingRequest,
  ApprovePendingResponse
} from '../../shared/ipcTypes.js';
import { DappPermissionManager } from '../dapp/DappPermissionManager.js';
import { PendingRequestManager } from '../dapp/PendingRequestManager.js';
import { TransactionValidator } from '@solanym/wallet-core/src/solana/transaction/TransactionValidator.js';

import { activeAccountManager } from '../accounts/ActiveAccountManager.js';
import type { AccountService } from '@solanym/wallet-core/src/solana/accounts/AccountService.js';
import { stateCoordinator } from '../StateCoordinator.js';
import { getBase58Decoder } from '@solana/kit';

export const permissionManager = new DappPermissionManager();
export const pendingManager = new PendingRequestManager();
const validator = new TransactionValidator();

async function openPopup() {
  const url = browser.runtime.getURL('index.html');
  const windows = await browser.windows.getAll({ populate: true });
  const existingPopup = windows.find(w => w.type === 'popup' && w.tabs?.some(t => t.url?.startsWith(url)));
  
  if (existingPopup && existingPopup.id) {
    await browser.windows.update(existingPopup.id, { focused: true });
  } else {
    await browser.windows.create({
      url,
      type: 'popup',
      width: 360,
      height: 600,
      focused: true
    });
  }
}

function getOrigin(sender?: browser.Runtime.MessageSender): string {
  if (!sender || !sender.url) throw new Error('Unauthorized');
  const url = new URL(sender.url);
  return url.origin;
}

export async function handleDappConnect(payload: DappConnectRequest, sender?: browser.Runtime.MessageSender): Promise<DappConnectResponse> {
  const origin = getOrigin(sender);
  
  if (
    stateCoordinator.state === 'ERROR_STATE' || 
    stateCoordinator.state === 'RESET_BLOCKED' ||
    stateCoordinator.state === 'READY_WITH_MUTATION_LOCK'
  ) {
    throw new Error('System is in a degraded state');
  }

  const accountService = (globalThis as any).accountService as AccountService;
  const isLocked = (stateCoordinator.state !== 'READY' );
  const isTrusted = await permissionManager.isTrusted(origin);

  if (payload.onlyIfTrusted) {
    if (isTrusted && !isLocked) {
      const pubkey = await activeAccountManager.getActiveAccountPublicKey(accountService);
      return { publicKey: pubkey };
    }
    throw new Error('Not trusted or locked');
  }

  if (isLocked || !isTrusted) {
    const approvalPromise = pendingManager.createConnectRequest(origin);
    await openPopup();
    
    const approved = await approvalPromise;
    if (!approved) {
      throw new Error('User rejected connect');
    }
    
    if (!isTrusted) {
      await permissionManager.grantPermission(origin);
    }
  }

  const pubkey = await activeAccountManager.getActiveAccountPublicKey(accountService);
  return { publicKey: pubkey };
}

export async function handleDappDisconnect(payload: DappDisconnectRequest, sender?: browser.Runtime.MessageSender): Promise<DappDisconnectResponse> {
  const origin = getOrigin(sender);
  await permissionManager.revokePermission(origin);
  return { success: true };
}

export async function handleDappSignTransaction(payload: DappSignRequest, sender?: browser.Runtime.MessageSender): Promise<DappSignResponse> {
  const origin = getOrigin(sender);
  const isTrusted = await permissionManager.isTrusted(origin);
  
  if (!isTrusted) {
    throw new Error('Origin not trusted. Connect first.');
  }

  if (
    stateCoordinator.state === 'ERROR_STATE' || 
    stateCoordinator.state === 'RESET_BLOCKED' ||
    stateCoordinator.state === 'READY_WITH_MUTATION_LOCK'
  ) {
    throw new Error('System is in a degraded state');
  }

  const accountService = (globalThis as any).accountService as AccountService;
  
  const validatedTx = validator.validateExternalTransaction(payload.transactionBase64);
  
  const trustedActiveIndex = activeAccountManager.getActiveAccountIndex();
  const trustedActivePublicKey = await activeAccountManager.getActiveAccountPublicKey(accountService);

  if (validatedTx.sourceAddress !== trustedActivePublicKey) {
    throw new Error('Transaction source address does not match the active wallet account');
  }
  
  const reviewData = {
    account: validatedTx.sourceAddress,
    destination: validatedTx.destinationAddress,
    amountLamports: validatedTx.lamports.toString(),
    estimatedFeeLamports: '5000',
    program: 'System Program (Transfer)' as const,
  };

  const approvalPromise = pendingManager.createSignRequest(
    origin, 
    reviewData, 
    validatedTx.messageBytes, 
    trustedActiveIndex,
    trustedActivePublicKey
  );
  
  await openPopup();

  const result = await approvalPromise;
  
  return { signature: result.signature, transaction: result.transactionBase64 };
}

export async function handleGetPendingApprovals(payload: GetPendingApprovalsRequest, sender?: browser.Runtime.MessageSender): Promise<GetPendingApprovalsResponse> {
  const connectReq = pendingManager.getPendingConnect();
  const signReq = pendingManager.getPendingSign();
  
  return {
    connectRequest: connectReq ? { internalRequestId: connectReq.internalRequestId, origin: connectReq.origin } : null,
    signRequest: signReq ? signReq.review : null
  };
}

export async function handleApprovePendingRequest(payload: ApprovePendingRequest, sender?: browser.Runtime.MessageSender): Promise<ApprovePendingResponse> {
  if (!payload.approved) {
    pendingManager.rejectConnect(new Error('User rejected'), payload.id);
    pendingManager.rejectSign(new Error('User rejected'), payload.id);
    return { success: true };
  }

  const connectReq = pendingManager.getPendingConnect();
  if (connectReq && connectReq.internalRequestId === payload.id) {
    pendingManager.approveConnect(payload.id);
    return { success: true };
  }

  const signReq = pendingManager.getPendingSign();
  if (signReq && signReq.internalRequestId === payload.id) {
    const client = (globalThis as any).txClient;
    
    // Attempt to authorize signature with global coordinator
    let startEpoch: number;
    try {
      startEpoch = stateCoordinator.authorizeSignature();
    } catch (e: any) {
      pendingManager.rejectSign(e, payload.id);
      return { success: true };
    }

    try {
      // 1. Revalidate Identity
      const accounts = await (globalThis as any).keyManager.getAccounts();
      const account = accounts.find((a: any) => a.index === signReq.accountIndex);
      
      if (!account) {
        throw new Error('Account not found during signing');
      }
      const b58 = getBase58Decoder().decode(account.publicKey);
      if (b58 !== signReq.expectedPublicKey) {
        throw new Error('Identity mismatch: Public key for index changed');
      }

      // 2. Compute signature
      const result = await client.signTransaction(signReq.accountIndex, signReq.messageBytes);

      // 3. Synchronous Exit Barrier & Commitment Point
      // NO YIELD ALLOWED BETWEEN VALIDATION AND DELIVERY INVOCATION
      if (!stateCoordinator.validateExit(startEpoch)) {
        throw new Error('Signature aborted: Wallet state changed (e.g., reset) before delivery');
      }
      
      // Deliver (Invokes the promise resolve which internally triggers IPC postMessage eventually)
      pendingManager.approveSign(payload.id, result);
      
    } catch (e: any) {
      pendingManager.rejectSign(e, payload.id);
    } finally {
      stateCoordinator.endSignature();
    }
    return { success: true };
  }

  throw new Error('Pending request not found');
}

