import { Routes, Route, Navigate } from 'react-router-dom';
import AppShell from './components/AppShell';
import CustomerPage from './pages/CustomerPage';
import DriverPage from './pages/DriverPage';
import MerchantPage from './pages/MerchantPage';
import AdminPage from './pages/AdminPage';
import WalletPage from './pages/WalletPage';
import MarketPage from './pages/MarketPage';
import DeliveryPage from './pages/DeliveryPage';
import RidePage from './pages/RidePage';
import LoginPage from './pages/LoginPage';
import ProviderPage from './pages/ProviderPage';

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/customer" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/customer" element={<CustomerPage />} />
        <Route path="/customer/ride" element={<RidePage />} />
        <Route path="/customer/services" element={<CustomerPage />} />
        <Route path="/driver" element={<DriverPage />} />
        <Route path="/merchant" element={<MerchantPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/wallet" element={<WalletPage />} />
        <Route path="/market" element={<MarketPage />} />
        <Route path="/delivery" element={<DeliveryPage />} />
        <Route path="/provider" element={<ProviderPage />} />
      </Routes>
    </AppShell>
  );
}
