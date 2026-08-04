'use client';

import { useEffect, useState } from 'react';
import { Circle, Power } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import SignInForm from '../components/SignInForm';
import ProgressTracker from '../components/ProgressTracker';
import { api } from '../lib/api';

type Tab =
  | 'Dashboard'
  | 'Availability'
  | 'Current Requests'
  | 'Earnings'
  | 'Reviews'
  | 'Profile'
  | 'Support';

interface DriverRequest {
  requestNumber: string;
  requestType: string;
  customerDisplayName: string;
  pickup: string;
  destination: string;
  distance: string | null;
  estimatedDuration: string | null;
  estimatedDriverEarningsCents: number;
  paymentStatus: string;
  customerInstructions: string | null;
  currentStatus: string | null;
  assignmentId?: string;
  active?: boolean;
  id?: string;
}

const MENU: Tab[] = [
  'Dashboard',
  'Availability',
  'Current Requests',
  'Earnings',
  'Reviews',
  'Profile',
  'Support',
];

const CATEGORIES = [
  'Transportation',
  'Ride',
  'Food Delivery',
  'Store Delivery',
  'Package Delivery',
  'Grocery Delivery',
  'Pharmacy Delivery',
  'Courier Service',
];

export default function DriverPage() {
  const { user, loading } = useAuth();
  const [tab, setTab] = useState<Tab>('Dashboard');
  const [availability, setAvailability] = useState<'ONLINE' | 'OFF'>('OFF');
  const [message, setMessage] = useState('');
  const [warning, setWarning] = useState('');
  const [requests, setRequests] = useState<DriverRequest[]>([]);
  const [offers, setOffers] = useState<DriverRequest[]>([]);
  const [earnings, setEarnings] = useState<Record<string, number | string> | null>(null);
  const [error, setError] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);

  async function load() {
    if (!user || user.role !== 'DRIVER') return;
    try {
      const [dash, reqs, earn] = await Promise.all([
        api<{ availability: 'ONLINE' | 'OFF' }>('/api/driver/dashboard'),
        api<{ requests: DriverRequest[]; offers: DriverRequest[] }>('/api/driver/requests'),
        api<Record<string, number | string>>('/api/driver/earnings'),
      ]);
      setAvailability(dash.availability);
      setRequests(reqs.requests);
      setOffers(reqs.offers);
      setEarnings(earn);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, [user]);

  async function setStatus(status: 'ONLINE' | 'OFF') {
    const res = await api<{ status: 'ONLINE' | 'OFF'; message: string; warning?: string }>(
      '/api/driver/availability',
      { method: 'POST', json: { status } },
    );
    setAvailability(res.status);
    setMessage(res.message);
    setWarning(res.warning || '');
    await load();
  }

  async function advance(reqItem: DriverRequest) {
    if (!reqItem.id) return;
    const order = ['ARRIVED', 'PICKUP', 'IN_TRANSIT', 'DELIVERED'] as const;
    const idx = reqItem.currentStatus
      ? order.indexOf(reqItem.currentStatus as (typeof order)[number])
      : -1;
    const next = order[Math.min(idx + 1, order.length - 1)];
    if (reqItem.currentStatus === 'DELIVERED') return;
    const kind = reqItem.requestType === 'RIDE' ? 'ride' : 'delivery';
    await api(`/api/driver/requests/${kind}/${reqItem.id}/stage`, {
      method: 'POST',
      json: { stage: next },
    });
    await load();
  }

  if (loading) return <p className="state">Loading…</p>;
  if (!user || user.role !== 'DRIVER') {
    return (
      <SignInForm
        expectedRole="DRIVER"
        title="Driver sign-in"
        subtitle="Access your driver dashboard, availability, and current requests."
      />
    );
  }

  return (
    <section>
      <div className="provider-head">
        <div>
          <h1>Driver dashboard</h1>
          <p className="page-sub">Availability, current requests, earnings, and support.</p>
        </div>
        <div
          className={availability === 'ONLINE' ? 'status-badge online' : 'status-badge offline'}
          role="status"
          aria-label={availability === 'ONLINE' ? 'Driver online' : 'Driver offline'}
        >
          <Circle size={12} fill="currentColor" aria-hidden="true" />
          <span>{availability === 'ONLINE' ? 'ONLINE' : 'OFF'}</span>
        </div>
      </div>

      <nav className="role-menu" aria-label="Driver menu">
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

      {error ? <p className="form-error">{error}</p> : null}

      {tab === 'Dashboard' && (
        <div className="stack">
          <p>
            Status: <strong>{availability}</strong>
          </p>
          <p className="muted">Active and assigned requests remain available even when OFF.</p>
        </div>
      )}

      {tab === 'Availability' && (
        <div className="availability-panel">
          <h2>Availability</h2>
          <div className="avail-buttons">
            <button
              type="button"
              className={`online-btn ${availability === 'ONLINE' ? 'selected' : ''}`}
              onClick={() => void setStatus('ONLINE')}
              aria-pressed={availability === 'ONLINE'}
            >
              <Power size={16} aria-hidden="true" /> ONLINE
            </button>
            <button
              type="button"
              className={`offline-btn ${availability === 'OFF' ? 'selected' : ''}`}
              onClick={() => void setStatus('OFF')}
              aria-pressed={availability === 'OFF'}
            >
              <Power size={16} aria-hidden="true" /> OFF
            </button>
          </div>
          {message ? <p className="state success" role="status">{message}</p> : null}
          {warning ? <p className="form-error" role="alert">{warning}</p> : null}
          {availability === 'OFF' ? (
            <p className="state">You are offline. New requests are paused.</p>
          ) : (
            <p className="state success">You are available for new assignments.</p>
          )}
        </div>
      )}

      {tab === 'Current Requests' && (
        <div>
          <div className="chip-row" aria-label="Request categories">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                className={category === c ? 'chip active' : 'chip'}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
          <h2>Assigned</h2>
          <div className="stack">
            {requests.length === 0 ? <p className="state">No assigned requests.</p> : null}
            {requests
              .filter((r) =>
                r.requestType.replace(/_/g, ' ').toLowerCase().includes(
                  category.toLowerCase().split(' ')[0].toLowerCase(),
                ) || category === 'Ride' && r.requestType === 'RIDE',
              )
              .map((r) => (
                <article className="job-card" key={r.requestNumber}>
                  <div>
                    <small>
                      {r.requestNumber} · {r.requestType}
                    </small>
                    <strong>
                      {r.customerDisplayName}: {r.pickup} → {r.destination}
                    </strong>
                    <span>
                      {r.distance} · {r.estimatedDuration}
                    </span>
                    <span>Pay status: {r.paymentStatus}</span>
                    <span>
                      Est. earnings: L${(r.estimatedDriverEarningsCents / 100).toFixed(2)}
                    </span>
                    {r.customerInstructions ? <span>Note: {r.customerInstructions}</span> : null}
                    <ProgressTracker current={r.currentStatus} />
                  </div>
                  <div>
                    <strong>{r.currentStatus || 'Ready'}</strong>
                    <button type="button" onClick={() => void advance(r)}>
                      Advance stage
                    </button>
                  </div>
                </article>
              ))}
          </div>
          <h2>New offers {availability === 'OFF' ? '(paused while OFF)' : ''}</h2>
          <div className="stack">
            {availability === 'OFF' ? (
              <p className="state">You are offline. New requests are paused.</p>
            ) : offers.length === 0 ? (
              <p className="state">No new offers right now.</p>
            ) : (
              offers.map((o) => (
                <article className="job-card" key={o.requestNumber}>
                  <div>
                    <small>
                      {o.requestNumber} · {o.requestType}
                    </small>
                    <strong>
                      {o.customerDisplayName}: {o.pickup} → {o.destination}
                    </strong>
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
      )}

      {tab === 'Earnings' && earnings && (
        <div className="price-breakdown">
          <div>
            <span>Tips (driver only)</span>
            <strong>L${(Number(earnings.tipTotalCents) / 100).toFixed(2)}</strong>
          </div>
          <div>
            <span>Driver platform fees</span>
            <strong>L${(Number(earnings.driverPlatformFeesCents) / 100).toFixed(2)}</strong>
          </div>
          <p className="muted">{String(earnings.note)}</p>
        </div>
      )}

      {tab === 'Reviews' && <p className="state">Customer reviews of your completed trips appear here.</p>}
      {tab === 'Profile' && (
        <p className="state">
          {user.firstName} {user.lastName} · {user.phone}
        </p>
      )}
      {tab === 'Support' && (
        <p className="state">
          For emergencies, contact local emergency services. JUSTGO support does not replace responders.
        </p>
      )}
    </section>
  );
}
