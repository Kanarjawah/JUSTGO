import { z } from 'zod';
import { prisma } from '@/server/db';
import { error, json, readJson } from '@/server/http';
import { appendLedgerEntry, refreshWalletCaches } from '@/server/lib/wallet-ledger';
import { writeAudit } from '@/server/lib/audit';
import { timingSafeEqual, createHmac } from 'node:crypto';

/**
 * Provider callback foundation. Credits a wallet ONLY when:
 * - PAYMENT_WEBHOOK_SECRET matches
 * - attempt is PENDING
 * - idempotency / provider reference is unique
 *
 * Without approved credentials this endpoint stays locked in production-like use.
 */
export async function POST(request: Request) {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!secret || secret === 'replace-with-payment-webhook-secret') {
    return error('Payment webhook is not configured', 503);
  }

  const signature = request.headers.get('x-justgo-payment-signature') || '';
  const raw = await request.text();
  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  try {
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return error('Invalid signature', 401);
    }
  } catch {
    return error('Invalid signature', 401);
  }

  try {
    const body = z
      .object({
        attemptId: z.string(),
        providerReference: z.string().min(3),
        status: z.enum(['SUCCEEDED', 'FAILED']),
      })
      .parse(JSON.parse(raw));

    const attempt = await prisma.paymentAttempt.findUnique({ where: { id: body.attemptId } });
    if (!attempt) return error('Attempt not found', 404);
    if (attempt.status === 'SUCCEEDED') {
      return json({ ok: true, duplicate: true });
    }

    if (body.status === 'FAILED') {
      await prisma.$transaction(async (tx) => {
        await tx.paymentAttempt.update({
          where: { id: attempt.id },
          data: { status: 'FAILED', completedAt: new Date(), failureReason: 'Provider reported failure' },
        });
        if (attempt.walletTxId) {
          await tx.walletTransaction.update({
            where: { id: attempt.walletTxId },
            data: { status: 'FAILED', completedAt: new Date() },
          });
        }
        if (attempt.walletId) await refreshWalletCaches(attempt.walletId, tx);
      });
      return json({ ok: true, status: 'FAILED' });
    }

    if (!attempt.walletId || !attempt.walletTxId) {
      return error('Attempt is not wallet-linked', 400);
    }

    const { transaction, duplicate } = await appendLedgerEntry({
      walletId: attempt.walletId,
      type: 'RECHARGE',
      amountCents: attempt.amountCents,
      description: 'Provider-confirmed wallet recharge',
      idempotencyKey: `provider:${body.providerReference}`,
      provider: attempt.provider,
      providerReference: body.providerReference,
      createdById: attempt.userId,
      status: 'COMPLETED',
    });

    if (!duplicate) {
      await prisma.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'SUCCEEDED',
          providerReference: body.providerReference,
          completedAt: new Date(),
          failureReason: null,
        },
      });
      await prisma.walletTransaction.update({
        where: { id: attempt.walletTxId },
        data: { status: 'CANCELED', completedAt: new Date(), description: 'Superseded by provider-confirmed ledger entry' },
      });
      await writeAudit({
        actorId: attempt.userId,
        action: 'WALLET_RECHARGE_COMPLETED',
        entityType: 'WalletTransaction',
        entityId: transaction.id,
        metadata: { providerReference: body.providerReference },
      });
    }

    return json({ ok: true, duplicate, transactionId: transaction.id });
  } catch (err) {
    return error(err instanceof Error ? err.message : 'Invalid callback', 400);
  }
}
