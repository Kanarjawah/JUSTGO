import { describe, expect, it } from 'vitest';
import {
  PLATFORM_FEE_CENTS,
  customerPriceBreakdown,
  driverEarningsBreakdown,
  platformRevenueFromFees,
} from '../../server/lib/money';

describe('fees and tips', () => {
  it('applies L$1 customer fee only in completed settlement helpers', () => {
    const breakdown = customerPriceBreakdown({
      subtotalCents: 35000,
      deliveryOrRideCents: 0,
      taxCents: 1750,
      tipCents: 500,
    });
    expect(breakdown.customerPlatformFeeCents).toBe(PLATFORM_FEE_CENTS);
    expect(PLATFORM_FEE_CENTS).toBe(100);
  });

  it('deducts L$1 driver fee only when completed', () => {
    const incomplete = driverEarningsBreakdown(35000, 500, false);
    expect(incomplete.driverPlatformFeeCents).toBe(0);
    const complete = driverEarningsBreakdown(35000, 500, true);
    expect(complete.driverPlatformFeeCents).toBe(100);
    expect(complete.netDriverEarningCents).toBe(35000 + 500 - 100);
  });

  it('excludes tips from platform revenue', () => {
    const revenue = platformRevenueFromFees(100, 100, 0);
    expect(revenue).toBe(200);
    expect(revenue).not.toBe(200 + 500);
  });
});
