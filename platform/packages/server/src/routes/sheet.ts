/**
 * The Google Sheet, fetched by the server on the dashboard's behalf.
 *
 * WHY. The dashboard used to pull every tab straight from docs.google.com by injecting a
 * <script> tag (gviz JSONP). That request is made BY THE VIEWER'S BROWSER, so it carries
 * whatever Google session that browser holds and runs past whatever extensions it has —
 * and it failed for some people while working for others. A browser signed in to Google,
 * or holding an expired session (Chrome's "Paused" profile), can be redirected towards
 * accounts.google.com: the page's CSP allows no script from there, and what comes back is
 * an HTML page Chrome will not execute as a script anyway. The tag's onerror fires, and the
 * sync pill reads "could not reach the sheet" while the very same sheet opens fine in the
 * next tab.
 *
 * Fetched here, the request carries no cookies, comes from the same place for everyone, and
 * is the same kind of request the report pipeline has always made from this server.
 *
 * NOT AN OPEN PROXY. The host and path are fixed, the spreadsheet id must be one of the two
 * the dashboard reads, the tab name is validated, and only signed-in users are served.
 *
 * CACHED BRIEFLY. Every open dashboard syncs sixteen tabs every ten minutes. A tab is
 * served from memory for a minute after it was fetched, and simultaneous requests for the
 * same tab share one fetch, so a room full of open dashboards costs Google no more than one
 * — plus one probe a minute per workbook, for the check described at firstTabSig.
 */
import type { FastifyInstance } from 'fastify';
import { currentUser } from '../session.ts';

/** The spreadsheets the dashboard reads — see SYNC in public/index.html. */
const SHEETS = new Set([
  '1crNcEBnf_h6n_ZhT-WfODXNoT0zD1tX-aNvnie3Bb7Q', // SAI Expenditure SYNC: every figure
  '1dlHnw6Y63GiV24wMC9y0cny22mSIx_VZtBtWv4V6cOc', // Test sheet 2: the EditHistory log only
]);
/** Tab names as the workbook spells them: "Sheet3", "DDO HQ", "DSC_Details", … */
const TAB_RE = /^[A-Za-z0-9 _&().'-]{1,64}$/;
const TTL_MS = 60_000;
const TIMEOUT_MS = 20_000;

const cache = new Map<string, { at: number; body: string }>();
const inFlight = new Map<string, Promise<string>>();

/* A plain field, not a `readonly status` parameter property: the server runs under
   Node's type stripping, which removes types but cannot rewrite constructors. */
export class SheetFetchError extends Error {
  status: number;
  constructor(message: string, status = 502) { super(message); this.status = status; }
}

interface Gviz { body: string; sig?: string }

/** One gviz request, unwrapped and checked — no caching, no substitution check. */
async function gviz(id: string, tab: string): Promise<Gviz> {
  const url = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:json&headers=0&sheet=${encodeURIComponent(tab)}`;
  let text: string;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new SheetFetchError(`Google answered ${res.status} for "${tab}".`);
    text = await res.text();
  } catch (err) {
    if (err instanceof SheetFetchError) throw err;
    const timedOut = (err as Error)?.name === 'TimeoutError';
    throw new SheetFetchError(timedOut ? `Google did not answer for "${tab}" within ${TIMEOUT_MS / 1000}s.`
                                       : `Could not reach Google for "${tab}".`);
  }
  /* google.visualization.Query.setResponse({...}); — keep what is inside the call. */
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) throw new SheetFetchError(`Google sent something that is not sheet data for "${tab}".`);
  const body = text.slice(a, b + 1);
  let parsed: { status?: string; sig?: unknown; errors?: { detailed_message?: string; message?: string }[]; table?: unknown };
  try { parsed = JSON.parse(body); } catch { throw new SheetFetchError(`Google's reply for "${tab}" could not be read.`); }
  /* A sheet that stopped being shared, or a query Google rejects, still comes back 200 —
     with status "error" inside. Surfaced as the message Google itself gives. */
  if (parsed.status === 'error' || !parsed.table) {
    const why = parsed.errors?.[0]?.detailed_message || parsed.errors?.[0]?.message || 'no table in the reply';
    throw new SheetFetchError(`"${tab}": ${why}`);
  }
  return { body, sig: parsed.sig == null ? undefined : String(parsed.sig) };
}

/* A tab name Google does not know is NOT an error to it. It answers "ok" with the
   workbook's FIRST tab instead - no warning, no flag - so a centre tab renamed in the
   workbook would have its vouchers silently replaced by some other tab's, and a
   dashboard reading them would attribute those to the wrong centre without a murmur.
   The one tell is the signature Google puts on each reply: every tab has its own, and
   any unknown name gets the first tab's. So a name that cannot exist is asked for once
   a minute, and a reply carrying the same signature is refused.

   The first tab of this workbook is a snapshot tab ("Snap_DDO HQ") that nothing here
   reads. If one of the tabs the dashboard DOES read were ever dragged to the front, it
   would be refused by this - loudly, with its name - rather than served. */
const PROBE = '__efip_no_such_tab__';
const probed = new Map<string, { at: number; sig?: string }>();
async function firstTabSig(id: string): Promise<string | undefined> {
  const hit = probed.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.sig;
  const { sig } = await gviz(id, PROBE);
  probed.set(id, { at: Date.now(), sig });
  return sig;
}

/**
 * One tab, as the gviz JSON object's text — the JS wrapper Google puts around it removed,
 * so the browser receives plain JSON it can parse without executing anything.
 */
export async function fetchSheetTab(id: string, tab: string): Promise<string> {
  if (!SHEETS.has(id)) throw new SheetFetchError('Unknown spreadsheet.', 400);
  if (!TAB_RE.test(tab)) throw new SheetFetchError('Unrecognised tab name.', 400);

  const key = `${id}|${tab}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.body;
  const pending = inFlight.get(key);
  if (pending) return pending;

  const job = (async () => {
    const [got, first] = await Promise.all([gviz(id, tab), firstTabSig(id)]);
    if (got.sig && first && got.sig === first) {
      throw new SheetFetchError(
        `The workbook has no tab named "${tab}" — Google answered with its first tab instead, so nothing from it was used.`, 404);
    }
    cache.set(key, { at: Date.now(), body: got.body });
    return got.body;
  })();
  inFlight.set(key, job);
  try { return await job; } finally { inFlight.delete(key); }
}

export function registerSheetRoutes(app: FastifyInstance): void {
  app.get('/api/sheet', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return reply.code(401).send({ message: 'Not authenticated.' });
    const q = (req.query ?? {}) as { id?: unknown; tab?: unknown };
    try {
      const body = await fetchSheetTab(String(q.id ?? ''), String(q.tab ?? ''));
      return reply.header('Cache-Control', 'no-store').type('application/json; charset=utf-8').send(body);
    } catch (err) {
      const e = err instanceof SheetFetchError ? err : new SheetFetchError('Sheet fetch failed.');
      req.log.warn({ event: 'sheet.fetch_failed', tab: q.tab, message: e.message });
      return reply.code(e.status).send({ message: e.message });
    }
  });
}
