/**
 * Pure structural + semantic validation for offline ApprovedIntent.
 */

import { assertAmountShape, assertExactUnits } from './amount.js';
import { INTENT_LIMITS } from './limits.js';
import { computePlanDigest, isDigestHex } from './planDigest.js';
import {
  APPROVED_INTENT_SCHEMA_VERSION,
  type ApprovedIntent,
  type DigestFn,
  type DestinationRef,
  type FeeLine,
  type SppIntentOp,
} from './types.js';

export type ValidationResult = { ok: true } | { ok: false; reasons: string[] };

const G_ADDRESS = /^G[A-Z2-7]{55}$/;
const C_ADDRESS = /^C[A-Z2-7]{55}$/;
const HEX_KEY = /^(0x)?[0-9a-fA-F]{64}$/;

function fail(...reasons: string[]): ValidationResult {
  return { ok: false, reasons };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function boundedString(
  value: unknown,
  field: string,
  min: number,
  max: number,
): string | null {
  if (typeof value !== 'string') return `${field} must be a string`;
  if (value.length < min) return `${field} shorter than ${min}`;
  if (value.length > max) return `${field} exceeds max length ${max}`;
  return null;
}

function validateDestination(op: SppIntentOp, dest: DestinationRef): string[] {
  const errs: string[] = [];
  if (op === 'deposit') {
    if (dest.mode !== 'none') errs.push('deposit requires destination.mode "none"');
    return errs;
  }
  if (op === 'private_transfer') {
    if (dest.mode === 'g_address') {
      if (!G_ADDRESS.test(dest.gAddress)) errs.push('private_transfer gAddress invalid');
    } else if (dest.mode === 'privacy_keys') {
      if (!HEX_KEY.test(dest.notePublicKeyHex)) errs.push('private_transfer notePublicKeyHex invalid');
    } else {
      errs.push('private_transfer requires g_address or privacy_keys destination');
    }
    return errs;
  }
  if (dest.mode === 'self') return errs;
  if (dest.mode === 'g_address') {
    if (!G_ADDRESS.test(dest.gAddress)) errs.push('withdraw gAddress invalid');
    return errs;
  }
  errs.push('withdraw requires destination.mode "self" or "g_address"');
  return errs;
}

function validateFees(fees: FeeLine[]): string[] {
  const errs: string[] = [];
  if (!Array.isArray(fees) || fees.length === 0) {
    return ['fees must be a non-empty array (use certainty "unknown" if not known)'];
  }
  if (fees.length > INTENT_LIMITS.maxFees) {
    return [`fees exceeds max ${INTENT_LIMITS.maxFees}`];
  }
  for (let i = 0; i < fees.length; i++) {
    const f = fees[i];
    if (!f || (f.certainty !== 'confirmed' && f.certainty !== 'estimated' && f.certainty !== 'unknown')) {
      errs.push(`fees[${i}].certainty invalid`);
      continue;
    }
    const noteErr = boundedString(f.note, `fees[${i}].note`, 1, INTENT_LIMITS.feeNoteMax);
    if (noteErr) errs.push(noteErr);
    if (f.certainty === 'unknown') {
      if (f.units !== undefined && f.units !== '') {
        errs.push(`fees[${i}].units must be omitted when certainty is unknown`);
      }
      continue;
    }
    const u = assertExactUnits(f.units);
    if (!u.ok) errs.push(`fees[${i}].units: ${u.reason}`);
  }
  return errs;
}

function validateAsset(asset: ApprovedIntent['asset']): string[] {
  const errs: string[] = [];
  if (!asset || (asset.kind !== 'native' && asset.kind !== 'classic' && asset.kind !== 'contract')) {
    return ['asset.kind invalid'];
  }
  if (asset.symbol !== undefined) {
    const e = boundedString(asset.symbol, 'asset.symbol', 1, INTENT_LIMITS.assetSymbolMax);
    if (e) errs.push(e);
  }
  if (asset.code !== undefined) {
    const e = boundedString(asset.code, 'asset.code', 1, INTENT_LIMITS.assetCodeMax);
    if (e) errs.push(e);
  }
  if (asset.kind === 'contract') {
    if (!asset.contractId || !C_ADDRESS.test(asset.contractId)) {
      errs.push('asset.contractId must be a C… address for contract assets');
    }
  }
  return errs;
}

function validateNarrativeList(
  value: unknown,
  field: string,
  maxItems: number,
): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [`${field} must be a non-empty string array`];
  }
  if (value.length > maxItems) {
    return [`${field} exceeds max ${maxItems} items`];
  }
  const errs: string[] = [];
  for (let i = 0; i < value.length; i++) {
    const e = boundedString(value[i], `${field}[${i}]`, 1, INTENT_LIMITS.narrativeStringMax);
    if (e) errs.push(e);
  }
  return errs;
}

