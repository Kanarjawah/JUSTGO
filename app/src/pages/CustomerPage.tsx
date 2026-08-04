import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import SignInForm from '../components/SignInForm';
import ProgressTracker from '../components/ProgressTracker';
import PriceBreakdown from '../components/PriceBreakdown';
import { api } from '../lib/api';

const SERVICES = [
  'Ride',
  'Transportation',
  'Food Delivery',
  'Store Delivery',
  'Grocery Delivery',
  'Pharmacy Delivery',
  'Package Delivery',
  'Courier Service',
] as const;

export default function CustomerPage() {
  const { user, loading } = useAuth();
  const [services, setServices] = useState<string[]>([...SERVICES]);
  const [requests, setRequests] = useState<Array<Record<string, unknown>>>([]);
  const [selected, setSelected] = useState<string>('Ride');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // Ride form
  const [pickup, setPickup] = useState('Broad Street');
  const [destination, setDestination] = useState('');
  const [pickupDate, setPickupDate] = useState('2026-08-02');
  const [pickupTime, setPickupTime] = useState('17:00');
  const [riderCount, setRiderCount] = useState(1);
  const [customerPhone, setCustomerPhone] = useState('+231770000002');
  const [ecName, setEcName] = useState('');
  const [ecPhone, setEcPhone] = useState('');
  const [accessibility, setAccessibility] = useState('');
  const [tripNote, setTripNote] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'MTN_MOMO' | 'ORANGE_MONEY'>('MTN_MOMO');
  const [tipLd, setTipLd] = useState('0');
  const [consent, setConsent] = useState(false);

  // Delivery form
  const [delPickup, setDelPickup] = useState('');
  const [delDestination, setDelDestination] = useState('');

  const breakdown = useMemo(() => {
    const subtotal = 35000;
    const tax = Math.round(subtotal * 0.05);
    const tip = Math.round(Number(tipLd || 0) * 100);
    const fee = 100;
    return {
      subtotalCents: subtotal,
      deliveryOrRideCents: 0,
      taxCents: tax,
      customerPlatformFeeCents: fee,
      tipCents: tip,
      totalCents: subtotal + tax + fee + tip,
    };
  }, [tipLd]);

  async function load() {
    if (!user || user.role !== 'CUSTOMER') return;
    const [svc, reqs] = await Promise.all([
      api<{ services: string[] }>('/api/customer/services'),
      api<{ requests: Array<Record<string, unknown>> }>('/api/customer/requests'),
    ]);
    setServices(svc.services);
    setRequests(reqs.requests);
  }

  useEffect(() => {
    void load();
  }, [user]);

  if (loading) return <p className="state">Loading…</p>;
  if (!user || user.role !== 'CUSTOMER') {
    return (
      <SignInForm
        expectedRole="CUSTOMER"
        title="Customer sign-in"
        subtitle="Book rides and deliveries, track requests, and leave reviews after delivery."
      />
    );
  }

  async function submitRide(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    if (!consent) {
      setError('Safety consent is required.');
      return;
    }
    if (riderCount < 1 || riderCount > 6) {
      setError('Rider count must be between 1 and 6.');
      return;
    }
    try {
      const res = await api<{ requestNumber: string; priceBreakdown: typeof breakdown }>(
        '/api/customer/rides',
        {
          method: 'POST',
          json: {
            pickup,
            destination,
            pickupDate,
            pickupTime,
            riderCount,
            customerPhone,
            emergencyContactName: ecName,
            emergencyContactPhone: ecPhone,
            accessibilityNeeds: accessibility || undefined,
            tripNote: tripNote || undefined,
            estimatedFareLd: 350,
            paymentMethod,
            tipLd: Number(tipLd || 0),
            safetyConsent: true,
          },
        },
      );
      setMessage(`Ride requested: ${res.requestNumber}`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function submitDelivery(e: FormEvent) {
    e.preventDefault();
    setError('');
    const serviceType = selected.toUpperCase().replace(/ /g, '_') as
      | 'TRANSPORTATION'
      | 'FOOD_DELIVERY'
      | 'STORE_DELIVERY'
      | 'GROCERY_DELIVERY'
      | 'PHARMACY_DELIVERY'
      | 'PACKAGE_DELIVERY'
      | 'COURIER_SERVICE';
    try {
      const res = await api<{ requestNumber: string }>('/api/customer/deliveries', {
        method: 'POST',
        json: {
          serviceType,
          pickup: delPickup,
          destination: delDestination,
          subtotalLd: 200,
          deliveryChargeLd: 80,
          tipLd: 0,
          paymentMethod,
        },
      });
      setMessage(`Request created: ${res.requestNumber}`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function review(kind: 'ride' | 'delivery', requestId: string, target: 'driver' | 'merchant' | 'overall') {
    try {
      await api('/api/customer/reviews', {
        method: 'POST',
        json: { kind, requestId, rating: 5, comment: 'Great service', target },
      });
      setMessage('Review submitted.');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section>
      <h1>Customer</h1>
      <p className="page-sub">Services, current requests, and safety tools.</p>

      <h2>Services</h2>
      <div className="chip-row" aria-label="Customer services">
        {services.map((s) => (
          <button
            key={s}
            type="button"
            className={selected === s ? 'chip active' : 'chip'}
            onClick={() => setSelected(s)}
          >
            {s}
          </button>
        ))}
      </div>
      <p>
        <Link className="text-link" to="/customer/ride">
          Open Ride page
        </Link>
      </p>

      {selected === 'Ride' ? (
        <form className="form-grid" onSubmit={submitRide} aria-label="Ride request form">
          <label className="field">
            <span>Pickup</span>
            <input value={pickup} onChange={(e) => setPickup(e.target.value)} required />
          </label>
          <label className="field">
            <span>Destination</span>
            <input value={destination} onChange={(e) => setDestination(e.target.value)} required />
          </label>
          <label className="field">
            <span>Pickup date</span>
            <input type="date" value={pickupDate} onChange={(e) => setPickupDate(e.target.value)} required />
          </label>
          <label className="field">
            <span>Pickup time</span>
            <input type="time" value={pickupTime} onChange={(e) => setPickupTime(e.target.value)} required />
          </label>
          <label className="field">
            <span>Number of riders</span>
            <input
              type="number"
              min={1}
              max={6}
              value={riderCount}
              onChange={(e) => setRiderCount(Number(e.target.value))}
              required
            />
          </label>
          <label className="field">
            <span>Customer telephone number</span>
            <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} required />
          </label>
          <label className="field">
            <span>Emergency-contact name</span>
            <input value={ecName} onChange={(e) => setEcName(e.target.value)} required />
          </label>
          <label className="field">
            <span>Emergency-contact telephone number</span>
            <input value={ecPhone} onChange={(e) => setEcPhone(e.target.value)} required />
          </label>
          <p className="muted">
            Emergency-contact information is stored securely for authorized JUSTGO safety or administrative
            personnel only. It does not appear on ordinary driver request cards. Retention follows trip safety
            and legal compliance needs; deletion is available on customer request after the retention period.
          </p>
          <label className="field">
            <span>Accessibility or assistance needs (optional)</span>
            <input value={accessibility} onChange={(e) => setAccessibility(e.target.value)} />
          </label>
          <label className="field">
            <span>Trip note (optional)</span>
            <input value={tripNote} onChange={(e) => setTripNote(e.target.value)} />
          </label>
          <label className="field">
            <span>Driver tip (L$)</span>
            <input value={tipLd} onChange={(e) => setTipLd(e.target.value)} />
          </label>
          <label className="field">
            <span>Payment method</span>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as 'MTN_MOMO' | 'ORANGE_MONEY')}
            >
              <option value="MTN_MOMO">MTN MoMo</option>
              <option value="ORANGE_MONEY">Orange Money</option>
            </select>
          </label>
          <p className="muted">Cash payment is not supported. Live mobile-money settlement is not configured here.</p>
          <PriceBreakdown {...breakdown} />
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              required
            />
            <span>
              I confirm that the information provided is accurate and authorize JUSTGO to use my
              emergency-contact information only when reasonably necessary for trip safety, emergencies,
              incident response, or legal compliance.
            </span>
          </label>
          <button className="primary-btn" type="submit">
            Confirm ride request
          </button>
        </form>
      ) : (
        <form className="form-grid" onSubmit={submitDelivery} aria-label={`${selected} form`}>
          <label className="field">
            <span>Pickup</span>
            <input
              value={delPickup}
              onChange={(e) => setDelPickup(e.target.value)}
              placeholder="Pickup"
              required
            />
          </label>
          <label className="field">
            <span>Destination</span>
            <input
              value={delDestination}
              onChange={(e) => setDelDestination(e.target.value)}
              required
            />
          </label>
          <button className="primary-btn" type="submit">
            Request {selected}
          </button>
        </form>
      )}

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {message ? <p className="state success" role="status">{message}</p> : null}

      <h2>Current Requests</h2>
      <div className="stack">
        {requests.length === 0 ? <p className="state">No current requests.</p> : null}
        {requests.map((r) => (
          <article className="panel-card" key={String(r.requestNumber)}>
            <small>
              {String(r.requestNumber)} · {String(r.serviceType)}
            </small>
            <p>Driver status: {String(r.driverStatus)}</p>
            {r.merchantStatus ? <p>Merchant status: {String(r.merchantStatus)}</p> : null}
            <strong>
              {String(r.pickup)} → {String(r.destination)}
            </strong>
            {r.priceBreakdown ? (
              <PriceBreakdown {...(r.priceBreakdown as typeof breakdown)} />
            ) : null}
            <p>Payment: {String(r.paymentStatus)}</p>
            <p>ETA: {String(r.estimatedCompletion)}</p>
            <ProgressTracker current={r.currentStage as string | null} />
            <div className="button-row">
              <button
                type="button"
                className="ghost-btn compact"
                onClick={() =>
                  void api('/api/customer/incidents', {
                    method: 'POST',
                    json: {
                      category: 'Other',
                      details: 'Customer reported a problem',
                      kind: r.kind,
                      requestId: r.id,
                    },
                  }).then(() => setMessage('Support request recorded.'))
                }
              >
                Support / report problem
              </button>
              {r.canReview ? (
                <>
                  <button
                    type="button"
                    className="secondary-btn compact"
                    onClick={() => void review(r.kind as 'ride' | 'delivery', String(r.id), 'driver')}
                  >
                    Review driver
                  </button>
                  <button
                    type="button"
                    className="secondary-btn compact"
                    onClick={() => void review(r.kind as 'ride' | 'delivery', String(r.id), 'overall')}
                  >
                    Review overall service
                  </button>
                </>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
