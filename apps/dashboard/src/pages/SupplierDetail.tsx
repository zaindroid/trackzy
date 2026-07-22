import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useAuthToken } from '../lib/auth.js';
import { apiFetch, type Supplier } from '../lib/api.js';
import type { TrackingCandidate } from '@fulfillment-tracker/core';

interface TestParserResult {
  candidate: TrackingCandidate | null;
  confidence: number;
  usedFallback: boolean;
}

export function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { token } = useAuthToken();
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');

  const suppliersQuery = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => apiFetch<{ suppliers: Supplier[] }>('/suppliers', token),
  });
  const supplier = suppliersQuery.data?.suppliers.find((s) => s.id === id);

  const testMutation = useMutation({
    mutationFn: () =>
      apiFetch<TestParserResult>(`/suppliers/${id}/test-parser`, token, {
        method: 'POST',
        body: JSON.stringify({ subject, text }),
      }),
  });

  if (!supplier) return <p className="text-slate-500">Loading...</p>;

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-xl font-semibold text-slate-100">{supplier.name}</h1>
      <p className="mb-6 text-sm text-slate-500">
        {supplier.emailSenderPattern} · parser <code>{supplier.parserId}</code>
      </p>

      <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-300">Test parser</h2>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject (optional)"
          className="mb-2 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-1.5 text-sm text-slate-200"
        />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste email body..."
          rows={6}
          className="mb-2 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-1.5 text-sm text-slate-200"
        />
        <button
          onClick={() => testMutation.mutate()}
          disabled={!text || testMutation.isPending}
          className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          Run parser
        </button>

        {testMutation.data && (
          <div className="mt-4 rounded-md border border-slate-800 bg-slate-950 p-3 text-sm">
            <div className="text-slate-400">Confidence: {testMutation.data.confidence}</div>
            {testMutation.data.candidate ? (
              <pre className="mt-1 whitespace-pre-wrap text-emerald-400">
                {JSON.stringify(testMutation.data.candidate, null, 2)}
              </pre>
            ) : (
              <div className="mt-1 text-red-400">No tracking candidate extracted.</div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
