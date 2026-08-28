/**
 * Who may comment on a voucher, and when a comment stops being editable.
 *
 * The centre check is the only genuine boundary in this feature — the balance
 * rule cannot be one, because the server holds no financial data — so it is
 * tested directly rather than through a route. `canComment` is a pure function
 * for exactly that reason.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ASSIGNABLE_CENTRES,
  RC_SHEET_NAMES,
  TX_KEY_RE,
  centreFromUsername,
  centreOfTxKey,
  isAssignableCentre,
  txCommentKey,
  type User,
} from '@efip/shared';

const dir = mkdtempSync(join(tmpdir(), 'efip-comments-'));
process.env.EFIP_DB = join(dir, 'test.db');
delete process.env.DATABASE_URL; // never let a stray env point these at RDS
process.env.JWT_SECRET ??= 'test-secret-not-used-in-production';

const { canComment, findComment, isKnownCentre, listComments, lockComments, saveComment } =
  await import('../src/comments.ts');
const { upsertUser, updateUser } = await import('../src/users.ts');

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* WAL files stay open for the life of the process on Windows; harmless. */
  }
});

const KOL = txCommentKey('KOLKATA', 'TSA/11');
const MUM = txCommentKey('MUMBAI', 'TSA/22');

describe('the transaction key', () => {
  it('is centre and voucher, and carries no amount', () => {
    assert.equal(KOL, 'KOLKATA|TSA/11');
    assert.equal(centreOfTxKey(KOL), 'KOLKATA');
  });

  /* A key that cannot be split back apart unambiguously would let one voucher's
     comment land on another's row, so the shape is refused at the door. */
  it('refuses a shape it could not split back apart', () => {
    for (const bad of ['KOLKATA|', '|TSA/11', 'KOLKATA', 'A|B|C', '', '|']) {
      assert.equal(TX_KEY_RE.test(bad), false, `${JSON.stringify(bad)} must be rejected`);
      assert.equal(centreOfTxKey(bad), '', `${JSON.stringify(bad)} must yield no centre`);
    }
  });

  it('accepts a voucher containing the characters real vouchers contain', () => {
    assert.equal(TX_KEY_RE.test('DDO HQ|TSA/492'), true, 'a centre name may contain a space');
    assert.equal(centreOfTxKey('DDO HQ|TSA/492'), 'DDO HQ');
  });
});

describe('known centres', () => {
  it('accepts every worksheet tab and nothing else', () => {
    for (const c of RC_SHEET_NAMES) assert.equal(isKnownCentre(c), true, c);
    /* INFRA-SAI is in DATA.centres but has no worksheet tab, so no transaction
       is ever stamped with it — assigning someone to it would grant nothing. */
    assert.equal(isKnownCentre('INFRA-SAI'), false);
    assert.equal(isKnownCentre('kolkata'), false, 'the match is exact, not case-folded');
    assert.equal(isKnownCentre(''), false);
  });
});

describe('who may write', () => {
  const kolkata = { regional_centre: 'KOLKATA' };

  it('lets a centre write on its own voucher', () => {
    assert.equal(canComment(kolkata, KOL), null);
  });

  it("refuses another centre's voucher", () => {
    assert.equal(canComment(kolkata, MUM), 'wrong-centre');
  });

  it('refuses a user assigned to no centre', () => {
    assert.equal(canComment({ regional_centre: '' }, KOL), 'no-centre');
    assert.equal(canComment({ regional_centre: '   ' }, KOL), 'no-centre');
  });

  it('refuses nobody at all', () => {
    assert.equal(canComment(null, KOL), 'not-authenticated');
    assert.equal(canComment(undefined, KOL), 'not-authenticated');
  });

  it('refuses a malformed key before anything else can go wrong', () => {
    assert.equal(canComment(kolkata, 'KOLKATA'), 'bad-key');
    assert.equal(canComment(kolkata, 'KOLKATA|'), 'bad-key');
  });

  /* The centre match is a whole-segment equality, never a prefix. If it were
     startsWith, KOLKATA would reach a hypothetical "KOLKATA 2". */
  it('matches the whole centre, not a prefix of it', () => {
    assert.equal(canComment({ regional_centre: 'KOLKATA' }, 'KOLKATA 2|TSA/1'), 'wrong-centre');
    assert.equal(canComment({ regional_centre: 'KOL' }, KOL), 'wrong-centre');
  });

  it('is case sensitive, because the stored value is', () => {
    assert.equal(canComment({ regional_centre: 'kolkata' }, KOL), 'wrong-centre');
  });
});

