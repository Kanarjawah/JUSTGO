import { NextResponse } from 'next/server';
import { prisma } from '@/server/db';
import { rateLimit } from '@/server/lib/rate-limit';
import { maskPhoneForStorage } from '@/server/lib/phone';

/**
 * Orange SMS Delivery Receipt (DR) callback.
 * Logs provider delivery status and resource IDs without storing message bodies or OTPs.
 */
export async function POST(request: Request) {
  const limited = rateLimit(request, 'orange-sms-dr', 120, 60_000);
  if (!limited.ok) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const deliveryInfo =
      (payload.deliveryInfoNotification as Record<string, unknown> | undefined)?.deliveryInfo ||
      (payload.deliveryInfo as Record<string, unknown> | undefined) ||
      payload;

    const info = deliveryInfo as {
      deliveryStatus?: string;
      address?: string;
      code?: string | number;
      link?: Array<{ rel?: string; href?: string }>;
    };

    const status = String(info.deliveryStatus || info.code || 'UNKNOWN').slice(0, 64);
    const address = typeof info.address === 'string' ? info.address : '';
    const phoneDigits = address.replace(/\D/g, '');
    const phoneMasked = phoneDigits
      ? maskPhoneForStorage(`+${phoneDigits.replace(/^00/, '')}`)
      : 'unknown';

    const resourceHref =
      info.link?.find((l) => l.rel === 'OutboundSMSMessageRequest' || l.href)?.href ||
      (typeof (payload as { resourceURL?: string }).resourceURL === 'string'
        ? (payload as { resourceURL: string }).resourceURL
        : undefined);
    const providerReference = resourceHref
      ? resourceHref.split('/').filter(Boolean).pop()?.slice(0, 128)
      : undefined;

    await prisma.smsDeliveryLog.create({
      data: {
        phone: phoneMasked,
        status: `DR_${status}`,
        provider: 'ORANGE_SMS',
        message: 'Delivery receipt received',
        purpose: 'GENERIC',
        providerReference: providerReference ?? null,
      },
    });

    console.info('[JUSTGO Orange SMS] delivery receipt', {
      status,
      phoneLast4: phoneDigits.slice(-4) || null,
      providerReference: providerReference ?? null,
    });

    return NextResponse.json({ ok: true });
  } catch {
    console.error('[JUSTGO Orange SMS] delivery receipt handling failed');
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
