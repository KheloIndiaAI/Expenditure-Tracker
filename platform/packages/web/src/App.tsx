/**
 * App root.
 *
 * This build is intentionally the login surface only. The dashboard is the
 * self-contained, Google-Sheets-synced HTML served by the server at "/" once a
 * session cookie exists, so the SPA's whole job is to authenticate and hand off.
 */

import { Login } from './pages/Login.tsx';

export function App() {
  return <Login />;
}
