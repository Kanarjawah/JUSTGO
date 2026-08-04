/**
 * Orange SMS integration placeholder.
 * Do not claim production SMS delivery until credentials and a secure provider client exist.
 */
export type SmsSendResult = {
  ok: boolean;
  status: 'QUEUED_PLACEHOLDER' | 'NOT_CONFIGURED';
  provider: 'ORANGE_SMS';
  message: string;
};

export function isOrangeSmsConfigured(): boolean {
  return Boolean(
    process.env.ORANGE_CLIENT_ID &&
      process.env.ORANGE_CLIENT_SECRET &&
      process.env.ORANGE_CLIENT_SECRET !== 'your-orange-client-secret',
  );
}

export async function sendOrangeSms(_phone: string, _body: string): Promise<SmsSendResult> {
  if (!isOrangeSmsConfigured()) {
    return {
      ok: false,
      status: 'NOT_CONFIGURED',
      provider: 'ORANGE_SMS',
      message: 'Orange SMS is not configured. OTP is stored server-side only.',
    };
  }
  return {
    ok: false,
    status: 'QUEUED_PLACEHOLDER',
    provider: 'ORANGE_SMS',
    message: 'Orange SMS credentials detected but live sending is not implemented.',
  };
}
