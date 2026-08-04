export const FULFILLMENT_STAGES = ['ARRIVED', 'PICKUP', 'IN_TRANSIT', 'DELIVERED'] as const;
export type FulfillmentStageName = (typeof FULFILLMENT_STAGES)[number];

const ORDER: Record<FulfillmentStageName, number> = {
  ARRIVED: 0,
  PICKUP: 1,
  IN_TRANSIT: 2,
  DELIVERED: 3,
};

export function canTransition(
  current: FulfillmentStageName | null | undefined,
  next: FulfillmentStageName,
): { ok: true } | { ok: false; error: string } {
  if (current === 'DELIVERED') {
    return { ok: false, error: 'Delivered is a final operational state' };
  }
  if (!current) {
    if (next === 'ARRIVED') return { ok: true };
    return { ok: false, error: 'First stage must be Arrived' };
  }
  const cur = ORDER[current];
  const nxt = ORDER[next];
  if (nxt !== cur + 1) {
    return { ok: false, error: `Invalid transition from ${current} to ${next}` };
  }
  return { ok: true };
}

export function stageLabel(stage: FulfillmentStageName): string {
  switch (stage) {
    case 'ARRIVED':
      return 'Arrived';
    case 'PICKUP':
      return 'Pickup';
    case 'IN_TRANSIT':
      return 'In Transit';
    case 'DELIVERED':
      return 'Delivered';
  }
}
