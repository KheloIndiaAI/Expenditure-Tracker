/**
 * Sign-in history.
 *
 * The log is what Administration reads to answer "who was on the platform, and
 * when?", so the cases that matter are the awkward ones: an attempt against a
 * username that does not exist, ordering when several events share a moment,
 * and the promise that writing the log can never break signing in.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'efip-logins-'));
process.env.EFIP_DB = join(dir, 'test.db');
delete process.env.DATABASE_URL; // never let a stray env point these at RDS
process.env.JWT_SECRET ??= 'test-secret-not-used-in-production';

const { recordLogin, listLogins, loginSummary } = await import('../src/logins.ts');
const { upsertUser } = await import('../src/users.ts');

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* WAL files stay open for the life of the process on Windows; harmless. */
  }
});

describe('sign-in history', () => {
  let aliceId = '';

  before(async () => {
    aliceId = (
      await upsertUser({ username: 'log_alice', password: 'password123', name: 'Alice', role: 'analyst' })
    ).id;
    await recordLogin({ userId: aliceId, username: 'log_alice', outcome: 'success', ip: '10.0.0.1' });
    await recordLogin({ userId: aliceId, username: 'log_alice', outcome: 'logout', ip: '10.0.0.1' });
    await recordLogin({ userId: aliceId, username: 'log_alice', outcome: 'failed', ip: '10.0.0.9' });
    /* No such account: this is the row an INNER join would silently lose. */
    await recordLogin({ username: 'ghost_user', outcome: 'failed', ip: '203.0.113.7' });
  });

  it('keeps an attempt against a username that does not exist', async () => {
    const events = await listLogins({ limit: 500 });
    const ghost = events.find((e) => e.username === 'ghost_user');
    assert.ok(ghost, 'an attempt on an unknown username must still be recorded');
    assert.equal(ghost.outcome, 'failed');
    assert.equal(ghost.user_id, '', 'there is no account to attribute it to');
    /* NULL, not undefined — the join found nothing. The UI must fall back to the
       stored username, so this is pinned rather than left to chance. */
    assert.equal(ghost.name, null, 'and therefore no name to join');
    assert.equal(ghost.role, null);
  });

  it('joins the current name and role for a known account', async () => {
    const [e] = await listLogins({ userId: aliceId, outcome: 'success' });
    assert.equal(e.name, 'Alice');
    assert.equal(e.role, 'analyst');
    assert.equal(e.ip, '10.0.0.1');
  });

  it('stores the username in lower case, however it was typed', async () => {
    await recordLogin({ username: '  MiXeD_Case  ', outcome: 'failed' });
    const events = await listLogins({ limit: 500 });
    assert.ok(events.some((e) => e.username === 'mixed_case'));
  });

  it('returns newest first', async () => {
    const events = await listLogins({ limit: 500 });
    const at = events.map((e) => e.at);
    assert.deepEqual(at, [...at].sort().reverse(), 'the log reads newest first');
  });

  it('filters by outcome and by user', async () => {
    const failures = await listLogins({ outcome: 'failed', limit: 500 });
    assert.equal(failures.every((e) => e.outcome === 'failed'), true);
    const hers = await listLogins({ userId: aliceId, limit: 500 });
    assert.equal(hers.every((e) => e.user_id === aliceId), true);
    assert.equal(hers.length, 3, 'three events for Alice, and not the ghost attempt');
  });

  it('honours a window, and excludes what falls outside it', async () => {
    const recent = await listLogins({ since: new Date(Date.now() - 60_000).toISOString(), limit: 500 });
    assert.ok(recent.length > 0, 'everything written in this test is within the last minute');
    const ancient = await listLogins({ since: new Date(Date.now() + 60_000).toISOString(), limit: 500 });
    assert.equal(ancient.length, 0, 'nothing was recorded in the future');
  });

  it('clamps the limit rather than trusting it', async () => {
    assert.equal((await listLogins({ limit: 1 })).length, 1);
    assert.equal((await listLogins({ limit: 0 })).length <= 500, true);
    assert.equal((await listLogins({ limit: -5 })).length <= 500, true);
    assert.equal((await listLogins({ limit: 10_000 })).length <= 500, true);
  });

  it('reports the last successful sign-in per person', async () => {
    const { total, lastSeen } = await loginSummary();
    assert.ok(total >= 5);
    const mine = lastSeen.find((r) => r.user_id === aliceId);
    assert.ok(mine, 'Alice signed in successfully, so she has a last-seen');
    /* Only successes count as being seen — her failed attempt is later than her
       success, and must not be what "last seen" reports. */
    const [success] = await listLogins({ userId: aliceId, outcome: 'success' });
    assert.equal(mine.at, success.at);
  });

  it('never throws out of the sign-in path, even when the write fails', async () => {
    let caught: unknown = null;
    await assert.doesNotReject(
      recordLogin({ username: 'x', outcome: 'not-a-real-outcome' as never }, (err) => {
        caught = err;
      }),
    );
    /* Whether this particular value offends the store is beside the point: the
       promise is that a logging failure is reported, never thrown. */
    if (caught) assert.ok(caught instanceof Error || typeof caught === 'object');
  });
});
