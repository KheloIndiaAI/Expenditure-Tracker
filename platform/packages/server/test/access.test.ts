/**
 * Tests for the rules that decide who can do what.
 *
 * These cover the guarantees that are easy to break silently later: that an
 * untouched user keeps full access, that a Super Admin cannot be locked out of
 * their own platform, and that a password verifies only against itself.
 *
 * Runs against a throwaway SQLite file so it needs no server and no Postgres.
 * EFIP_DB is set before importing anything that touches the database — the
 * connection is memoised on first use, so the order matters.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ADMIN_ROLES, MODULE_KEYS, RESTRICTED_MODULES, ROLES, can, isRestrictedModule } from '@efip/shared';

const dir = mkdtempSync(join(tmpdir(), 'efip-test-'));
process.env.EFIP_DB = join(dir, 'test.db');
delete process.env.DATABASE_URL; // never let a stray env point these at RDS
process.env.JWT_SECRET ??= 'test-secret-not-used-in-production';

const { hashPassword, verifyPassword, isSuperAdmin } = await import('../src/auth.ts');
const { upsertUser, getModuleAccess, setModuleAccess, findByUsername, updateUser } = await import('../src/users.ts');

after(() => {
  /* Best-effort: node:sqlite keeps the WAL files open for the life of the
     process, and Windows refuses to unlink an open file. The directory is under
     the OS temp root, so leaving it is harmless — failing the suite over
     housekeeping would not be. */
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('passwords', () => {
  it('verifies against its own hash and nothing else', () => {
    const stored = hashPassword('correct horse battery');
    assert.equal(verifyPassword('correct horse battery', stored), true);
    assert.equal(verifyPassword('correct horse batter', stored), false);
    assert.equal(verifyPassword('', stored), false);
  });

  it('salts, so the same password hashes differently every time', () => {
    assert.notEqual(hashPassword('same'), hashPassword('same'));
  });

  it('never stores the plaintext', () => {
    assert.equal(hashPassword('plaintext-should-not-appear').includes('plaintext-should-not-appear'), false);
  });
});

describe('isSuperAdmin', () => {
  it('admits both administrator roles', () => {
    assert.equal(isSuperAdmin({ role: 'super_admin' }), true);
    assert.equal(isSuperAdmin({ role: 'admin' }), true);
  });

  it('admits nobody else', () => {
    for (const role of ROLES) {
      if ((ADMIN_ROLES as readonly string[]).includes(role)) continue;
      assert.equal(isSuperAdmin({ role }), false, `${role} must not reach administration`);
    }
    assert.equal(isSuperAdmin(null), false);
    assert.equal(isSuperAdmin(undefined), false);
  });

  /* The gate and the capability matrix must agree. If a role is ever given
     manage_users without being added to ADMIN_ROLES it would hold the right on
     paper and be refused at the door, which is the kind of contradiction that
     gets worked around rather than fixed. */
  it('agrees with the capability matrix on who may manage users', () => {
    for (const role of ROLES) {
      assert.equal(
        isSuperAdmin({ role }),
        can(role, 'manage_users'),
        `${role}: administration gate and manage_users capability disagree`,
      );
    }
  });
});

