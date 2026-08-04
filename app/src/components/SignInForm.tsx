'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, type Role } from '../context/AuthContext';
import SignUpForm from './SignUpForm';

interface Props {
  expectedRole?: Role;
  title: string;
  subtitle?: string;
  onSuccess?: () => void;
}

export default function SignInForm({ expectedRole, title, subtitle, onSuccess }: Props) {
  const { login } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const showSignUp =
    expectedRole === undefined ||
    expectedRole === 'CUSTOMER' ||
    expectedRole === 'DRIVER' ||
    expectedRole === 'MERCHANT';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const user = await login(phone, password);
      if (expectedRole && user.role !== expectedRole) {
        setError(`This area requires a ${expectedRole.toLowerCase()} account.`);
        return;
      }
      onSuccess?.();
      const path =
        user.role === 'ADMIN'
          ? '/admin'
          : user.role === 'DRIVER'
            ? '/driver'
            : user.role === 'MERCHANT'
              ? '/merchant'
              : '/customer';
      router.push(path);
    } catch (err) {
      setError((err as Error).message || 'Invalid credentials');
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'signup' && showSignUp) {
    return (
      <div>
        <div className="chip-row" role="tablist" aria-label="Authentication">
          <button type="button" className="chip" role="tab" aria-selected={false} onClick={() => setMode('signin')}>
            Sign In
          </button>
          <button type="button" className="chip active" role="tab" aria-selected={true}>
            Sign Up
          </button>
        </div>
        <SignUpForm
          defaultAccountType={
            expectedRole === 'DRIVER' ? 'DRIVER' : expectedRole === 'MERCHANT' ? 'MERCHANT' : 'CUSTOMER'
          }
          onSwitchToSignIn={() => setMode('signin')}
        />
      </div>
    );
  }

  return (
    <div>
      {showSignUp ? (
        <div className="chip-row" role="tablist" aria-label="Authentication">
          <button type="button" className="chip active" role="tab" aria-selected={true}>
            Sign In
          </button>
          <button
            type="button"
            className="chip"
            role="tab"
            aria-selected={false}
            onClick={() => setMode('signup')}
            data-testid="signup-tab"
          >
            Sign Up
          </button>
        </div>
      ) : null}
      <form className="auth-card" onSubmit={onSubmit} aria-label={title}>
        <h1>{title}</h1>
        {subtitle ? <p className="page-sub">{subtitle}</p> : null}
        <label className="field">
          <span>Phone number</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+231..."
            autoComplete="tel"
            required
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="primary-btn" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
