/**
 * Promote (or create) the platform's Super Administrator.
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
 */

import { findByUsername, countUsers, updateUser, upsertUser } from '../users.ts';

const username = process.env.SUPER_ADMIN_USERNAME || 'MYAS_OSD';
const password = process.env.SUPER_ADMIN_PASSWORD || '';

const existing = await findByUsername(username);

if (existing) {
  if (existing.role === 'super_admin' && existing.is_active) {
    console.log(`✓ "${username}" is already the Super Administrator. Nothing to do.`);
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
