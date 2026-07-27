import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuthToken } from './lib/auth.js';
import { Layout } from './components/Layout.js';
import { LoginPage } from './pages/Login.js';
import { HomePage } from './pages/Home.js';
import { ResearchPage } from './pages/Research.js';
import { RadarPage } from './pages/Radar.js';
import { LibraryPage } from './pages/Library.js';
import { LeaderboardPage } from './pages/Leaderboard.js';
import { OrdersPage } from './pages/Orders.js';
import { MonitorsPage } from './pages/Monitors.js';
import { ConnectionsPage } from './pages/Connections.js';
import { SettingsPage } from './pages/Settings.js';
import { BillingPage } from './pages/Billing.js';

export default function App() {
  const { token } = useAuthToken();
  if (!token) return <LoginPage />;

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/research" element={<ResearchPage />} />
        <Route path="/radar" element={<RadarPage />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/monitors" element={<MonitorsPage />} />
        <Route path="/connections" element={<ConnectionsPage />} />
        <Route path="/billing" element={<BillingPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
