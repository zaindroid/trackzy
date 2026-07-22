/**
 * The dashboard's signature status indicator: a monospaced, uppercase tag
 * with a small square marker, styled after the flag entries on a shipping
 * manifest rather than a generic filled pill. Tailwind needs full class
 * strings to find at build time, so each status maps to a complete class set.
 */
const STYLES: Record<string, string> = {
  received: 'text-ink-muted before:bg-ink-faint',
  evaluating: 'text-freight before:bg-freight',
  fulfilling: 'text-freight before:bg-freight',
  partially_shipped: 'text-ochre before:bg-ochre',
  shipped: 'text-moss before:bg-moss',
  delivered: 'text-moss before:bg-moss',
  exception: 'text-brick before:bg-brick',
  rejected: 'text-brick before:bg-brick',
  cancelled: 'text-ink-faint before:bg-ink-faint',
  pending: 'text-ink-muted before:bg-ink-faint',
  in_transit: 'text-freight before:bg-freight',
  needs_review: 'text-ochre before:bg-ochre',
  draft: 'text-ink-muted before:bg-ink-faint',
  approved: 'text-freight before:bg-freight',
  sent: 'text-moss before:bg-moss',
  resolved: 'text-moss before:bg-moss',
};

export function StatusStamp({ status }: { status: string }) {
  const classes = STYLES[status] ?? 'text-ink-muted before:bg-ink-faint';
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-wider before:block before:h-1.5 before:w-1.5 before:shrink-0 before:content-[''] ${classes}`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}
