'use client';

import { useState } from 'react';
import { vendors } from '../data/mock';

export default function DeliveryPage() {
  const [mode, setMode] = useState<'package' | 'food'>('package');
  return (
    <section>
      <h1>Send am, or order am</h1>
      <p className="page-sub">Packages, food and goods from local providers.</p>
      <div className="segmented">
        <button
          type="button"
          className={mode === 'package' ? 'active' : ''}
          onClick={() => setMode('package')}
        >
          Send Package
        </button>
        <button
          type="button"
          className={mode === 'food' ? 'active' : ''}
          onClick={() => setMode('food')}
        >
          Order Food
        </button>
      </div>
      {mode === 'package' ? (
        <div>
          <label className="field">
            <span>Pickup</span>
            <input placeholder="Pickup" aria-label="Pickup" />
          </label>
          <label className="field">
            <span>Drop-off</span>
            <input placeholder="Drop-off address" aria-label="Drop-off" />
          </label>
          <div className="card">
            <span>Estimated cost</span>
            <strong>L$180 – L$260</strong>
          </div>
          <button type="button" className="primary-btn">
            Find a courier
          </button>
        </div>
      ) : (
        <div className="stack">
          {vendors.map((v) => (
            <article className="vendor-card" key={v.id}>
              <div className="vendor-icon">{v.icon}</div>
              <div>
                <strong>{v.name}</strong>
                <small>
                  {v.type} · {v.eta}
                </small>
                <span>★ {v.rating}</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
