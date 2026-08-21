/**
 * My Profile — what a user may change about themselves, and nothing more.
 *
 * Name, designation, email and phone are editable. Username, role and module
 * access are shown read-only because they are not the user's to set: the server
 * accepts only those four fields on PATCH /api/me, so a crafted request cannot
 * turn a profile edit into a privilege change.
 */

import { useEffect, useState } from 'react';
import * as Icons from 'lucide-react';
import { MODULES, ROLE_LABELS, type ModuleKey } from '@efip/shared';
import { api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { AdminShell } from '../components/AdminShell.tsx';
import { Button, Card, Field, Notice, inputClass } from '../components/ui.tsx';

export function Profile() {
  const { user, setUser } = useAuth();
  const [form, setForm] = useState({ name: '', designation: '', email: '', phone: '' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) {
      setForm({
        name: user.name ?? '',
        designation: user.designation ?? '',
        email: user.email ?? '',
        phone: user.phone ?? '',
      });
    }
  }, [user]);

  if (!user) return null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setUser(await api.updateProfile(form));
      setNotice('Profile updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your profile.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminShell title="My Profile" subtitle="Your contact details. Role and access are set by an administrator.">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="p-5">
          <form onSubmit={save} className="space-y-3">
            {error && <Notice kind="error">{error}</Notice>}
            {notice && <Notice kind="ok">{notice}</Notice>}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name">
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
              </Field>
              <Field label="Designation">
                <input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} className={inputClass} />
              </Field>
              <Field label="Email ID">
                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} />
              </Field>
              <Field label="Phone Number">
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputClass} />
              </Field>
              <Field label="Username" hint="Your login identifier. Only an administrator can change this.">
                <input disabled value={user.username} className={inputClass} />
              </Field>
              <Field label="Role" hint="Set by an administrator.">
                <input disabled value={ROLE_LABELS[user.role]} className={inputClass} />
              </Field>
            </div>
            <div className="flex justify-end pt-1">
              <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</Button>
            </div>
          </form>
        </Card>

        <div className="space-y-4">
          <ChangePassword />
          <Card className="p-5">
            <h2 className="text-h3 text-ink">Your access</h2>
            <p className="mt-0.5 text-caption text-ink-muted">Read-only. An administrator decides this.</p>
            <ul className="mt-3 space-y-1.5">
              {MODULES.map((m) => {
                const on = user.modules?.[m.key as ModuleKey] ?? true;
                return (
                  <li key={m.key} className="flex items-center justify-between gap-3 text-body">
                    <span className="text-ink-secondary">{m.label}</span>
                    <span className={`text-caption font-semibold ${on ? 'text-primary-hover' : 'text-ink-muted'}`}>
                      {on ? 'ON' : 'OFF'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      </div>
    </AdminShell>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    if (next !== confirm) {
      setError('The two new passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      setNotice('Password changed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change your password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 text-h3 text-ink">
        <Icons.KeyRound className="h-4 w-4 text-ink-muted" strokeWidth={1.6} />
        Change Password
      </h2>
      <form onSubmit={submit} className="mt-3 space-y-3">
        {error && <Notice kind="error">{error}</Notice>}
        {notice && <Notice kind="ok">{notice}</Notice>}
        <Field label="Current password">
          <input required type="password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputClass} />
        </Field>
        <Field label="New password" hint="At least 8 characters.">
          <input required type="password" value={next} onChange={(e) => setNext(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Confirm new password">
          <input required type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
        </Field>
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Saving…' : 'Change password'}
        </Button>
      </form>
    </Card>
  );
}
