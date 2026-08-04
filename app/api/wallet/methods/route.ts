import { z } from 'zod';
import { prisma } from '@/server/db';
import { error, json, readJson } from '@/server/http';
import { requireUser } from '@/server/authz';
import { normalizePhone } from '@/server/lib/phone';
import { ensureUserWallet } from '@/server/lib/wallet-ledger';

export async function POST(request: Request) {
  const auth = await requireUser(['CUSTOMER']);
  if (!auth.ok) return auth.response;

  try {
    const body = z
      .object({
        method: z.enum(['MTN_MOMO', 'ORANGE_MONEY', 'CARD']),
        momoPhone: z.string().optional(),
        displayHint: z.string().min(2).max(80),
        /** External token from a PCI provider — never a full PAN/CVV/PIN */
        externalRef: z.string().min(4).max(120).optional(),
      })
      .parse(await readJson(request));

    if (body.method === 'CARD' && !body.externalRef) {
      return error(
        'Card methods require a tokenized reference from a PCI-compliant hosted provider. Full card numbers are not accepted.',
        400,
      );
    }

    if ((body.method === 'MTN_MOMO' || body.method === 'ORANGE_MONEY') && body.momoPhone) {
      normalizePhone(body.momoPhone);
    }

    const wallet = await ensureUserWallet(auth.user.id);
    const ref = await prisma.paymentMethodReference.create({
      data: {
        userId: auth.user.id,
        walletId: wallet.id,
        method: body.method,
        provider:
          body.method === 'MTN_MOMO'
            ? 'MTN_MOMO'
            : body.method === 'ORANGE_MONEY'
              ? 'ORANGE_MONEY'
              : 'CARD_HOSTED',
        externalRef: body.externalRef ?? null,
        displayHint: body.displayHint,
        momoPhoneMasked: body.momoPhone
          ? `${normalizePhone(body.momoPhone).slice(0, 6)}****`
          : null,
      },
    });

    return json({ method: ref }, 201);
  } catch (err) {
    return error(err instanceof Error ? err.message : 'Invalid request', 400);
  }
}
