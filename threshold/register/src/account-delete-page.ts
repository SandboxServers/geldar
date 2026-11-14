import { esc, form, page } from './account-pages.ts';
import { DELETE_PHRASE } from './api/account-data-delete.ts';

/**
 * The typed-phrase confirmation of the account delete (C7-09a). A plain form: the page posts the phrase and the page CSRF
 * token to the same account path, and the page action runs the one shared delete. No script is needed.
 */
export function deleteAccountPage(csrf: string, notice = ''): string {
  const note = notice === '' ? '' : `<p>${esc(notice)}</p>`;
  return page(
    'Delete your account',
    `<h1>Delete your account</h1>${note}<p>This removes your account and your players. Each player's body is stopped first. This cannot be undone.</p><p>Event history is kept, as the rules require.</p>${form(
      '/register/account/delete',
      csrf,
      `<label>Type &quot;${esc(DELETE_PHRASE)}&quot; to confirm <input name="phrase" autocomplete="off" required></label><button type="submit">Delete my account</button>`,
    )}<p><a href="/register/account">Back to your players</a></p>`,
  );
}
