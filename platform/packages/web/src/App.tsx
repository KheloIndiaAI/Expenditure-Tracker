/**
 * App root.
 *
 * One bundle serves two surfaces: the sign-in page and the Super Admin area.
 * My Profile used to be a third; it is a panel of the dashboard now, so a user
 * changing their phone number never leaves the product they were using.
 * The dashboard is still the self-contained,
 * Google-Sheets-synced HTML that the server hands out at "/" once a session
 * cookie exists, so this SPA never renders financial data.
 *
 * The route guards below decide what to *render*. They are not the security
 * boundary — every admin endpoint re-checks the caller's role server-side, so a
 * user who edits their client state gets a 403, not data.
 */

import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { isAdminRole } from '@efip/shared';
import { Login } from './pages/Login.tsx';
import { AdminUsers } from './pages/AdminUsers.tsx';
import { AdminAccess } from './pages/AdminAccess.tsx';
import { useAuth } from './lib/auth.tsx';

/** Blocks the first paint until `me` has resolved, so guards never flash. */
function Gate({ children, superOnly }: { children: React.ReactNode; superOnly?: boolean }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="grid min-h-full place-items-center bg-page text-body text-ink-muted">Loading…</div>;
  if (!user) {
    window.location.href = '/login';
    return null;
  }
  if (superOnly && !isAdminRole(user.role)) {
    /* Nothing in this bundle is theirs to see. My Profile is a dashboard panel
       now, so the only sensible destination is the dashboard itself. */
    window.location.href = '/?panel=profile';
    return null;
  }
  return <>{children}</>;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/admin" element={<Navigate to="/admin/users" replace />} />
        <Route
          path="/admin/users"
          element={
            <Gate superOnly>
              <AdminUsers />
            </Gate>
          }
        />
        <Route
          path="/admin/access"
          element={
            <Gate superOnly>
              <AdminAccess />
            </Gate>
          }
        />
        <Route path="*" element={<Login />} />
      </Routes>
    </BrowserRouter>
  );
}