describe('storing a comment', () => {
  let author: User;

  before(async () => {
    const u = await upsertUser({
      username: 'rc_kolkata',
      password: 'password123',
      name: 'RC Kolkata',
      role: 'analyst',
      regional_centre: 'KOLKATA',
    });
    author = u;
  });

  it('round-trips, keeping the centre as its own column', async () => {
    const saved = await saveComment({
      txKey: KOL,
      voucher: 'TSA/11',
      body: '  Awaiting UC from the state association.  ',
      author,
      balance: 500000,
    });
    assert.equal(saved.centre, 'KOLKATA');
    assert.equal(saved.voucher, 'TSA/11');
    assert.equal(saved.body, 'Awaiting UC from the state association.', 'trimmed');
    assert.equal(saved.locked, false, 'a live voucher is not frozen');
    assert.equal(saved.author_id, author.id);
  });

  it('edits in place rather than accumulating rows', async () => {
    await saveComment({ txKey: KOL, voucher: 'TSA/11', body: 'Second version.', author, balance: 500000 });
    const all = await listComments('KOLKATA');
    assert.equal(all.filter((c) => c.tx_key === KOL).length, 1, 'one comment per voucher');
    assert.equal((await findComment(KOL))?.body, 'Second version.');
  });

  it('caps a very long body instead of refusing it', async () => {
    const saved = await saveComment({
      txKey: KOL,
      voucher: 'TSA/11',
      body: 'x'.repeat(5000),
      author,
      balance: 500000,
    });
    assert.equal(saved.body.length, 2000);
  });

  it('stores the text exactly as typed, escaping nothing at rest', async () => {
    /* Escaping belongs at render, once, where the context is known. Escaping on
       the way in would double-encode the moment anything else read the row. */
    const raw = '<img src=x onerror=alert(1)> & "quoted" ’ 5 < 6';
    const saved = await saveComment({ txKey: KOL, voucher: 'TSA/11', body: raw, author, balance: 1 });
    assert.equal(saved.body, raw);
  });

  it('lists only the centre asked for, and everything when asked for none', async () => {
    await saveComment({ txKey: MUM, voucher: 'TSA/22', body: 'Mumbai note.', author, balance: 10 });
    assert.deepEqual((await listComments('KOLKATA')).map((c) => c.tx_key), [KOL]);
    assert.deepEqual((await listComments('MUMBAI')).map((c) => c.tx_key), [MUM]);
    assert.equal((await listComments()).length, 2);
  });
});

describe('freezing at a nil balance', () => {
  let author: User;
  const KEY = txCommentKey('PATIALA', 'TSA/99');

  before(async () => {
    author = await upsertUser({
      username: 'rc_patiala',
      password: 'password123',
      name: 'RC Patiala',
      role: 'analyst',
      regional_centre: 'PATIALA',
    });
  });

  it('latches when the balance is reported nil', async () => {
    await saveComment({ txKey: KEY, voucher: 'TSA/99', body: 'Live.', author, balance: 100 });
    assert.equal((await findComment(KEY))?.locked, false);
    await saveComment({ txKey: KEY, voucher: 'TSA/99', body: 'Closing.', author, balance: 0 });
    assert.equal((await findComment(KEY))?.locked, true);
  });

  it('refuses a further write once latched', async () => {
    const existing = await findComment(KEY);
    assert.equal(canComment({ regional_centre: 'PATIALA' }, KEY, existing), 'locked');
  });

  /* The latch is one-way on purpose. A sheet correction lifting the balance off
     nil must not quietly reopen a comment that was sealed. */
  it('stays latched even when a later write claims a healthy balance', async () => {
    await saveComment({ txKey: KEY, voucher: 'TSA/99', body: 'Trying again.', author, balance: 999 });
    assert.equal((await findComment(KEY))?.locked, true, 'the latch never lifts');
  });

  it('seals a comment whose voucher closed after it was written', async () => {
    const K2 = txCommentKey('PATIALA', 'TSA/100');
    await saveComment({ txKey: K2, voucher: 'TSA/100', body: 'Written while live.', author, balance: 42 });
    assert.equal((await findComment(K2))?.locked, false);
    assert.equal(await lockComments('PATIALA', [K2]), 1);
    assert.equal((await findComment(K2))?.locked, true);
    assert.equal(await lockComments('PATIALA', [K2]), 0, 'already sealed, so nothing to do');
  });

  it("will not let one centre seal another centre's voucher", async () => {
    const K3 = txCommentKey('MUMBAI', 'TSA/77');
    await saveComment({
      txKey: K3,
      voucher: 'TSA/77',
      body: 'Mumbai, live.',
      author: await upsertUser({
        username: 'rc_mumbai',
        password: 'password123',
        name: 'RC Mumbai',
        role: 'analyst',
        regional_centre: 'MUMBAI',
      }),
      balance: 5,
    });
    assert.equal(await lockComments('PATIALA', [K3]), 0, 'not Patiala’s to seal');
    assert.equal((await findComment(K3))?.locked, false);
  });

  it('ignores malformed keys handed to the sealer', async () => {
    assert.equal(await lockComments('PATIALA', ['PATIALA', '', '|', 'A|B|C']), 0);
  });
});

