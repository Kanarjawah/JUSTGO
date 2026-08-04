'use client';

import { FormEvent, useState } from 'react';
import { useAuth, type Role } from '../context/AuthContext';

interface Props {
  expectedRole?: Role;
  title: string;
  subtitle?: string;
  onSuccess?: () => void;
}

export default function SignInForm({ expectedRole, title, subtitle, onSuccess }: Props) {
  const { login } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
    } catch {
      setError('Invalid credentials');
    } finally {
      setBusy(false);
    }
  }

  return (
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
  );
}
