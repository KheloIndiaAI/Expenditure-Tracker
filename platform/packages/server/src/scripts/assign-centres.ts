/**
 * Propose a Regional Centre for every existing `RC_*` login.
 *
 *   npm run centres:assign -w @efip/server              # look
 *   npm run centres:assign -w @efip/server -- --apply   # then write
 *
 * The username convention (`RC_Kolkata`) is the only clue the platform has about
 * which centre a pre-existing login belongs to. It is a fine clue and a poor
 * rule: it fails on "DDO HQ" (the username charset forbids the space), it is
 * destroyed by the lower-casing every username goes through, and it would grant
 * or withhold access on a typo. So it is used HERE — once, offline, printed for
 * a person to read — and never at request time, where the authorisation check
 * reads the stored column instead.
 *
 * Dry by default, exact matches only. Anything that does not resolve to exactly
 * one of the sheet's thirteen tab names is left alone and listed, to be set by
 * hand in Administration. Nothing is ever cleared: a centre already assigned is
 * reported and skipped, so re-running cannot undo a correction made by hand.
 */

import { RC_SHEET_NAMES } from '@efip/shared';
import { listUsers, updateUser } from '../users.ts';

const apply = process.argv.includes('--apply');

/** `rc_kolkata` → `KOLKATA`, `rc-new-delhi` → `NEW DELHI`. Exact matches only. */
function proposeCentre(username: string): string {
  const m = /^rc[_.-](.+)$/i.exec(username.trim());
  if (!m) return '';
  const guess = m[1].replace(/[_.-]+/g, ' ').trim().toUpperCase();
  return (RC_SHEET_NAMES as readonly string[]).includes(guess) ? guess : '';
}

const users = await listUsers();
const rows = users.map((u) => ({
  user: u,
  proposed: proposeCentre(u.username),
}));

const already = rows.filter((r) => r.user.regional_centre);
const toSet = rows.filter((r) => !r.user.regional_centre && r.proposed);
const unresolved = rows.filter(
  (r) => !r.user.regional_centre && !r.proposed && /^rc[_.-]/i.test(r.user.username),
);

console.log(`${users.length} logins.\n`);

if (already.length) {
  console.log('Already assigned — left untouched:');
  for (const r of already) console.log(`  ${r.user.username.padEnd(22)} ${r.user.regional_centre}`);
  console.log('');
}

if (toSet.length) {
  console.log(`${apply ? 'Assigning' : 'Would assign'}:`);
  for (const r of toSet) console.log(`  ${r.user.username.padEnd(22)} → ${r.proposed}`);
  console.log('');
}

if (unresolved.length) {
  console.log('Looks like a centre login but matches no worksheet tab — set these by hand');
  console.log('in Administration → User Management:');
  for (const r of unresolved) console.log(`  ${r.user.username.padEnd(22)} (${r.user.name})`);
  console.log('');
}

if (!toSet.length) {
  console.log(apply ? 'Nothing to assign.' : 'Nothing would be assigned.');
} else if (!apply) {
  console.log('Dry run — nothing was changed. Re-run with --apply to write.');
} else {
  for (const r of toSet) await updateUser(r.user.id, { regional_centre: r.proposed });
  console.log(`✓ Assigned ${toSet.length} login${toSet.length === 1 ? '' : 's'}.`);
  console.log('  Anyone signed in picks this up on their next request — the centre is read');
  console.log('  from the database each time, not carried in their session cookie.');
}
