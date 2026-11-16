import type { IncomingMessage, ServerResponse } from 'node:http';
import { controlsBlock } from './account-controls-page.ts';
import { ACCOUNT_CONTROLS_SCRIPT_PATH, serveControlsScript } from './account-controls-script.ts';
import type { PlayerRow } from './store.ts';

export { ACCOUNT_PAGE_HEADERS } from './account-controls-script.ts';

/** The controls block of the account page. The body buttons appear only when the body routes are mounted (C7-06d). */
export const controlsOf = (
  players: readonly PlayerRow[],
  csrf: string,
  bodyControls?: boolean,
): string => controlsBlock(players, csrf, bodyControls === true);

/**
 * Answers the script path (C7-06d): the script on GET, `refuse` for any other method. Returns false for every other
 * path, so the account router carries on. Kept here so account.ts stays under its line cap.
 */
export function controlsRoute(
  path: string,
  req: IncomingMessage,
  res: ServerResponse,
  refuse: () => true,
): boolean {
  if (path !== ACCOUNT_CONTROLS_SCRIPT_PATH) return false;
  return req.method === 'GET' ? serveControlsScript(res) : refuse();
}
