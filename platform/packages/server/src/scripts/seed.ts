/**
 * Seed / update the initial admin login from environment variables.
 *
 * Idempotent: safe to re-run (upserts on username). Run after setting ADMIN_* :
 *   npm run seed -w @efip/server
 */

import type { Role } from '@efip/shared';
import { countUsers, upsertUser } from '../users.ts';

const username = process.env.ADMIN_USERNAME || 'admin';
const password = process.env.ADMIN_PASSWORD || 'change-me-now';
const name = process.env.ADMIN_NAME || 'Administrator';
const role = (process.env.ADMIN_ROLE || 'admin') as Role;
const designation = process.env.ADMIN_DESIGNATION || 'Platform Administrator';

await upsertUser({ username, password, name, role, designation });

console.log(`✓ Seeded/updated login "${username}" (role: ${role}). Total users: ${await countUsers()}.`);
if (password === 'change-me-now') {
  console.warn('⚠  Using the default ADMIN_PASSWORD. Set a real one before deploying.');
}
process.exit(0);
