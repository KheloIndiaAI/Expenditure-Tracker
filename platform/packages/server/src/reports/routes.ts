/**
 * Report automation — the HTTP surface.
 *
 * ENFORCEMENT LIVES HERE, NOT IN THE UI, exactly as it does for /api/admin/*.
 * Every route below resolves the caller from the session cookie and re-reads
 * their module grants from the database on that request. The sidebar hiding a
 * panel is a courtesy; this is the rule.
 *
 * 'reports' is a restricted module — nobody holds it until an administrator
 * grants it — so a signed-in user who has not been given it is refused here
 * even though they can reach every other panel.
 */

import type { FastifyInstance } from 'fastify';
import type { User } from '@efip/shared';
import { currentUser } from '../session.ts';
import { getModuleAccess } from '../users.ts';
import { isSuperAdmin } from '../auth.ts';
import * as store from './store.ts';
import * as service from './service.ts';

/** The caller, if they are allowed to see reports at all. */
async function allowed(req: unknown): Promise<User | null> {
  const user = await currentUser(req as never);
  if (!user) return null;
  if (isSuperAdmin(user)) return user;
  const modules = await getModuleAccess(user.id, user.role);
  return modules.reports === true ? user : null;
}

const CONTENT_TYPE: Record<string, string> = {
  report: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  html: 'text/html; charset=utf-8',
  'weekly-html': 'text/html; charset=utf-8',
  pdf: 'application/pdf',
  'weekly-pdf': 'application/pdf',
};

export function registerReportRoutes(app: FastifyInstance): void {
  /** Status, last run, recent history — one call, so the panel paints once. */
  app.get('/api/reports/status', async (req, reply) => {
    const user = await allowed(req);
    if (!user) return reply.code(403).send({ message: 'You do not have access to Report Automation.' });
    return service.status();
  });

  /**
   * Produce today's documents. THE ONLY WAY A REPORT IS EVER PRODUCED — there
   * is no scheduler behind this, so nothing exists until somebody presses
   * Process now.
   *
   * Rate-limited because a run fetches the whole workbook and lays out two
   * documents; a held-down button should not become a queue of them. The
   * service refuses a second concurrent run on its own, so this is only about
   * not asking in the first place.
   */
  app.post(
    '/api/reports/run',
    { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const user = await allowed(req);
      if (!user) return reply.code(403).send({ message: 'You do not have access to Report Automation.' });

      const already = await store.runningRun();
      if (already || service.isRunning()) {
        return reply.code(409).send({ message: 'A run is already in progress.', since: already?.at ?? null });
      }
      req.log.info({ event: 'reports.run', userId: user.id });
      const r = await service.runReport({ trigger: 'manual', triggeredBy: user.username });
      if (!r.ok) return reply.code(422).send({ message: r.error ?? 'The run failed.', runId: r.runId });
      return r;
    },
  );

  /**
   * A document. `format` names which of the run's outputs is wanted; a PDF is
   * rendered from that run's stored HTML the first time it is asked for and
   * kept thereafter, which is why this can be slow once and instant after.
   */
  app.get<{ Params: { runId: string; format: string } }>(
    '/api/reports/:runId/:format',
    async (req, reply) => {
      const user = await allowed(req);
      if (!user) return reply.code(403).send({ message: 'You do not have access to Report Automation.' });

      const { runId, format } = req.params;
      if (!CONTENT_TYPE[format]) return reply.code(404).send({ message: 'Unknown document.' });

      let doc: { name: string; content: Buffer } | null = null;
      if (format === 'pdf' || format === 'weekly-pdf') {
        const r = await service.renderPdf(runId, format === 'weekly-pdf');
        if ('error' in r) return reply.code(422).send({ message: r.error });
        doc = r;
      } else {
        doc = await store.getDoc(runId, format);
      }
      if (!doc) return reply.code(404).send({ message: 'That document is not held for this run.' });

      /* attachment, not inline: these are files to keep, and the HTML copy in
         particular must never be rendered as a page on this origin. */
      return reply
        .header('Content-Type', CONTENT_TYPE[format])
        .header('Content-Disposition', `attachment; filename="${doc.name.replace(/"/g, '')}"`)
        .header('Cache-Control', 'private, no-store')
        .send(doc.content);
    },
  );

  /**
   * Save the hand-entered page-1 figures.
   *
   * A write, and one that changes what the next report will say, so it is held
   * to the same grant as producing the report itself — this module is given to
   * the desks that own the Summary, and setting a figure is part of owning it.
   * Nothing is applied by saving: the values sit in the config until the next
   * Process now reads them.
   *
   * Amounts arrive in crore and are stored in rupees; the service does that
   * conversion and the validation, and its message is meant to be read by the
   * person who typed the value.
   */
  app.post<{ Body: Record<string, unknown> }>(
    '/api/reports/overrides',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const user = await allowed(req);
      if (!user) return reply.code(403).send({ message: 'You do not have access to Report Automation.' });
      try {
        const r = await service.saveOverrides(req.body ?? {});
        req.log.info({ event: 'reports.overrides', userId: user.id, applied: r.applied });
        return r;
      } catch (err) {
        return reply.code(400).send({ message: (err as Error).message });
      }
    },
  );

  /** The cumulative day-by-day log workbook. */
  app.get('/api/reports/daily-log', async (req, reply) => {
    const user = await allowed(req);
    if (!user) return reply.code(403).send({ message: 'You do not have access to Report Automation.' });
    const buf = await store.getDailyLog();
    if (!buf) return reply.code(404).send({ message: 'No daily log has been written yet.' });
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', 'attachment; filename="daily-expenditure-log.xlsx"')
      .header('Cache-Control', 'private, no-store')
      .send(buf);
  });
}
