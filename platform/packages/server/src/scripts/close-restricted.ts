/**
 * Withdraw every stored grant of a restricted module.
 *
 *   npm run access:close -w @efip/server -- --dry-run    # look first
 *   npm run access:close -w @efip/server                 # then do it
 *
 * Why this exists. Adding a module to RESTRICTED_MODULES changes what a user
 * with NO stored decision gets — it does not reach a user who has one. Anybody
 * whose access was ever edited has a row for every module, so a module that was
 * open when that edit happened is still recorded as allowed, and stays allowed.
 * Flipping the default closes the panel for most people and quietly leaves it
 * open for exactly the users an administrator once took an interest in, which is
 * the worst of both. This closes those rows too, so "off by default" is true of
 * everyone on the day it ships.
 *
 * Deliberately NOT a boot migration. Run at startup it would also wipe every
 * grant an administrator made afterwards, on the next restart — a permission
 * that silently undoes itself is worse than one that was never given. It is a
 * one-off, run by hand, and anything granted after it stands.
 *
 * Reversible: an administrator can grant any of these again in Roles & Access.
 */

import { RESTRICTED_MODULES } from '@efip/shared';
import { getDb } from '../db/index.ts';

const dry = process.argv.includes('--dry-run');

if (!RESTRICTED_MODULES.length) {
  console.log('No modules are restricted. Nothing to do.');
  process.exit(0);
}

const db = await getDb();
const list = RESTRICTED_MODULES.map(() => '?').join(', ');

/* Reported per user rather than as a count: this withdraws access from named
   people, and whoever runs it should see whose. */
const open = await db.all<{ username: string; name: string; module: string }>(
  `SELECT u.username AS username, u.name AS name, a.module AS module
     FROM user_module_access a
     JOIN app_user u ON u.id = a.user_id
    WHERE a.module IN (${list}) AND a.allowed = 1
    ORDER BY u.username, a.module`,
  [...RESTRICTED_MODULES],
);

console.log(`Restricted modules: ${RESTRICTED_MODULES.join(', ')}`);

if (!open.length) {
  console.log('✓ No stored grants for any of them. Every user is already on the default (off).');
  process.exit(0);
}

console.log(`\n${open.length} stored grant${open.length === 1 ? '' : 's'} to withdraw:`);
for (const r of open) console.log(`  ${r.username.padEnd(20)} ${r.module}   (${r.name})`);

if (dry) {
  console.log('\n--dry-run: nothing was changed.');
  process.exit(0);
}

await db.run(
  `UPDATE user_module_access SET allowed = 0 WHERE module IN (${list}) AND allowed = 1`,
  [...RESTRICTED_MODULES],
);
console.log(`\n✓ Withdrawn. An administrator can grant any of these again in Roles & Access.`);
console.log('  Anyone signed in keeps their current access until they sign out and back in.');
