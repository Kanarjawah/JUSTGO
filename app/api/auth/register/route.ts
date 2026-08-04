import { z } from 'zod';
import { error, json, readJson } from '@/server/http';
import { normalizePhone } from '@/server/lib/phone';
import { assertStrongPassword, hashPassword } from '@/server/lib/password';
import { rateLimit } from '@/server/lib/rate-limit';
import { issueOtp } from '@/server/lib/otp';
import { createUserWithWallet } from '@/server/lib/create-user-with-wallet';
import { writeAudit } from '@/server/lib/audit';
import { setSessionUserId } from '@/server/session';

const registerSchema = z.object({
  fullName: z.string().min(2).max(120),
  phone: z.string().min(7),
  email: z.string().email().optional().or(z.literal('')),
  password: z.string().min(10),
  confirmPassword: z.string().min(10),
  accountType: z.enum(['CUSTOMER', 'DRIVER', 'MERCHANT']),
  acceptTerms: z.literal(true),
});

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts[0] || 'User';
  const lastName = parts.slice(1).join(' ') || firstName;
  return { firstName, lastName };
}

export async function POST(request: Request) {
  const limited = rateLimit(request, 'register', 8, 15 * 60_000);
  if (!limited.ok) {
    return error(`Too many registration attempts. Retry in ${limited.retryAfterSec}s`, 429);
  }

  try {
    const body = registerSchema.parse(await readJson(request));
    if (body.password !== body.confirmPassword) {
      return error('Passwords do not match', 400);
    }
    assertStrongPassword(body.password);

    let phone: string;
    try {
      phone = normalizePhone(body.phone);
    } catch {
      return error('Invalid Liberian phone number', 400);
    }

    const email = body.email?.trim() ? body.email.trim().toLowerCase() : null;
    const { prisma } = await import('@/server/db');
    const existingPhone = await prisma.user.findUnique({ where: { phone } });
    if (existingPhone) return error('An account with this phone number already exists', 409);
    if (email) {
      const existingEmail = await prisma.user.findUnique({ where: { email } });
      if (existingEmail) return error('An account with this email already exists', 409);
    }

    const { firstName, lastName } = splitName(body.fullName);
    const passwordHash = await hashPassword(body.password);
    const role = body.accountType;

    const { user, wallet } = await createUserWithWallet({
      phone,
      email,
      passwordHash,
      firstName,
      lastName,
      role,
      status: 'PENDING',
      termsAcceptedAt: new Date(),
      merchant: role === 'MERCHANT' ? { businessName: `${firstName}'s business` } : undefined,
    });

    await issueOtp(phone, user.id);
    await writeAudit({
      actorId: user.id,
      action: 'REGISTER',
      entityType: 'User',
      entityId: user.id,
      metadata: { role, walletPublicReference: wallet.publicReference },
    });

    if (role === 'CUSTOMER') {
      await setSessionUserId(user.id);
    }

    const dashboard =
      role === 'DRIVER' ? '/driver' : role === 'MERCHANT' ? '/merchant' : '/customer';

    return json(
      {
        ok: true,
        user: {
          id: user.id,
          role: user.role,
          firstName: user.firstName,
          lastName: user.lastName,
          phone: user.phone,
          status: user.status,
        },
        wallet: {
          publicReference: wallet.publicReference,
          currency: wallet.currency,
          availableCents: 0,
        },
        requiresPhoneVerification: true,
        pendingAdminApproval: role !== 'CUSTOMER',
        redirectTo: dashboard,
        message:
          role === 'CUSTOMER'
            ? 'Account and wallet created. Verify your phone with the OTP (dev: see server terminal).'
            : 'Account and wallet created; pending administrator approval. Verify your phone (dev: see server terminal).',
      },
      201,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid registration';
    if (message.includes('Password')) return error(message, 400);
    return error(message, 400);
  }
}
