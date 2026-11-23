/**
 * Test-only identity-check switch. Nothing under src/ imports this module.
 * Pair with vi.mock of sppPaymentIdentityChecks.js so mint reads `enabled`.
 */
export const sppPaymentIdentityChecks = { enabled: false };

export function setSppPaymentIdentityChecksForTests(enabled: boolean): void {
  sppPaymentIdentityChecks.enabled = enabled;
}
