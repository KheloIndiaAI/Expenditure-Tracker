/**
 * Make sure the platform has an administrator, promoting or creating one.
 *
 * Idempotent and safe to re-run:
 *   npm run seed:super -w @efip/server
 *
 * The account defaults to MYAS_OSD, the Officer on Special Duty login. If that
 * user already exists — as it will on any environment seeded from
 * `seed/rc_users.csv` — this only raises its role and makes sure it is active,
 * leaving the name, designation and existing password untouched. A password is
 * required only when the account has to be created from nothing, which keeps the
 * common case (promote an existing login) free of any secret handling.
 *
 * An account that already holds EITHER administrator role is left at the rank it
 * has. This is a recovery tool for "nobody can administer the platform", and an
 * Administrator is not that: rewriting a deliberate Administrator back to Super
 * Administrator on a routine re-run would undo a choice somebody made on
 * purpose, silently, and this script is run precisely when things are confusing.
 */

import { ROLE_LABELS, isAdminRole } from '@efip/shared';
import { findByUsername, countUsers, updateUser, upsertUser } from '../users.ts';

const username = process.env.SUPER_ADMIN_USERNAME || 'MYAS_OSD';
const password = process.env.SUPER_ADMIN_PASSWORD || '';

const existing = await findByUsername(username);

if (existing) {
  if (isAdminRole(existing.role) && existing.is_active) {
    console.log(`✓ "${username}" is already ${ROLE_LABELS[existing.role]}. Nothing to do.`);
  } else if (isAdminRole(existing.role)) {
    /* The rank is fine, the account is switched off. Turn it back on and leave
       the role exactly as it stands. */
    await updateUser(existing.id, { is_active: true });
    console.log(`✓ Reactivated "${username}" (${ROLE_LABELS[existing.role]}).`);
  } else {
    await updateUser(existing.id, { role: 'super_admin', is_active: true });
    console.log(`✓ Promoted "${username}" to Super Administrator (was: ${existing.role}).`);
  }
} else {
  if (!password) {
    console.error(
      `✗ "${username}" does not exist yet, so it cannot be promoted.\n` +
        `  Seed it first (npm run seed:users), or set SUPER_ADMIN_PASSWORD to create it here.`,
    );
    process.exit(1);
  }
  await upsertUser({
    username,
    password,
    name: process.env.SUPER_ADMIN_NAME || 'Officer on Special Duty',
    role: 'super_admin',
    designation: process.env.SUPER_ADMIN_DESIGNATION || 'Ministry of Youth Affairs & Sports',
    email: process.env.SUPER_ADMIN_EMAIL || '',
    phone: process.env.SUPER_ADMIN_PHONE || '',
    is_active: true,
  });
  console.log(`✓ Created "${username}" as Super Administrator.`);
}

console.log(`  Total users: ${await countUsers()}.`);
process.exit(0);
