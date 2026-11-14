import { isIP } from 'node:net';
import { esc } from './account-pages.ts';
import { BASE } from './pages.ts';

/** A held token waits this long for its one showing. After that the onboarding page shows no token. */
export const HANDOFF_TTL_MS = 10 * 60 * 1000;

/** The same-origin script the onboarding page loads (CSP script-src 'self'; no inline script). */
export const ONBOARDING_SCRIPT_PATH = '/onboarding.js';

/** The onboarding page's CSP: no inline script and no inline style. */
export const ONBOARDING_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

/** What the onboarding page shows once: the player, the new token and the expiry instant. */
export interface ShownToken {
  playerId: string;
  token: string;
  expiresAt: Date;
}

/**
 * Holds a freshly made token between the mint and the one page that shows it. A session has one slot,
 * keyed by its session hash, so another session never sees the token. The token lives only in memory.
 */
export class OnboardingHandoff {
  private readonly held = new Map<string, { shown: ShownToken; until: number }>();

  put(key: string, shown: ShownToken, now: number): void {
    for (const [k, entry] of this.held) {
      if (now >= entry.until) this.held.delete(k);
    }
    this.held.set(key, { shown, until: now + HANDOFF_TTL_MS });
  }

  /** Returns the held token and removes it, so a second call gets null. Null too once the TTL has passed. */
  take(key: string, now: number): ShownToken | null {
    const entry = this.held.get(key);
    this.held.delete(key);
    if (entry === undefined || now >= entry.until) return null;
    return entry.shown;
  }
}

/**
 * The MCP base of this deployment. The explicit REGISTER_MCP_PUBLIC_URL wins when set. Otherwise it is the register's
 * host with its first label replaced by `mcp`, and only when that host has at least three labels and is not an IP
 * literal (`example.com` would give `mcp.com`, a guess). Null otherwise: the page then shows no command and says why.
 */
export function mcpBaseFor(publicUrl: string, explicit = ''): string | null {
  if (explicit !== '') return explicit;
  if (!publicUrl.startsWith('https://')) return null;
  let url: URL;
  try {
    url = new URL(publicUrl);
  } catch {
    return null;
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(hostname) !== 0) return null;
  if (hostname.split('.').length < 3) return null;
  const host = url.host;
  const dot = host.indexOf('.');
  return `https://mcp.${host.slice(dot + 1)}`;
}

/** The copy buttons. Same origin, no eval, no innerHTML: it copies the text of the element named by data-copy. */
export const ONBOARDING_SCRIPT = `document.addEventListener('click', function (event) {
  var button = event.target;
  if (!(button instanceof HTMLElement)) return;
  var id = button.getAttribute('data-copy');
  if (id === null || !navigator.clipboard) return;
  var source = document.getElementById(id);
  if (source) navigator.clipboard.writeText(source.textContent || '');
});
`;

const wrap = (title: string, body: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}<script src="${BASE}${ONBOARDING_SCRIPT_PATH}" defer></script></body></html>`;

/** The once-only onboarding page: the token and two ready snippets. The token is only in this body. */
export function onboardingPage(shown: ShownToken, mcpBase: string | null): string {
  const snippets =
    mcpBase === null ? NO_MCP_ADDRESS : snippetsFor(shown, `${mcpBase}/p/${shown.playerId}`);
  return wrap(
    'Your token',
    `<h1>Connect ${esc(shown.playerId)}</h1>
<p>This token is shown once. It is not shown again, and it is never emailed. Copy it now.</p>
<p>Making a new token on your account page revokes the old one immediately. Agents connected with the old token stop working at once.</p>
<h2>Token</h2>
<pre id="token">${esc(shown.token)}</pre>
<p><button type="button" data-copy="token">Copy token</button></p>
${snippets}
<p>The player guide is docs/players/README.md in the Geldar repository.</p>
<p><a href="${BASE}/account">Back to your players</a></p>`,
  );
}

/** The two ready snippets for an MCP endpoint: the Claude Code command and the .mcp.json file. */
function snippetsFor(shown: ShownToken, endpoint: string): string {
  const claude = `claude mcp add --transport http geldar ${endpoint} --header "Authorization: Bearer ${shown.token}"`;
  const json = JSON.stringify(
    {
      mcpServers: {
        geldar: {
          type: 'http',
          url: endpoint,
          headers: { Authorization: `Bearer ${shown.token}` },
        },
      },
    },
    null,
    2,
  );
  return `<h2>Claude Code</h2>
<pre id="claude">${esc(claude)}</pre>
<p><button type="button" data-copy="claude">Copy command</button></p>
<h2>Headless: .mcp.json</h2>
<p>Save this in a private file. It holds the token.</p>
<pre id="mcpjson">${esc(json)}</pre>
<p><button type="button" data-copy="mcpjson">Copy .mcp.json</button></p>`;
}

/** Shown in place of the snippets when no valid MCP address is configured, so no wrong command is ever shown. */
const NO_MCP_ADDRESS = `<h2>No connect command</h2>
<p>No connect command is shown because this deployment has no MCP address. Set REGISTER_MCP_PUBLIC_URL, or use a public REGISTER_PUBLIC_URL with a name of at least three labels that is not an IP address. Your token above is still valid. Ask the operator for the MCP address.</p>`;

/** The page after the first showing, or after the hold has run out. It never shows a token. */
export function onboardingEmptyPage(): string {
  return wrap(
    'Your token',
    `<h1>No token to show</h1>
<p>A token is shown once, straight after it is made, and it is not shown again. To get a new one, renew the token on your account page.</p>
<p><a href="${BASE}/account">Back to your players</a></p>`,
  );
}
