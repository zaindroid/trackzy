import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useAuthToken } from '../lib/auth.js';
import { apiFetch, type Supplier } from '../lib/api.js';
import type { TrackingCandidate } from '@fulfillment-tracker/core';
import { Button, Field, PageHeader, Panel, Textarea, TextInput } from '../components/ui.js';

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

  if (!supplier) return <p className="text-sm text-ink-faint">Loading supplier…</p>;

  return (
    <div className="max-w-2xl">
      <PageHeader
        eyebrow="Supplier"
        title={supplier.name}
        description={
          <span className="font-mono">
            {supplier.emailSenderPattern} · parser {supplier.parserId}
          </span>
        }
      />

      <Panel title="Test parser">
        <p className="mb-4 text-sm text-ink-muted">
          Paste a real shipping-notification email below to see exactly what this supplier's parser
          extracts, live — no need to wait for a real one to arrive.
        </p>
        <div className="space-y-3">
          <Field label="Subject (optional)">
            <TextInput value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Field label="Email body">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} className="font-mono" />
          </Field>
          <Button variant="primary" onClick={() => testMutation.mutate()} disabled={!text || testMutation.isPending}>
            Run parser
          </Button>
        </div>

        {testMutation.data && (
          <div className="mt-4 border border-rule bg-paper p-3 text-sm">
            <div className="text-ink-muted">Confidence: <span className="font-mono text-ink">{testMutation.data.confidence}</span></div>
            {testMutation.data.candidate ? (
              <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-moss">
                {JSON.stringify(testMutation.data.candidate, null, 2)}
              </pre>
            ) : (
              <div className="mt-2 text-brick">No tracking candidate extracted.</div>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}
