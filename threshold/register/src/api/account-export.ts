import { SECURITY_HEADERS } from '../pages.ts';
import { sendProblem } from '../problem.ts';
import type { ApiContext, ApiRoute } from './route.ts';

/**
 * The largest export the route sends (C7-09b): 8,000,000 bytes of JSON. A larger document is answered with a fixed
 * problem and is never sent; the per-table budgets (3 MB each in migration 0065) keep a real export well under it.
 */
export const EXPORT_MAX_BYTES = 8_000_000;

/** Thrown by the export port while another export runs (one at a time, process-wide): the route answers 503. */
export class ExportBusyError extends Error {
  constructor() {
    super('an owner export is already running');
    this.name = 'ExportBusyError';
  }
}

/** Thrown by the export wiring when a store call does not settle in time: the route answers 503 (and frees the gate). */
export class ExportTimeoutError extends Error {
  constructor() {
    super('an owner export did not finish in time');
    this.name = 'ExportTimeoutError';
  }
}

/**
 * The deps of the owner data export (C7-09b). The store's exportOwnerData is register_owner_export as text: the
 * document of the identity's owner, or null when the identity has no owner row. It is passed through as it is, with no
 * parse and no stringify. Nothing here logs the payload.
 */
export interface AccountExportDeps {
  readonly exportOwnerData: (identityHash: string) => Promise<string | null>;
  /** The owner window for the export: seconds to wait, or 0 when the export may go on (one per minute per owner). */
  readonly charge: (ownerId: string) => number;
  /** The clock for the UTC date in the file name. */
  readonly now: () => number;
}

/** The download name: the UTC date only, with no name and no id (decision 0261). */
export function exportFileName(nowMs: number): string {
  return `geldar-export-${new Date(nowMs).toISOString().slice(0, 10)}.json`;
}

/**
 * The fetch-metadata rule of the onboarding GET (account.ts): only an own navigation (no Sec-Fetch-Site, same-origin or
 * none) may read the sensitive document. A cross-site or same-site request is answered as not found.
 */
function ownNavigation(site: string | undefined): boolean {
  return site === undefined || site === 'same-origin' || site === 'none';
}

/**
 * GET /account/export (C7-09b). Cookie session only: a Bearer owner key is refused 401 by the router (decision 0173),
 * which is what cookieOnly does; the handler never runs for it. It is a read, so no CSRF token is needed. The identity
 * hash comes only from the session. Order: the session (401), the fetch-metadata rule (404), the owner window (429),
 * the export (503 while another export runs); a null document is 404, an oversized one is 500 internal with no content,
 * and a database error is 500 internal from the router, with nothing of the document in the answer.
 */
export function accountExportRoutes(deps: AccountExportDeps): readonly ApiRoute[] {
  return [
    {
      method: 'GET',
      pattern: /^\/account\/export$/,
      scope: 'manage',
      write: false,
      cookieOnly: true,
      async handler(ctx: ApiContext) {
        const identityHash = ctx.identityHash;
        if (identityHash === null) return sendProblem(ctx.res, 'unauthenticated');
        const site = ctx.req.headers['sec-fetch-site'];
        if (!ownNavigation(typeof site === 'string' ? site : undefined)) {
          return sendProblem(ctx.res, 'not_found');
        }
        const wait = deps.charge(ctx.ownerId);
        if (wait > 0) return sendProblem(ctx.res, 'rate_limited', { 'retry-after': String(wait) });
        let payload: string | null;
        try {
          payload = await deps.exportOwnerData(identityHash);
        } catch (err) {
          if (err instanceof ExportBusyError || err instanceof ExportTimeoutError) {
            return sendProblem(ctx.res, 'unavailable', { 'retry-after': '5' });
          }
          throw err;
        }
        if (payload === null) return sendProblem(ctx.res, 'not_found');
        if (Buffer.byteLength(payload) > EXPORT_MAX_BYTES) return sendProblem(ctx.res, 'internal');
        ctx.res.writeHead(200, {
          ...SECURITY_HEADERS,
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': `attachment; filename="${exportFileName(deps.now())}"`,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        });
        ctx.res.end(payload);
      },
    },
  ];
}
