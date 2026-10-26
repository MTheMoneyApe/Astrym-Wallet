/**
 * Exact amount helpers — no Number/float arithmetic on monetary values.
 */

const INTEGER_UNITS = /^(0|[1-9][0-9]*)$/;

export type AmountCheck = { ok: true } | { ok: false; reason: string };

/** Validate smallest-unit integer string (stroops, etc.). */
export function assertExactUnits(units: unknown): AmountCheck {
  if (typeof units !== 'string') return { ok: false, reason: 'amount.units must be a string' };
  if (!INTEGER_UNITS.test(units)) {
    return {
      ok: false,
      reason: 'amount.units must be a non-negative integer decimal string without leading zeros',
    };
  }
  // Cap absurd precision / DoS (u128 max is 39 digits; allow up to 39).
  if (units.length > 39) return { ok: false, reason: 'amount.units exceeds maximum digit length' };
  return { ok: true };
}

export function assertDecimals(decimals: unknown): AmountCheck {
  if (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    return { ok: false, reason: 'amount.decimals must be an integer in 0..18' };
  }
  return { ok: true };
}

/**
 * Compare two unit strings as big integers without bigint literals in hot paths
 * that might confuse older tooling — BigInt is fine in this Node/vitest target.
 */
export function unitsEqual(a: string, b: string): boolean {
  return assertExactUnits(a).ok && assertExactUnits(b).ok && BigInt(a) === BigInt(b);
}

/** Reject if fractional display would require more precision than decimals allows — N/A for integer units. */
export function assertAmountShape(amount: { units: unknown; decimals: unknown }): AmountCheck {
  const u = assertExactUnits(amount.units);
  if (!u.ok) return u;
  return assertDecimals(amount.decimals);
}
