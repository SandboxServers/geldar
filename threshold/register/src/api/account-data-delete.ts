import type { IncomingMessage } from 'node:http';
import { SECURITY_HEADERS } from '../pages.ts';
import { sendProblem } from '../problem.ts';
import { UNAVAILABLE_RETRY_SECONDS } from './body.ts';
import { type BodyStopLink, LOGIN_NAME, stopPlayerBody } from './body-retire.ts';
import type { ApiContext, ApiRoute } from './route.ts';

/** The typed phrase the account delete page asks for (C7-09a). Any other text is refused before anything runs. */
export const DELETE_PHRASE = 'delete my account';

/** The delete body is `{"confirm":"..."}`: anything longer than this is refused before it is parsed. */
const MAX_BODY_BYTES = 1024;

export interface DeletablePlayer {
  readonly name: string;
  readonly status: string;
}

/** The deps of the delete, shared by the API route and the account page action (one service, two callers). */
export interface AccountDeleteDeps {
  /** The owner row by identity hash; null when there is none. A banned owner is refused like a banned sign-in. */
  readonly findOwner: (identityHash: string) => Promise<{ readonly banned: boolean } | null>;
  /** The owner's players (the store's listPlayers). Each one's body is stopped before the erase. */
  readonly listPlayers: (identityHash: string) => Promise<readonly DeletablePlayer[]>;
  /**
   * The owner's players that the operator moved in (a register_audit row 'player.set_owner' names them), one entry
   * each with its status. A live one refuses the delete (C7 delete-guard). Optional only for test fakes: the production
   * deps (accountDeleteDeps) always carry it, and a missing one skips the check.
   */
  readonly movedInPlayers?: (
    identityHash: string,
  ) => Promise<readonly { readonly status: string }[]>;
  /** register_account_delete: true when the account was removed, false when there was nothing to remove (a no-op). */
  readonly eraseAccount: (identityHash: string) => Promise<boolean>;
  /** The Set-Cookie values that clear the session cookies: the __Host- name and the legacy names. */
  readonly clearCookies: readonly string[];
  /**
   * The body link and slot of C7-04c2, the same ones the retire route uses. Null when NATS is not configured: no
   * managed body can exist, so the stop step is a no-op and the erase still runs.
   */
  readonly body: BodyStopLink | null;
  /** One line per skipped body stop, with the reason and no name or id. Optional: a fake without it logs nothing. */
  readonly log?: ((line: string) => void) | undefined;
}

/** What the shared delete did. Only 'deleted' removed anything. */
export type AccountDeleteOutcome =
  | 'deleted'
  | 'unauthenticated'
  | 'conflict'
  | 'body_unavailable'
  | 'moved_in';

/** The refusal text for a moved-in player. It names no player and says what to do; nothing was removed. */
export const MOVED_IN_DETAIL =
  'A player was moved to this account by the operator. Ask the operator to move it away, then delete again. Nothing was deleted.';

/** Reads the confirm field of the JSON body. Null when the body is too long, not JSON or has no string confirm. */
async function readConfirm(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.from(chunk as Uint8Array);
    size += buf.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(buf);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const confirm = (parsed as { confirm?: unknown }).confirm;
    return typeof confirm === 'string' ? confirm : null;
  } catch {
    return null;
  }
}

/**
 * The shared delete (C7-09a). The caller has checked the typed phrase and the credential. Order: the owner (missing or
 * banned is 'unauthenticated' with nothing read further), a live moved-in player ('moved_in', nothing stopped or removed),
 * the owner's body slot (held by a body operation is 'conflict'),
 * every non-retired player's body stopped (a stop that is not ok is 'body_unavailable' and NOTHING is removed), and only
 * then the erase: it removes the roster rows, so it must come after the stops. The erase is one database transaction; a
 * database error throws to the caller. The slot is released in every case.
 */