/**
 * Structural validation of an ApprovedIntent candidate.
 * Does not prove digests match payload — use assertPlanDigestConcordance.
 * Never silently truncates amount/destination/asset/digests.
 */
export function validateApprovedIntentStructure(intent: unknown): ValidationResult {
  if (!isPlainObject(intent)) return fail('intent must be an object');
  const reasons: string[] = [];

  if (intent.schemaVersion !== APPROVED_INTENT_SCHEMA_VERSION) {
    reasons.push(`schemaVersion must be ${APPROVED_INTENT_SCHEMA_VERSION}`);
  }
  {
    const e = boundedString(
      intent.intentId,
      'intentId',
      INTENT_LIMITS.intentIdMin,
      INTENT_LIMITS.intentIdMax,
    );
    if (e) reasons.push(e);
  }
  const op = intent.op;
  if (op !== 'deposit' && op !== 'private_transfer' && op !== 'withdraw') {
    reasons.push('op must be deposit | private_transfer | withdraw');
  }
  if (typeof intent.account !== 'string' || !G_ADDRESS.test(intent.account)) {
    reasons.push('account must be a G… Stellar address');
  }
  {
    const e = boundedString(
      intent.networkPassphrase,
      'networkPassphrase',
      1,
      INTENT_LIMITS.networkPassphraseMax,
    );
    if (e) reasons.push(e);
  }
  if (typeof intent.poolContractId !== 'string' || !C_ADDRESS.test(intent.poolContractId)) {
    reasons.push('poolContractId must be a C… address');
  }

  const amountCheck = assertAmountShape(
    isPlainObject(intent.amount) ? intent.amount : { units: undefined, decimals: undefined },
  );
  if (!amountCheck.ok) reasons.push(amountCheck.reason);

  if (isPlainObject(intent.asset)) {
    reasons.push(...validateAsset(intent.asset as ApprovedIntent['asset']));
  } else {
    reasons.push('asset required');
  }

  if (isPlainObject(intent.destination) && typeof intent.destination.mode === 'string') {
    if (op === 'deposit' || op === 'private_transfer' || op === 'withdraw') {
      reasons.push(...validateDestination(op, intent.destination as DestinationRef));
    }
  } else {
    reasons.push('destination required');
  }

  if (Array.isArray(intent.fees)) {
    reasons.push(...validateFees(intent.fees as FeeLine[]));
  } else {
    reasons.push('fees required');
  }

  reasons.push(
    ...validateNarrativeList(intent.publicEffects, 'publicEffects', INTENT_LIMITS.maxPublicEffects),
  );
  reasons.push(
    ...validateNarrativeList(intent.privacyLimits, 'privacyLimits', INTENT_LIMITS.maxPrivacyLimits),
  );

  if (!isPlainObject(intent.digests)) {
    reasons.push('digests required');
  } else {
    if (!isDigestHex(intent.digests.planDigestHex)) {
      reasons.push('digests.planDigestHex must be 64 lowercase hex chars');
    }
    if (!isDigestHex(intent.digests.operationDigestHex)) {
      reasons.push('digests.operationDigestHex must be 64 lowercase hex chars');
    }
  }

  if (typeof intent.createdAtMs !== 'number' || !Number.isFinite(intent.createdAtMs)) {
    reasons.push('createdAtMs must be a finite number');
  }
  if (typeof intent.expiresAtMs !== 'number' || !Number.isFinite(intent.expiresAtMs)) {
    reasons.push('expiresAtMs must be a finite number');
  } else if (
    typeof intent.createdAtMs === 'number' &&
    intent.expiresAtMs <= intent.createdAtMs
  ) {
    reasons.push('expiresAtMs must be greater than createdAtMs');
  }

  if (!Array.isArray(intent.unknownCritical)) {
    reasons.push('unknownCritical must be an array');
  } else if (intent.unknownCritical.length > INTENT_LIMITS.maxUnknownCritical) {
    reasons.push(`unknownCritical exceeds max ${INTENT_LIMITS.maxUnknownCritical}`);
  } else {
    for (let i = 0; i < intent.unknownCritical.length; i++) {
      const u = intent.unknownCritical[i];
      if (!isPlainObject(u) || u.status !== 'unknown') {
        reasons.push(`unknownCritical[${i}] invalid`);
        continue;
      }
      const e = boundedString(
        u.reason,
        `unknownCritical[${i}].reason`,
        1,
        INTENT_LIMITS.unknownCriticalReasonMax,
      );
      if (e) reasons.push(e);
    }
  }

  return reasons.length ? fail(...reasons) : { ok: true };
}

