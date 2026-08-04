/**
 * MTN MoMo payment integration placeholder.
 * Never expose MTN credentials in browser code. Live settlement is not operational here.
 */
export type MoMoChargeResult = {
  ok: boolean;
  status: 'NOT_CONFIGURED' | 'PLACEHOLDER';
  provider: 'MTN_MOMO';
  message: string;
};

export function isMtnMomoConfigured(): boolean {
  return Boolean(
    process.env.MTN_MOMO_SUBSCRIPTION_KEY &&
      process.env.MTN_MOMO_SUBSCRIPTION_KEY !== 'your-mtn-subscription-key',
  );
}

export async function initiateMtnMomoPayment(_params: {
  amountCents: number;
  phone: string;
  reference: string;
}): Promise<MoMoChargeResult> {
  if (!isMtnMomoConfigured()) {
    return {
      ok: false,
      status: 'NOT_CONFIGURED',
      provider: 'MTN_MOMO',
      message: 'MTN MoMo is listed as a supported method but is not operational in this environment.',
    };
  }
  return {
    ok: false,
    status: 'PLACEHOLDER',
    provider: 'MTN_MOMO',
    message: 'MTN MoMo credentials present but live payment capture is not implemented.',
  };
}
