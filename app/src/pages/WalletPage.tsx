'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import SignInForm from '../components/SignInForm';
import { api } from '../lib/api';

function ld(cents: number) {
  return `L$${(cents / 100).toFixed(2)}`;
}

type WalletPayload = {
  wallet: {
    publicReference: string;
    availableCents: number;
    pendingCents: number;
    heldCents: number;
    currency: string;
    status: string;
  };
  role: string;
  rolePurpose: { canWithdraw: boolean; purposes: string[] };
  payoutBlocked: boolean;
  transactions: Array<{ id: string; type: string; amountCents: number; status: string; description: string }>;
  paymentMethods: Array<{ id: string; method: string; displayHint: string }>;
  paymentAttempts: Array<{ id: string; status: string; amountCents: number; method: string }>;
  refunds: Array<{ id: string; amountCents: number; status: string; reason: string }>;
  payoutDestinations: Array<{ id: string; type: string; displayHint: string; verificationStatus: string }>;
  withdrawals: Array<{ id: string; status: string; amountCents: number; feeCents: number }>;
  rechargeMethods: Array<{ id: string; label: string; status: string }>;
  withdrawalLimits: { minCents: number; maxCents: number; feeCents: number };
  mockProviderEnabled: boolean;
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
  const [useMock, setUseMock] = useState(false);
  const [wdAmount, setWdAmount] = useState('20');
  const [wdDest, setWdDest] = useState('');

  async function load() {
    if (!user) return;
    setError('');
    try {
      const res = await api<WalletPayload>('/api/wallet');
      setData(res);
      if (!wdDest && res.payoutDestinations[0]) setWdDest(res.payoutDestinations[0].id);
    } catch (err) {
      setData(null);
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, [user]);

  if (loading) return <p className="state">Loading…</p>;
  if (!user) {
    return (
      <SignInForm
        title="Wallet sign-in"
        subtitle="Sign in with your Customer, Driver, Merchant, or Administrator account to open your JUSTGO wallet."
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
      const res = await api<{ message: string }>('/api/wallet', {
        method: 'POST',
        json: {
          amountLd,
          method,
          momoPhone: method === 'CARD' ? undefined : momoPhone,
          useMockProvider: useMock,
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

  async function onWithdraw(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const res = await api<{ message: string }>('/api/wallet/withdrawals', {
        method: 'POST',
        json: {
          amountLd: wdAmount,
          payoutDestinationId: wdDest,
          stepUpConfirmed: user?.role === 'ADMIN' ? true : undefined,
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
      <h1>{data.role} Wallet</h1>
      <p className="page-sub">
        Reference {data.wallet.publicReference} · {data.wallet.currency} · {data.wallet.status}
      </p>
      <ul className="muted">
        {data.rolePurpose.purposes.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>

      <div className="wallet-card">
        <small>AVAILABLE</small>
        <strong>{ld(data.wallet.availableCents)}</strong>
        <span>
          Pending {ld(data.wallet.pendingCents)} · Held {ld(data.wallet.heldCents)}
        </span>
      </div>

      <h2>Recharge wallet</h2>
      <form className="form-grid" onSubmit={onRecharge}>
        <label className="field">
          <span>Amount (LRD)</span>
          <input value={amountLd} onChange={(e) => setAmountLd(e.target.value)} required />
        </label>
        <label className="field">
          <span>Method</span>
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
            <span>Mobile-money phone</span>
            <input value={momoPhone} onChange={(e) => setMomoPhone(e.target.value)} required />
          </label>
        ) : null}
        {data.mockProviderEnabled ? (
          <label className="checkbox">
            <input type="checkbox" checked={useMock} onChange={(e) => setUseMock(e.target.checked)} />
            <span>Use DEV mock provider (not a real payment)</span>
          </label>
        ) : null}
        <button className="primary-btn" type="submit" disabled={busy}>
          Recharge Wallet
        </button>
      </form>

      {data.rolePurpose.canWithdraw ? (
        <>
          <h2>Withdraw</h2>
          {data.payoutBlocked ? (
            <p className="form-error">Payouts blocked until your account is approved by an Administrator.</p>
          ) : (
            <form className="form-grid" onSubmit={onWithdraw}>
              <p className="muted">
                Fee {ld(data.withdrawalLimits.feeCents)} · Min {ld(data.withdrawalLimits.minCents)} · Max{' '}
                {ld(data.withdrawalLimits.maxCents)}. Cash is not supported.
              </p>
              <label className="field">
                <span>Amount (LRD)</span>
                <input value={wdAmount} onChange={(e) => setWdAmount(e.target.value)} required />
              </label>
              <label className="field">
                <span>Payout destination</span>
                <select value={wdDest} onChange={(e) => setWdDest(e.target.value)} required>
                  <option value="">Select verified destination</option>
                  {data.payoutDestinations
                    .filter((d) => d.verificationStatus === 'VERIFIED')
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.type} · {d.displayHint}
                      </option>
                    ))}
                </select>
              </label>
              <button className="primary-btn" type="submit" disabled={busy || !wdDest}>
                Request withdrawal
              </button>
            </form>
          )}
          <h3>Payout destinations (masked)</h3>
          {data.payoutDestinations.length === 0 ? (
            <p className="state">None yet. Add via API /api/wallet/payout-destinations after recent auth + OTP.</p>
          ) : (
            data.payoutDestinations.map((d) => (
              <div className="transaction" key={d.id}>
                {d.type} · {d.displayHint} · {d.verificationStatus}
              </div>
            ))
          )}
          <h3>Withdrawal requests</h3>
          {data.withdrawals.length === 0 ? (
            <p className="state">No withdrawals.</p>
          ) : (
            data.withdrawals.map((w) => (
              <div className="transaction" key={w.id}>
                {w.status} · {ld(w.amountCents)} + fee {ld(w.feeCents)}
              </div>
            ))
          )}
        </>
      ) : null}

      {message ? <p className="muted" role="status">{message}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}

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

      <h2>Payment attempts</h2>
      {data.paymentAttempts.map((a) => (
        <div className="transaction" key={a.id}>
          {a.method} · {a.status} · {ld(a.amountCents)}
        </div>
      ))}

      <p className="muted">{data.securityNotice}</p>
    </section>
  );
}
