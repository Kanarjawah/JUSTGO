import { z } from 'zod';
import { prisma } from '@/server/db';
import { error, json, readJson } from '@/server/http';
import { requireUser } from '@/server/authz';
import { normalizePhone } from '@/server/lib/phone';
import { encryptText } from '@/server/lib/crypto';
import { ensureUserWallet } from '@/server/lib/wallet-ledger';
import { writeAudit } from '@/server/lib/audit';
import { issueOtp, verifyOtpCode } from '@/server/lib/otp';

const COOLOFF_MS = 24 * 60 * 60 * 1000;

function maskPhone(phone: string) {
  return `${phone.slice(0, 6)}****${phone.slice(-2)}`;
}

function maskAccount(last4: string) {
  return `****${last4.slice(-4)}`;
}

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  if (auth.user.role === 'CUSTOMER') {
    return error('Customers use in-app payment methods; payout destinations are for Driver, Merchant, and Admin', 403);
  }

  const rows = await prisma.payoutDestination.findMany({
    where: { userId: auth.user.id, active: true },
    orderBy: { createdAt: 'desc' },
  });

  return json({
    destinations: rows.map((d) => ({
      id: d.id,
      type: d.type,
      accountHolderName: d.accountHolderName,
      bankName: d.bankName,
      displayHint: d.displayHint,
      verificationStatus: d.verificationStatus,
      currency: d.currency,
      country: d.country,
      changeCooloffUntil: d.changeCooloffUntil,
    })),
  });
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  if (auth.user.role === 'CUSTOMER') {
    return error('Payout destinations are not available for Customer wallets', 403);
  }

  try {
    const body = z
      .object({
        type: z.enum(['BANK_ACCOUNT', 'MTN_MOMO', 'ORANGE_MONEY']),
        accountHolderName: z.string().min(2).max(120),
        bankName: z.string().min(2).max(120).optional(),
        accountNumberOrToken: z.string().min(4).max(120).optional(),
        bankOrBranchCode: z.string().max(40).optional(),
        phone: z.string().optional(),
        currency: z.string().default('LRD'),
        country: z.string().default('LR'),
        recentAuthConfirmed: z.literal(true),
      })
      .parse(await readJson(request));

    const wallet = await ensureUserWallet(auth.user.id);
    let displayHint = '';
    let accountNumberEncrypted: string | null = null;
    let phoneEncrypted: string | null = null;
    let provider: 'MTN_MOMO' | 'ORANGE_MONEY' | 'CARD_HOSTED' | null = null;

    if (body.type === 'BANK_ACCOUNT') {
      if (!body.bankName || !body.accountNumberOrToken) {
        return error('Bank name and account number/token are required', 400);
      }
      // Prefer treating value as provider token; store encrypted, expose masked hint only.
      accountNumberEncrypted = encryptText(body.accountNumberOrToken);
      displayHint = `${body.bankName} ${maskAccount(body.accountNumberOrToken)}`;
    } else {
      if (!body.phone) return error('Mobile-money phone is required', 400);
      const phone = normalizePhone(body.phone);
      phoneEncrypted = encryptText(phone);
      provider = body.type === 'MTN_MOMO' ? 'MTN_MOMO' : 'ORANGE_MONEY';
      displayHint = `${body.type} ${maskPhone(phone)}`;
    }

    const dest = await prisma.payoutDestination.create({
      data: {
        userId: auth.user.id,
        walletId: wallet.id,
        type: body.type,
        accountHolderName: body.accountHolderName,
        bankName: body.bankName ?? null,
        accountNumberEncrypted,
        bankOrBranchCode: body.bankOrBranchCode ?? null,
        provider,
        phoneEncrypted,
        currency: body.currency,
        country: body.country,
        verificationStatus: 'PENDING_OTP',
        displayHint,
        changeCooloffUntil: new Date(Date.now() + COOLOFF_MS),
      },
    });

    await issueOtp(auth.user.phone, auth.user.id);
    await writeAudit({
      actorId: auth.user.id,
      action: 'PAYOUT_DESTINATION_CREATED',
      entityType: 'PayoutDestination',
      entityId: dest.id,
      metadata: { type: body.type, displayHint },
    });

    return json(
      {
        destination: {
          id: dest.id,
          type: dest.type,
          displayHint: dest.displayHint,
          verificationStatus: dest.verificationStatus,
          changeCooloffUntil: dest.changeCooloffUntil,
        },
        message: 'Destination created. Verify with OTP before activation (dev: OTP in server terminal).',
      },
      201,
    );
  } catch (err) {
    return error(err instanceof Error ? err.message : 'Invalid request', 400);
  }
}

export async function PUT(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    const body = z
      .object({
        destinationId: z.string(),
        code: z.string().min(4).max(10),
      })
      .parse(await readJson(request));

    const dest = await prisma.payoutDestination.findFirst({
      where: { id: body.destinationId, userId: auth.user.id },
    });
    if (!dest) return error('Destination not found', 404);

    await verifyOtpCode(auth.user.phone, body.code);
    const updated = await prisma.payoutDestination.update({
      where: { id: dest.id },
      data: { verificationStatus: 'VERIFIED', verifiedAt: new Date() },
    });
    await writeAudit({
      actorId: auth.user.id,
      action: 'PAYOUT_DESTINATION_VERIFIED',
      entityType: 'PayoutDestination',
      entityId: dest.id,
    });

    return json({
      destination: {
        id: updated.id,
        verificationStatus: updated.verificationStatus,
        displayHint: updated.displayHint,
      },
    });
  } catch (err) {
    const status = (err as Error & { status?: number }).status ?? 400;
    return error(err instanceof Error ? err.message : 'Verification failed', status);
  }
}
