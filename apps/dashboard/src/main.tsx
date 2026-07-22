import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { MockAuthProvider, CLERK_CONFIGURED } from './lib/auth.js';
import App from './App.js';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

async function renderApp() {
  let AuthProvider = MockAuthProvider;
  if (CLERK_CONFIGURED) {
    const mod = await import('./lib/clerkAuth.js');
    AuthProvider = mod.ClerkAuthProvider;
  }

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </AuthProvider>
      </QueryClientProvider>
    </React.StrictMode>,
  );
}

void renderApp();
