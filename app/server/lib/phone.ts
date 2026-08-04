/** Normalize Liberian phone numbers to +231 format. */
export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.startsWith('231') && digits.length >= 11) {
    return `+${digits}`;
  }
  if (digits.startsWith('0') && digits.length >= 9) {
    return `+231${digits.slice(1)}`;
  }
  if (digits.length === 8 || digits.length === 9) {
    return `+231${digits}`;
  }
  if (input.trim().startsWith('+231')) {
    return `+${digits}`;
  }
  throw new Error('Invalid Liberian phone number');
}
