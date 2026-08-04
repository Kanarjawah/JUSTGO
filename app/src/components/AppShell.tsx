'use client';

import { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Car,
  Package,
  Store,
  Wallet,
  UserRound,
  Truck,
  Store as Shop,
  Shield,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import BrandLogo from './BrandLogo';

const navItems = [
  { to: '/customer', label: 'Customer', icon: UserRound },
  { to: '/driver', label: 'Driver', icon: Truck },
  { to: '/merchant', label: 'Merchant', icon: Shop },
  { to: '/admin', label: 'Admin', icon: Shield },
  { to: '/wallet', label: 'Wallet', icon: Wallet },
];

const secondary = [
  { to: '/customer/ride', label: 'Ride', icon: Car },
  { to: '/customer/services', label: 'Delivery', icon: Package },
  { to: '/market', label: 'Market', icon: Store },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();

  return (
    <div className="app-frame">
      <header className="topbar">
        <div className="brand-block">
          <Link href="/" className="brand-link" aria-label="JUSTGO Liberia home">
            <BrandLogo variant="header" />
            <span>
              <span className="brand">
                JUSTGO<span>.</span>
              </span>
              <span className="brand-tag">Liberia · Ride · Deliver · Trade</span>
            </span>
          </Link>
        </div>
        <div className="topbar-actions">
          {user ? (
            <>
              <span className="user-chip" aria-label="Signed in user">
                {user.firstName} · {user.role}
              </span>
              <button type="button" className="ghost-btn compact" onClick={() => void logout()}>
                Sign out
              </button>
            </>
          ) : (
            <Link href="/login" className="wallet-chip">
              Sign in
            </Link>
          )}
          <Link href="/wallet" className="wallet-chip">
            Wallet
          </Link>
        </div>
      </header>

      <nav className="main-nav" aria-label="Primary">
        {navItems.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            href={to}
            className={pathname === to || pathname.startsWith(`${to}/`) ? 'nav-pill active' : 'nav-pill'}
          >
            <Icon size={16} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>

      <main className="content">{children}</main>

      <nav className="bottom-nav" aria-label="Quick services">
        {secondary.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            href={to}
            className={pathname === to || pathname.startsWith(`${to}/`) ? 'nav-item active' : 'nav-item'}
          >
            <Icon size={19} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
        <Link
          href="/admin"
          className={pathname.startsWith('/admin') ? 'nav-item active' : 'nav-item'}
        >
          <Shield size={19} aria-hidden="true" />
          <span>Admin</span>
        </Link>
        <Link
          href="/wallet"
          className={pathname.startsWith('/wallet') ? 'nav-item active' : 'nav-item'}
        >
          <Wallet size={19} aria-hidden="true" />
          <span>Wallet</span>
        </Link>
      </nav>
    </div>
  );
}
