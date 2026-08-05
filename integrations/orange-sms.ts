/**
 * Orange SMS Liberia (v2) server-side client.
 * Credentials and tokens never leave the server process.
 *
 * Docs: https://developer.orange.com/apis/sms-liberia/
 * Token: POST https://api.orange.com/oauth/v3/token (client_credentials, ~3600s)
 * Send:  POST https://api.orange.com/smsmessaging/v1/outbound/{senderAddress}/requests
 * Liberia country senderAddress default: tel:+2310000
 */

import 'server-only';

export type SmsPurpose =
  | 'OTP_VERIFICATION'
  | 'TRANSACTION_STATUS'
  | 'SERVICE_STATUS'
  | 'ACCOUNT_APPROVAL'
  | 'GENERIC';

export type SmsSendStatus =
  | 'SENT'
  | 'MOCK_SENT'
  | 'QUEUED'
  | 'FAILED'
  | 'NOT_CONFIGURED'
  | 'DISABLED'
  | 'MOCK_BLOCKED_IN_PRODUCTION';

export type SmsSendResult = {
  ok: boolean;
  status: SmsSendStatus;
  provider: 'ORANGE_SMS';
  /** Safe, non-sensitive summary for SmsDeliveryLog — never includes SMS body or OTP. */
  logMessage: string;
  providerReference?: string;
  httpStatus?: number;
  purpose: SmsPurpose;
};

type TokenCache = {
  accessToken: string;
  expiresAtMs: number;
};

const DEFAULT_TOKEN_URL = 'https://api.orange.com/oauth/v3/token';
const DEFAULT_API_BASE = 'https://api.orange.com/smsmessaging/v1';
/** Orange Liberia platform senderAddress (OneAPI). */
const DEFAULT_LIBERIA_COUNTRY_SENDER = 'tel:+2310000';
/** Refresh token this many ms before advertised expiry. */
const TOKEN_REFRESH_SKEW_MS = 60_000;

let tokenCache: TokenCache | null = null;

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function isPlaceholderSecret(value: string | undefined): boolean {
  if (!value) return true;
  const lowered = value.toLowerCase();
  return (
    lowered.startsWith('your_') ||
    lowered.startsWith('your-') ||
    lowered.startsWith('paste_') ||
    lowered.includes('client_secret') ||
    lowered.includes('client-secret') ||
    lowered.includes('paste_client') ||
    lowered === 'change-me'
  );
}

/** True when ORANGE_SMS_MOCK_MODE (or legacy ORANGE_SMS_MOCK) is enabled. */
export function isOrangeSmsMockEnvEnabled(): boolean {
  const mockMode = (env('ORANGE_SMS_MOCK_MODE') || env('ORANGE_SMS_MOCK') || '').toLowerCase();
  return mockMode === 'true';
}

/**
 * Refuse to start the app in production when mock SMS is enabled.
 * Call from instrumentation / boot — do not soft-fail sends only.
 */
export function assertOrangeSmsSafeToStart(): void {
  if (process.env.NODE_ENV === 'production' && isOrangeSmsMockEnvEnabled()) {
    throw new Error(
      'Refusing to start: ORANGE_SMS_MOCK_MODE (or ORANGE_SMS_MOCK) cannot be true when NODE_ENV=production',
    );
  }
}

export function resetOrangeSmsTokenCacheForTests() {
  tokenCache = null;
}

export function isOrangeSmsEnabled(): boolean {
  return (env('ORANGE_SMS_ENABLED') || '').toLowerCase() === 'true';
}

/** Dev-only mock. Always false when NODE_ENV=production (boot must already refuse mock). */
export function isOrangeSmsMockMode(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return isOrangeSmsMockEnvEnabled();
}

function looksLikePhoneSender(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.startsWith('tel:') ||
    trimmed.startsWith('+') ||
    /^\d{6,}$/.test(trimmed.replace(/\D/g, ''))
  );
}

