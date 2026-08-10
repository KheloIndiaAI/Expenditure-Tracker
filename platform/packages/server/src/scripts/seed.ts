/**
 * Seed / update the initial admin login from environment variables.
 *
 * Idempotent: safe to run repeatedly (it upserts on email). Run after setting
 * ADMIN_* in .env:  npm run seed -w @efip/server
 */

import type { Role } from '@efip/shared';
import { getDb } from '../db/index.ts';
import { countUsers, upsertUser } from '../users.ts';

const email = process.env.ADMIN_EMAIL || 'admin@sai.gov.in';
const password = process.env.ADMIN_PASSWORD || 'change-me-now';
const name = process.env.ADMIN_NAME || 'Administrator';
const role = (process.env.ADMIN_ROLE || 'admin') as Role;
const designation = process.env.ADMIN_DESIGNATION || 'Platform Administrator';

getDb(); // ensures the app_user table exists
upsertUser({ email, password, name, role, designation });

console.log(`✓ Seeded/updated login "${email}" (role: ${role}). Total users: ${countUsers()}.`);
if (password === 'change-me-now') {
  console.warn('⚠  Using the default ADMIN_PASSWORD. Set a real one in .env before deploying.');
}
process.exit(0);
