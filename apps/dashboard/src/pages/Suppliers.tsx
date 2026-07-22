import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuthToken } from '../lib/auth.js';
import { apiFetch, type Supplier } from '../lib/api.js';

export function SuppliersPage() {
  const { token } = useAuthToken();
  const query = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => apiFetch<{ suppliers: Supplier[] }>('/suppliers', token),
  });

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-100">Suppliers</h1>
      <div className="overflow-hidden rounded-lg border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900/60 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">Email pattern</th>
              <th className="px-4 py-2.5">Parser</th>
              <th className="px-4 py-2.5">Active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {query.data?.suppliers.map((s) => (
              <tr key={s.id} className="hover:bg-slate-900/40">
                <td className="px-4 py-2.5">
                  <Link to={`/suppliers/${s.id}`} className="font-medium text-emerald-400 hover:underline">
                    {s.name}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-slate-300">{s.emailSenderPattern}</td>
                <td className="px-4 py-2.5 text-slate-300">{s.parserId}</td>
                <td className="px-4 py-2.5 text-slate-300">{s.active ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
