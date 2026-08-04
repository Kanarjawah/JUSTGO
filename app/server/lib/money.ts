import { Decimal } from 'decimal.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/** All monetary values are integer Liberian dollar cents (smallest unit). L$1 = 100 cents. */
export const PLATFORM_FEE_CENTS = 100;

export function toCents(amountLd: number | string): number {
  return new Decimal(amountLd).mul(100).round().toNumber();
}

export function fromCents(cents: number): string {
  return new Decimal(cents).div(100).toFixed(2);
}

export function addCents(...values: number[]): number {
  return values.reduce((acc, v) => new Decimal(acc).plus(v).toNumber(), 0);
}

export function subCents(a: number, b: number): number {
  return new Decimal(a).minus(b).toNumber();
}

export interface PriceBreakdownInput {
  subtotalCents: number;
  deliveryOrRideCents: number;
  taxCents: number;
  tipCents?: number;
}

export function customerPriceBreakdown(input: PriceBreakdownInput) {
  const tip = input.tipCents ?? 0;
  const platformFee = PLATFORM_FEE_CENTS;
  const total = addCents(
    input.subtotalCents,
    input.deliveryOrRideCents,
    input.taxCents,
    platformFee,
    tip,
  );
  return {
    subtotalCents: input.subtotalCents,
    deliveryOrRideCents: input.deliveryOrRideCents,
    taxCents: input.taxCents,
    customerPlatformFeeCents: platformFee,
    tipCents: tip,
    totalCents: total,
  };
}

export function driverEarningsBreakdown(grossCents: number, tipCents: number, completed: boolean) {
  const platformFee = completed ? PLATFORM_FEE_CENTS : 0;
  const net = subCents(addCents(grossCents, tipCents), platformFee);
  return {
    grossDriverEarningCents: grossCents,
    driverPlatformFeeCents: platformFee,
    tipCents,
    netDriverEarningCents: net,
  };
}

export function merchantSettlementBreakdown(
  productSubtotalCents: number,
  taxCents: number,
  merchantFeeCents: number,
  refundCents: number,
) {
  const net = subCents(
    addCents(productSubtotalCents, taxCents),
    addCents(merchantFeeCents, refundCents),
  );
  return {
    productSubtotalCents,
    taxCents,
    merchantFeeCents,
    refundCents,
    netMerchantSettlementCents: net,
  };
}

/** Tips are never platform revenue. */
export function platformRevenueFromFees(
  customerFeeCents: number,
  driverFeeCents: number,
  merchantFeeCents: number,
) {
  return addCents(customerFeeCents, driverFeeCents, merchantFeeCents);
}