describe('deriving a centre from a login name', () => {
  /* This is what spares an administrator from having to assign thirteen centres
     by hand, and what makes an existing RC login work the moment it migrates. */
  it('reads the RC_<Centre> convention, however it is punctuated or cased', () => {
    for (const u of ['RC_Kolkata', 'rc_kolkata', 'RC-KOLKATA', 'rc.Kolkata', 'RC_KOLKATA']) {
      assert.equal(centreFromUsername(u), 'KOLKATA', u);
    }
  });

  it('places every assignable centre from its own conventional username', () => {
    for (const c of ASSIGNABLE_CENTRES) {
      assert.equal(centreFromUsername('RC_' + c.replace(/ /g, '_')), c, c);
    }
  });

  /* No fuzzy matching anywhere: a name it cannot place is left for a person. */
  it('leaves anything it cannot place exactly', () => {
    for (const u of ['RC_Kolkatta', 'RC_Kol', 'RC_', 'kolkata', 'MYAS_OSD', 'ki_1', '', 'rc']) {
      assert.equal(centreFromUsername(u), '', JSON.stringify(u));
    }
  });

  /* DDO HQ is a worksheet tab but not an assignable centre: the Regional Centres
     panel filters it out, so a login assigned to it could never use the right. */
  it('will not derive DDO HQ, which the panel never shows', () => {
    assert.equal(centreFromUsername('RC_DDO_HQ'), '');
    assert.equal(isAssignableCentre('DDO HQ'), false);
    assert.equal(ASSIGNABLE_CENTRES.length, RC_SHEET_NAMES.length - 1);
  });
});

describe('the centre assignment itself', () => {
  it('is a stored column, and reassigning it takes effect on the next read', async () => {
    const u = await upsertUser({
      username: 'rc_moves',
      password: 'password123',
      name: 'Moves About',
      role: 'analyst',
      regional_centre: 'KOLKATA',
    });
    assert.equal(canComment(u, KOL), null);
    const moved = await updateUser(u.id, { regional_centre: 'MUMBAI' });
    assert.equal(moved?.regional_centre, 'MUMBAI');
    assert.equal(canComment(moved, KOL), 'wrong-centre', 'the old centre is refused at once');
    assert.equal(canComment(moved, MUM), null);
  });

  /* The seed roster is a list of logins, not a record of every setting: it
     carries no centre column at all. If an omitted centre were written as '',
     the next routine `npm run seed:users` would strip every RC account of the
     assignment an administrator made, and nothing would say so. */
  it('survives a re-seed that does not mention it', async () => {
    const u = await upsertUser({
      username: 'rc_reseeded',
      password: 'password123',
      name: 'Re-seeded',
      role: 'analyst',
      regional_centre: 'GUWAHATI',
    });
    assert.equal(u.regional_centre, 'GUWAHATI');
    /* Exactly what scripts/seed-users.ts passes — no centre, no is_active. */
    const after = await upsertUser({
      username: 'rc_reseeded',
      password: 'password123',
      name: 'Re-seeded',
      role: 'analyst',
      designation: 'In-charge',
    });
    assert.equal(after.regional_centre, 'GUWAHATI', 'a re-seed must not clear the centre');
    assert.equal(after.designation, 'In-charge', 'but it still applies what it does carry');
  });

  it('is still cleared when an administrator deliberately sets it to none', async () => {
    const u = await upsertUser({
      username: 'rc_cleared',
      password: 'password123',
      name: 'Cleared',
      role: 'analyst',
      regional_centre: 'BHOPAL',
    });
    const after = await updateUser(u.id, { regional_centre: '' });
    assert.equal(after?.regional_centre, '', 'an explicit none is honoured');
    assert.equal(canComment(after, txCommentKey('BHOPAL', 'TSA/1')), 'no-centre');
  });

  it('defaults to none, so an existing login gains nothing by the migration', async () => {
    const u = await upsertUser({
      username: 'plain_person',
      password: 'password123',
      name: 'Plain',
      role: 'analyst',
    });
    assert.equal(u.regional_centre, '');
    assert.equal(canComment(u, KOL), 'no-centre');
  });
});
