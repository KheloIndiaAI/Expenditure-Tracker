/**
 * Sign-in. Internal, authenticated, role-based only — there is no public or
 * citizen-facing access in v1 (01 §8 non-goals).
 */

import { useState } from 'react';
import * as Icons from 'lucide-react';
import { useAuth } from '../lib/auth.tsx';

const DEMO_ACCOUNTS = [
  { email: 'js@sai.gov.in', label: 'Joint Secretary', note: 'exec view + exceptions' },
  { email: 'finance@sai.gov.in', label: 'Finance Officer', note: 'maker — upload + validate' },
  { email: 'checker@sai.gov.in', label: 'Senior Finance', note: 'checker — approve, publish, rollback' },
  { email: 'auditor@sai.gov.in', label: 'Auditor', note: 'full audit trail' },
];

export function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('js@sai.gov.in');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-page px-4 py-8">
      <div className="w-full max-w-[880px] overflow-hidden rounded-lg border border-hairline bg-surface shadow-elev-2 md:grid md:grid-cols-2">
        {/* Left: identity */}
        <div className="flex flex-col justify-between gap-6 border-b border-hairline p-7 md:border-b-0 md:border-r">
          <div>
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-sm bg-primary text-white">
                <Icons.IndianRupee className="h-5 w-5" strokeWidth={2} />
              </div>
              <div>
                <div className="text-label font-semibold text-ink">Sports Authority of India</div>
                <div className="text-caption text-ink-muted">Ministry of Youth Affairs &amp; Sports</div>
              </div>
            </div>
            <h1 className="mt-6 text-h1 text-ink">Executive Financial Intelligence</h1>
            <p className="mt-2 text-body text-ink-secondary">
              Monitor, validate and trace Khelo India Scheme expenditure — from the executive summary down to an
              individual voucher.
            </p>
          </div>
          <dl className="grid grid-cols-3 gap-3 border-t border-hairline pt-5">
            <div>
              <dt className="text-caption text-ink-muted">Scheme</dt>
              <dd className="text-label font-medium text-ink">Khelo India</dd>
            </div>
            <div>
              <dt className="text-caption text-ink-muted">Financial year</dt>
              <dd className="text-label font-medium text-ink tabular">2026–27</dd>
            </div>
            <div>
              <dt className="text-caption text-ink-muted">Centres</dt>
              <dd className="text-label font-medium text-ink tabular">13</dd>
            </div>
          </dl>
        </div>

        {/* Right: form */}
        <div className="p-7">
          <h2 className="text-h2 text-ink">Sign in</h2>
          <p className="mt-1 text-body text-ink-secondary">Access is role-based and every action is audited.</p>

          <form onSubmit={submit} className="mt-5 space-y-4">
            <div>
              <label htmlFor="email" className="mb-1 block text-label text-ink-secondary">
                Official email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-9 w-full rounded-sm border border-hairline bg-surface px-3 text-body text-ink outline-none focus:border-primary"
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-1 block text-label text-ink-secondary">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-9 w-full rounded-sm border border-hairline bg-surface px-3 text-body text-ink outline-none focus:border-primary"
              />
            </div>

            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-sm bg-raised p-3 text-label text-ink"
                style={{ borderLeft: '3px solid var(--status-critical)' }}
              >
                <Icons.TriangleAlert className="mt-[1px] h-4 w-4 shrink-0 text-status-critical" strokeWidth={1.5} />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="h-9 w-full rounded-sm bg-primary text-label font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="mt-6 border-t border-hairline pt-4">
            <div className="mb-2 text-caption font-medium uppercase tracking-wide text-ink-muted">
              Demonstration accounts
            </div>
            <ul className="space-y-1">
              {DEMO_ACCOUNTS.map((a) => (
                <li key={a.email}>
                  <button
                    type="button"
                    onClick={() => {
                      setEmail(a.email);
                      setPassword('khelo2026');
                    }}
                    className="flex w-full items-baseline gap-2 rounded-sm px-2 py-1 text-left hover:bg-raised"
                  >
                    <span className="text-label font-medium text-ink">{a.label}</span>
                    <span className="truncate text-caption text-ink-muted">{a.note}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-caption text-ink-muted">
              Seeded development credentials — password <code className="text-ink-secondary">khelo2026</code>. Replace
              before any production deployment.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
