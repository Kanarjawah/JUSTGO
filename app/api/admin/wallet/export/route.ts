import { prisma } from '@/server/db';
import { withAdmin } from '@/server/route-handler';

/** Export wallet transactions without secrets (no provider secrets, cards, OTPs). */
export async function GET(request: Request) {
  return withAdmin(request, async () => {
    const rows = await prisma.walletTransaction.findMany({
      orderBy: { createdAt: 'desc' },
      take: 1000,
      include: {
        wallet: {
          include: {
            user: { select: { id: true, phone: true, firstName: true, lastName: true } },
          },
        },
      },
    });

    const header = [
      'id',
      'userId',
      'phone',
      'type',
      'amountCents',
      'currency',
      'status',
      'provider',
      'providerReference',
      'description',
      'idempotencyKey',
      'createdAt',
      'completedAt',
    ];
    const lines = [
      header.join(','),
      ...rows.map((r) =>
        [
          r.id,
          r.wallet.userId,
          r.wallet.user.phone,
          r.type,
          r.amountCents,
          r.currency,
          r.status,
          r.provider ?? '',
          r.providerReference ?? '',
          JSON.stringify(r.description),
          r.idempotencyKey,
          r.createdAt.toISOString(),
          r.completedAt?.toISOString() ?? '',
        ].join(','),
      ),
    ];

    return new Response(lines.join('\n'), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="justgo-wallet-transactions.csv"',
      },
    });
  });
}
