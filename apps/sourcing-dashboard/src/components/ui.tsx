import type { ButtonHTMLAttributes, InputHTMLAttributes, LabelHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

const VARIANTS = {
  primary: 'bg-signal text-signal-ink hover:brightness-110 disabled:opacity-50',
  secondary: 'border border-rule text-ink hover:bg-paper-raised disabled:opacity-50',
  ghost: 'text-ink-muted hover:bg-paper-raised hover:text-ink disabled:opacity-50',
  danger: 'border border-rule text-brick hover:bg-brick/10 disabled:opacity-50',
};

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof VARIANTS }) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium transition-all active:scale-[0.97] ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

const FIELD_CLASSES =
  'w-full rounded-lg border border-rule bg-paper-raised px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint disabled:opacity-50';

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${FIELD_CLASSES} ${props.className ?? ''}`} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${FIELD_CLASSES} resize-y ${props.className ?? ''}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${FIELD_CLASSES} ${props.className ?? ''}`} />;
}

export function Label(props: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      {...props}
      className={`mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-faint ${props.className ?? ''}`}
    />
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export function Panel({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-rule bg-paper-raised p-4 shadow-raised sm:p-5 ${className}`}>
      {title && <h2 className="mb-3 text-sm font-semibold text-ink">{title}</h2>}
      {children}
    </section>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <div className="mb-1 text-xs font-medium uppercase tracking-widest text-ink-faint">{eyebrow}</div>}
        <h1 className="font-display text-2xl font-semibold uppercase tracking-wide text-ink sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="px-4 py-10 text-center text-sm text-ink-faint">{children}</p>;
}

const BADGE_TONES = {
  moss: 'bg-moss/15 text-moss',
  ochre: 'bg-ochre/20 text-ochre',
  brick: 'bg-brick/15 text-brick',
  signal: 'bg-signal/15 text-signal',
  neutral: 'bg-paper text-ink-faint',
};

export function Badge({
  tone = 'neutral',
  className = '',
  children,
}: {
  tone?: keyof typeof BADGE_TONES;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${BADGE_TONES[tone]} ${className}`}>
      {children}
    </span>
  );
}
