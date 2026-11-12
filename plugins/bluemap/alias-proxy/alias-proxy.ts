import { readFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { fileURLToPath } from 'node:url';

// Public BlueMap labels show private aliases, never agent usernames. This sits between the bluemap-web Caddy @live
// handler and Paper (paper:8101). It rewrites each player's `name` in live/players.json from a private JSON file
// ({"<username>": "<alias>"}, path in GELDAR_ALIASES_FILE) and passes every other live file through unchanged.
// FAIL CLOSED: a missing or invalid file, or a player without an alias, gets NEUTRAL_LABEL, never the raw name.
// An upstream reply that is not the expected shape is a 502, never the raw body. Runs as plain Node (type stripping).

export const NEUTRAL_LABEL = 'Ranger';
const LIVE_PATH = /^\/maps\/[A-Za-z0-9_-]+\/live\/([A-Za-z0-9_-]+)(\.json)?$/;

export type Aliases = ReadonlyMap<string, string>;

/** Reads the private alias file. Null when it is missing or not an object of non-empty strings. */
export function loadAliases(path: string | undefined): Aliases | null {
  if (!path) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const out = new Map<string, string>();
    for (const [user, alias] of Object.entries(parsed)) {
      if (typeof alias !== 'string' || alias.trim() === '') return null;
      out.set(user, alias);
    }
    return out;
  } catch {
    return null;
  }
}

/** Rewrites players.json. Returns null when the body is not {"players":[{...}]}: the caller must not pass it on. */
export function rewritePlayers(body: string, aliases: Aliases | null): string | null {
  let doc: unknown;
  try {
    doc = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return null;
  const players = (doc as { players?: unknown }).players;
  if (!Array.isArray(players)) return null;
  for (const p of players) {
    if (typeof p !== 'object' || p === null || Array.isArray(p)) return null;
    const player = p as { name?: unknown };
    const alias = typeof player.name === 'string' ? aliases?.get(player.name) : undefined;
    player.name = alias ?? NEUTRAL_LABEL;
  }
  return JSON.stringify(doc);
}

export type Proxy = { close: () => void; port: () => number };

export function startProxy(opts: {
  listen: number;
  upstreamHost: string;
  upstreamPort: number;
  aliasesFile: string | undefined;
  log?: (line: string) => void;
}): Promise<Proxy> {
  const log = opts.log ?? ((line: string) => console.log(line));
  let lastState = '';
  const note = (state: string, line: string): void => {
    if (state !== lastState) log(line);
    lastState = state;
  };
  const server = createServer((req, res) => {
    const match = LIVE_PATH.exec(req.url ?? '');
    if ((req.method !== 'GET' && req.method !== 'HEAD') || !match) {
      res.writeHead(404).end();
      return;
    }
    const isPlayers = match[1] === 'players';
    const up = request(
      {
        host: opts.upstreamHost,
        port: opts.upstreamPort,
        method: 'GET',
        path: req.url,
        headers: { accept: 'application/json', 'accept-encoding': 'identity' },
      },
      (upRes) => {
        const chunks: Buffer[] = [];
        upRes.on('data', (c: Buffer) => chunks.push(c));
        upRes.on('end', () => {
          const raw = Buffer.concat(chunks);
          const type = upRes.headers['content-type'] ?? 'application/json';
          const status = upRes.statusCode ?? 502;
          let out: Buffer | string = raw;
          if (isPlayers && status === 200) {
            const aliases = loadAliases(opts.aliasesFile);
            if (aliases) note('ok', 'alias-proxy: alias file loaded');
            else
              note('missing', 'alias-proxy: alias file missing or invalid, every label is neutral');
            const rewritten = rewritePlayers(raw.toString('utf8'), aliases);
            if (rewritten === null) {
              note(
                'bad-upstream',
                'alias-proxy: unexpected players.json shape, refusing to pass it on',
              );
              res.writeHead(502).end();
              return;
            }
            out = rewritten;
          } else if (isPlayers) {
            // An error body from Paper may echo a name; send the status only.
            res.writeHead(status).end();
            return;
          }
          res.writeHead(status, { 'content-type': type, 'cache-control': 'no-cache' });
          res.end(req.method === 'HEAD' ? undefined : out);
        });
      },
    );
    up.on('error', () => res.writeHead(502).end());
    up.end();
  });
  return new Promise((ok) => {
    server.listen(opts.listen, () => {
      const addr = server.address();
      ok({
        close: () => server.close(),
        port: () => (typeof addr === 'object' && addr ? addr.port : 0),
      });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void startProxy({
    listen: Number(process.env.GELDAR_ALIAS_PROXY_PORT ?? 8102),
    upstreamHost: process.env.GELDAR_ALIAS_UPSTREAM_HOST ?? 'paper',
    upstreamPort: Number(process.env.GELDAR_ALIAS_UPSTREAM_PORT ?? 8101),
    aliasesFile: process.env.GELDAR_ALIASES_FILE,
  });
}
