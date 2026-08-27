/**
 * App root.
 *
 * This bundle is the sign-in page, and only that.
 *
 * It used to carry three more surfaces. My Profile went first, then User
 * Management and Roles & Access, and all of them for the same reason: they are
 * things you do *while working in the platform*, and sending someone out to a
 * separate application to do them meant losing the sidebar, the search and the
 * live sync status, then coming back through a full page load. They are panels
 * of the dashboard now — see the ADMINISTRATION group in `public/index.html`.
 *
 * The old paths still exist; the server redirects each to the panel that
 * replaced it, so bookmarks and saved links keep working.
 *
 * The dashboard remains the self-contained, Google-Sheets-synced HTML the server
 * hands out at "/" once a session cookie exists, so this SPA never renders
 * financial data.
 */

import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Login } from './pages/Login.tsx';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        {/* Anything else served by this bundle is a sign-in page. The server
            redirects /admin/* and /profile before they ever reach the router. */}
        <Route path="*" element={<Login />} />
      </Routes>
    </BrowserRouter>
  );
}
