'use client';

function ld(cents: number) {
  return `L$${(cents / 100).toFixed(2)}`;
}

export default function PriceBreakdown({
  subtotalCents,
  deliveryOrRideCents,
  taxCents,
  customerPlatformFeeCents,
  tipCents,
  totalCents,
  walletAmountUsedCents = 0,
  remainingExternalCents,
}: {
  subtotalCents: number;
  deliveryOrRideCents: number;
  taxCents: number;
  customerPlatformFeeCents: number;
  tipCents: number;
  totalCents: number;
  walletAmountUsedCents?: number;
  remainingExternalCents?: number;
}) {
  const remaining =
    remainingExternalCents ?? Math.max(0, totalCents - walletAmountUsedCents);

  return (
    <div className="price-breakdown" aria-label="Price breakdown">
      <div><span>Service or product subtotal</span><strong>{ld(subtotalCents)}</strong></div>
      <div><span>Delivery or ride charge</span><strong>{ld(deliveryOrRideCents)}</strong></div>
      <div><span>Tax</span><strong>{ld(taxCents)}</strong></div>
      <div><span>Customer platform fee</span><strong>{ld(customerPlatformFeeCents)}</strong></div>
      <div><span>Driver tip</span><strong>{ld(tipCents)}</strong></div>
      <div><span>Wallet amount used</span><strong>{ld(walletAmountUsedCents)}</strong></div>
      <div><span>Remaining external payment</span><strong>{ld(remaining)}</strong></div>
      <div className="total"><span>Total</span><strong>{ld(totalCents)}</strong></div>
    </div>
  );
}
