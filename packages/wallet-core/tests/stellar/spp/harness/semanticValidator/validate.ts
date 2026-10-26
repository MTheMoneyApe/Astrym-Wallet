/**
 * Compare ExpectedSemanticIntent to extracted ExtData / auth-tree facts.
 *
 * Scope (FASE-2.18 VERIFIED / PARTIAL extractable only):
 *   deposit  — ext_amount>0, |amount|, sender, source, pool, network, token.transfer auth
 *   withdraw — ext_amount<0, |amount|, sender, source, pool, network, recipient G…, no sub-auth
 *
 * Explicitly NOT semantic proof: ZK proof, encrypted_output contents, opaque digests,
 * transfer-to-keys, multi-tx plans.
 *
 * Fase 2.21: results are frozen; `bindingId` always set; `classification` is authoritative.
 * Do not accept via `status === 'verifiable_complete'` — use `acceptSurfaceVerification`.
 */

import { computeBindingId } from './binding.js';
import { ExtractError, extractTransactFacts } from './extract.js';
import type {
  ExpectedSemanticIntent,
  FieldVerdict,
  OperationEvidence,
  SemanticValidationResult,
} from './types.js';

const G_ADDRESS = /^G[A-Z2-7]{55}$/;
const C_ADDRESS = /^C[A-Z2-7]{55}$/;

function freezeResult(result: SemanticValidationResult): SemanticValidationResult {
  const extracted = result.extracted
    ? Object.freeze({
        ...result.extracted,
        ...(result.extracted.tokenTransfer
          ? { tokenTransfer: Object.freeze({ ...result.extracted.tokenTransfer }) }
          : {}),
      })
    : undefined;
  return Object.freeze({
    ...result,
    verifiedFields: Object.freeze([...result.verifiedFields]),
    unverifiedFields: Object.freeze(
      result.unverifiedFields.map((u) => Object.freeze({ ...u })),
    ),
    rejectionReasons: Object.freeze([...result.rejectionReasons]),
    fieldVerdicts: Object.freeze(result.fieldVerdicts.map((v) => Object.freeze({ ...v }))),
    extracted,
  });
}

function reject(
  expected: ExpectedSemanticIntent,
  evidence: OperationEvidence,
  reasons: string[],
  verdicts: FieldVerdict[],
  extra?: Pick<SemanticValidationResult, 'extracted'>,
): SemanticValidationResult {
  return freezeResult({
    status: 'rejected',
    classification: 'rejected',
    safetyClaim: 'not_full_protocol_safety',
    summary: `rejected: ${reasons[0] ?? 'validation failed'}`,
    verifiedFields: verdicts.filter((v) => v.status === 'verified').map((v) => v.field),
    unverifiedFields: verdicts
      .filter((v) => v.status === 'unverified')
      .map((v) => ({ field: v.field, reason: v.reason })),
    rejectionReasons: reasons,
    fieldVerdicts: verdicts,
    bindingId: computeBindingId(expected, evidence),
    ...(extra?.extracted ? { extracted: extra.extracted } : {}),
  });
}

function parseExactUnits(units: string): bigint | null {
  if (typeof units !== 'string' || !/^(0|[1-9][0-9]*)$/.test(units)) return null;
  try {
    return BigInt(units);
  } catch {
    return null;
  }
}

function pushVerified(verdicts: FieldVerdict[], field: string, detail?: string): void {
  verdicts.push({ field, status: 'verified', detail });
}

function pushUnverified(verdicts: FieldVerdict[], field: string, reason: string): void {
  verdicts.push({ field, status: 'unverified', reason });
}

function pushMismatch(verdicts: FieldVerdict[], field: string, reason: string): void {
  verdicts.push({ field, status: 'mismatch', reason });
}

export type ValidateSemanticOptions = {
  /**
   * If true, refuse even when the verifiable subset matches — opaque
   * proof/ciphertext means full operation safety cannot be claimed.
   */
  claimFullOperationSafety?: boolean;
};

