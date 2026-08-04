import { z } from 'zod';
import { prisma } from '@/server/db';
import { error, json, readJson } from '@/server/http';
import { normalizePhone } from '@/server/lib/phone';
import { assertStrongPassword, hashPassword } from '@/server/lib/password';
import { rateLimit } from '@/server/lib/rate-limit';
import { issueOtp } from '@/server/lib/otp';
import { ensureCustomerWallet } from '@/server/lib/wallet-ledger';
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
    const existingPhone = await prisma.user.findUnique({ where: { phone } });
    if (existingPhone) return error('An account with this phone number already exists', 409);
    if (email) {
      const existingEmail = await prisma.user.findUnique({ where: { email } });
      if (existingEmail) return error('An account with this email already exists', 409);
    }

    const { firstName, lastName } = splitName(body.fullName);
    const passwordHash = await hashPassword(body.password);
    const role = body.accountType;

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          phone,
          email,
          passwordHash,
          firstName,
          lastName,
          role,
          status: 'PENDING',
          termsAcceptedAt: new Date(),
        },
      });

      if (role === 'CUSTOMER') {
        await tx.customerProfile.create({ data: { userId: created.id } });
      } else if (role === 'DRIVER') {
        await tx.driverProfile.create({
          data: {
            userId: created.id,
            applicationStatus: 'PENDING',
            availability: { create: { status: 'OFF' } },
          },
        });
      } else if (role === 'MERCHANT') {
        await tx.merchantProfile.create({
          data: {
            userId: created.id,
            businessName: `${firstName}'s business`,
            applicationStatus: 'PENDING',
          },
        });
      }

      return created;
    });

    if (role === 'CUSTOMER') {
      await ensureCustomerWallet(user.id);
    }

    await issueOtp(phone, user.id);
    await writeAudit({
      actorId: user.id,
      action: 'REGISTER',
      entityType: 'User',
      entityId: user.id,
      metadata: { role },
    });

    // Do not auto-login Driver/Merchant until approved; Customer may continue to OTP verify.
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
        requiresPhoneVerification: true,
        pendingAdminApproval: role !== 'CUSTOMER',
        redirectTo: dashboard,
        message:
          role === 'CUSTOMER'
            ? 'Account created. Verify your phone with the OTP sent (dev: see server terminal).'
            : 'Account created and pending administrator approval. Verify your phone with the OTP (dev: see server terminal).',
      },
      201,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid registration';
    if (message.includes('Password')) return error(message, 400);
    return error(message, 400);
  }
}
