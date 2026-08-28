/**
 * Voucher comments — a Regional Centre's note to HQ about one release.
 *
 * Read is open to any signed-in user who can open the Regional Centres panel:
 * the whole point of a comment is that HQ sees it. Write is not. Only the user
 * assigned to a centre may write on that centre's vouchers, and that check is
 * `canComment` below — a pure function, so it can be tested directly rather than
 * only through a route handler.
 *
 * What this module does and does not guarantee:
 *
 *   Enforced here, server-side, on every request
 *     · who may write — the caller's stored `regional_centre` must equal the
 *       centre named by the key, and neither may be empty
 *     · the key is well formed, so one voucher's comment cannot land on another
 *     · a locked comment is never rewritten
 *
 *   NOT enforceable here
 *     · whether the voucher's balance is really above nil. The server holds no
 *       financial data at all — the dashboard reads the sheet in the browser —
 *       so the balance arrives as a claim from the client. The freeze at nil is
 *       therefore a rule the UI keeps, latched durably by `locked` once the
 *       client reports it. Do not read this file as if the balance were
 *       verified; it is not, and making it so means having the server pull the
 *       same sheet, which is a different platform.
 */

import {
  COMMENT_MAX,
  TX_KEY_RE,
  centreOfTxKey,
  RC_SHEET_NAMES,
  type TransactionComment,
  type User,
} from '@efip/shared';
import { getDb } from './db/index.ts';

type Row = Omit<TransactionComment, 'locked'> & { locked: number | boolean };

const toComment = (r: Row): TransactionComment => ({
  ...r,
  locked: r.locked === true || r.locked === 1,
});

/** Is this a centre the platform actually has a worksheet tab for? */
export function isKnownCentre(centre: string): boolean {
  return (RC_SHEET_NAMES as readonly string[]).includes(centre);
}

export type CommentRefusal =
  | 'not-authenticated'
  | 'bad-key'
  | 'no-centre'
  | 'wrong-centre'
  | 'locked';

/**
 * May this user write on this key? Returns null when they may, or the reason.
 *
 * Deliberately takes the caller's own record and nothing from the request body.
 * A `centre` field in the body would be the caller asserting their own
 * authority, which is not authorisation at all — so the centre is read off the
 * key and compared against the column, and the column is re-read from the
 * database on every request by currentUser().
 */
export function canComment(
  user: Pick<User, 'regional_centre'> | null | undefined,
  txKey: string,
  existing?: TransactionComment | null,
): CommentRefusal | null {
  if (!user) return 'not-authenticated';
  if (!TX_KEY_RE.test(txKey)) return 'bad-key';
  const mine = String(user.regional_centre || '').trim();
  if (!mine) return 'no-centre';
  /* Not `startsWith`, not a prefix, not case-insensitive: an exact match on the
     whole centre segment. "KOLKATA" must never satisfy a key for "KOLKATA 2". */
  if (mine !== centreOfTxKey(txKey)) return 'wrong-centre';
  if (existing && existing.locked) return 'locked';
  return null;
}

export const REFUSAL_MESSAGE: Record<CommentRefusal, string> = {
  'not-authenticated': 'Not authenticated.',
  'bad-key': 'That is not a valid voucher reference.',
  'no-centre':
    'Your account is not assigned to a Regional Centre, so it cannot comment on vouchers. An administrator can assign one.',
  'wrong-centre': 'You may only comment on your own Regional Centre’s vouchers.',
  locked: 'This voucher is closed. Its comment can no longer be changed.',
};

export async function findComment(txKey: string): Promise<TransactionComment | undefined> {
  const db = await getDb();
  const row = await db.one<Row>('SELECT * FROM transaction_comment WHERE tx_key = ?', [txKey]);
  return row ? toComment(row) : undefined;
}

/**
 * Comments, for one centre or for all of them.
 *
 * All of them is the normal case: the Regional Centres panel lists every centre
 * on one screen, so asking per centre would be thirteen requests for a table
 * that is only ever a few hundred rows.
 */
export async function listComments(centre?: string): Promise<TransactionComment[]> {
  const db = await getDb();
  const rows = centre
    ? await db.all<Row>(
        'SELECT * FROM transaction_comment WHERE centre = ? ORDER BY updated_at DESC',
        [centre],
      )
    : await db.all<Row>('SELECT * FROM transaction_comment ORDER BY updated_at DESC');
  return rows.map(toComment);
}

/**
 * Write a comment, creating or replacing the one on that voucher.
 *
 * `balance` is the client's claim about the voucher. It never decides who may
 * write — that is settled before this is called — but a claim of nil or less
 * latches `locked`, so the freeze survives even though the figure behind it
 * cannot be checked here.
 */
export async function saveComment(input: {
  txKey: string;
  voucher: string;
  body: string;
  author: User;
  balance: number;
}): Promise<TransactionComment> {
  const db = await getDb();
  const now = new Date().toISOString();
  const centre = centreOfTxKey(input.txKey);
  const body = input.body.trim().slice(0, COMMENT_MAX);
  const locked = Number.isFinite(input.balance) && input.balance <= 0 ? 1 : 0;
  const existing = await findComment(input.txKey);
  if (existing) {
    await db.run(
      `UPDATE transaction_comment
          SET body = ?, author_id = ?, author_name = ?, updated_at = ?,
              locked = CASE WHEN locked = 1 THEN 1 ELSE ? END
        WHERE tx_key = ?`,
      [body, input.author.id, input.author.name, now, locked, input.txKey],
    );
  } else {
    await db.run(
      `INSERT INTO transaction_comment
         (tx_key, centre, voucher, body, author_id, author_name, locked, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [input.txKey, centre, input.voucher, body, input.author.id, input.author.name, locked, now, now],
    );
  }
  return (await findComment(input.txKey)) as TransactionComment;
}

/**
 * Latch a voucher closed without writing a comment.
 *
 * A comment written while the balance was healthy leaves no later row, so
 * nothing would ever record that the voucher has since closed. The panel
 * reports the keys it now sees at nil, and this seals them. It only ever sets
 * the latch — there is no path in this module that clears one.
 */
export async function lockComments(centre: string, keys: string[]): Promise<number> {
  const wanted = keys.filter((k) => TX_KEY_RE.test(k) && centreOfTxKey(k) === centre);
  if (!wanted.length) return 0;
  const db = await getDb();
  let n = 0;
  for (const k of wanted) {
    const existing = await findComment(k);
    if (!existing || existing.locked) continue;
    await db.run('UPDATE transaction_comment SET locked = 1 WHERE tx_key = ?', [k]);
    n++;
  }
  return n;
}
