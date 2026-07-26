import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthToken } from '../lib/auth.js';
import { apiFetch, type SellerSettings } from '../lib/api.js';
import { Button, Field, PageHeader, Panel, Select, TextInput } from '../components/ui.js';

export function SettingsPage() {
  const { token } = useAuthToken();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Partial<SellerSettings>>({});

  const query = useQuery({
    queryKey: ['sellerSettings'],
    queryFn: () => apiFetch<{ settings: SellerSettings }>('/settings', token),
  });

  useEffect(() => {
    if (query.data) setForm(query.data.settings);
  }, [query.data]);

  const save = useMutation({
    mutationFn: () =>
      apiFetch('/settings', token, {
        method: 'PUT',
        body: JSON.stringify({
          defaultShippingCostCents: form.defaultShippingCostCents,
          handlingTimeDays: form.handlingTimeDays,
          returnPolicy: form.returnPolicy,
          targetMarginPercent: form.targetMarginPercent,
          ebayFeePercent: form.ebayFeePercent,
          itemLocationPostalCode: form.itemLocationPostalCode,
        }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sellerSettings'] }),
  });

  const num = (v: string) => (v === '' ? undefined : Number(v));

  return (
    <div className="max-w-xl">
      <PageHeader
        eyebrow="Setup"
        title="Listing defaults"
        description="Used on every listing you publish, and to compute margins. Set these once."
      />

      <Panel>
        <div className="flex flex-col gap-4">
          <Field label="Flat shipping charged to buyer ($)">
            <TextInput
              type="number"
              value={form.defaultShippingCostCents !== undefined ? (form.defaultShippingCostCents / 100).toString() : ''}
              onChange={(e) => setForm({ ...form, defaultShippingCostCents: e.target.value === '' ? undefined : Math.round(Number(e.target.value) * 100) })}
            />
          </Field>
          <Field label="Handling time (days)">
            <TextInput type="number" value={form.handlingTimeDays ?? ''} onChange={(e) => setForm({ ...form, handlingTimeDays: num(e.target.value) })} />
          </Field>
          <Field label="Return policy">
            <Select
              value={form.returnPolicy ?? '30_day'}
              onChange={(e) => setForm({ ...form, returnPolicy: e.target.value as SellerSettings['returnPolicy'] })}
            >
              <option value="no_returns">No returns</option>
              <option value="30_day">30-day returns</option>
              <option value="60_day">60-day returns</option>
            </Select>
          </Field>
          <Field label="Target margin (%)">
            <TextInput type="number" value={form.targetMarginPercent ?? ''} onChange={(e) => setForm({ ...form, targetMarginPercent: num(e.target.value) })} />
          </Field>
          <Field label="eBay fee (%)">
            <TextInput type="number" value={form.ebayFeePercent ?? ''} onChange={(e) => setForm({ ...form, ebayFeePercent: num(e.target.value) })} />
          </Field>
          <Field label="Item location postal code">
            <TextInput value={form.itemLocationPostalCode ?? ''} onChange={(e) => setForm({ ...form, itemLocationPostalCode: e.target.value })} />
          </Field>
          <div>
            <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
            {save.isSuccess && <span className="ml-3 text-sm text-moss">Saved.</span>}
            {save.isError && <span className="ml-3 text-sm text-brick">{(save.error as Error).message}</span>}
          </div>
        </div>
      </Panel>
    </div>
  );
}
