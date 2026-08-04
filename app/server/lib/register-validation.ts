import { z } from 'zod';
import {
  CONFIRM_PASSWORD_TOO_SHORT,
  GENERIC_REGISTER_ERROR,
  PASSWORD_TOO_SHORT,
  PASSWORDS_MISMATCH,
} from '@/src/lib/auth-messages';

export const registerSchema = z
  .object({
    fullName: z.string().min(2, 'Enter your full name.').max(120),
    phone: z.string().min(7, 'Enter a valid Liberian phone number.'),
    email: z.string().email('Enter a valid email address.').optional().or(z.literal('')),
    password: z.string().min(10, PASSWORD_TOO_SHORT),
    confirmPassword: z.string().min(10, CONFIRM_PASSWORD_TOO_SHORT),
    accountType: z.enum(['CUSTOMER', 'DRIVER', 'MERCHANT'], {
      errorMap: () => ({ message: 'Select a valid account type.' }),
    }),
    acceptTerms: z.literal(true, {
      errorMap: () => ({ message: 'You must accept the Terms and Privacy Policy.' }),
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: PASSWORDS_MISMATCH,
    path: ['confirmPassword'],
  });

export type RegisterInput = z.infer<typeof registerSchema>;

export type RegisterFieldErrors = Partial<
  Record<'fullName' | 'phone' | 'email' | 'password' | 'confirmPassword' | 'accountType' | 'acceptTerms', string>
>;

/** Map Zod issues to per-field messages without exposing raw JSON. */
export function fieldErrorsFromZod(error: z.ZodError): RegisterFieldErrors {
  const fields: RegisterFieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] || '');
    if (!key || fields[key as keyof RegisterFieldErrors]) continue;
    fields[key as keyof RegisterFieldErrors] = issue.message || GENERIC_REGISTER_ERROR;
  }
  return fields;
}

export function firstRegisterErrorMessage(fields: RegisterFieldErrors): string {
  return (
    fields.password ||
    fields.confirmPassword ||
    fields.fullName ||
    fields.phone ||
    fields.email ||
    fields.accountType ||
    fields.acceptTerms ||
    GENERIC_REGISTER_ERROR
  );
}

/** True when a string looks like leaked Zod/JSON internals. */
export function looksLikeInternalErrorPayload(message: string): boolean {
  const trimmed = message.trim();
  return (
    trimmed.startsWith('[') ||
    trimmed.startsWith('{') ||
    trimmed.includes('"code":') ||
    trimmed.includes('"path":') ||
    trimmed.includes('ZodError')
  );
}
