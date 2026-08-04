import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import AppShell from '../../app/src/components/AppShell';
import CustomerPage from '../../app/src/pages/CustomerPage';
import MerchantPage from '../../app/src/pages/MerchantPage';
import DriverPage from '../../app/src/pages/DriverPage';
import { AuthProvider } from '../../app/src/context/AuthContext';

vi.mock('../../app/src/lib/api', () => ({
  api: vi.fn(async (path: string) => {
    if (path === '/api/auth/me') throw Object.assign(new Error('Authentication required'), { status: 401 });
    if (path === '/api/customer/services') {
      return {
        services: [
          'Ride',
          'Transportation',
          'Food Delivery',
          'Store Delivery',
          'Grocery Delivery',
          'Pharmacy Delivery',
          'Package Delivery',
          'Courier Service',
        ],
      };
    }
    if (path === '/api/customer/requests') return { requests: [] };
    if (path === '/api/merchant/dashboard') {
      return {
        menu: [],
        store: { name: 'Test', preparationMins: 20 },
      };
    }
    if (path === '/api/merchant/requests') return { requests: [], tabs: ['Store'] };
    if (path === '/api/merchant/earnings') {
      return {
        settlement: {
          productSubtotalCents: 0,
          taxCents: 0,
          merchantFeeCents: 0,
          refundCents: 0,
          netMerchantSettlementCents: 0,
        },
      };
    }
    if (path === '/api/driver/dashboard') return { availability: 'OFF', menu: [] };
    if (path === '/api/driver/requests') {
      return {
        categories: ['TRANSPORTATION'],
        requests: [],
        offers: [],
      };
    }
    if (path === '/api/driver/earnings') return { tipTotalCents: 0, driverPlatformFeesCents: 0, note: '' };
    return {};
  }),
  clearCsrf: vi.fn(),
}));

function wrap(ui: ReactNode, route = '/') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider>{ui}</AuthProvider>
    </MemoryRouter>,
  );
}

describe('Navigation and labels', () => {
  it('Admin navigation is visible', () => {
    wrap(
      <AppShell>
        <div>child</div>
      </AppShell>,
    );
    const adminLinks = screen.getAllByRole('link', { name: /admin/i });
    expect(adminLinks.length).toBeGreaterThanOrEqual(1);
  });

  it('mobile and desktop navigation still include role links', () => {
    wrap(
      <AppShell>
        <div />
      </AppShell>,
    );
    expect(screen.getAllByRole('link', { name: /customer/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /driver/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /merchant/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /admin/i }).length).toBeGreaterThan(0);
  });
});

describe('Customer services and labels', () => {
  it('Ride appears in Customer Services and Pickup label has no "or restaurant"', async () => {
    // Force authenticated customer via mocked me after first fail — re-mock for this test
    const { api } = await import('../../app/src/lib/api');
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === '/api/auth/me') {
        return {
          user: {
            id: 'c1',
            role: 'CUSTOMER',
            firstName: 'Comfort',
            lastName: 'K',
            phone: '+231770000002',
          },
        };
      }
      if (path === '/api/customer/services') {
        return {
          services: [
            'Ride',
            'Transportation',
            'Food Delivery',
            'Store Delivery',
            'Grocery Delivery',
            'Pharmacy Delivery',
            'Package Delivery',
            'Courier Service',
          ],
        };
      }
      if (path === '/api/customer/requests') return { requests: [] };
      return {};
    });

    wrap(<CustomerPage />);
    expect(await screen.findByRole('button', { name: 'Ride' })).toBeInTheDocument();
    const pickupLabels = await screen.findAllByText('Pickup');
    expect(pickupLabels.length).toBeGreaterThan(0);
    expect(document.body.textContent?.toLowerCase()).not.toContain('or restaurant');
  });
});

describe('Merchant and Driver current request labels', () => {
  it('Store appears in Merchant Current Requests', async () => {
    const { api } = await import('../../app/src/lib/api');
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === '/api/auth/me') {
        return {
          user: {
            id: 'm1',
            role: 'MERCHANT',
            firstName: 'Sarah',
            lastName: 'M',
            phone: '+231770000004',
          },
        };
      }
      if (path === '/api/merchant/dashboard') {
        return { store: { name: 'Kitchen', preparationMins: 20 } };
      }
      if (path === '/api/merchant/requests') return { requests: [], tabs: ['Store'] };
      if (path === '/api/merchant/earnings') {
        return {
          settlement: {
            productSubtotalCents: 0,
            taxCents: 0,
            merchantFeeCents: 0,
            refundCents: 0,
            netMerchantSettlementCents: 0,
          },
        };
      }
      return {};
    });

    wrap(<MerchantPage />);
    // open Current Requests
    const btn = await screen.findByRole('button', { name: 'Current Requests' });
    btn.click();
    expect(await screen.findByRole('button', { name: 'Store' })).toBeInTheDocument();
  });

  it('Transportation appears in Driver Current Requests', async () => {
    const { api } = await import('../../app/src/lib/api');
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === '/api/auth/me') {
        return {
          user: {
            id: 'd1',
            role: 'DRIVER',
            firstName: 'Emmanuel',
            lastName: 'D',
            phone: '+231770000003',
          },
        };
      }
      if (path === '/api/driver/dashboard') return { availability: 'ONLINE' };
      if (path === '/api/driver/requests') return { requests: [], offers: [], categories: [] };
      if (path === '/api/driver/earnings') return { tipTotalCents: 0, driverPlatformFeesCents: 0 };
      return {};
    });

    wrap(<DriverPage />);
    const btn = await screen.findByRole('button', { name: 'Current Requests' });
    btn.click();
    expect(await screen.findByRole('button', { name: 'Transportation' })).toBeInTheDocument();
  });
});
