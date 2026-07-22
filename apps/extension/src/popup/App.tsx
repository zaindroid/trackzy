import { useEffect, useState } from 'react';
import { getConfig, setConfig } from '../lib/config.js';
import { fetchActiveManualTask, fetchPendingTrackingUploads } from '../lib/api.js';

type Status = 'idle' | 'checking' | 'connected' | 'error';

export default function App() {
  const [backendUrl, setBackendUrl] = useState('');
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [taskCount, setTaskCount] = useState<number | null>(null);
  const [uploadCount, setUploadCount] = useState<number | null>(null);

  useEffect(() => {
    getConfig().then((config) => {
      setBackendUrl(config.backendUrl);
      setToken(config.bearerToken ?? '');
    });
  }, []);

  const saveAndCheck = async () => {
    await setConfig({ backendUrl, bearerToken: token || null });
    setStatus('checking');
    try {
      const [task, uploads] = await Promise.all([fetchActiveManualTask(), fetchPendingTrackingUploads()]);
      setTaskCount(task ? 1 : 0);
      setUploadCount(uploads.length);
      setStatus('connected');
    } catch {
      setStatus('error');
    }
  };

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px' }}>Fulfillment Tracker</h1>

      <label style={{ display: 'block', fontSize: 12, color: '#555', marginBottom: 4 }}>Backend URL</label>
      <input
        value={backendUrl}
        onChange={(e) => setBackendUrl(e.target.value)}
        style={{ width: '100%', boxSizing: 'border-box', marginBottom: 10, padding: 6, fontSize: 12 }}
      />

      <label style={{ display: 'block', fontSize: 12, color: '#555', marginBottom: 4 }}>Access token</label>
      <input
        value={token}
        onChange={(e) => setToken(e.target.value)}
        type="password"
        placeholder="dev-user"
        style={{ width: '100%', boxSizing: 'border-box', marginBottom: 10, padding: 6, fontSize: 12 }}
      />

      <button
        onClick={saveAndCheck}
        style={{ width: '100%', padding: 8, background: '#0b74de', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}
      >
        Save &amp; check connection
      </button>

      {status === 'connected' && (
        <p style={{ fontSize: 12, marginTop: 12, color: '#2e7d32' }}>
          Connected — {taskCount} active manual task, {uploadCount} pending tracking upload{uploadCount === 1 ? '' : 's'}.
        </p>
      )}
      {status === 'error' && (
        <p style={{ fontSize: 12, marginTop: 12, color: '#c0392b' }}>
          Could not reach the backend — check the URL and access token.
        </p>
      )}
    </div>
  );
}
