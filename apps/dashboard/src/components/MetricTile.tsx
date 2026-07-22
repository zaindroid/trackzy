export function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t-2 border-ink pt-2">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="mt-1 font-mono text-xl font-medium text-ink sm:text-2xl">{value}</div>
    </div>
  );
}

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
