/**
 * Frame for the administration and profile screens.
 *
 * Deliberately plain: a masthead, a short menu and the page. The dashboard is
 * where analysis happens — this is a settings area, so it gets no KPIs, charts
 * or anything else that would imply it is somewhere to look at data.
 *
 * The Administration menu is rendered only for Super Admins, but that is a
 * courtesy, not a control: every route behind it is authorised server-side.
 */

import { NavLink, useLocation } from 'react-router-dom';
import * as Icons from 'lucide-react';
import type { ReactNode } from 'react';
import { isAdminRole } from '@efip/shared';
import { useAuth } from '../lib/auth.tsx';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2.5 rounded-sm px-3 py-2 text-label transition-colors ${
    isActive ? 'bg-primary-subtle font-semibold text-primary-hover' : 'text-ink-secondary hover:bg-raised hover:text-ink'
  }`;

export function AdminShell({ title, subtitle, actions, children }: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { user, logout } = useAuth();
  const isSuper = isAdminRole(user?.role);
  const { pathname } = useLocation();

  return (
    <div className="min-h-full bg-page">
      <header className="border-b border-hairline bg-surface">
        <div className="mx-auto flex max-w-[1180px] items-center gap-3 px-5 py-3">
          <a href="/" className="flex items-center gap-2.5 text-ink hover:text-primary" title="Back to the dashboard">
            <span className="grid h-8 w-8 place-items-center rounded-sm bg-primary text-caption font-bold text-white">
              SAI
            </span>
            <span className="text-label font-semibold">Expenditure Tracker</span>
          </a>
          <span className="ml-auto hidden text-caption text-ink-muted sm:block">
            {user?.name} · {user?.designation || user?.username}
          </span>
          <a
            href="/"
            className="inline-flex h-9 items-center gap-2 rounded-sm border border-hairline px-3 text-label text-ink-secondary hover:bg-raised hover:text-ink"
          >
            <Icons.LayoutDashboard className="h-4 w-4" strokeWidth={1.6} />
            Dashboard
          </a>
          <button
            type="button"
            onClick={() => void logout()}
            className="inline-flex h-9 items-center gap-2 rounded-sm border border-hairline px-3 text-label text-ink-secondary hover:bg-raised hover:text-ink"
          >
            <Icons.LogOut className="h-4 w-4" strokeWidth={1.6} />
            Sign out
          </button>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1180px] gap-6 px-5 py-6">
        <nav className="hidden w-[210px] shrink-0 md:block" aria-label="Settings">
          {isSuper && (
            <>
              <div className="px-3 pb-1.5 text-caption font-semibold uppercase tracking-wide text-ink-muted">
                Administration
              </div>
              <NavLink to="/admin/users" className={linkClass}>
                <Icons.Users className="h-4 w-4" strokeWidth={1.6} />
                User Management
              </NavLink>
              <NavLink to="/admin/access" className={linkClass}>
                <Icons.ShieldCheck className="h-4 w-4" strokeWidth={1.6} />
                Roles &amp; Access
              </NavLink>
            </>
          )}
          <div className="px-3 pb-1.5 pt-4 text-caption font-semibold uppercase tracking-wide text-ink-muted">
            Account
          </div>
          {/* My Profile is a panel of the dashboard, not a screen of this SPA, so
              this is a real navigation rather than a client-side route. */}
          <a href="/?panel=profile" className={linkClass({ isActive: false })}>
            <Icons.UserRound className="h-4 w-4" strokeWidth={1.6} />
            My Profile
          </a>
        </nav>

        <main className="min-w-0 flex-1">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-h2 text-ink">{title}</h1>
              {subtitle && <p className="mt-0.5 text-body text-ink-secondary">{subtitle}</p>}
            </div>
            {actions}
          </div>
          {/* Menu collapses on small screens; these keep both areas reachable. */}
          <div className="mb-4 flex gap-2 md:hidden">
            {isSuper && (
              <>
                <NavLink to="/admin/users" className={linkClass}>
                  Users
                </NavLink>
                <NavLink to="/admin/access" className={linkClass}>
                  Access
                </NavLink>
              </>
            )}
            <a href="/?panel=profile" className={linkClass({ isActive: false })}>
              Profile
            </a>
          </div>
          <div key={pathname}>{children}</div>
        </main>
      </div>
    </div>
  );
}
