export function parseSolToLamports(solAmount: string): string {
  if (typeof solAmount !== 'string') {
    throw new Error('Amount must be a string');
  }

  const trimmed = solAmount.trim();
  if (trimmed === '') {
    throw new Error('Amount cannot be empty');
  }

  // Reject scientific notation, multiple dots, negative values, etc.
  // Enforce digits with optional single dot and max 9 decimal places.
  if (!/^\d+(\.\d{1,9})?$/.test(trimmed)) {
    throw new Error('Invalid SOL amount format');
  }

  const parts = trimmed.split('.');
  const integerPart = parts[0];
  const fractionalPart = parts.length > 1 ? parts[1] : '';

  // Pad fractional part to exactly 9 digits
  const paddedFractional = fractionalPart.padEnd(9, '0');

  // Combine and remove leading zeros
  const combined = integerPart + paddedFractional;
  const lamportsStr = combined.replace(/^0+/, '') || '0';

  if (lamportsStr === '0') {
    throw new Error('Amount must be strictly positive');
  }

  return lamportsStr;
}
