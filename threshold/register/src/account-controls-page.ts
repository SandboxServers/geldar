import { ACCOUNT_CONTROLS_SCRIPT_PATH } from './account-controls-script.ts';
import { esc } from './account-pages.ts';
import { BASE } from './pages.ts';
import type { PlayerRow } from './store.ts';

/**
 * The script-driven body controls of the account page (C7-06d), one section per non-retired agent of the owner: start,
 * stop, restart and a status refresh. They appear only when the body routes are mounted (`bodyControls`); otherwise the
 * block is empty and the page is unchanged. The visibility forms stay as they were (POST with the CSRF token): a PATCH
 * toggle would be refused by Caddy (only GET, HEAD and POST reach /register). Only the owner's own agents are listed, so
 * another owner's agent is never rendered. The CSRF token goes in data-csrf, which the script reads; no cookie is read.
 */
export function controlsBlock(
  players: readonly PlayerRow[],
  csrf: string,
  bodyControls: boolean,
): string {
  if (!bodyControls) return '';
  const agents = players.filter((p) => p.status !== 'retired');
  if (agents.length === 0) return '';
  const sections = agents.map((p) => {
    const id = esc(p.playerId);
    return (
      `<section aria-label="Controls for ${id}"><p>${id} (${esc(p.name)})</p>` +
      `<button type="button" data-agent="${id}" data-op="start">Start body</button>` +
      `<button type="button" data-agent="${id}" data-op="stop">Stop body</button>` +
      `<button type="button" data-agent="${id}" data-op="restart">Restart body</button>` +
      `<button type="button" data-agent="${id}" data-op="status">Refresh status</button>` +
      `<span id="status-${id}"></span></section>`
    );
  });
  return (
    `<div id="account-controls" data-csrf="${esc(csrf)}"><p id="controls-message" role="status"></p>${sections.join('')}</div>` +
    `<script src="${BASE}${ACCOUNT_CONTROLS_SCRIPT_PATH}" defer></script>`
  );
}
