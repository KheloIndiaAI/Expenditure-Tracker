/**
 * Application shell — left navigation + top bar.
 *
 * 04 §1: navigation is application-based, never worksheet-based; it collapses to
 * icons on narrow viewports; the active page, the current version
 * ("Data as of v7 · 26 May 2026") and the signed-in role are always visible.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as Icons from 'lucide-react';
import { ROLE_LABELS, formatDate } from '@efip/shared';
import { api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { NAV } from '../nav.ts';
import { CommandPalette } from './CommandPalette.tsx';

function Icon({ name, className }: { name: string; className?: string }) {
  const C = (Icons as unknown as Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>>)[name];
  if (!C) return null;
  // 09 §12 — one line-icon set, 1.5px stroke, 20px default.
  return <C className={className ?? 'h-5 w-5'} strokeWidth={1.5} />;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout, can } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => (localStorage.getItem('efip.theme') as 'light' | 'dark') ?? 'light',
  );

  const { data: versions } = useQuery({ queryKey: ['versions'], queryFn: api.versions });
  const current = versions?.find((v) => v.is_current);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('efip.theme', theme);
  }, [theme]);

  // FR-EX-09 — ⌘K / Ctrl-K opens universal search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
      if (e.key === 'Escape') setPaletteOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-full bg-page">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-sm focus:bg-surface focus:px-3 focus:py-2 focus:shadow-elev-2"
      >
        Skip to content
      </a>

      {/* ── Left navigation ───────────────────────────────────────────── */}
      <nav
        aria-label="Primary"
        className={`${collapsed ? 'w-[64px]' : 'w-[264px]'} shrink-0 border-r border-hairline bg-surface transition-[width] duration-200 hidden md:flex md:flex-col`}
      >
        <div className="flex h-[60px] items-center gap-3 border-b border-hairline px-4">
          <div
            className="grid h-8 w-8 shrink-0 place-items-center rounded-sm bg-primary text-white"
            aria-hidden
          >
            <Icons.IndianRupee className="h-[18px] w-[18px]" strokeWidth={2} />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate text-label font-semibold text-ink">Sports Authority of India</div>
              <div className="truncate text-caption text-ink-muted">Financial Intelligence</div>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-3">
          {NAV.map((group) => {
            const items = group.items.filter((i) => !i.capability || can(i.capability));
            if (!items.length) return null;
            return (
              <div key={group.title ?? 'root'} className="mb-4">
                {group.title && !collapsed && (
                  <div className="px-3 pb-2 pt-1 text-caption font-medium uppercase tracking-wide text-ink-muted">
                    {group.title}
                  </div>
                )}
                {group.title && collapsed && <div className="mx-3 mb-2 border-t border-hairline" />}
                <ul className="space-y-[2px]">
                  {items.map((item) => (
                    <li key={item.path}>
                      <NavLink
                        to={item.path}
                        end={item.path === '/'}
                        title={collapsed ? item.label : undefined}
                        className={({ isActive }) =>
                          [
                            'flex items-center gap-3 rounded-sm px-3 py-2 text-label transition-colors',
                            isActive
                              ? 'bg-primary-subtle font-semibold text-primary'
                              : 'text-ink-secondary hover:bg-raised hover:text-ink',
                          ].join(' ')
                        }
                      >
                        <span className="shrink-0">
                          <Icon name={item.icon} />
                        </span>
                        {!collapsed && <span className="truncate">{item.label}</span>}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-3 border-t border-hairline px-4 py-3 text-label text-ink-muted hover:text-ink"
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        >
          <Icons.PanelLeft className="h-5 w-5 shrink-0" strokeWidth={1.5} />
          {!collapsed && <span>Collapse</span>}
        </button>
      </nav>

      {/* ── Main column ───────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[60px] shrink-0 items-center gap-4 border-b border-hairline bg-surface px-5">
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex h-9 min-w-0 flex-1 max-w-[420px] items-center gap-2 rounded-sm border border-hairline bg-raised px-3 text-label text-ink-muted transition-colors hover:border-primary hover:text-ink"
            aria-label="Open universal search"
          >
            <Icons.Search className="h-4 w-4 shrink-0" strokeWidth={1.5} />
            <span className="truncate">Search centres, grantees, vouchers, sanctions…</span>
            <kbd className="ml-auto hidden shrink-0 rounded-[4px] border border-hairline bg-surface px-1.5 py-0.5 text-caption text-ink-muted sm:block">
              ⌘K
            </kbd>
          </button>

          <div className="ml-auto flex items-center gap-4">
            {/* Every screen states which version it is serving (02 §7). */}
            <div className="hidden text-right lg:block">
              <div className="text-caption text-ink-muted">Data as of</div>
              <div className="text-label font-medium text-ink tabular">
                {current ? `${current.label} · ${formatDate(current.published_at)}` : 'No published version'}
              </div>
            </div>

            <button
              onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
              className="grid h-9 w-9 place-items-center rounded-sm text-ink-muted hover:bg-raised hover:text-ink"
              aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
            >
              {theme === 'light' ? (
                <Icons.Moon className="h-[18px] w-[18px]" strokeWidth={1.5} />
              ) : (
                <Icons.Sun className="h-[18px] w-[18px]" strokeWidth={1.5} />
              )}
            </button>

            <div className="flex items-center gap-3 border-l border-hairline pl-4">
              <div className="hidden text-right sm:block">
                <div className="text-label font-medium text-ink">{user?.name}</div>
                <div className="text-caption text-ink-muted">{user ? ROLE_LABELS[user.role] : ''}</div>
              </div>
              <button
                onClick={logout}
                className="grid h-9 w-9 place-items-center rounded-sm text-ink-muted hover:bg-raised hover:text-ink"
                aria-label="Sign out"
                title="Sign out"
              >
                <Icons.LogOut className="h-[18px] w-[18px]" strokeWidth={1.5} />
              </button>
            </div>
          </div>
        </header>

        <main id="main" className="min-w-0 flex-1 overflow-y-auto" key={location.pathname}>
          <div className="mx-auto max-w-container px-5 py-6">{children}</div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
