/**
 * User Management — the Super Admin's list of every login on the platform.
 *
 * Nothing here decides permission. Each action calls an endpoint that re-checks
 * the caller's role server-side, so the worst a tampered client can do is show
 * buttons that then fail with 403.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Icons from 'lucide-react';
import { ROLES, ROLE_LABELS, type Role } from '@efip/shared';
import { api, type AdminUser, type NewUserInput } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { AdminShell } from '../components/AdminShell.tsx';
import { Button, Card, Empty, Field, Modal, Notice, StatusPill, inputClass } from '../components/ui.tsx';

type Draft = NewUserInput & { id?: string };

const BLANK: Draft = {
  username: '',
  name: '',
  designation: '',
  email: '',
  phone: '',
  role: 'analyst',
  password: '',
  is_active: true,
};

export function AdminUsers() {
  const { user: me } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pwFor, setPwFor] = useState<AdminUser | null>(null);
  const [query, setQuery] = useState('');

  const load = async () => {
    try {
      setUsers(await api.listUsers());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load users.');
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!users || !q) return users ?? [];
    return users.filter((u) =>
      [u.name, u.username, u.email, u.phone, u.designation, ROLE_LABELS[u.role]]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [users, query]);

  const toggleActive = async (u: AdminUser) => {
    setError(null);
    try {
      await api.editUser(u.id, { is_active: !u.is_active });
      setNotice(`${u.name} is now ${u.is_active ? 'inactive' : 'active'}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the user.');
    }
  };

  return (
    <AdminShell
      title="User Management"
      subtitle="Every login on the platform. Roles decide capability; access decides which panels open."
      actions={
        <Button onClick={() => setDraft({ ...BLANK })}>
          <Icons.Plus className="h-4 w-4" strokeWidth={2} /> Add User
        </Button>
      }
    >
      {error && (
        <div className="mb-3">
          <Notice kind="error">{error}</Notice>
        </div>
      )}
      {notice && (
        <div className="mb-3">
          <Notice kind="ok">{notice}</Notice>
        </div>
      )}

      <Card>
        <div className="flex items-center gap-2 border-b border-hairline px-4 py-3">
          <Icons.Search className="h-4 w-4 text-ink-muted" strokeWidth={2} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name, username, email, phone or role"
            className="w-full border-0 bg-transparent text-body text-ink outline-none placeholder:text-ink-muted"
          />
          <span className="shrink-0 text-caption text-ink-muted">{shown.length} of {users?.length ?? 0}</span>
        </div>

        {users === null ? (
          <Empty>Loading…</Empty>
        ) : shown.length === 0 ? (
          <Empty>No users match that filter.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] border-collapse text-body">
              <thead>
                <tr className="border-b border-hairline text-left text-label text-ink-muted">
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Designation</th>
                  <th className="px-4 py-2.5 font-medium">Email</th>
                  <th className="px-4 py-2.5 font-medium">Phone</th>
                  <th className="px-4 py-2.5 font-medium">Role</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((u) => (
                  <tr key={u.id} className="border-b border-hairline last:border-0 hover:bg-raised">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-ink">{u.name}</div>
                      <div className="text-caption text-ink-muted">{u.username}</div>
                    </td>
                    <td className="px-4 py-2.5 text-ink-secondary">{u.designation || '—'}</td>
                    <td className="px-4 py-2.5 text-ink-secondary">{u.email || '—'}</td>
                    <td className="px-4 py-2.5 text-ink-secondary tabular">{u.phone || '—'}</td>
                    <td className="px-4 py-2.5 text-ink-secondary">{ROLE_LABELS[u.role]}</td>
                    <td className="px-4 py-2.5">
                      <StatusPill active={u.is_active} />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        <IconAction label="Edit user" icon={<Icons.Pencil className="h-4 w-4" strokeWidth={1.6} />}
                          onClick={() => setDraft({ ...BLANK, ...u, password: '' })} />
                        <IconAction label="Manage access" icon={<Icons.ShieldCheck className="h-4 w-4" strokeWidth={1.6} />}
                          onClick={() => navigate(`/admin/access?user=${u.id}`)} />
                        <IconAction label="Change password" icon={<Icons.KeyRound className="h-4 w-4" strokeWidth={1.6} />}
                          onClick={() => setPwFor(u)} />
                        <IconAction
                          label={u.is_active ? 'Deactivate' : 'Activate'}
                          disabled={u.id === me?.id}
                          title={u.id === me?.id ? 'You cannot deactivate your own account' : undefined}
                          icon={u.is_active
                            ? <Icons.UserMinus className="h-4 w-4" strokeWidth={1.6} />
                            : <Icons.UserCheck className="h-4 w-4" strokeWidth={1.6} />}
                          onClick={() => void toggleActive(u)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {draft && (
        <UserForm
          draft={draft}
          isSelf={draft.id === me?.id}
          onClose={() => setDraft(null)}
          onSaved={async (msg) => {
            setDraft(null);
            setNotice(msg);
            setError(null);
            await load();
          }}
        />
      )}

      {pwFor && (
        <PasswordForm
          user={pwFor}
          onClose={() => setPwFor(null)}
          onSaved={(msg) => {
            setPwFor(null);
            setNotice(msg);
          }}
        />
      )}
    </AdminShell>
  );
}

function IconAction({ label, icon, onClick, disabled, title }: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title ?? label}
      className="grid h-8 w-8 place-items-center rounded-sm border border-hairline bg-surface text-ink-secondary transition-colors hover:border-primary hover:text-primary disabled:opacity-40 disabled:hover:border-hairline disabled:hover:text-ink-secondary"
    >
      {icon}
    </button>
  );
}

function UserForm({ draft, isSelf, onClose, onSaved }: {
  draft: Draft;
  isSelf: boolean;
  onClose: () => void;
  onSaved: (message: string) => void | Promise<void>;
}) {
  const [form, setForm] = useState<Draft>(draft);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editing = Boolean(form.id);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await api.editUser(form.id as string, {
          name: form.name,
          designation: form.designation,
          email: form.email,
          phone: form.phone,
          role: form.role,
          is_active: form.is_active,
        });
        await onSaved(`${form.name} updated.`);
      } else {
        await api.createUser(form);
        await onSaved(`${form.name} created.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the user.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={editing ? 'Edit User' : 'Add User'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-3">
        {error && <Notice kind="error">{error}</Notice>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <input required value={form.name} onChange={(e) => set('name', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Designation">
            <input value={form.designation ?? ''} onChange={(e) => set('designation', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Email ID">
            <input type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Phone Number">
            <input value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Username" hint={editing ? 'The login identifier cannot be changed.' : 'Used to sign in, e.g. RC_Kolkata.'}>
            <input
              required
              disabled={editing}
              value={form.username}
              onChange={(e) => set('username', e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Role" hint={isSelf ? 'You cannot change your own role.' : undefined}>
            <select
              value={form.role}
              disabled={isSelf}
              onChange={(e) => set('role', e.target.value as Role)}
              className={inputClass}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </Field>
          {!editing && (
            <Field label="Password" hint="At least 8 characters. Stored only as a scrypt hash.">
              <input
                required
                type="password"
                value={form.password}
                onChange={(e) => set('password', e.target.value)}
                className={inputClass}
              />
            </Field>
          )}
        </div>

        <label className="flex items-center gap-2 pt-1 text-body text-ink">
          <input
            type="checkbox"
            checked={form.is_active !== false}
            disabled={isSelf}
            onChange={(e) => set('is_active', e.target.checked)}
            className="h-4 w-4 accent-[var(--primary)]"
          />
          Active
          {isSelf && <span className="text-caption text-ink-muted">— you cannot deactivate your own account</span>}
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create user'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function PasswordForm({ user, onClose, onSaved }: {
  user: AdminUser;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.setUserPassword(user.id, next);
      onSaved(`Password changed for ${user.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Change password · ${user.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {error && <Notice kind="error">{error}</Notice>}
        <Field label="New password" hint="At least 8 characters.">
          <input required type="password" value={next} onChange={(e) => setNext(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Confirm new password">
          <input required type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</Button>
        </div>
      </form>
    </Modal>
  );
}
