import { SECURITY_HEADERS } from '../pages.ts';
import { sendProblem } from '../problem.ts';
import type { ApiContext, ApiRoute } from './route.ts';

/**
 * The deps of the owner data export (C7-09b). The store's exportOwnerData is register_owner_export: the document of the
 * identity's owner, or null when the identity has no owner row. Nothing here logs the payload.
 */
export interface AccountExportDeps {
  readonly exportOwnerData: (identityHash: string) => Promise<unknown>;
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
 * GET /account/export (C7-09b). Cookie session only: a Bearer owner key is refused 401 by the router (decision 0173).
 * It is a read, so no CSRF token is needed. The identity hash comes only from the session. Order: the session (401),
 * the fetch-metadata rule (404), the owner window (429), the export; a null document is 404, and a database error is
 * 500 internal from the router, with nothing of the document in the answer.
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
        const payload = await deps.exportOwnerData(identityHash);
        if (payload === null || payload === undefined) return sendProblem(ctx.res, 'not_found');
        ctx.res.writeHead(200, {
          ...SECURITY_HEADERS,
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': `attachment; filename="${exportFileName(deps.now())}"`,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        });
        ctx.res.end(JSON.stringify(payload));
      },
    },
  ];
}
