/**
 * Roles & Access — which dashboard panels a given user may open.
 *
 * The toggles write to `user_module_access`; the dashboard then asks the server
 * what the signed-in user may see. Turning a module off here removes it for that
 * user on their next request, not merely from their menu.
 *
 * Administrators are shown read-only at full access, matching what the server
 * will always return for them — the platform must not be administrable into a
 * state where nobody can reach Administration. Leaving their toggles editable
 * would be worse than useless: it would accept a decision the server discards.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as Icons from 'lucide-react';
import { MODULES, ROLE_LABELS, isAdminRole, type ModuleAccess, type ModuleKey } from '@efip/shared';
import { api, type AdminUser } from '../lib/api.ts';
import { AdminShell } from '../components/AdminShell.tsx';
import { Button, Card, Empty, Notice, StatusPill, Toggle, inputClass } from '../components/ui.tsx';

export function AdminAccess() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('user') ?? '';
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [access, setAccess] = useState<ModuleAccess | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listUsers().then(setUsers).catch((e) => setError(e instanceof Error ? e.message : 'Could not load users.'));
  }, []);

  useEffect(() => {
    setAccess(null);
    setDirty(false);
    setNotice(null);
    if (!selectedId) return;
    api
      .getAccess(selectedId)
      .then(setAccess)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load access.'));
  }, [selectedId]);

  const selected = users?.find((u) => u.id === selectedId) ?? null;
  const locked = isAdminRole(selected?.role ?? null);

  const save = async () => {
    if (!selected || !access) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await api.setAccess(selected.id, access);
      setAccess(saved);
      setDirty(false);
      setNotice(`Access saved for ${selected.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save access.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminShell title="Roles & Access" subtitle="Choose a user, then switch each panel on or off.">
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

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <label className="text-label font-medium text-ink-secondary" htmlFor="userSel">
            User
          </label>
          <select
            id="userSel"
            value={selectedId}
            onChange={(e) => setParams(e.target.value ? { user: e.target.value } : {})}
            className={`${inputClass} max-w-[360px]`}
          >
            <option value="">Select a user…</option>
            {(users ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} · {u.username} · {ROLE_LABELS[u.role]}
              </option>
            ))}
          </select>
          {selected && <StatusPill active={selected.is_active} />}
        </div>
      </Card>

      {!selectedId ? (
        <Card>
          <Empty>Select a user to review what they can open.</Empty>
        </Card>
      ) : !access ? (
        <Card>
          <Empty>Loading…</Empty>
        </Card>
      ) : (
        <Card>
          {locked && (
            <div className="border-b border-hairline px-4 py-3">
              <Notice kind="ok">
                {selected ? ROLE_LABELS[selected.role] : 'This user'} {selected?.name} always has every module. Change
                their role first if this should not be the case.
              </Notice>
            </div>
          )}
          <ul>
            {MODULES.map((m) => (
              <li
                key={m.key}
                className="flex items-center justify-between gap-4 border-b border-hairline px-4 py-3 last:border-0"
              >
                <span className="text-body text-ink">{m.label}</span>
                <div className="flex items-center gap-3">
                  <span className={`text-caption font-medium ${access[m.key as ModuleKey] ? 'text-primary-hover' : 'text-ink-muted'}`}>
                    {access[m.key as ModuleKey] ? 'ON' : 'OFF'}
                  </span>
                  <Toggle
                    label={m.label}
                    disabled={locked}
                    checked={access[m.key as ModuleKey]}
                    onChange={(next) => {
                      setAccess({ ...access, [m.key]: next });
                      setDirty(true);
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-3 border-t border-hairline px-4 py-3">
            <span className="text-caption text-ink-muted">
              {dirty ? 'Unsaved changes.' : 'Applies on the user’s next request.'}
            </span>
            <Button onClick={() => void save()} disabled={!dirty || busy || locked}>
              <Icons.Check className="h-4 w-4" strokeWidth={2} />
              {busy ? 'Saving…' : 'Save access'}
            </Button>
          </div>
        </Card>
      )}
    </AdminShell>
  );
}
