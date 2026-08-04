'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../lib/api';
import { useAuth, type Role } from '../context/AuthContext';
import {
  CONFIRM_PASSWORD_TOO_SHORT,
  PASSWORD_REQUIREMENTS,
  PASSWORD_TOO_SHORT,
  PASSWORDS_MISMATCH,
} from '../lib/auth-messages';

type AccountType = 'CUSTOMER' | 'DRIVER' | 'MERCHANT';

interface Props {
  defaultAccountType?: AccountType;
  onSwitchToSignIn?: () => void;
}

type FieldKey = 'fullName' | 'phone' | 'email' | 'password' | 'confirmPassword' | 'accountType' | 'acceptTerms';

function validateClient(input: {
  fullName: string;
  phone: string;
  email: string;
  password: string;
  confirmPassword: string;
  acceptTerms: boolean;
}): Partial<Record<FieldKey, string>> {
  const fields: Partial<Record<FieldKey, string>> = {};
  if (input.fullName.trim().length < 2) fields.fullName = 'Enter your full name.';
  if (input.phone.trim().length < 7) fields.phone = 'Enter a valid Liberian phone number.';
  if (input.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
    fields.email = 'Enter a valid email address.';
  }
  if (input.password.length < 10) fields.password = PASSWORD_TOO_SHORT;
  if (input.confirmPassword.length < 10) fields.confirmPassword = CONFIRM_PASSWORD_TOO_SHORT;
  if (
    input.password.length >= 10 &&
    input.confirmPassword.length >= 10 &&
    input.password !== input.confirmPassword
  ) {
    fields.confirmPassword = PASSWORDS_MISMATCH;
  }
  if (!input.acceptTerms) fields.acceptTerms = 'You must accept the Terms and Privacy Policy.';
  return fields;
}