export function getOrangeSmsConfig() {
  const clientId = env('ORANGE_SMS_CLIENT_ID') || env('ORANGE_CLIENT_ID');
  const clientSecret = env('ORANGE_SMS_CLIENT_SECRET') || env('ORANGE_CLIENT_SECRET');
  const countryCode = (env('ORANGE_SMS_COUNTRY_CODE') || '231').replace(/\D/g, '') || '231';
  const senderAddressRaw = env('ORANGE_SMS_SENDER_ADDRESS') || env('ORANGE_SMS_SENDER');
  const explicitCountrySender = env('ORANGE_SMS_COUNTRY_SENDER');

  let countrySender = explicitCountrySender || DEFAULT_LIBERIA_COUNTRY_SENDER;
  if (!explicitCountrySender && senderAddressRaw && looksLikePhoneSender(senderAddressRaw)) {
    countrySender = toOrangeTelAddress(senderAddressRaw);
  } else if (!explicitCountrySender && !senderAddressRaw) {
    countrySender = `tel:+${countryCode}0000`;
  }

  const senderName =
    env('ORANGE_SMS_SENDER_NAME')?.slice(0, 11) ||
    (senderAddressRaw && !looksLikePhoneSender(senderAddressRaw) && !isPlaceholderSecret(senderAddressRaw)
      ? senderAddressRaw.slice(0, 11)
      : undefined);

  return {
    clientId,
    clientSecret,
    countryCode,
    countrySender: normalizeTelAddress(countrySender),
    senderName,
    tokenUrl: env('ORANGE_SMS_TOKEN_URL') || DEFAULT_TOKEN_URL,
    apiBase: (
      env('ORANGE_SMS_BASE_URL') ||
      env('ORANGE_SMS_API_BASE') ||
      DEFAULT_API_BASE
    ).replace(/\/$/, ''),
  };
}

export function isOrangeSmsConfigured(): boolean {
  if (!isOrangeSmsEnabled()) return false;
  if (isOrangeSmsMockMode()) return true;
  const { clientId, clientSecret, countrySender } = getOrangeSmsConfig();
  return Boolean(
    clientId &&
      clientSecret &&
      countrySender &&
      !isPlaceholderSecret(clientId) &&
      !isPlaceholderSecret(clientSecret),
  );
}

/** Convert +231… / 231… to OneAPI tel:+231… form. */
export function toOrangeTelAddress(phoneOrTel: string): string {
  const trimmed = phoneOrTel.trim();
  if (trimmed.startsWith('tel:')) return normalizeTelAddress(trimmed);
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) throw new Error('Invalid phone for Orange SMS');
  return `tel:+${digits.replace(/^00/, '')}`;
}

function normalizeTelAddress(value: string): string {
  const raw = value.trim();
  if (raw.startsWith('tel:+')) return `tel:+${raw.slice(5).replace(/\D/g, '')}`;
  if (raw.startsWith('tel:')) {
    const rest = raw.slice(4).replace(/\D/g, '');
    return `tel:+${rest.replace(/^00/, '')}`;
  }
  return toOrangeTelAddress(raw);
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')}`;
}

async function fetchAccessToken(forceRefresh = false): Promise<string> {
  const now = Date.now();
  if (!forceRefresh && tokenCache && tokenCache.expiresAtMs > now + TOKEN_REFRESH_SKEW_MS) {
    return tokenCache.accessToken;
  }

  const { clientId, clientSecret, tokenUrl } = getOrangeSmsConfig();
  if (!clientId || !clientSecret) {
    throw new Error('Orange SMS credentials are not configured');
  }

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(clientId, clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: 'grant_type=client_credentials',
  });

  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: string | number;
    message?: string;
    description?: string;
  };

  if (!res.ok || !data.access_token) {
    console.error('[JUSTGO Orange SMS] token request failed', {
      httpStatus: res.status,
      codeMessage: data.message || null,
    });
    throw new Error('Orange SMS authentication failed');
  }

  const expiresInSec = Number(data.expires_in || 3600);
  tokenCache = {
    accessToken: data.access_token,
    expiresAtMs: now + Math.max(60, expiresInSec) * 1000,
  };
  return data.access_token;
}

function extractProviderReference(payload: unknown, locationHeader: string | null): string | undefined {
  const body = payload as {
    outboundSMSMessageRequest?: { resourceURL?: string };
  };
  const resourceUrl = body.outboundSMSMessageRequest?.resourceURL || locationHeader || undefined;
  if (!resourceUrl) return undefined;
  const parts = resourceUrl.split('/');
  return parts[parts.length - 1] || resourceUrl.slice(0, 64);
}

