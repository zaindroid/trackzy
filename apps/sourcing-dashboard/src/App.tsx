import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuthToken } from './lib/auth.js';
import { Layout } from './components/Layout.js';
import { LoginPage } from './pages/Login.js';
import { ResearchPage } from './pages/Research.js';
import { RadarPage } from './pages/Radar.js';
import { LibraryPage } from './pages/Library.js';
import { ConnectionsPage } from './pages/Connections.js';
import { SettingsPage } from './pages/Settings.js';
import { BillingPage } from './pages/Billing.js';

export default function App() {
  const { token } = useAuthToken();
  if (!token) return <LoginPage />;

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/research" replace />} />
        <Route path="/research" element={<ResearchPage />} />
        <Route path="/radar" element={<RadarPage />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/connections" element={<ConnectionsPage />} />
        <Route path="/billing" element={<BillingPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/research" replace />} />
      </Routes>
    </Layout>
  );
}