export default function SignUpForm({ defaultAccountType = 'CUSTOMER', onSwitchToSignIn }: Props) {
  const router = useRouter();
  const { refresh } = useAuth();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [accountType, setAccountType] = useState<AccountType>(defaultAccountType);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'register' | 'otp'>('register');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function onRegister(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    const clientFields = validateClient({
      fullName,
      phone,
      email,
      password,
      confirmPassword,
      acceptTerms,
    });
    if (Object.keys(clientFields).length > 0) {
      setFieldErrors(clientFields);
      setError(clientFields.password || clientFields.confirmPassword || Object.values(clientFields)[0] || '');
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      const res = await api<{
        message: string;
        redirectTo: string;
        requiresPhoneVerification: boolean;
      }>('/api/auth/register', {
        method: 'POST',
        json: {
          fullName,
          phone,
          email: email || undefined,
          password,
          confirmPassword,
          accountType,
          acceptTerms: true,
        },
      });
      setMessage(res.message);
      setStep('otp');
    } catch (err) {
      const apiErr = err as Error & { fields?: Partial<Record<FieldKey, string>> };
      if (apiErr.fields) setFieldErrors(apiErr.fields);
      setError(apiErr.message);
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await api<{ redirectTo: string; user: { role: Role } }>('/api/auth/otp/verify', {
        method: 'POST',
        json: { phone, code: otp },
      });
      await refresh();
      router.push(res.redirectTo);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function resendOtp() {
    setError('');
    setBusy(true);
    try {
      await api('/api/auth/otp/request', { method: 'POST', json: { phone } });
      setMessage(
        'A new code was requested. In development, check the server terminal — the OTP is never sent to the browser.',
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (step === 'otp') {
    return (
      <form className="auth-card" onSubmit={onVerify} aria-label="Verify phone">
        <h1>Verify phone</h1>
        <p className="page-sub">
          Enter the OTP sent to your Liberian number. In development the code is printed only in the
          server terminal — never returned to the browser.
        </p>
        {message ? <p className="muted">{message}</p> : null}
        <label className="field">
          <span>Verification code</span>
          <input value={otp} onChange={(e) => setOtp(e.target.value)} required autoComplete="one-time-code" />
        </label>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <button className="primary-btn" type="submit" disabled={busy}>
          {busy ? 'Verifying…' : 'Verify and continue'}
        </button>
        <button type="button" className="ghost-btn" disabled={busy} onClick={() => void resendOtp()}>
          Resend code
        </button>
      </form>
    );
  }

  return (
    <form className="auth-card" onSubmit={onRegister} aria-label="Sign up" noValidate>
      <h1>Sign up</h1>
      <p className="page-sub">
        Create a Customer, Driver, or Merchant account. Administrator registration is not available.
      </p>
      <label className="field">
        <span>Full name</span>
        <input
          value={fullName}
          onChange={(e) => {
            setFullName(e.target.value);
            setFieldErrors((prev) => ({ ...prev, fullName: undefined }));
          }}
          required
          autoComplete="name"
          aria-invalid={Boolean(fieldErrors.fullName)}
        />
        {fieldErrors.fullName ? (
          <span className="field-error" role="alert">
            {fieldErrors.fullName}
          </span>
        ) : null}
      </label>
      <label className="field">
        <span>Liberian phone number</span>
        <input
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            setFieldErrors((prev) => ({ ...prev, phone: undefined }));
          }}
          placeholder="+231..."
          required
          autoComplete="tel"
          aria-invalid={Boolean(fieldErrors.phone)}
        />
        {fieldErrors.phone ? (
          <span className="field-error" role="alert">
            {fieldErrors.phone}
          </span>
        ) : null}
      </label>
      <label className="field">
        <span>Email address (optional)</span>
        <input
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setFieldErrors((prev) => ({ ...prev, email: undefined }));
          }}
          autoComplete="email"
          aria-invalid={Boolean(fieldErrors.email)}
        />
        {fieldErrors.email ? (
          <span className="field-error" role="alert">
            {fieldErrors.email}
          </span>
        ) : null}
      </label>
      <label className="field">
        <span>Password</span>
        <span className="password-field">
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setFieldErrors((prev) => ({ ...prev, password: undefined }));
            }}
            required
            minLength={10}
            autoComplete="new-password"
            aria-invalid={Boolean(fieldErrors.password)}
            aria-describedby="password-requirements"
          />
          <button
            type="button"
            className="password-toggle"
            onClick={() => setShowPassword((v) => !v)}
            aria-pressed={showPassword}
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </span>
        <span id="password-requirements" className="field-hint">
          {PASSWORD_REQUIREMENTS}
        </span>
        {fieldErrors.password ? (
          <span className="field-error" role="alert">
            {fieldErrors.password}
          </span>
        ) : null}
      </label>
      <label className="field">
        <span>Confirm password</span>
        <span className="password-field">
          <input
            type={showConfirmPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              setFieldErrors((prev) => ({ ...prev, confirmPassword: undefined }));
            }}
            required
            minLength={10}
            autoComplete="new-password"
            aria-invalid={Boolean(fieldErrors.confirmPassword)}
          />
          <button
            type="button"
            className="password-toggle"
            onClick={() => setShowConfirmPassword((v) => !v)}
            aria-pressed={showConfirmPassword}
          >
            {showConfirmPassword ? 'Hide' : 'Show'}
          </button>
        </span>
        {fieldErrors.confirmPassword ? (
          <span className="field-error" role="alert">
            {fieldErrors.confirmPassword}
          </span>
        ) : null}
      </label>
      <label className="field">
        <span>Account type</span>
        <select
          value={accountType}
          onChange={(e) => setAccountType(e.target.value as AccountType)}
          required
          aria-invalid={Boolean(fieldErrors.accountType)}
        >
          <option value="CUSTOMER">Customer</option>
          <option value="DRIVER">Driver</option>
          <option value="MERCHANT">Merchant</option>
        </select>
        {fieldErrors.accountType ? (
          <span className="field-error" role="alert">
            {fieldErrors.accountType}
          </span>
        ) : null}
      </label>
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={acceptTerms}
          onChange={(e) => {
            setAcceptTerms(e.target.checked);
            setFieldErrors((prev) => ({ ...prev, acceptTerms: undefined }));
          }}
          required
        />
        <span>
          I agree to the <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>
        </span>
      </label>
      {fieldErrors.acceptTerms ? (
        <p className="field-error" role="alert">
          {fieldErrors.acceptTerms}
        </p>
      ) : null}
      {error && !fieldErrors.password && !fieldErrors.confirmPassword ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="primary-btn" type="submit" disabled={busy || !acceptTerms}>
        {busy ? 'Creating account…' : 'Create account'}
      </button>
      {onSwitchToSignIn ? (
        <button type="button" className="ghost-btn" disabled={busy} onClick={onSwitchToSignIn}>
          Already have an account? Sign in
        </button>
      ) : null}
    </form>
  );
}
