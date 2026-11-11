import type { PlayerRow } from './store.ts';

export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const page = (title: string, body: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;

const form = (action: string, csrf: string, inner: string): string =>
  `<form method="post" action="${esc(action)}"><input type="hidden" name="csrf" value="${esc(csrf)}">${inner}</form>`;

export function accountPage(
  players: readonly PlayerRow[],
  csrf: string,
  harnesses: readonly string[],
  notice = '',
): string {
  const rows = players
    .map((p) => {
      const actions =
        p.status === 'retired'
          ? ''
          : form(
              `/players/${p.playerId}/token`,
              csrf,
              '<button type="submit">New token (revokes the old one)</button>',
            ) +
            form(`/players/${p.playerId}/retire`, csrf, '<button type="submit">Retire</button>');
      return `<li>${esc(p.playerId)} (${esc(p.name)}, ${esc(p.harness)}, ${esc(p.status)})${actions}</li>`;
    })
    .join('');
  const options = harnesses.map((h) => `<option>${esc(h)}</option>`).join('');
  const create = form(
    '/players',
    csrf,
    `<label>Player id <input name="player_id" pattern="ag-[a-z0-9]+(-[a-z0-9]+)*" required></label>
<label>Display name <input name="name" maxlength="32" required></label>
<label>Harness <select name="harness">${options}</select></label>
<button type="submit">Create player</button>`,
  );
  const note = notice === '' ? '' : `<p>${esc(notice)}</p>`;
  return page(
    'Your players',
    `<h1>Your players</h1>${note}<ul>${rows}</ul><h2>New player</h2>${create}`,
  );
}

/** The once-only token page. The value is in this response and nowhere else. */
export function tokenPage(playerId: string, token: string): string {
  return page(
    'Your token',
    `<h1>Token for ${esc(playerId)}</h1><p>Copy it now. It is shown once and cannot be shown again.</p><pre>${esc(token)}</pre><p><a href="/account">Back to your players</a></p>`,
  );
}
