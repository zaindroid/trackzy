import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuthToken } from './lib/auth.js';
import { Layout } from './components/Layout.js';
import { LoginPage } from './pages/Login.js';
import { OrdersPage } from './pages/Orders.js';
import { OrderDetailPage } from './pages/OrderDetail.js';
import { FulfillmentsPage } from './pages/Fulfillments.js';
import { SuppliersPage } from './pages/Suppliers.js';
import { SupplierDetailPage } from './pages/SupplierDetail.js';
import { DisputesPage } from './pages/Disputes.js';
import { SettingsPage } from './pages/Settings.js';

export default function App() {
  const { token } = useAuthToken();

  if (!token) {
    return <LoginPage />;
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/orders" replace />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/orders/:id" element={<OrderDetailPage />} />
        <Route path="/fulfillments" element={<FulfillmentsPage />} />
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/suppliers/:id" element={<SupplierDetailPage />} />
        <Route path="/disputes" element={<DisputesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/orders" replace />} />
      </Routes>
    </Layout>
  );
}