describe('module access', () => {
  let plainId = '';
  let superId = '';

  before(async () => {
    plainId = (await upsertUser({ username: 'test_plain', password: 'password123', name: 'Plain', role: 'analyst' })).id;
    superId = (await upsertUser({ username: 'test_super', password: 'password123', name: 'Super', role: 'super_admin' })).id;
  });

  it('grants every ordinary module to a user with no stored decision', async () => {
    const access = await getModuleAccess(plainId, 'analyst');
    for (const k of MODULE_KEYS) {
      if (isRestrictedModule(k)) continue;
      assert.equal(access[k], true, `${k} should be open with no decision stored`);
    }
  });

  /* The whole point of the restricted list: shipping one of these must not hand
     it to every existing login the moment it appears in MODULES. */
  it('withholds a restricted module until it is granted', async () => {
    assert.ok(RESTRICTED_MODULES.length > 0, 'this suite is meaningless with none');
    const access = await getModuleAccess(plainId, 'analyst');
    for (const k of RESTRICTED_MODULES) {
      assert.equal(access[k], false, `${k} must be withheld until granted`);
    }
  });

  it('honours a stored decision', async () => {
    await setModuleAccess(plainId, { command: true, tracker: true, kigroups: false, mdsd: true, rc: true, exceptions: false });
    const access = await getModuleAccess(plainId, 'analyst');
    assert.equal(access.kigroups, false);
    assert.equal(access.exceptions, false);
    assert.equal(access.command, true);
    assert.equal(access.rc, true);
  });

  /* A partial save must not become a back door. Omitting an ordinary key leaves
     it granted (silence is not a denial); omitting a restricted one leaves it
     withheld (silence is not a grant). Same call, opposite readings. */
  it('reads a missing key as granted for an ordinary module and withheld for a restricted one', async () => {
    await setModuleAccess(plainId, { command: true });
    const access = await getModuleAccess(plainId, 'analyst');
    assert.equal(access.tracker, true, 'an unmentioned ordinary module stays granted');
    for (const k of RESTRICTED_MODULES) {
      assert.equal(access[k], false, `${k} must not be granted by omission`);
    }
  });

  it('grants a restricted module when it is explicitly turned on', async () => {
    const patch: Record<string, boolean> = {};
    for (const k of MODULE_KEYS) patch[k] = true;
    await setModuleAccess(plainId, patch as never);
    const access = await getModuleAccess(plainId, 'analyst');
    for (const k of RESTRICTED_MODULES) {
      assert.equal(access[k], true, `${k} must be granted once switched on`);
    }
    /* And revocable again — a grant that cannot be taken back is not a toggle. */
    await setModuleAccess(plainId, { command: true } as never);
    const after = await getModuleAccess(plainId, 'analyst');
    for (const k of RESTRICTED_MODULES) assert.equal(after[k], false, `${k} must be revocable`);
  });

  it('gives an administrator a restricted module without any stored grant', async () => {
    for (const role of ADMIN_ROLES) {
      const access = await getModuleAccess(superId, role);
      for (const k of RESTRICTED_MODULES) {
        assert.equal(access[k], true, `${role} must hold ${k} without being granted it`);
      }
    }
  });

  it('cannot lock an administrator out, even when everything is stored as off', async () => {
    await setModuleAccess(superId, {
      command: false, tracker: false, kigroups: false, mdsd: false, rc: false, exceptions: false,
    });
    /* Both administrator roles, against the same all-off stored rows: the role
       is what grants the modules back, so each has to be asked for separately. */
    for (const role of ADMIN_ROLES) {
      const access = await getModuleAccess(superId, role);
      assert.deepEqual(
        Object.values(access).every(Boolean),
        true,
        `${role} must keep every module`,
      );
    }
  });

  it('replaces the whole set rather than merging, so the UI and store agree', async () => {
    await setModuleAccess(plainId, { command: false });
    const access = await getModuleAccess(plainId, 'analyst');
    assert.equal(access.command, false);
    // Keys omitted by the caller default to allowed, not to their previous value.
    assert.equal(access.kigroups, true);
  });
});

describe('user records', () => {
  it('stores contact details and defaults to active', async () => {
    await upsertUser({
      username: 'test_contact',
      password: 'password123',
      name: 'Contact',
      role: 'director',
      email: 'contact@example.gov.in',
      phone: '+91 90000 00000',
    });
    const row = await findByUsername('test_contact');
    assert.equal(row?.email, 'contact@example.gov.in');
    assert.equal(row?.phone, '+91 90000 00000');
    assert.equal(row?.is_active, true, 'a new user is active unless stated otherwise');
  });

  it('lowercases the username so sign-in is case-insensitive', async () => {
    await upsertUser({ username: 'Test_MixedCase', password: 'password123', name: 'Mixed', role: 'analyst' });
    assert.ok(await findByUsername('test_mixedcase'));
    assert.ok(await findByUsername('TEST_MIXEDCASE'));
  });

  it('does not revive a deactivated account on re-seed', async () => {
    const user = await upsertUser({ username: 'test_off', password: 'password123', name: 'Off', role: 'analyst' });
    await updateUser(user.id, { is_active: false });
    // A re-seed states no is_active, so the administrator's decision must stand.
    await upsertUser({ username: 'test_off', password: 'password123', name: 'Off', role: 'analyst' });
    assert.equal((await findByUsername('test_off'))?.is_active, false);
  });
});