/**
 * Validate deposit/withdraw semantic concordance for a single on-chain tx.
 * Never treats an opaque digest as proof. Never claims full private-payment safety.
 */
export function validateSemanticConcordance(
  expected: ExpectedSemanticIntent,
  evidence: OperationEvidence,
  options: ValidateSemanticOptions = {},
): SemanticValidationResult {
  const verdicts: FieldVerdict[] = [];
  const reasons: string[] = [];

  if (options.claimFullOperationSafety) {
    return reject(
      expected,
      evidence,
      [
        'refusing claimFullOperationSafety: Fase 2.19 validation is partial (proof/ciphertext unverified); cannot present as complete private-payment authorization',
      ],
      [
        {
          field: 'claimFullOperationSafety',
          status: 'blocked',
          reason: 'partial validator must not be promoted to full safety',
        },
      ],
    );
  }

  // --- Hard blocks before parse ---
  if (
    expected.op === 'private_transfer' ||
    expected.op === 'transfer_to_keys' ||
    expected.op === 'transact_raw'
  ) {
    verdicts.push({
      field: 'op',
      status: 'blocked',
      reason: `${expected.op} is out of scope for Fase 2.19 (requires plan metadata / cleartext not in XDR)`,
    });
    return reject(
      expected,
      evidence,
      [`unsupported op ${expected.op}: fail-closed (BLOCKED per FASE-2.18)`],
      verdicts,
    );
  }

  if (expected.destination.mode === 'privacy_keys') {
    verdicts.push({
      field: 'destination',
      status: 'blocked',
      reason: 'privacy_keys destination cannot be verified from ExtData cleartext',
    });
    return reject(
      expected,
      evidence,
      ['privacy_keys destination is BLOCKED for this prototype'],
      verdicts,
    );
  }

  if (!Number.isInteger(expected.planTxCount) || expected.planTxCount !== 1) {
    verdicts.push({
      field: 'planTxCount',
      status: 'blocked',
      reason: 'prototype only validates single-tx plans (planTxCount === 1)',
    });
    return reject(
      expected,
      evidence,
      [
        `multi-tx / non-singleton planTxCount=${String(expected.planTxCount)} is BLOCKED (FASE-2.18)`,
      ],
      verdicts,
    );
  }
  pushVerified(verdicts, 'planTxCount', 'singleton plan declared');

  if (evidence.networkPassphrase !== expected.networkPassphrase) {
    pushMismatch(
      verdicts,
      'networkPassphrase',
      'evidence.networkPassphrase !== expected.networkPassphrase',
    );
    reasons.push('network passphrase mismatch between intent and evidence');
  }

  if (!G_ADDRESS.test(expected.account)) {
    reasons.push('expected.account is not a G… address');
  }
  if (!C_ADDRESS.test(expected.poolContractId) || !C_ADDRESS.test(expected.tokenContractId)) {
    reasons.push('poolContractId/tokenContractId must be C… addresses');
  }
  const amount = parseExactUnits(expected.amountUnits);
  if (amount === null) {
    reasons.push('amountUnits must be an exact non-negative integer decimal string');
  }
  if (expected.op === 'deposit' && expected.destination.mode !== 'none') {
    reasons.push('deposit intent requires destination.mode "none"');
  }
  if (expected.op === 'withdraw' && expected.destination.mode === 'none') {
    reasons.push('withdraw intent requires destination.mode "self" or "g_address"');
  }
  if (reasons.length) {
    return reject(expected, evidence, reasons, verdicts);
  }

  let extracted;
  try {
    extracted = extractTransactFacts(
      evidence.transactionXdr,
      evidence.networkPassphrase,
      evidence.authEntryXdrs,
    );
  } catch (e) {
    const msg = e instanceof ExtractError ? `${e.code}: ${e.message}` : 'extract failed';
    return reject(expected, evidence, [`operation evidence unusable (${msg})`], verdicts);
  }

  // Structural invoke checks
  if (extracted.functionName !== 'transact') {
    pushMismatch(verdicts, 'functionName', `got ${extracted.functionName}`);
    reasons.push('invoke function must be transact');
  } else {
    pushVerified(verdicts, 'functionName', 'transact');
  }

  if (extracted.poolContractId !== expected.poolContractId) {
    pushMismatch(verdicts, 'poolContractId', 'invoke contract ≠ intent pool');
    reasons.push('pool contract mismatch');
  } else {
    pushVerified(verdicts, 'poolContractId');
  }

  if (extracted.authRootContractId !== expected.poolContractId || extracted.authRootFunctionName !== 'transact') {
    pushMismatch(verdicts, 'authRoot', 'auth root must be pool.transact');
    reasons.push('auth root is not pool.transact');
  } else {
    pushVerified(verdicts, 'authRoot', 'pool.transact');
  }

  if (!extracted.authBoundToInvoke) {
    pushMismatch(verdicts, 'authTxBinding', 'auth entry not bound to transaction invoke args');
    reasons.push('auth↔tx binding missing');
  } else {
    pushVerified(verdicts, 'authTxBinding', 'auth root args XDR == invoke args XDR');
  }

  if (extracted.sourceAccount !== expected.account) {
    pushMismatch(verdicts, 'sourceAccount', 'tx.source ≠ intent.account');
    reasons.push('transaction source account mismatch');
  } else {
    pushVerified(verdicts, 'sourceAccount');
  }

  if (extracted.senderAddress !== expected.account) {
    pushMismatch(verdicts, 'sender', 'transact sender arg ≠ intent.account');
    reasons.push('transact sender mismatch');
  } else {
    pushVerified(verdicts, 'sender');
  }

  pushVerified(verdicts, 'networkPassphrase', 'parsed under expected passphrase');

  // Opaque / non-verifiable surfaces (always listed)
  pushUnverified(
    verdicts,
    'proof',
    'ZK proof bytes/map are opaque; not semantically validated (FASE-2.18 BLOCKED)',
  );
  pushUnverified(
    verdicts,
    'encrypted_output0',
    `ciphertext present (${extracted.encryptedOutput0ByteLength} bytes); contents not interpretable`,
  );
  pushUnverified(
    verdicts,
    'encrypted_output1',
    `ciphertext present (${extracted.encryptedOutput1ByteLength} bytes); contents not interpretable`,
  );
  pushUnverified(
    verdicts,
    'opaqueDigest',
    'opaque plan/operation digests are not accepted as semantic equivalence',
  );

  if (expected.op === 'deposit') {
    if (extracted.extAmount <= 0n) {
      pushMismatch(verdicts, 'ext_amount', 'deposit requires ext_amount > 0');
      reasons.push('ext_amount sign does not match deposit');
    } else if (extracted.extAmount !== amount!) {
      pushMismatch(
        verdicts,
        'ext_amount',
        `ext_amount ${extracted.extAmount} !== amountUnits ${expected.amountUnits}`,
      );
      reasons.push('deposit amount mismatch');
    } else {
      pushVerified(verdicts, 'ext_amount', `+${extracted.extAmount.toString()}`);
    }

    // Auth tree: exactly token.transfer(sender, pool, ext_amount)
    if (extracted.authSubInvocationCount !== 1 || !extracted.tokenTransfer) {
      pushMismatch(verdicts, 'authTree', 'deposit requires exactly one token.transfer sub-invocation');
      reasons.push('deposit auth tree invalid');
    } else {
      const t = extracted.tokenTransfer;
      if (t.tokenContractId !== expected.tokenContractId) {
        pushMismatch(verdicts, 'tokenContractId', 'auth transfer token ≠ intent');
        reasons.push('token contract mismatch');
      } else {
        pushVerified(verdicts, 'tokenContractId');
      }
      if (t.from !== expected.account || t.to !== expected.poolContractId) {
        pushMismatch(verdicts, 'tokenTransferEndpoints', 'transfer must be sender→pool');
        reasons.push('token.transfer endpoints mismatch');
      } else {
        pushVerified(verdicts, 'tokenTransferEndpoints', 'sender→pool');
      }
      if (t.amount !== amount!) {
        pushMismatch(verdicts, 'tokenTransferAmount', 'transfer amount ≠ intent amount');
        reasons.push('token.transfer amount mismatch');
      } else {
        pushVerified(verdicts, 'tokenTransferAmount');
      }
    }

    // Recipient Address is present but not bound for deposit (intent destination.mode none)
    pushUnverified(
      verdicts,
      'extData.recipient',
      `present as ${extracted.recipientAddress} but deposit ApprovedIntent destination is mode none — not compared`,
    );
    pushVerified(verdicts, 'op', 'deposit inferred from ext_amount>0 + token.transfer auth');
  } else {
    // withdraw
    if (extracted.extAmount >= 0n) {
      pushMismatch(verdicts, 'ext_amount', 'withdraw requires ext_amount < 0');
      reasons.push('ext_amount sign does not match withdraw');
    } else if (-extracted.extAmount !== amount!) {
      pushMismatch(
        verdicts,
        'ext_amount',
        `|ext_amount| ${(-extracted.extAmount).toString()} !== amountUnits ${expected.amountUnits}`,
      );
      reasons.push('withdraw amount mismatch');
    } else {
      pushVerified(verdicts, 'ext_amount', extracted.extAmount.toString());
    }

    if (extracted.authSubInvocationCount !== 0 || extracted.tokenTransfer) {
      pushMismatch(
        verdicts,
        'authTree',
        'withdraw/transfer auth must have zero sub-invocations (check_transact_auth)',
      );
      reasons.push('withdraw auth tree has unexpected sub-invocations');
    } else {
      pushVerified(verdicts, 'authTree', 'transact-only (no token.transfer)');
    }

    const expectedRecipient =
      expected.destination.mode === 'self'
        ? expected.account
        : expected.destination.mode === 'g_address'
          ? expected.destination.gAddress
          : null;
    if (!expectedRecipient || !G_ADDRESS.test(expectedRecipient)) {
      reasons.push('withdraw destination invalid');
    } else if (extracted.recipientAddress !== expectedRecipient) {
      pushMismatch(
        verdicts,
        'recipient',
        `ExtData.recipient ${extracted.recipientAddress} ≠ expected ${expectedRecipient}`,
      );
      reasons.push('withdraw recipient mismatch');
    } else {
      pushVerified(verdicts, 'recipient', expectedRecipient);
    }
    pushVerified(verdicts, 'op', 'withdraw inferred from ext_amount<0 + empty auth subs');
  }

  if (reasons.length) {
    return reject(expected, evidence, reasons, verdicts, { extracted });
  }

  const unverifiedFields = verdicts
    .filter((v) => v.status === 'unverified')
    .map((v) => ({ field: v.field, reason: v.reason }));
  const verifiedFields = verdicts.filter((v) => v.status === 'verified').map((v) => v.field);

  // Checkable surface matched. Opaque proof/ciphertext remain.
  // Legacy status `verifiable_complete` is a non-authoritative alias (Fase 2.21).
  // Acceptance must go through acceptSurfaceVerification(classification+…).
  return freezeResult({
    status: 'verifiable_complete',
    classification: 'surface_verified_with_opaque_remainder',
    safetyClaim: 'not_full_protocol_safety',
    summary: `${expected.op}: surface verified (ExtData+auth bound to tx); opaque proof/ciphertext remain — NOT full private-payment safety`,
    verifiedFields,
    unverifiedFields,
    rejectionReasons: [],
    fieldVerdicts: verdicts,
    extracted,
    bindingId: computeBindingId(expected, evidence),
  });
}
