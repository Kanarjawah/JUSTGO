/**
 * Orange Money payment integration placeholder.
 * Never expose Orange Money credentials in browser code. Live settlement is not operational here.
 */
export type OrangeMoneyChargeResult = {
  ok: boolean;
  status: 'NOT_CONFIGURED' | 'PLACEHOLDER';
  provider: 'ORANGE_MONEY';
  message: string;
};

export function isOrangeMoneyConfigured(): boolean {
  return Boolean(
    process.env.ORANGE_MONEY_MERCHANT_KEY &&
      process.env.ORANGE_MONEY_MERCHANT_KEY !== 'your-orange-money-merchant-key',
  );
}

export async function initiateOrangeMoneyPayment(_params: {
  amountCents: number;
  phone: string;
  reference: string;
}): Promise<OrangeMoneyChargeResult> {
  if (!isOrangeMoneyConfigured()) {
    return {
      ok: false,
      status: 'NOT_CONFIGURED',
      provider: 'ORANGE_MONEY',
      message:
        'Orange Money is listed as a supported method but is not operational in this environment.',
    };
  }
  return {
    ok: false,
    status: 'PLACEHOLDER',
    provider: 'ORANGE_MONEY',
    message: 'Orange Money credentials present but live payment capture is not implemented.',
  };
}
