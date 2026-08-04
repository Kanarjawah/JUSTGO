import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { error, json, readJson } from '@/server/http';
import { withAdmin } from '@/server/route-handler';
import { appendLedgerEntry, ensureCustomerWallet, refreshWalletCaches } from '@/server/lib/wallet-ledger';
import { writeAudit } from '@/server/lib/audit';
import { toCents } from '@/server/lib/money';

export async function GET(request: Request) {
  return withAdmin(request, async () => {
    const url = new URL(request.url);
    const q = url.searchParams.get('q')?.trim() || '';
    const wallets = await prisma.wallet.findMany({
      where: q
        ? {
            OR: [
              { user: { phone: { contains: q } } },
              { user: { email: { contains: q } } },
              { user: { firstName: { contains: q } } },
              { user: { lastName: { contains: q } } },
            ],
          }
        : undefined,
      include: {
        user: { select: { id: true, phone: true, email: true, firstName: true, lastName: true, role: true, status: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });

    const [attempts, refunds, audits] = await Promise.all([
      prisma.paymentAttempt.findMany({
        where: { status: { in: ['PENDING', 'FAILED'] } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.refund.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.auditLog.findMany({
        where: { action: { contains: 'WALLET' } },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { actor: { select: { firstName: true, lastName: true, role: true } } },
      }),
    ]);

    return json({
      wallets,
      pendingOrFailedAttempts: attempts,
      refunds,
      auditLogs: audits,
      exportNote: 'Use /api/admin/wallet/export for CSV without secrets.',
    });
  });
}

export async function POST(request: Request) {
  return withAdmin(request, async (admin) => {
    const body = z
      .object({
        userId: z.string().min(1),
        /** Signed Liberian dollars: positive credits, negative debits */
        amountLd: z.union([z.number(), z.string()]),
        reason: z.string().min(5).max(500),
        confirm: z.literal(true),
        idempotencyKey: z.string().min(8).max(80).optional(),
      })
      .parse(await readJson(request));

    const amountCents = toCents(body.amountLd);
    if (amountCents === 0) return error('Adjustment amount cannot be zero', 400);

    const wallet = await ensureCustomerWallet(body.userId);
    const key = body.idempotencyKey || `adj:${admin.id}:${randomBytes(8).toString('hex')}`;

    const { transaction, duplicate } = await appendLedgerEntry({
      walletId: wallet.id,
      type: 'ADJUSTMENT',
      amountCents,
      description: `Admin adjustment: ${body.reason}`,
      idempotencyKey: key,
      provider: 'ADMIN_ADJUSTMENT',
      providerReference: key,
      createdById: admin.id,
      status: 'COMPLETED',
      allowNegative: false,
    });

    await writeAudit({
      actorId: admin.id,
      action: 'WALLET_ADMIN_ADJUSTMENT',
      entityType: 'WalletTransaction',
      entityId: transaction.id,
      metadata: { reason: body.reason, amountCents, userId: body.userId, duplicate },
    });

    const fresh = await refreshWalletCaches(wallet.id);
    return json({ ok: true, transaction, wallet: fresh, duplicate });
  });
}
