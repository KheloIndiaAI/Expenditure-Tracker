/**
 * Small presentational primitives for the administration screens.
 *
 * Everything resolves through the design tokens (09 §1.4) — white cards, light
 * grey page, one blue accent, soft radius, restrained shadow — so these match
 * the dashboard without redefining any of it.
 */

import type { ReactNode } from 'react';
import * as Icons from 'lucide-react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-md border border-hairline bg-surface shadow-elev-1 ${className}`}>{children}</div>
  );
}

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  disabled,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  className?: string;
}) {
  const base =
    'inline-flex h-9 items-center justify-center gap-2 rounded-sm px-3 text-label font-medium transition-colors disabled:opacity-50';
  const look =
    variant === 'primary'
      ? 'bg-primary text-white hover:bg-primary-hover'
      : variant === 'danger'
        ? 'border border-hairline bg-surface text-status-critical hover:bg-raised'
        : 'border border-hairline bg-surface text-ink-secondary hover:bg-raised hover:text-ink';
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${look} ${className}`}>
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-label font-medium text-ink-secondary">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-caption text-ink-muted">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'h-9 w-full rounded-sm border border-hairline bg-surface px-3 text-body text-ink outline-none ' +
  'placeholder:text-ink-muted transition-colors focus:border-primary disabled:bg-raised disabled:text-ink-muted';

/** A plain ON/OFF switch — no animation beyond the colour and knob transition. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors disabled:opacity-50 ${
        checked ? 'bg-primary' : 'bg-grid'
      }`}
    >
      <span
        className={`absolute top-[3px] h-4 w-4 rounded-full bg-white shadow-elev-1 transition-all ${
          checked ? 'left-[19px]' : 'left-[3px]'
        }`}
      />
    </button>
  );
}

export function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-caption font-medium ${
        active ? 'bg-primary-subtle text-primary-hover' : 'bg-raised text-ink-muted'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-status-good' : 'bg-ink-muted'}`} />
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-ink/30 p-4 py-10"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Card className={`w-full ${wide ? 'max-w-[640px]' : 'max-w-[460px]'} shadow-elev-3`}>
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
          <h2 className="text-h3 text-ink">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-ink-muted hover:text-ink">
            <Icons.X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </Card>
    </div>
  );
}

export function Notice({ kind, children }: { kind: 'error' | 'ok'; children: ReactNode }) {
  const critical = kind === 'error';
  return (
    <div
      role={critical ? 'alert' : 'status'}
      className="flex items-start gap-2 rounded-sm bg-raised p-3 text-label text-ink"
      style={{ borderLeft: `3px solid var(--status-${critical ? 'critical' : 'good'})` }}
    >
      {critical ? (
        <Icons.TriangleAlert className="mt-[1px] h-4 w-4 shrink-0 text-status-critical" strokeWidth={1.5} />
      ) : (
        <Icons.CheckCircle2 className="mt-[1px] h-4 w-4 shrink-0 text-status-good" strokeWidth={1.5} />
      )}
      <span>{children}</span>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-5 py-10 text-center text-body text-ink-muted">{children}</div>;
}
