'use client';

import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';
import { formatAmount } from '@finstat/shared';

// ---------------------------------------------------------------------------
// Buttons and inputs
// ---------------------------------------------------------------------------

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium transition',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500',
        'disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm',
        variant === 'primary' && 'bg-ink-800 text-white hover:bg-ink-700',
        variant === 'secondary' &&
          'border border-ink-200 bg-white text-ink-700 hover:bg-ink-50 hover:text-ink-900',
        variant === 'ghost' && 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
        variant === 'danger' && 'bg-red-600 text-white hover:bg-red-700',
        className,
      )}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
      {children}
    </button>
  );
}

export function Input({
  label,
  hint,
  error,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  error?: string;
}) {
  return (
    <label className="block">
      {label ? (
        <span className="mb-1 block text-xs font-medium text-ink-600">{label}</span>
      ) : null}
      <input
        {...props}
        className={clsx(
          'w-full rounded-md border bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-300',
          'focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500',
          error ? 'border-red-400' : 'border-ink-200',
          className,
        )}
      />
      {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : null}
      {hint && !error ? <span className="mt-1 block text-xs text-ink-400">{hint}</span> : null}
    </label>
  );
}

export function Select({
  label,
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <label className="block">
      {label ? (
        <span className="mb-1 block text-xs font-medium text-ink-600">{label}</span>
      ) : null}
      <select
        {...props}
        className={clsx(
          'w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900',
          'focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500',
          className,
        )}
      >
        {children}
      </select>
    </label>
  );
}

export function Textarea({
  label,
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }) {
  return (
    <label className="block">
      {label ? (
        <span className="mb-1 block text-xs font-medium text-ink-600">{label}</span>
      ) : null}
      <textarea
        {...props}
        className={clsx(
          'w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900',
          'focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500',
          className,
        )}
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Card({
  title,
  description,
  actions,
  className,
  children,
}: {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={clsx('rounded-lg border border-ink-200 bg-white shadow-sm', className)}
    >
      {title || actions ? (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 px-5 py-3.5">
          <div>
            {title ? <h2 className="text-sm font-semibold text-ink-900">{title}</h2> : null}
            {description ? (
              <p className="mt-0.5 text-xs text-ink-500">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">{title}</h1>
        {description ? <p className="mt-1 text-sm text-ink-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  tone = 'neutral',
  hint,
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'good' | 'bad' | 'warn';
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-ink-200 bg-white px-4 py-3">
      <div className="text-xs font-medium text-ink-500">{label}</div>
      <div
        className={clsx(
          'tabular mt-1 text-lg font-semibold',
          tone === 'neutral' && 'text-ink-900',
          tone === 'good' && 'text-accent-600',
          tone === 'bad' && 'text-red-600',
          tone === 'warn' && 'text-amber-600',
        )}
      >
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-xs text-ink-400">{hint}</div> : null}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'good' | 'bad' | 'warn' | 'info';
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
        tone === 'neutral' && 'bg-ink-100 text-ink-600',
        tone === 'good' && 'bg-emerald-50 text-emerald-700',
        tone === 'bad' && 'bg-red-50 text-red-700',
        tone === 'warn' && 'bg-amber-50 text-amber-700',
        tone === 'info' && 'bg-sky-50 text-sky-700',
      )}
    >
      {children}
    </span>
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
  onDismiss,
}: {
  tone?: 'info' | 'good' | 'bad' | 'warn';
  title?: string;
  children?: React.ReactNode;
  onDismiss?: () => void;
}) {
  const Icon =
    tone === 'good' ? CheckCircle2 : tone === 'bad' ? XCircle : tone === 'warn' ? AlertTriangle : Info;

  return (
    <div
      className={clsx(
        'flex items-start gap-2.5 rounded-md border px-3.5 py-2.5 text-sm',
        tone === 'info' && 'border-sky-200 bg-sky-50 text-sky-900',
        tone === 'good' && 'border-emerald-200 bg-emerald-50 text-emerald-900',
        tone === 'bad' && 'border-red-200 bg-red-50 text-red-900',
        tone === 'warn' && 'border-amber-200 bg-amber-50 text-amber-900',
      )}
      role={tone === 'bad' ? 'alert' : 'status'}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        {title ? <div className="font-medium">{title}</div> : null}
        {children ? <div className={clsx(title && 'mt-0.5 text-[13px]')}>{children}</div> : null}
      </div>
      {onDismiss ? (
        <button onClick={onDismiss} aria-label="Dismiss" className="shrink-0 opacity-60 hover:opacity-100">
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-400">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label ?? 'Loading'}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <h3 className="text-sm font-semibold text-ink-800">{title}</h3>
      {description ? <p className="max-w-md text-sm text-ink-500">{description}</p> : null}
      {action}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-900/40 p-4 sm:p-8">
      <div
        className={clsx(
          'w-full rounded-lg border border-ink-200 bg-white shadow-xl',
          wide ? 'max-w-4xl' : 'max-w-lg',
        )}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="flex items-start justify-between gap-4 border-b border-ink-100 px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
            {description ? <p className="mt-0.5 text-xs text-ink-500">{description}</p> : null}
          </div>
          <button onClick={onClose} aria-label="Close" className="text-ink-400 hover:text-ink-700">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

export function Money({
  value,
  blankOnZero = false,
  className,
}: {
  value: number | null | undefined;
  blankOnZero?: boolean;
  className?: string;
}) {
  if (value === null || value === undefined) return <span className={className} />;

  return (
    <span className={clsx('tabular', value < 0 && 'text-red-600', className)}>
      {formatAmount(value, { accounting: true, blankOnZero })}
    </span>
  );
}
