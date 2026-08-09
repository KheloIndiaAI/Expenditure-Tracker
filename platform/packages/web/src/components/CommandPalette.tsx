/**
 * Universal search / command palette — implements `05 §5` (FR-SRCH) and the
 * ⌘K keyboard-first requirement in `09 §7`.
 *
 * FR-SRCH-02: results are grouped by entity type; selecting a result navigates
 * AND filters the platform to it (Flow F in `08`).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as Icons from 'lucide-react';
import { formatINR } from '@efip/shared';
import type { SearchHit } from '@efip/shared';
import { api, encodeFilters } from '../lib/api.ts';

const GROUP_ICON: Record<string, string> = {
  regional_centre: 'Building2',
  grantee: 'Users',
  transaction: 'Receipt',
  sub_category: 'Tags',
  subvertical: 'GitBranch',
  head: 'Layers',
  sanction: 'FileText',
};

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Debounce so keystrokes do not each cost a request; NFR-3 targets < 300 ms.
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 120);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isFetching } = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.search(debounced),
    enabled: open && debounced.length >= 2,
  });

  const flat = useMemo<SearchHit[]>(() => (data?.groups ?? []).flatMap((g) => g.hits), [data]);

  useEffect(() => {
    setActive(0);
  }, [flat.length]);

  if (!open) return null;

  const go = (hit: SearchHit) => {
    const f = encodeFilters(hit.drill.filters);
    navigate(`${hit.drill.page}${f ? `?f=${encodeURIComponent(f)}` : ''}`);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && flat[active]) {
      e.preventDefault();
      go(flat[active]);
    }
  };

  let index = -1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 px-4 pt-[12vh]"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Universal search"
        className="w-full max-w-[640px] overflow-hidden rounded-lg border border-hairline bg-surface shadow-elev-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-hairline px-4">
          <Icons.Search className="h-[18px] w-[18px] shrink-0 text-ink-muted" strokeWidth={1.5} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search a centre, grantee, sanction number, voucher or narration…"
            className="h-[52px] w-full bg-transparent text-body text-ink outline-none placeholder:text-ink-muted"
            aria-label="Search query"
            autoComplete="off"
          />
          {isFetching && <div className="skeleton h-1 w-8 shrink-0" aria-label="Searching" />}
          <kbd className="shrink-0 rounded-[4px] border border-hairline px-1.5 py-0.5 text-caption text-ink-muted">
            esc
          </kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-2">
          {debounced.length < 2 && (
            <p className="px-3 py-6 text-center text-body text-ink-muted">
              Type at least two characters. Try “Kolkata”, “KITD/12”, “Gopichand” or “marathon”.
            </p>
          )}

          {debounced.length >= 2 && !isFetching && flat.length === 0 && (
            <p className="px-3 py-6 text-center text-body text-ink-muted">
              No matches for “{debounced}” in the published version.
            </p>
          )}

          {(data?.groups ?? []).map((group) => (
            <div key={group.entity_type} className="mb-2">
              <div className="px-3 py-1 text-caption font-medium uppercase tracking-wide text-ink-muted">
                {group.label}
              </div>
              <ul>
                {group.hits.map((hit) => {
                  index += 1;
                  const isActive = index === active;
                  const IconC = (Icons as unknown as Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>>)[
                    GROUP_ICON[hit.entity_type] ?? 'CornerDownRight'
                  ];
                  return (
                    <li key={`${hit.entity_type}:${hit.key}`}>
                      <button
                        onClick={() => go(hit)}
                        onMouseEnter={() => setActive(index)}
                        className={`flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left ${
                          isActive ? 'bg-primary-subtle' : 'hover:bg-raised'
                        }`}
                      >
                        {IconC && <IconC className="h-4 w-4 shrink-0 text-ink-muted" strokeWidth={1.5} />}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-label font-medium text-ink">{hit.label}</span>
                          <span className="block truncate text-caption text-ink-muted">{hit.sublabel}</span>
                        </span>
                        {hit.amount !== null && (
                          <span className="shrink-0 text-label text-ink-secondary tabular">
                            {formatINR(hit.amount)}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        {data && (
          <div className="border-t border-hairline px-4 py-2 text-caption text-ink-muted">
            {flat.length} result{flat.length === 1 ? '' : 's'} in {data.took_ms} ms · ↑↓ to navigate · ↵ to open
          </div>
        )}
      </div>
    </div>
  );
}
