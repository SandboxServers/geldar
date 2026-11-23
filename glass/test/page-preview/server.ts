// The Thought Stream page without Postgres or a shard, for looking at it while changing it. The page, its
// files, the Content-Security-Policy, the Host check, the rate limits and the 404s are Glass's real handler
// (glass/src/http.ts) under the limits it ships with. Only the data is invented (sample.ts): this server
// answers the /api/ routes itself, with a live entry every few seconds. Test-only, loopback only, never
// deployed.
//
//   node glass/test/page-preview/server.ts [port] [live-entry-seconds] [delay-seconds] [limited|unlimited] [kino]
//
// Defaults: 8790, 5 and 60. 0 live-entry-seconds means no live entries. Open http://localhost:8790/.
// The word "unlimited" as the fourth argument turns the rate limits off, for a script that loads the page
// many times in a row (screenshots). Leave it out (or say "limited") to see what a visitor gets. The word
// "kino" as the fifth shows the page as it is served when Kino is mounted, with the Kino tab; the link
// itself leads nowhere here (the Kino preview is glass/test/kino-preview/server.ts).

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHandler } from '../../src/http.ts';
import { buildLimiters } from '../../src/policy.ts';
import type { SqlClient } from '../../src/query.ts';
import type { SseHub } from '../../src/sse.ts';
import { AGENTS, type Entry, entry, HISTORY, POOL, type Row } from './sample.ts';

const port = Number(process.argv[2] ?? 8790);
const liveSeconds = Number(process.argv[3] ?? 5);
const delaySeconds = Number(process.argv[4] ?? 60);
// The limits Glass ships with (the defaults in glass/src/config.ts), so a page that asks for too much is refused here too.
const limits =
  process.argv[5] === 'unlimited'
    ? {}
    : buildLimiters({ perMinute: 60, burst: 20, maxClients: 1024 });

const DAY_MS = 86_400_000;
const now = Date.now();
/** Every entry, newest first. */
const entries: Entry[] = [];
for (let k = 0; k < 9; k += 1) {
  const line = POOL[(POOL.length - 1 - k) % POOL.length];
  if (line !== undefined)
    entries.push(entry(line, now - delaySeconds * 1000 - k * 137_000 - 20_000));
}
for (const line of HISTORY) entries.push(entry(line, now - (line.daysAgo ?? 0) * DAY_MS));

const streams = new Set<ServerResponse>();
let cursor = 0;

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

/** The list route's filters, as the page uses them: agent, outcome, since, and a cursor that is a position. */
function page(query: URLSearchParams): { thoughts: Row[]; next: string | null } {
  const agent = query.get('agent');
  const outcome = query.get('outcome');
  const since = query.get('since');
  const rows = entries
    .map((e) => e.row)
    .filter((r) => agent === null || r.life_id === agent)
    .filter((r) => outcome === null || r.kind !== 'journal')
    .filter((r) => outcome === null || (outcome === 'parsed') === (r.parsed !== null))
    .filter((r) => since === null || Date.parse(String(r.at)) >= Date.parse(since));
  const from = Number(query.get('cursor') ?? 0);
  // A small first page, so "Load older" has something to load.
  const size = query.has('cursor') ? Number(query.get('limit') ?? 50) : 9;
  const next = from + size < rows.length ? String(from + size) : null;
  return { thoughts: rows.slice(from, from + size), next };
}

/** Answers the API routes from the sample. True when it answered. Everything else is Glass's handler. */
function api(req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url ?? '/', 'http://preview.invalid');
  if (!url.pathname.startsWith('/api/') || req.method !== 'GET') return false;
  if (url.pathname === '/api/agents') json(res, 200, { agents: AGENTS });
  else if (url.pathname === '/api/session') json(res, 200, { signedIn: false });
  else if (url.pathname === '/api/thoughts') json(res, 200, page(url.searchParams));
  else if (url.pathname === '/api/receipts') {
    const want = url.searchParams.get('action_id');
    const found = entries.find(
      (e) => Array.isArray(e.row.action_ids) && e.row.action_ids.includes(want),
    );
    json(res, 200, { receipts: found?.receipts ?? [] });
  } else if (url.pathname === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.write(': preview\n\n');
    streams.add(res);
    res.on('close', () => streams.delete(res));
  } else {
    const id = decodeURIComponent(url.pathname.slice('/api/thoughts/'.length));
    const found = entries.find((e) => e.row.thought_id === id);
    if (found === undefined) json(res, 404, { error: 'not found' });
    else json(res, 200, { thought: found.row });
  }
  return true;
}

const handler = createHandler({
  db: {} as SqlClient,
  hub: {} as SseHub,
  policy: { delaySeconds, ...limits },
  kinoMounted: process.argv[6] === 'kino',
  extra: api,
});

const server = createServer((req, res) => void handler(req, res));
server.listen(port, '127.0.0.1', () => {
  console.log(`glass page preview on http://localhost:${port}/ (invented data)`);
});

if (liveSeconds > 0) {
  setInterval(() => {
    const line = POOL[cursor % POOL.length];
    cursor += 1;
    if (line === undefined) return;
    const made = entry(line, Date.now() - delaySeconds * 1000);
    entries.unshift(made);
    // A stream frame carries less than a list row, as Glass's does (thoughtsAfter in query.ts).
    const { thought_id, life_id, at, wake_reason, parsed, tier, name, kind, text } = made.row;
    const frame = { thought_id, life_id, at, wake_reason, parsed, tier, name, kind, text };
    for (const res of streams) res.write(`event: thought\ndata: ${JSON.stringify(frame)}\n\n`);
  }, liveSeconds * 1000).unref();
}
