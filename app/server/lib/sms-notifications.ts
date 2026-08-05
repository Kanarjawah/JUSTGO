import { sendOrangeSms, type SmsPurpose } from '../../../integrations/orange-sms';
import { prisma } from '../db';
import { maskPhoneForStorage, normalizePhone } from './phone';

const GENERIC_SMS_FAILURE = 'Unable to send the message right now. Please try again later.';

async function logDelivery(params: {
  phone: string;
  status: string;
  provider: string;
  logMessage: string;
  purpose: SmsPurpose;
  providerReference?: string;
}) {
  await prisma.smsDeliveryLog.create({
    data: {
      phone: maskPhoneForStorage(params.phone),
      status: params.status,
      provider: params.provider,
      message: params.logMessage,
      purpose: params.purpose,
      providerReference: params.providerReference ?? null,
    },
  });
}

/**
 * Low-level send + delivery logging. Never persists SMS body / OTP content.
 * Returns a user-safe error message when ok=false.
 * SMS delivery is never treated as payment confirmation.
 */
export async function dispatchSms(params: {
  phone: string;
  body: string;
  purpose: SmsPurpose;
}): Promise<{ ok: boolean; userMessage?: string; providerReference?: string }> {
  const phone = normalizePhone(params.phone);
  const result = await sendOrangeSms(phone, params.body, params.purpose);
  await logDelivery({
    phone,
    status: result.status,
    provider: result.provider,
    logMessage: result.logMessage,
    purpose: result.purpose,
    providerReference: result.providerReference,
  });
  if (!result.ok) {
    return { ok: false, userMessage: GENERIC_SMS_FAILURE };
  }
  return { ok: true, providerReference: result.providerReference };
}

/** OTP verification SMS — body contains the code; body is never logged. */
export async function sendOtpSms(phone: string, code: string) {
  return dispatchSms({
    phone,
    purpose: 'OTP_VERIFICATION',
    body: `JUSTGO code: ${code}. Valid 5 minutes. Do not share this code.`,
  });
}

/** Transaction status notification (no payment confirmation / balance changes). */
export async function sendTransactionStatusSms(
  phone: string,
  summary: { requestNumber?: string; status: string },
) {
  const ref = summary.requestNumber ? ` ${summary.requestNumber}` : '';
  return dispatchSms({
    phone,
    purpose: 'TRANSACTION_STATUS',
    body: `JUSTGO update${ref}: ${summary.status}. Open the app for details.`,
  });
}

/** Service / fulfillment status notification. */
export async function sendServiceStatusSms(
  phone: string,
  summary: { serviceLabel?: string; status: string },
) {
  const label = summary.serviceLabel ? ` (${summary.serviceLabel})` : '';
  return dispatchSms({
    phone,
    purpose: 'SERVICE_STATUS',
    body: `JUSTGO service update${label}: ${summary.status}.`,
  });
}

/** Driver / merchant account approval or rejection (not payment-related). */
export async function sendAccountApprovalSms(
  phone: string,
  summary: { roleLabel: string; approved: boolean },
) {
  const outcome = summary.approved ? 'approved' : 'not approved';
  return dispatchSms({
    phone,
    purpose: 'ACCOUNT_APPROVAL',
    body: `JUSTGO: Your ${summary.roleLabel} account was ${outcome}. Open the app for next steps.`,
  });
}

export const SMS_USER_FAILURE = GENERIC_SMS_FAILURE;
