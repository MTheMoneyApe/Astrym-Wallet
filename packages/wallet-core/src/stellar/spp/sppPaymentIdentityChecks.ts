/**
 * Payment mint stays fail-closed. There is no setter on this module.
 * Tests that need the mint path replace this module with vi.mock.
 */
export function sppPaymentIdentityChecksEnabled(): boolean {
  return false;
}
