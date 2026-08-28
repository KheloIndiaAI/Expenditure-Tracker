/**
 * Voucher comment endpoints.
 *
 * Thin by design: every decision worth testing lives in `canComment` in
 * comments.ts, because a rule buried inside a route handler can only be tested
 * through the route, and this repository has no HTTP-level tests.
 *
 * Reading is open to any signed-in user — a note to HQ that HQ cannot read is
 * pointless. Writing is restricted to the centre the caller is assigned to, and
 * that assignment is re-read from the database on every request via
 * currentUser(), never taken from the token, so revoking it takes effect at
 * once rather than whenever the cookie happens to expire.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { COMMENT_MAX, TX_KEY_RE, centreOfTxKey } from '@efip/shared';
import { currentUser } from '../session.ts';
import {
  REFUSAL_MESSAGE,
  canComment,
  findComment,
  isKnownCentre,
  listComments,
  lockComments,
  saveComment,
} from '../comments.ts';

const TX_KEY = z.string().trim().max(200).regex(TX_KEY_RE, 'That is not a valid voucher reference.');

const NEW_COMMENT = z.object({
  tx_key: TX_KEY,
  body: z.string().trim().min(1, 'Enter a comment.').max(COMMENT_MAX),
  /* The client's reading of the voucher's balance. It does not decide who may
     write — see comments.ts — but nil latches the comment closed. */
  balance: z.number().finite(),
});

const LOCK = z.object({ keys: z.array(TX_KEY).max(500) });

function firstError(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Invalid request.';
}

export function registerCommentRoutes(app: FastifyInstance): void {
  /* Read. Any signed-in user may ask, because a note written for HQ that HQ
     cannot read would be pointless — and the Regional Centres panel lists every
     centre at once, so it asks for the lot in one request rather than thirteen.
     `centre` narrows it when a caller wants only one. */
  app.get<{ Querystring: { centre?: string } }>('/api/comments', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return reply.code(401).send({ message: 'Not authenticated.' });
    const centre = String(req.query?.centre ?? '').trim();
    if (centre && !isKnownCentre(centre)) {
      return reply.code(400).send({ message: 'Unknown Regional Centre.' });
    }
    return { centre: centre || null, comments: await listComments(centre || undefined) };
  });

  app.post('/api/comments', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return reply.code(401).send({ message: 'Not authenticated.' });
    const parsed = NEW_COMMENT.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ message: firstError(parsed.error) });
    const { tx_key, body, balance } = parsed.data;

    const centre = centreOfTxKey(tx_key);
    if (!isKnownCentre(centre)) {
      return reply.code(400).send({ message: 'Unknown Regional Centre.' });
    }

    const existing = await findComment(tx_key);
    const refusal = canComment(user, tx_key, existing);
    if (refusal) {
      /* Logged at warn with both centres named: a user reaching for another
         centre's voucher is the thing worth being able to find later. */
      req.log.warn({
        event: 'comment.denied',
        reason: refusal,
        userId: user.id,
        userCentre: user.regional_centre,
        target: centre,
        txKey: tx_key,
      });
      const code = refusal === 'locked' ? 409 : refusal === 'bad-key' ? 400 : 403;
      return reply.code(code).send({ message: REFUSAL_MESSAGE[refusal] });
    }

    const saved = await saveComment({
      txKey: tx_key,
      voucher: tx_key.slice(tx_key.indexOf('|') + 1),
      body,
      author: user,
      balance,
    });
    req.log.info({
      event: existing ? 'comment.update' : 'comment.create',
      userId: user.id,
      centre,
      txKey: tx_key,
      locked: saved.locked,
    });
    return { comment: saved };
  });

  /* Seal vouchers the panel now sees at nil. Only the owning centre may do it,
     and it can only ever set the latch — see lockComments. */
  app.post('/api/comments/lock', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return reply.code(401).send({ message: 'Not authenticated.' });
    const mine = String(user.regional_centre || '').trim();
    if (!mine || !isKnownCentre(mine)) {
      return reply.code(403).send({ message: REFUSAL_MESSAGE['no-centre'] });
    }
    const parsed = LOCK.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ message: firstError(parsed.error) });
    const locked = await lockComments(mine, parsed.data.keys);
    if (locked) req.log.info({ event: 'comment.lock', userId: user.id, centre: mine, count: locked });
    return { locked };
  });
}
