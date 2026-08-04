import { describe, expect, it } from 'vitest';
import { canTransition } from '../../app/server/lib/status';

describe('fulfillment stages', () => {
  it('follows Arrived → Pickup → In Transit → Delivered', () => {
    expect(canTransition(null, 'ARRIVED').ok).toBe(true);
    expect(canTransition('ARRIVED', 'PICKUP').ok).toBe(true);
    expect(canTransition('PICKUP', 'IN_TRANSIT').ok).toBe(true);
    expect(canTransition('IN_TRANSIT', 'DELIVERED').ok).toBe(true);
  });

  it('rejects invalid transitions', () => {
    expect(canTransition('DELIVERED', 'PICKUP').ok).toBe(false);
    expect(canTransition('ARRIVED', 'DELIVERED').ok).toBe(false);
    expect(canTransition('IN_TRANSIT', 'ARRIVED').ok).toBe(false);
    expect(canTransition(null, 'PICKUP').ok).toBe(false);
  });
});
