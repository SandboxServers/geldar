import type { ServerResponse } from 'node:http';
import { esc, form, page } from './account-pages.ts';
import {
  type AccountDeleteDeps,
  DELETE_PHRASE,
  deleteAccountData,
  MOVED_IN_DETAIL,
} from './api/account-data-delete.ts';
import { UNAVAILABLE_RETRY_SECONDS } from './api/body.ts';
import { errorPage } from './errors.ts';
import { BASE, SECURITY_HEADERS } from './pages.ts';

/**
 * The typed-phrase confirmation of the account delete (C7-09a). A plain form: the page posts the phrase and the page CSRF
 * token to the same account path, and the page action runs the one shared delete. No script is needed.
 */
export function deleteAccountPage(csrf: string, notice = ''): string {
  const note = notice === '' ? '' : `<p>${esc(notice)}</p>`;
  return page(
    'Delete your account',
    `<h1>Delete your account</h1>${note}<p>This removes your account and your players. Each player's body is stopped first. This cannot be undone.</p><p>If the operator moved a player to your account, the delete is refused until that player is moved away.</p><p>Event history is kept, as the rules require.</p>${form(
      '/register/account/delete',
      csrf,
      `<label>Type &quot;${esc(DELETE_PHRASE)}&quot; to confirm <input name="phrase" autocomplete="off" required></label><button type="submit">Delete my account</button>`,
    )}<p><a href="/register/account">Back to your players</a></p>`,
  );
}

/** The signed-in owner the page action acts for. */
export interface DeleteSession {
  readonly csrf: string;
  readonly identityHash: string;
  readonly ownerId: string;
}

function send(res: ServerResponse, status: number, body: string, extra = {}): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    ...SECURITY_HEADERS,
    ...extra,
  });
  res.end(body);
}

/**
 * The account delete page action (C7-09a). CSRF, the origin and the ban were checked by the caller. The phrase is
 * checked here, then the same shared delete the API route runs. Nothing is removed unless the outcome is 'deleted'.
 * A stop that failed answers 503 with the page, and the erase is not called.
 */
export async function runAccountDelete(
  res: ServerResponse,
  deps: AccountDeleteDeps | undefined,
  s: DeleteSession,
  fields: URLSearchParams,
  log: (line: string) => void,
): Promise<void> {
  if (!deps) {
    send(res, 404, errorPage(404));
    return;
  }
  if (fields.get('phrase') !== DELETE_PHRASE) {
    send(res, 422, deleteAccountPage(s.csrf, 'The confirmation phrase does not match.'));
    return;
  }
  const outcome = await deleteAccountData(deps, s.identityHash, s.ownerId);
  if (outcome === 'deleted') {
    log('account deleted');
    res.writeHead(302, {
      location: BASE,
      'set-cookie': [...deps.clearCookies],
      ...SECURITY_HEADERS,
    });
    res.end();
    return;
  }
  if (outcome === 'unauthenticated') {
    send(res, 403, errorPage(403));
    return;
  }
  if (outcome === 'conflict') {
    send(res, 409, deleteAccountPage(s.csrf, 'An agent is busy. Try again shortly.'));
    return;
  }
  if (outcome === 'moved_in') {
    send(res, 409, deleteAccountPage(s.csrf, MOVED_IN_DETAIL));
    return;
  }
  send(
    res,
    503,
    deleteAccountPage(s.csrf, 'An agent body could not be stopped. Nothing was deleted.'),
    { 'retry-after': String(UNAVAILABLE_RETRY_SECONDS) },
  );
}
