/**
 * The four data-region states — implements PRD `04_Dashboard_UI.md §6`.
 *
 * "Every data region specifies four states: loading (skeleton, never a
 * spinner-only blank), empty (explains why and what to do), error (actionable,
 * preserves last-good), and populated. No screen ever shows a raw error or a
 * silent blank."
 */

import type { ReactNode } from 'react';
import * as Icons from 'lucide-react';

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function PageSkeleton() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading page">
      <div className="space-y-2">
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[104px] w-full rounded-md" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-[320px] rounded-md lg:col-span-2" />
        <Skeleton className="h-[320px] rounded-md" />
      </div>
    </div>
  );
}

export function CardSkeleton({ height = 280 }: { height?: number }) {
  return <Skeleton className="w-full rounded-md" />;
}

export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="Loading table">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

/** Empty state — explains WHY it is empty and what to do next (04 §6). */
export function EmptyState({
  title,
  description,
  action,
  icon = 'Inbox',
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: string;
}) {
  const C = (Icons as unknown as Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>>)[icon];
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-hairline bg-raised px-6 py-10 text-center">
      {C && <C className="mb-3 h-6 w-6 text-ink-muted" strokeWidth={1.5} />}
      <div className="text-h3 text-ink">{title}</div>
      <p className="mt-1 max-w-[52ch] text-body text-ink-secondary">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * Error state — actionable, and explicit that the previously published version
 * keeps serving (06 VR-FAIL-02). Never renders a raw stack trace.
 */
export function ErrorState({
  title = 'This view could not be loaded',
  error,
  onRetry,
}: {
  title?: string;
  error?: unknown;
  onRetry?: () => void;
}) {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'An unexpected error occurred.';
  return (
    <div
      role="alert"
      className="rounded-md border border-hairline bg-surface p-5"
      style={{ borderLeft: '3px solid var(--status-critical)' }}
    >
      <div className="flex items-start gap-3">
        <Icons.TriangleAlert className="mt-[2px] h-5 w-5 shrink-0 text-status-critical" strokeWidth={1.5} />
        <div className="min-w-0">
          <div className="text-h3 text-ink">{title}</div>
          <p className="mt-1 text-body text-ink-secondary">{message}</p>
          <p className="mt-2 text-caption text-ink-muted">
            The last successfully validated dataset remains live — no figure on screen has been replaced by an
            unvalidated one.
          </p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="mt-3 h-9 rounded-sm border border-hairline px-3 text-label text-ink hover:bg-raised"
            >
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Wraps a data region so every one of the four states is handled explicitly.
 * Pages should not hand-roll their own loading/empty/error branches.
 */
export function DataRegion<T>({
  query,
  skeleton,
  empty,
  children,
}: {
  query: { data: T | undefined; isLoading: boolean; isError: boolean; error: unknown; refetch?: () => void };
  skeleton?: ReactNode;
  empty?: { when: (data: T) => boolean; title: string; description: string; icon?: string };
  children: (data: T) => ReactNode;
}) {
  if (query.isLoading) return <>{skeleton ?? <CardSkeleton />}</>;
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;
  if (query.data === undefined) return <ErrorState error="No data was returned." onRetry={query.refetch} />;
  if (empty && empty.when(query.data)) {
    return <EmptyState title={empty.title} description={empty.description} icon={empty.icon} />;
  }
  return <>{children(query.data)}</>;
}
