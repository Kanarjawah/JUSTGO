'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import SignInForm from '../components/SignInForm';
import ConfirmDialog from '../components/ConfirmDialog';
import ProgressTracker from '../components/ProgressTracker';
import { api } from '../lib/api';

interface Overview {
  title: string;
  sections: string[];
  overview: Record<string, number | string>;
}

export default function AdminPage() {
  const { user, loading } = useAuth();
  const [data, setData] = useState<Overview | null>(null);
  const [drivers, setDrivers] = useState<Array<{ id: string; applicationStatus: string; user: { id: string; firstName: string; status: string } }>>([]);
  const [merchants, setMerchants] = useState<Array<{ id: string; applicationStatus: string; businessName: string; user: { id: string; firstName: string; status: string } }>>([]);
  const [requests, setRequests] = useState<{ rides: Array<Record<string, unknown>>; deliveries: Array<Record<string, unknown>> } | null>(null);
  const [audits, setAudits] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState('');
  const [section, setSection] = useState('Dashboard overview');
  const [confirm, setConfirm] = useState<{
    title: string;
    message: string;
    action: () => Promise<void>;
  } | null>(null);

  async function load() {
    if (!user || user.role !== 'ADMIN') return;
    setError('');
    try {
      const [center, d, m, r, a] = await Promise.all([
        api<Overview>('/api/admin/control-center'),
        api<{ drivers: typeof drivers }>('/api/admin/drivers'),
        api<{ merchants: typeof merchants }>('/api/admin/merchants'),
        api<{ rides: Array<Record<string, unknown>>; deliveries: Array<Record<string, unknown>> }>('/api/admin/requests'),
        api<{ logs: Array<Record<string, unknown>> }>('/api/admin/audit-logs'),
      ]);
      setData(center);
      setDrivers(d.drivers);
      setMerchants(m.merchants);
      setRequests(r);
      setAudits(a.logs);
    } catch (e) {
      const err = e as Error & { status?: number };
      setError(err.status === 401 || err.status === 403 ? 'Access denied' : err.message);
      setData(null);
    }
  }

  useEffect(() => {
    void load();
  }, [user]);

  if (loading) return <p className="state">Loading…</p>;

  if (!user || user.role !== 'ADMIN') {
    return (
      <SignInForm
        expectedRole="ADMIN"
        title="Administrator sign-in"
        subtitle="Sign in to open the JUSTGO Admin Control Center. Administrative data is never shown before authentication."
      />
    );
  }

  if (error) return <p className="form-error" role="alert">{error}</p>;
  if (!data) return <p className="state">Loading Admin Control Center…</p>;

  return (
    <section className="admin-page">
      <h1>{data.title}</h1>
      <p className="page-sub">Server-protected administration for JUSTGO Liberia.</p>

      <div className="admin-layout">
        <aside className="admin-menu" aria-label="Admin sections">
          {data.sections.map((s) => (
            <button
              key={s}
              type="button"
              className={section === s ? 'menu-item active' : 'menu-item'}
              onClick={() => setSection(s)}
            >
              {s}
            </button>
          ))}
        </aside>

        <div className="admin-panel">
          {section === 'Dashboard overview' && (
            <div className="stats-grid">
              {Object.entries(data.overview).map(([k, v]) => (
                <div className="stat-card" key={k}>
                  <small>{k}</small>
                  <strong>{String(v)}</strong>
                </div>
              ))}
            </div>
          )}

          {(section === 'Driver applications' || section === 'Driver management') && (
            <div className="stack">
              {drivers.map((d) => (
                <article className="panel-card" key={d.id}>
                  <strong>
                    {d.user.firstName} · {d.applicationStatus} · {d.user.status}
                  </strong>
                  <div className="button-row">
                    <button
                      type="button"
                      className="primary-btn compact"
                      onClick={() =>
                        setConfirm({
                          title: 'Approve driver',
                          message: `Approve ${d.user.firstName}?`,
                          action: async () => {
                            await api(`/api/admin/drivers/${d.id}/application`, {
                              method: 'POST',
                              json: { decision: 'APPROVED', confirm: true },
                            });
                            await load();
                          },
                        })
                      }
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="danger-btn compact"
                      onClick={() =>
                        setConfirm({
                          title: 'Reject application',
                          message: `Reject ${d.user.firstName}'s driver application?`,
                          action: async () => {
                            await api(`/api/admin/drivers/${d.id}/application`, {
                              method: 'POST',
                              json: { decision: 'REJECTED', confirm: true },
                            });
                            await load();
                          },
                        })
                      }
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      className="ghost-btn compact"
                      onClick={() =>
                        setConfirm({
                          title: 'Suspend account',
                          message: `Suspend ${d.user.firstName}?`,
                          action: async () => {
                            await api(`/api/admin/accounts/${d.user.id}/status`, {
                              method: 'POST',
                              json: { status: 'SUSPENDED', confirm: true },
                            });
                            await load();
                          },
                        })
                      }
                    >
                      Suspend
                    </button>
                    <button
                      type="button"
                      className="danger-btn compact"
                      onClick={() =>
                        setConfirm({
                          title: 'Deactivate driver',
                          message: `Deactivate ${d.user.firstName}? This is a sensitive action.`,
                          action: async () => {
                            await api(`/api/admin/accounts/${d.user.id}/status`, {
                              method: 'POST',
                              json: { status: 'DEACTIVATED', confirm: true },
                            });
                            await load();
                          },
                        })
                      }
                    >
                      Deactivate
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          {(section === 'Merchant applications' || section === 'Merchant management') && (
            <div className="stack">
              {merchants.map((m) => (
                <article className="panel-card" key={m.id}>
                  <strong>
                    {m.businessName} · {m.applicationStatus}
                  </strong>
                  <div className="button-row">
                    <button
                      type="button"
                      className="primary-btn compact"
                      onClick={() =>
                        setConfirm({
                          title: 'Approve merchant',
                          message: `Approve ${m.businessName}?`,
                          action: async () => {
                            await api(`/api/admin/merchants/${m.id}/application`, {
                              method: 'POST',
                              json: { decision: 'APPROVED', confirm: true },
                            });
                            await load();
                          },
                        })
                      }
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="danger-btn compact"
                      onClick={() =>
                        setConfirm({
                          title: 'Reject merchant',
                          message: `Reject ${m.businessName}?`,
                          action: async () => {
                            await api(`/api/admin/merchants/${m.id}/application`, {
                              method: 'POST',
                              json: { decision: 'REJECTED', confirm: true },
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
          )}

          {(section.includes('requests') ||
            section.includes('Ride') ||
            section.includes('Orders') ||
            section.includes('delivery') ||
            section.includes('Transportation') ||
            section.includes('Package')) &&
            requests && (
              <div className="stack">
                {requests.rides.map((r) => (
                  <article className="panel-card" key={String(r.id)}>
                    <small>{String(r.requestNumber)} · RIDE</small>
                    <strong>
                      {String(r.pickup)} → {String(r.destination)}
                    </strong>
                    <ProgressTracker current={r.fulfillmentStage as string | null} />
                    <p className="muted">History entries: {(r.statusHistory as unknown[])?.length ?? 0}</p>
                    <button
                      type="button"
                      className="danger-btn compact"
                      onClick={() =>
                        setConfirm({
                          title: 'Cancel order',
                          message: `Cancel ${String(r.requestNumber)}?`,
                          action: async () => {
                            await api('/api/admin/cancel', {
                              method: 'POST',
                              json: { kind: 'ride', requestId: r.id, confirm: true },
                            });
                            await load();
                          },
                        })
                      }
                    >
                      Cancel
                    </button>
                  </article>
                ))}
                {requests.deliveries.map((r) => (
                  <article className="panel-card" key={String(r.id)}>
                    <small>
                      {String(r.requestNumber)} · {String(r.serviceType)}
                    </small>
                    <strong>
                      {String(r.pickup)} → {String(r.destination)}
                    </strong>
                    <ProgressTracker current={r.fulfillmentStage as string | null} />
                  </article>
                ))}
              </div>
            )}

          {section === 'Audit logs' && (
            <div className="stack">
              {audits.map((log) => (
                <article className="panel-card" key={String(log.id)}>
                  <strong>{String(log.action)}</strong>
                  <small>
                    {String(log.entityType)} · {String(log.createdAt)}
                  </small>
                </article>
              ))}
            </div>
          )}

          {!['Dashboard overview', 'Driver applications', 'Driver management', 'Merchant applications', 'Merchant management', 'Audit logs'].includes(section) &&
            !section.includes('Ride') &&
            !section.includes('request') &&
            !section.includes('Orders') &&
            !section.includes('delivery') &&
            !section.includes('Transportation') &&
            !section.includes('Package') && (
              <p className="state">
                Section “{section}” is available in the Admin Control Center API. Use the linked
                management panels and audit tools to operate this area.
              </p>
            )}
        </div>
      </div>

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
