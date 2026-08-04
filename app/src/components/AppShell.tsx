import { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
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

  return (
    <div className="app-frame">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand">
            JUSTGO<span>.</span>
          </div>
          <p className="brand-tag">Liberia · Ride · Deliver · Trade</p>
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
            <NavLink to="/login" className="wallet-chip">
              Sign in
            </NavLink>
          )}
          <NavLink to="/wallet" className="wallet-chip">
            Wallet
          </NavLink>
        </div>
      </header>

      <nav className="main-nav" aria-label="Primary">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => (isActive ? 'nav-pill active' : 'nav-pill')}
          >
            <Icon size={16} aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <main className="content">{children}</main>

      <nav className="bottom-nav" aria-label="Quick services">
        {secondary.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
          >
            <Icon size={19} aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
        <NavLink
          to="/admin"
          className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
        >
          <Shield size={19} aria-hidden="true" />
          <span>Admin</span>
        </NavLink>
        <NavLink
          to="/wallet"
          className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
        >
          <Wallet size={19} aria-hidden="true" />
          <span>Wallet</span>
        </NavLink>
      </nav>
    </div>
  );
}