export function assertNoUnknownCritical(intent: ApprovedIntent): ValidationResult {
  if (intent.unknownCritical.length > 0) {
    return fail(...intent.unknownCritical.map((u) => `unknown critical: ${u.reason}`));
  }
  return { ok: true };
}

export function assertPlanDigestConcordance(
  intent: ApprovedIntent,
  digestFn: DigestFn,
): ValidationResult {
  const expected = computePlanDigest(intent, digestFn);
  if (expected !== intent.digests.planDigestHex.toLowerCase()) {
    return fail('plan digest does not match semantic fields (plan↔digest discrepancy)');
  }
  return { ok: true };
}

/**
 * Concordance between claimed operation digest and presented operation bytes.
 * Does NOT parse XDR semantics (see FASE-2.17 plan↔XDR section).
 */
export function assertOperationDigestConcordance(
  intent: ApprovedIntent,
  operationBytes: Uint8Array,
  digestFn: DigestFn,
): ValidationResult {
  const got = digestFn(operationBytes);
  if (got !== intent.digests.operationDigestHex.toLowerCase()) {
    return fail('operation/XDR digest does not match intent.digests.operationDigestHex');
  }
  return { ok: true };
}

export function freezeIntent(intent: ApprovedIntent): Readonly<ApprovedIntent> {
  return Object.freeze({
    ...intent,
    asset: Object.freeze({ ...intent.asset }),
    amount: Object.freeze({ ...intent.amount }),
    destination: Object.freeze({ ...intent.destination }),
    fees: Object.freeze(intent.fees.map((f) => Object.freeze({ ...f }))),
    publicEffects: Object.freeze([...intent.publicEffects]),
    privacyLimits: Object.freeze([...intent.privacyLimits]),
    digests: Object.freeze({ ...intent.digests }),
    unknownCritical: Object.freeze(
      intent.unknownCritical.map((u) => Object.freeze({ ...u })),
    ),
  });
}

export function intentFingerprint(intent: ApprovedIntent): string {
  return [
    intent.intentId,
    intent.op,
    intent.account,
    intent.networkPassphrase,
    intent.poolContractId,
    intent.amount.units,
    intent.digests.planDigestHex.toLowerCase(),
    intent.digests.operationDigestHex.toLowerCase(),
    JSON.stringify(intent.destination),
    JSON.stringify(intent.asset),
  ].join('|');
}

export function assertAuthorizationId(id: unknown): ValidationResult {
  const e = boundedString(
    id,
    'authorizationId',
    INTENT_LIMITS.authorizationIdMin,
    INTENT_LIMITS.authorizationIdMax,
  );
  return e ? fail(e) : { ok: true };
}
