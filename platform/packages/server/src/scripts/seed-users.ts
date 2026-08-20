/**
 * Bulk-seed login users from a CSV — the Regional-Centre portal accounts.
 *
 * Idempotent: upserts on username, so re-running updates names/roles/passwords
 * without creating duplicates. Passwords are scrypt-hashed; only hashes are stored.
 *
 *   SEED_USERS_CSV=./seed/rc_users.csv npm run seed:users -w @efip/server
 *
 * CSV columns (header required): username,name,role,designation,password
 * The CSV holds plaintext passwords, so it is gitignored and must be supplied
 * out-of-band on the deploy host (or via a secret), never committed.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Role } from '@efip/shared';
import { ROLES } from '@efip/shared';
import { countUsers, upsertUser } from '../users.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Default resolves to platform/seed/rc_users.csv regardless of the cwd npm uses.
const path = process.env.SEED_USERS_CSV
  ? resolve(process.env.SEED_USERS_CSV)
  : resolve(__dirname, '../../../../seed/rc_users.csv');

const records = parseCsv(readFileSync(path, 'utf8'));
if (records.length === 0) {
  console.error(`No rows found in ${path}`);
  process.exit(1);
}

let n = 0;
for (const r of records) {
  const username = (r.username || '').trim();
  const password = r.password || '';
  const role = (r.role || 'analyst').trim() as Role;
  if (!username || !password) {
    console.warn(`⚠  Skipping row with missing username/password: ${JSON.stringify(r)}`);
    continue;
  }
  if (!ROLES.includes(role)) {
    console.error(`✗ Row "${username}" has unknown role "${role}". Valid: ${ROLES.join(', ')}`);
    process.exit(1);
  }
  await upsertUser({
    username,
    password,
    name: (r.name || username).trim(),
    role,
    designation: (r.designation || '').trim(),
  });
  n++;
}

console.log(`✓ Seeded/updated ${n} user(s) from ${path}. Total users: ${await countUsers()}.`);
process.exit(0);

/** Minimal RFC-4180-ish CSV parser: handles quotes, escaped quotes, commas, newlines. */
function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.some((v) => v !== '')) rows.push(row);
  }
  const [header, ...body] = rows;
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase());
  return body.map((cols) => Object.fromEntries(keys.map((k, i) => [k, cols[i] ?? ''])));
}
