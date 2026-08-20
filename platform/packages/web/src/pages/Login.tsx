/**
 * Sign-in. Internal, authenticated, role-based only — there is no public or
 * citizen-facing access in v1 (01 §8 non-goals).
 *
 * Two panels on one card: the Government of India masthead on the left, the
 * credential form on the right, split by a hairline. On narrow screens the
 * divider becomes horizontal and the panels stack.
 *
 * The sizes here are written as explicit values rather than type-scale tokens
 * because this page is a pixel-matched design; colours still resolve through the
 * tokens (09 §1.4), so a re-theme still carries.
 */

import { useState } from 'react';
import * as Icons from 'lucide-react';
import { useAuth } from '../lib/auth.tsx';
import { Emblem } from '../components/Emblem.tsx';

const FIELD =
  'h-[46px] w-full rounded-[6px] border border-hairline bg-surface px-[14px] text-[14px] text-ink ' +
  'placeholder:text-ink-muted outline-none transition-colors focus:border-primary';

export function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-page px-4 py-8">
      <div className="grid w-full max-w-[900px] overflow-hidden rounded-[10px] border border-hairline bg-surface shadow-elev-2 md:grid-cols-2">
        {/* ── Left: Government of India masthead ───────────────────────────── */}
        <div className="border-b border-hairline px-[48px] py-[52px] md:border-b-0 md:border-r">
          <div className="flex items-start gap-[14px]">
            {/* Height drives the size; width follows the emblem's own 0.691 ratio. */}
            <Emblem className="h-[56px] w-auto shrink-0" />
            <div className="pt-[4px]">
              <div className="text-[15px] font-bold leading-[20px] text-ink">Government of India</div>
              <div className="mt-[3px] text-[13px] leading-[18px] text-ink-secondary">
                Ministry of Youth Affairs &amp; Sports
              </div>
            </div>
          </div>

          <h1 className="mt-[44px] text-[36px] font-bold leading-[42px] tracking-[-0.02em] text-ink">
            Khelo India
          </h1>
          <p className="mt-[4px] text-[22px] leading-[30px] text-ink-secondary">Expenditure Tracker</p>
          <span className="mt-[22px] block h-[4px] w-[46px] rounded-full bg-primary" />
        </div>

        {/* ── Right: credentials ───────────────────────────────────────────── */}
        <div className="px-[48px] py-[52px]">
          <h2 className="text-[26px] font-bold leading-[32px] text-ink">Sign in</h2>

          <form onSubmit={submit} className="mt-[30px]">
            <label htmlFor="username" className="mb-[8px] block text-[13px] font-semibold text-ink">
              Username
            </label>
            <input
              id="username"
              type="text"
              required
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="username"
              placeholder="Enter your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={FIELD}
            />

            <label htmlFor="password" className="mb-[8px] mt-[20px] block text-[13px] font-semibold text-ink">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${FIELD} pr-[44px]`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                className="absolute right-[12px] top-1/2 -translate-y-1/2 text-ink-muted transition-colors hover:text-ink-secondary"
              >
                {showPassword ? (
                  <Icons.EyeOff className="h-[18px] w-[18px]" strokeWidth={1.6} />
                ) : (
                  <Icons.Eye className="h-[18px] w-[18px]" strokeWidth={1.6} />
                )}
              </button>
            </div>

            {error && (
              <div
                role="alert"
                className="mt-[16px] flex items-start gap-2 rounded-[6px] bg-raised p-3 text-[13px] text-ink"
                style={{ borderLeft: '3px solid var(--status-critical)' }}
              >
                <Icons.TriangleAlert className="mt-[1px] h-4 w-4 shrink-0 text-status-critical" strokeWidth={1.5} />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="mt-[28px] h-[46px] w-full rounded-[6px] bg-primary text-[15px] font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
