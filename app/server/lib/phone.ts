/**
 * Liberian mobile NSN prefixes (9 digits after country code), per LTA numbering.
 * Landlines (2x fixed) and premium ranges are rejected.
 */
const MOBILE_NSN_PREFIXES = [
  '555', // Lonestar Cell MTN
  '220', // LIBTELCO mobile
  '770',
  '772',
  '773',
  '774',
  '775',
  '776',
  '777',
  '778',
  '779', // Orange
  '880',
  '881',
  '886',
  '887',
  '888',
  '889', // Lonestar Cell MTN
] as const;

function isSupportedMobileNsn(national: string): boolean {
  if (national.length !== 9) return false;
  const prefix3 = national.slice(0, 3);
  return (MOBILE_NSN_PREFIXES as readonly string[]).includes(prefix3);
}

/** Mask E.164 for logs/DB — never store full MSISDN in SmsDeliveryLog. */
export function maskPhoneForStorage(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const last4 = digits.slice(-4) || '????';
  return `+231******${last4}`;
}

/** Normalize Liberian mobile numbers to E.164 (+231…) format. */
export function normalizePhone(input: string): string {
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, '');

  let national: string | null = null;
  if (digits.startsWith('231') && digits.length >= 11) {
    national = digits.slice(3);
  } else if (digits.startsWith('0') && digits.length >= 9) {
    national = digits.slice(1);
  } else if (digits.length === 8 || digits.length === 9) {
    national = digits;
  } else if (trimmed.startsWith('+231') && digits.startsWith('231')) {
    national = digits.slice(3);
  }

  if (!national || !/^[0-9]+$/.test(national)) {
    throw new Error('Invalid Liberian phone number');
  }

  // Reject landlines (fixed 2x) and unsupported / premium ranges.
  if (national.startsWith('2') && !national.startsWith('220')) {
    throw new Error('Landline numbers are not supported');
  }
  if (national.startsWith('3') || national.startsWith('9')) {
    throw new Error('Unsupported Liberian phone number');
  }

  if (!isSupportedMobileNsn(national)) {
    throw new Error('Unsupported Liberian mobile number');
  }

  return `+231${national}`;
}

/** OneAPI address form used by Orange SMS (tel:+231…). */
export function toTelUri(phone: string): string {
  const normalized = normalizePhone(phone);
  return `tel:${normalized}`;
}

export const LIBERIA_MOBILE_PREFIXES = MOBILE_NSN_PREFIXES;
