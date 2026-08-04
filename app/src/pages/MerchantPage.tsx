'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import SignInForm from '../components/SignInForm';
import ProgressTracker from '../components/ProgressTracker';
import ConfirmDialog from '../components/ConfirmDialog';
import { api } from '../lib/api';

type Tab =
  | 'Dashboard'
  | 'Current Requests'
  | 'Store'
  | 'Products or Menu'
  | 'Preparation Times'
  | 'Earnings'
  | 'Reviews'
  | 'Profile'
  | 'Support';

const MENU: Tab[] = [
  'Dashboard',
  'Current Requests',
  'Store',
  'Products or Menu',
  'Preparation Times',
  'Earnings',
  'Reviews',
  'Profile',
  'Support',
];

export default function MerchantPage() {
  const { user, loading } = useAuth();
  const [tab, setTab] = useState<Tab>('Dashboard');
  const [requests, setRequests] = useState<Array<Record<string, unknown>>>([]);
  const [storeName, setStoreName] = useState('');
  const [storeAddress, setStoreAddress] = useState('');
  const [prepMins, setPrepMins] = useState(20);
  const [productName, setProductName] = useState('');
  const [priceCents, setPriceCents] = useState(1000);
  const [earnings, setEarnings] = useState<Record<string, number> | null>(null);
  const [message, setMessage] = useState('');
  const [confirm, setConfirm] = useState<{ title: string; message: string; action: () => Promise<void> } | null>(null);

  async function load() {
    if (!user || user.role !== 'MERCHANT') return;
    const [dash, reqs, earn] = await Promise.all([
      api<{ store?: { name: string; address?: string | null; preparationMins: number } }>('/api/merchant/dashboard'),
      api<{ requests: Array<Record<string, unknown>> }>('/api/merchant/requests'),
      api<{ settlement: Record<string, number> }>('/api/merchant/earnings'),
    ]);
    if (dash.store) {
      setStoreName(dash.store.name);
      setStoreAddress(dash.store.address || '');
      setPrepMins(dash.store.preparationMins);
    }
    setRequests(reqs.requests);
    setEarnings(earn.settlement);
  }

  useEffect(() => {
    void load();
  }, [user]);

  if (loading) return <p className="state">Loading…</p>;
  if (!user || user.role !== 'MERCHANT') {
    return (
      <SignInForm
        expectedRole="MERCHANT"
        title="Merchant sign-in"
        subtitle="Manage store orders, products, preparation times, and earnings."
      />
    );
  }

  async function saveStore(e: FormEvent) {
    e.preventDefault();
    await api('/api/merchant/store', {
      method: 'PUT',
      json: { name: storeName, address: storeAddress, preparationMins: prepMins },
    });
    setMessage('Store saved.');
    await load();
  }

  async function addProduct(e: FormEvent) {
    e.preventDefault();
    const body = new FormData();
    body.append('name', productName);
    body.append('priceCents', String(priceCents));
    await fetch('/api/merchant/products', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'X-CSRF-Token': (
          await (await fetch('/api/csrf', { credentials: 'include' })).json()
        ).csrfToken,
      },
      body,
    });
    setProductName('');
    setMessage('Product added.');
    await load();
  }

  return (
    <section>
      <h1>Merchant dashboard</h1>
      <p className="page-sub">Store operations, current requests, and settlement.</p>

      <nav className="role-menu" aria-label="Merchant menu">
        {MENU.map((item) => (
          <button
            key={item}
            type="button"
            className={tab === item ? 'menu-item active' : 'menu-item'}
            onClick={() => setTab(item)}
          >
            {item}
          </button>
        ))}
      </nav>

      {message ? <p className="state success">{message}</p> : null}

      {tab === 'Dashboard' && <p className="state">Welcome, {user.firstName}. Use Current Requests for store orders.</p>}

      {tab === 'Current Requests' && (
        <div>
          <div className="chip-row">
            <button type="button" className="chip active">
              Store
            </button>
          </div>
          <div className="stack">
            {requests.length === 0 ? <p className="state">No store requests yet.</p> : null}
            {requests.map((r) => (
              <article className="panel-card" key={String(r.orderId)}>
                <small>{String(r.requestNumber)}</small>
                <strong>{String(r.customerDisplayName)}</strong>
                <ul>
                  {(r.products as Array<{ name: string; quantity: number }>).map((p) => (
                    <li key={p.name}>
                      {p.name} × {p.quantity}
                    </li>
                  ))}
                </ul>
                <p>Total: L${(Number(r.totalCents) / 100).toFixed(2)} · {String(r.paymentStatus)}</p>
                <p>Prep estimate: {String(r.preparationEstimate)} min · Driver: {String(r.driverAssignmentStatus)}</p>
                <p>Merchant prep: {String(r.merchantPrepStatus)}</p>
                <ProgressTracker current={r.fulfillmentStage as string | null} />
                <div className="button-row">
                  <button
                    type="button"
                    className="primary-btn compact"
                    onClick={() =>
                      void api(`/api/merchant/orders/${r.orderId}/prep`, {
                        method: 'POST',
                        json: { status: 'ACCEPTED' },
                      }).then(load)
                    }
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="secondary-btn compact"
                    onClick={() =>
                      void api(`/api/merchant/orders/${r.orderId}/prep`, {
                        method: 'POST',
                        json: { status: 'PREPARING' },
                      }).then(load)
                    }
                  >
                    Preparing
                  </button>
                  <button
                    type="button"
                    className="secondary-btn compact"
                    onClick={() =>
                      void api(`/api/merchant/orders/${r.orderId}/prep`, {
                        method: 'POST',
                        json: { status: 'READY_FOR_PICKUP' },
                      }).then(load)
                    }
                  >
                    Ready for Pickup
                  </button>
                  <button
                    type="button"
                    className="danger-btn compact"
                    onClick={() =>
                      setConfirm({
                        title: 'Reject order',
                        message: `Reject ${String(r.requestNumber)}?`,
                        action: async () => {
                          await api(`/api/merchant/orders/${r.orderId}/reject`, {
                            method: 'POST',
                            json: { confirm: true },
                          });
                          await load();
                        },
                      })
                    }
                  >
                    Reject
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {tab === 'Store' && (
        <form className="form-grid" onSubmit={saveStore}>
          <label className="field">
            <span>Store name</span>
            <input value={storeName} onChange={(e) => setStoreName(e.target.value)} required />
          </label>
          <label className="field">
            <span>Address</span>
            <input value={storeAddress} onChange={(e) => setStoreAddress(e.target.value)} />
          </label>
          <button className="primary-btn" type="submit">
            Save store
          </button>
        </form>
      )}

      {tab === 'Products or Menu' && (
        <form className="form-grid" onSubmit={addProduct}>
          <label className="field">
            <span>Product name</span>
            <input value={productName} onChange={(e) => setProductName(e.target.value)} required />
          </label>
          <label className="field">
            <span>Price (cents)</span>
            <input
              type="number"
              value={priceCents}
              onChange={(e) => setPriceCents(Number(e.target.value))}
              min={1}
              required
            />
          </label>
          <button className="primary-btn" type="submit">
            Add product
          </button>
        </form>
      )}

      {tab === 'Preparation Times' && (
        <form className="form-grid" onSubmit={saveStore}>
          <label className="field">
            <span>Default preparation minutes</span>
            <input
              type="number"
              value={prepMins}
              min={1}
              max={240}
              onChange={(e) => setPrepMins(Number(e.target.value))}
            />
          </label>
          <button className="primary-btn" type="submit">
            Save preparation time
          </button>
        </form>
      )}

      {tab === 'Earnings' && earnings && (
        <div className="price-breakdown">
          <div><span>Product subtotal</span><strong>L${(earnings.productSubtotalCents / 100).toFixed(2)}</strong></div>
          <div><span>Taxes</span><strong>L${(earnings.taxCents / 100).toFixed(2)}</strong></div>
          <div><span>Merchant fees</span><strong>L${(earnings.merchantFeeCents / 100).toFixed(2)}</strong></div>
          <div><span>Refunds</span><strong>L${(earnings.refundCents / 100).toFixed(2)}</strong></div>
          <div className="total"><span>Net merchant settlement</span><strong>L${(earnings.netMerchantSettlementCents / 100).toFixed(2)}</strong></div>
        </div>
      )}

      {tab === 'Reviews' && <p className="state">Store reviews appear after delivered orders.</p>}
      {tab === 'Profile' && <p className="state">{user.firstName} · {user.phone}</p>}
      {tab === 'Support' && (
        <p className="state">
          Report problems from order details. For emergencies, contact local emergency services first.
        </p>
      )}

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title || ''}
        message={confirm?.message || ''}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const action = confirm?.action;
          setConfirm(null);
          if (action) void action();
        }}
      />
    </section>
  );
}
