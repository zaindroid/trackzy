import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuthToken } from '../lib/auth.js';
import { apiFetch, type Supplier } from '../lib/api.js';
import { EmptyState, PageHeader } from '../components/ui.js';

export function SuppliersPage() {
  const { token } = useAuthToken();
  const query = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => apiFetch<{ suppliers: Supplier[] }>('/suppliers', token),
  });

  return (
    <div>
      <PageHeader eyebrow="Directory" title="Suppliers" description="Where orders ship from, and how their tracking emails get read." />
      <div className="border border-rule bg-paper-raised shadow-raised">
        <table className="manifest">
          <thead className="border-b border-rule text-xs uppercase tracking-wide text-ink-faint">
            <tr>
              <th className="px-4 py-2.5 font-medium">Name</th>
              <th className="px-4 py-2.5 font-medium">Email pattern</th>
              <th className="px-4 py-2.5 font-medium">Parser</th>
              <th className="px-4 py-2.5 font-medium">Active</th>
            </tr>
          </thead>
          <tbody>
            {query.data?.suppliers.map((s) => (
              <tr key={s.id} className="md:hover:bg-paper">
                <td data-label="Name" className="md:px-4 md:py-2.5">
                  <Link to={`/suppliers/${s.id}`} className="font-medium text-signal hover:underline">
                    {s.name}
                  </Link>
                </td>
                <td data-label="Email pattern" className="font-mono text-ink-muted md:px-4 md:py-2.5">
                  {s.emailSenderPattern}
                </td>
                <td data-label="Parser" className="font-mono text-ink-muted md:px-4 md:py-2.5">
                  {s.parserId}
                </td>
                <td data-label="Active" className="text-ink-muted md:px-4 md:py-2.5">
                  {s.active ? 'Yes' : 'No'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {query.data?.suppliers.length === 0 && <EmptyState>No suppliers configured yet.</EmptyState>}
      </div>
    </div>
  );
}
