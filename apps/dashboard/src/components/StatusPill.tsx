const COLORS: Record<string, string> = {
  received: 'bg-slate-500/15 text-slate-300',
  evaluating: 'bg-sky-500/15 text-sky-300',
  fulfilling: 'bg-sky-500/15 text-sky-300',
  partially_shipped: 'bg-amber-500/15 text-amber-300',
  shipped: 'bg-emerald-500/15 text-emerald-300',
  delivered: 'bg-emerald-500/20 text-emerald-300',
  exception: 'bg-red-500/15 text-red-300',
  rejected: 'bg-red-500/15 text-red-300',
  cancelled: 'bg-slate-600/20 text-slate-400',
  pending: 'bg-slate-500/15 text-slate-300',
  in_transit: 'bg-sky-500/15 text-sky-300',
  needs_review: 'bg-amber-500/15 text-amber-300',
  draft: 'bg-slate-500/15 text-slate-300',
  approved: 'bg-sky-500/15 text-sky-300',
  sent: 'bg-emerald-500/15 text-emerald-300',
  resolved: 'bg-emerald-500/15 text-emerald-300',
};

export function StatusPill({ status }: { status: string }) {
  const classes = COLORS[status] ?? 'bg-slate-500/15 text-slate-300';
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${classes}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}
