'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../lib/api';
import { useAuth, type Role } from '../context/AuthContext';

type AccountType = 'CUSTOMER' | 'DRIVER' | 'MERCHANT';

interface Props {
  defaultAccountType?: AccountType;
  onSwitchToSignIn?: () => void;
}

export default function SignUpForm({ defaultAccountType = 'CUSTOMER', onSwitchToSignIn }: Props) {
  const router = useRouter();
  const { refresh } = useAuth();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [accountType, setAccountType] = useState<AccountType>(defaultAccountType);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'register' | 'otp'>('register');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function onRegister(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
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
      setError((err as Error).message);
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
      setMessage('A new code was requested. In development, check the server terminal — the OTP is never sent to the browser.');
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
        {error ? <p className="form-error" role="alert">{error}</p> : null}
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
    <form className="auth-card" onSubmit={onRegister} aria-label="Sign up">
      <h1>Sign up</h1>
      <p className="page-sub">Create a Customer, Driver, or Merchant account. Administrator registration is not available.</p>
      <label className="field">
        <span>Full name</span>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} required autoComplete="name" />
      </label>
      <label className="field">
        <span>Liberian phone number</span>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+231..." required autoComplete="tel" />
      </label>
      <label className="field">
        <span>Email address (optional)</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      </label>
      <label className="field">
        <span>Password</span>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" />
      </label>
      <label className="field">
        <span>Confirm password</span>
        <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required autoComplete="new-password" />
      </label>
      <label className="field">
        <span>Account type</span>
        <select value={accountType} onChange={(e) => setAccountType(e.target.value as AccountType)} required>
          <option value="CUSTOMER">Customer</option>
          <option value="DRIVER">Driver</option>
          <option value="MERCHANT">Merchant</option>
        </select>
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} required />
        <span>
          I agree to the <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>
        </span>
      </label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="primary-btn" type="submit" disabled={busy || !acceptTerms}>
        {busy ? 'Creating account…' : 'Create account'}
      </button>
      {onSwitchToSignIn ? (
        <button type="button" className="ghost-btn" onClick={onSwitchToSignIn}>
          Already have an account? Sign in
        </button>
      ) : null}
    </form>
  );
}
