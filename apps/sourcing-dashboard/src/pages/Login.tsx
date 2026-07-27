import { useAuthToken } from '../lib/auth.js';
import { Button } from '../components/ui.js';

export function LoginPage() {
  const { loginAsDevUser } = useAuthToken();

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm rounded-2xl border border-rule bg-paper-raised p-8 shadow-raised">
        <div className="mb-8 border-b border-dashed border-rule pb-6 text-center">
          <div className="font-display text-3xl font-semibold uppercase tracking-wide text-ink">Droparch</div>
          <p className="mt-2 text-sm text-ink-muted">Find winning products, list them in one click</p>
        </div>
        <Button variant="primary" onClick={loginAsDevUser} className="w-full">
          Continue as dev user
        </Button>
        <p className="mt-4 text-center text-xs text-ink-faint">MOCK_MODE — Clerk is not configured for this deployment.</p>
      </div>
    </div>
  );
}