/**
 * Send an SMS via Orange Liberia v2 (or mock in non-production).
 * Never logs the SMS body. Reuses cached OAuth token until near expiry.
 */
export async function sendOrangeSms(
  phone: string,
  body: string,
  purpose: SmsPurpose = 'GENERIC',
): Promise<SmsSendResult> {
  if (process.env.NODE_ENV === 'production' && isOrangeSmsMockEnvEnabled()) {
    console.error('[JUSTGO Orange SMS] mock mode blocked in production');
    return {
      ok: false,
      status: 'MOCK_BLOCKED_IN_PRODUCTION',
      provider: 'ORANGE_SMS',
      logMessage: 'Mock SMS blocked in production',
      purpose,
    };
  }

  if (!isOrangeSmsEnabled()) {
    return {
      ok: false,
      status: 'DISABLED',
      provider: 'ORANGE_SMS',
      logMessage: 'Orange SMS disabled',
      purpose,
    };
  }

  if (isOrangeSmsMockMode()) {
    console.info('[JUSTGO Orange SMS] mock send', {
      purpose,
      phoneLast4: phone.replace(/\D/g, '').slice(-4),
      bodyLength: body.length,
    });
    return {
      ok: true,
      status: 'MOCK_SENT',
      provider: 'ORANGE_SMS',
      logMessage: `Mock SMS accepted (${purpose})`,
      providerReference: `mock-${Date.now()}`,
      purpose,
    };
  }

  if (!isOrangeSmsConfigured()) {
    return {
      ok: false,
      status: 'NOT_CONFIGURED',
      provider: 'ORANGE_SMS',
      logMessage: 'Orange SMS not configured',
      purpose,
    };
  }

  const { countrySender, senderName, apiBase } = getOrangeSmsConfig();
  const address = toOrangeTelAddress(phone);
  const senderAddress = countrySender;
  const urlSender = encodeURIComponent(senderAddress);
  const endpoint = `${apiBase}/outbound/${urlSender}/requests`;

  const outboundSMSMessageRequest: Record<string, unknown> = {
    address,
    senderAddress,
    outboundSMSTextMessage: { message: body },
  };
  if (senderName) outboundSMSMessageRequest.senderName = senderName;

  try {
    let accessToken = await fetchAccessToken(false);
    let res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ outboundSMSMessageRequest }),
    });

    if (res.status === 401) {
      accessToken = await fetchAccessToken(true);
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ outboundSMSMessageRequest }),
      });
    }

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errBody = payload as { message?: string; code?: number | string; description?: string };
      console.error('[JUSTGO Orange SMS] send failed', {
        purpose,
        httpStatus: res.status,
        providerCode: errBody.code ?? null,
        providerMessage: errBody.message ?? null,
        phoneLast4: phone.replace(/\D/g, '').slice(-4),
      });
      return {
        ok: false,
        status: 'FAILED',
        provider: 'ORANGE_SMS',
        logMessage: `Provider send failed HTTP ${res.status}`,
        httpStatus: res.status,
        purpose,
      };
    }

    const providerReference = extractProviderReference(payload, res.headers.get('location'));
    console.info('[JUSTGO Orange SMS] send accepted', {
      purpose,
      httpStatus: res.status,
      providerReference: providerReference ?? null,
      phoneLast4: phone.replace(/\D/g, '').slice(-4),
    });

    return {
      ok: true,
      status: 'SENT',
      provider: 'ORANGE_SMS',
      logMessage: `SMS accepted by provider (${purpose})`,
      providerReference,
      httpStatus: res.status,
      purpose,
    };
  } catch (err) {
    console.error('[JUSTGO Orange SMS] send error', {
      purpose,
      phoneLast4: phone.replace(/\D/g, '').slice(-4),
      errorName: err instanceof Error ? err.name : 'Error',
    });
    return {
      ok: false,
      status: 'FAILED',
      provider: 'ORANGE_SMS',
      logMessage: 'Provider send threw an error',
      purpose,
    };
  }
}

/** @deprecated Prefer sendOrangeSms(..., purpose) */
export async function isOrangeSmsReady(): Promise<boolean> {
  return isOrangeSmsConfigured();
}
