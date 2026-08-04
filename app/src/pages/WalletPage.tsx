'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import SignInForm from '../components/SignInForm';
import { api } from '../lib/api';

function ld(cents: number) {
  return `L$${(cents / 100).toFixed(2)}`;
}

type WalletPayload = {
  wallet: { availableCents: number; pendingCents: number; currency: string };
  transactions: Array<{
    id: string;
    type: string;
    amountCents: number;
    status: string;
    description: string;
    createdAt: string;
  }>;
  paymentMethods: Array<{ id: string; method: string; displayHint: string }>;
  paymentAttempts: Array<{ id: string; status: string; amountCents: number; method: string; failureReason?: string | null }>;
  refunds: Array<{ id: string; amountCents: number; status: string; reason: string }>;
  rechargeMethods: Array<{ id: string; label: string; status: string }>;
  securityNotice: string;
};

export default function WalletPage() {
  const { user, loading } = useAuth();
  const [data, setData] = useState<WalletPayload | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [amountLd, setAmountLd] = useState('50');
  const [method, setMethod] = useState<'MTN_MOMO' | 'ORANGE_MONEY' | 'CARD'>('MTN_MOMO');
  const [momoPhone, setMomoPhone] = useState('');

  async function load() {
    if (!user || (user.role !== 'CUSTOMER' && user.role !== 'ADMIN')) return;
    setError('');
    try {
      const res = await api<WalletPayload>('/api/wallet');
      setData(res);
    } catch (err) {
      setData(null);
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, [user]);

  if (loading) return <p className="state">Loading…</p>;

  if (!user || (user.role !== 'CUSTOMER' && user.role !== 'ADMIN')) {
    return (
      <SignInForm
        expectedRole="CUSTOMER"
        title="Wallet sign-in"
        subtitle="Customer wallet access requires an authenticated Customer account. Administrators may review wallets from the Admin Control Center."
      />
    );
  }

  if (error && !data) return <p className="form-error" role="alert">{error}</p>;
  if (!data) return <p className="state">Loading wallet…</p>;

  async function onRecharge(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const res = await api<{ message: string; status: string }>('/api/wallet', {
        method: 'POST',
        json: {
          amountLd,
          method,
          momoPhone: method === 'CARD' ? undefined : momoPhone,
        },
      });
      setMessage(res.message);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h1>Your Wallet</h1>
      <p className="page-sub">Balances are calculated server-side from the immutable ledger. Cash is not supported.</p>

      <div className="wallet-card">
        <small>AVAILABLE · {data.wallet.currency}</small>
        <strong>{ld(data.wallet.availableCents)}</strong>
        <span>Pending {ld(data.wallet.pendingCents)}</span>
      </div>

      <h2>Recharge wallet</h2>
      <form className="form-grid" onSubmit={onRecharge} aria-label="Recharge wallet">
        <label className="field">
          <span>Recharge amount (LRD)</span>
          <input value={amountLd} onChange={(e) => setAmountLd(e.target.value)} required />
        </label>
        <label className="field">
          <span>Payment method</span>
          <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            {data.rechargeMethods.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} — {m.status}
              </option>
            ))}
          </select>
        </label>
        {method !== 'CARD' ? (
          <label className="field">
            <span>Mobile-money telephone number</span>
            <input value={momoPhone} onChange={(e) => setMomoPhone(e.target.value)} placeholder="+231..." required />
          </label>
        ) : null}
        <p className="muted">
          Confirmation state: recharges stay <strong>PENDING</strong> until a verified payment-provider callback
          succeeds. Browser buttons cannot increase your balance.
        </p>
        <button className="primary-btn" type="submit" disabled={busy}>
          {busy ? 'Submitting…' : 'Recharge Wallet'}
        </button>
      </form>

      {message ? <p className="muted" role="status">{message}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}

      <h2>Payment methods</h2>
      {data.paymentMethods.length === 0 ? (
        <p className="state">No saved payment-method references yet.</p>
      ) : (
        data.paymentMethods.map((m) => (
          <div className="transaction" key={m.id}>
            {m.method} · {m.displayHint}
          </div>
        ))
      )}

      <h2>Withdraw / refund status</h2>
      {data.refunds.length === 0 ? (
        <p className="state">No refunds on file.</p>
      ) : (
        data.refunds.map((r) => (
          <div className="transaction" key={r.id}>
            {r.status} · {ld(r.amountCents)} · {r.reason}
          </div>
        ))
      )}

      <h2>Pending payment attempts</h2>
      {data.paymentAttempts.length === 0 ? (
        <p className="state">No payment attempts yet.</p>
      ) : (
        data.paymentAttempts.map((a) => (
          <div className="transaction" key={a.id}>
            {a.method} · {a.status} · {ld(a.amountCents)}
            {a.failureReason ? ` · ${a.failureReason}` : ''}
          </div>
        ))
      )}

      <h2>Transaction history</h2>
      {data.transactions.length === 0 ? (
        <p className="state">No ledger entries yet.</p>
      ) : (
        data.transactions.map((t) => (
          <div className="transaction" key={t.id}>
            {t.type} · {t.status} · {ld(t.amountCents)} · {t.description}
          </div>
        ))
      )}

      <p className="muted">{data.securityNotice}</p>
    </section>
  );
}