export async function deleteAccountData(
  deps: AccountDeleteDeps,
  identityHash: string,
  ownerId: string,
): Promise<AccountDeleteOutcome> {
  const owner = await deps.findOwner(identityHash);
  if (owner === null || owner.banned) return 'unauthenticated';
  const moved = deps.movedInPlayers ? await deps.movedInPlayers(identityHash) : [];
  if (moved.some((player) => player.status !== 'retired')) {
    // The log line names no player and no owner (the operator reads the register audit for the ids).
    deps.log?.('account delete refused reason=moved-in');
    return 'moved_in';
  }
  const link = deps.body;
  if (link?.slot.has(ownerId)) return 'conflict';
  link?.slot.add(ownerId);
  try {
    if (link) {
      for (const player of await deps.listPlayers(identityHash)) {
        if (player.status === 'retired') continue;
        // A stored name that is not a Body login (the retire route's rule) can never have been started by the
        // supervisor, so there is no body to stop. Skipping it keeps a bad stored name from blocking the deletion.
        if (!LOGIN_NAME.test(player.name)) {
          // An operator-started host is started by player id, not by name, so the operator must check for it (runbook).
          deps.log?.('account delete skipped body stop reason=login-name');
          continue;
        }
        if (!(await stopPlayerBody(link, ownerId, player.name))) return 'body_unavailable';
      }
    }
    await deps.eraseAccount(identityHash);
  } finally {
    link?.slot.delete(ownerId);
  }
  return 'deleted';
}

/**
 * POST /account/delete (C7-09a). Cookie session only, with the CSRF header (the router, decision 0173); a Bearer owner
 * key is refused 401 before this handler runs and can never delete an account. The typed phrase is checked first, then
 * the shared delete. A second POST never reaches this handler: the erase ended the session, so the router answers 401.
 * If the handler is called again with the same hash, findOwner finds no live owner (no row, or the banned tombstone),
 * the outcome is 'unauthenticated' and nothing is erased.
 * On success the session is ended by the erase (its register_sessions rows go) and both cookie names are cleared.
 */
export function accountDeleteRoutes(deps: AccountDeleteDeps): readonly ApiRoute[] {
  return [
    {
      method: 'POST',
      pattern: /^\/account\/delete$/,
      scope: 'manage',
      write: true,
      cookieOnly: true,
      async handler(ctx: ApiContext) {
        const identityHash = ctx.identityHash;
        if (identityHash === null) return sendProblem(ctx.res, 'unauthenticated');
        const confirm = await readConfirm(ctx.req);
        if (confirm !== DELETE_PHRASE) {
          return sendProblem(ctx.res, 'invalid', {}, 'The confirmation phrase does not match.');
        }
        const outcome = await deleteAccountData(deps, identityHash, ctx.ownerId);
        if (outcome === 'conflict') return sendProblem(ctx.res, 'conflict');
        if (outcome === 'body_unavailable') {
          return sendProblem(ctx.res, 'body_unavailable', {
            'retry-after': String(UNAVAILABLE_RETRY_SECONDS),
          });
        }
        if (outcome === 'unauthenticated') return sendProblem(ctx.res, 'unauthenticated');
        if (outcome === 'moved_in') return sendProblem(ctx.res, 'conflict', {}, MOVED_IN_DETAIL);
        ctx.res.writeHead(204, {
          'cache-control': 'no-store',
          'set-cookie': [...deps.clearCookies],
          ...SECURITY_HEADERS,
        });
        ctx.res.end();
      },
    },
  ];
}

/**
 * The production deps (C7-09a): the store's owner, roster and erase, the body link (null without NATS) and the cookie
 * clears. Structural, so a test can pass a fake store.
 */
export function accountDeleteDeps(
  store: {
    findOwner(identityHash: string): Promise<{ readonly banned: boolean } | null>;
    listPlayers(identityHash: string): Promise<readonly DeletablePlayer[]>;
    eraseAccount(identityHash: string): Promise<boolean>;
    movedInPlayers(identityHash: string): Promise<readonly { readonly status: string }[]>;
  },
  body: BodyStopLink | null,
  clearCookies: readonly string[],
  log?: (line: string) => void,
): AccountDeleteDeps {
  return {
    findOwner: (identityHash) => store.findOwner(identityHash),
    listPlayers: (identityHash) => store.listPlayers(identityHash),
    eraseAccount: (identityHash) => store.eraseAccount(identityHash),
    movedInPlayers: (identityHash) => store.movedInPlayers(identityHash),
    clearCookies,
    body,
    log,
  };
}
