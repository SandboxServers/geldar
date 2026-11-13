# Glass

Glass is the Thought Stream: a read-only web server that shows humans what the agents in the
vivarium think, what they do, and what happens to them. It is a window for people. Glass is
**read-only**, **for humans only**, and **public behind Caddy** (decision 0072). Glass itself binds
loopback only by default and has no authentication (the in-network opt-in below is the one exception); the shared Caddy (`deploy/caddy/glass.caddy`) is the only
way in from outside. No agent reads from it, and nothing feeds Glass back into any agent's prompt or plan.

The package is `@geldar/glass` (`glass/`). It is Node 22 and TypeScript, using `node:http` and
`pg`. The page that people look at is in `glass/public`, and this package serves it with the data.

## Routes

Every route is `GET` or `HEAD`. Any other method gets `405` with an `Allow: GET, HEAD` header. An unknown path
gets `404`. All responses are `application/json` except the stream, and carry the headers below.

| Route | What it returns |
| --- | --- |
| `GET /api/agents` | The agents: id, name, life number, shard, mode, tier, birth day, death time and cause. Owner, harness and model configuration are left out. |
| `GET /api/thoughts` | Thoughts, newest first, one page at a time. Query: `agent`, `tier`, `outcome` (`parsed` or `unparsed`), `since`, `limit` (1 to 100, default 50), `cursor`. The reply has `next`, the cursor for the next page, or `null`. |
| `GET /api/thoughts/:id` | One thought, without its prompt or raw reply. |
| `GET /api/receipts?action_id=` | The receipts of one action. |
| `GET /api/stream` | Server-sent events: each new thought as a `thought` event, with a heartbeat comment every 15 seconds. |

Text fields hold agent-authored and world-authored text. The API returns it as JSON data, and
nothing in the API interprets it as HTML.

Headers on every response:

- `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`

The policy lets the page run only its own script and style from this origin. It forbids inline
script and style, images, base-URI changes, form posts, and framing by any other site. The test
`glass/test/readme.test.ts` compares this line with the code, so the two cannot drift apart.

There is no CORS header, so a page on another origin cannot read the API.

**Host check.** Glass answers only to a `Host` header that names loopback (`127.0.0.1`, `localhost`
or `[::1]`, with an optional port) or a name listed in `GELDAR_GLASS_PUBLIC_HOSTS`. Any other value, and a missing header, gets `421 Misdirected
Request` and a JSON error, on every route. This defends against DNS rebinding: a page on another
site can point its own name at `127.0.0.1` and then send requests to this port, and the browser
would send that site's name in `Host`. The check refuses those requests before any route runs.

## Configuration

Plain values come from the environment. The password comes from a file.

| Variable | Default | Notes |
| --- | --- | --- |
| `GELDAR_GLASS_HOST` | `127.0.0.1` | `127.0.0.1`, `localhost` or `::1`; `0.0.0.0` is accepted only with `GELDAR_IN_NETWORK_HOSTS=1`. Anything else is refused at start. The check runs before every listen. |
| `GELDAR_GLASS_PORT` | `8787` | The port Glass listens on. |
| `GELDAR_GLASS_PG_HOST` | `127.0.0.1` | Postgres host; `postgres` is accepted only with `GELDAR_IN_NETWORK_HOSTS=1`. |
| `GELDAR_IN_NETWORK_HOSTS` | unset | `1` lets Glass bind `0.0.0.0` and reach Postgres as `postgres`, for the compose network, where the port is published on host loopback only (decision 0131). |
| `GELDAR_GLASS_PUBLIC_HOSTS` | empty | Comma-separated public host names Glass answers to besides loopback (exact match, any case, optional port). |
| `GELDAR_GLASS_SSE_PER_CLIENT` | `2` | Open streams for one client key. The next gets `503`. If Caddy is not a trusted proxy, all visitors share one key, so the site is limited to this many viewers. |
| `GELDAR_GLASS_PG_PORT` | `5432` | Postgres port. |
| `GELDAR_GLASS_PG_DB` | `geldar` | Database. |
| `GELDAR_GLASS_PG_USER` | `geldar_glass` | Any other value is refused. Glass never connects as a write role. |
| `GELDAR_GLASS_PG_PASSWORD_FILE` | none, required | The file holds the `geldar_glass` password. No error message shows its contents. |
| `GELDAR_GLASS_SSE_MAX_CLIENTS` | `8` | Stream clients at once. The next one gets `503`. |
| `GELDAR_GLASS_SSE_BUFFER_FRAMES` | `100` | Frames held for one slow client. The oldest is dropped when it is full. |
| `GELDAR_GLASS_SSE_POLL_MS` | `1000` | How often the stream looks for new thoughts. |
| `GELDAR_GLASS_ENABLED` | `true` | The service kill switch. It is read once at start, so flipping it needs a restart, which drops every stream. The fast switch is Caddy: load `deploy/caddy/glass-off.caddy` in place of `glass.caddy` and reload. |
| `GELDAR_GLASS_DELAY_SECONDS` | `60` | Thoughts are shown only after this many seconds. |
| `GELDAR_GLASS_SHOW_LIVING_SOVEREIGN` | `false` | The sovereign filter: while `false`, the thoughts and receipts of living sovereign agents are hidden. |
| `GELDAR_GLASS_TRUSTED_PROXIES` | empty | Comma-separated peer addresses whose `x-geldar-client-ip` header is believed. **Set it to Caddy's peer address.** While it is empty, every request is charged to Caddy's address and every visitor shares one rate-limit bucket. |
| `GELDAR_GLASS_RATE_PER_MINUTE` | `60` | Refill rate of each client's bucket. The next request gets `429`. |
| `GELDAR_GLASS_RATE_BURST` | `20` | Bucket size of each client. |
| `GELDAR_GLASS_RATE_MAX_CLIENTS` | `1024` | Client buckets kept at once. The least recently used is dropped. |

Size caps are fixed in the code, not configurable: a request body over 1 KiB gets `413` and a request
line or query that is too long gets `414`.

## Running it

`./geldar.ps1 glass up|down|status|logs` runs Glass detached on `127.0.0.1:8787` (the logic is in `tools/glass-ctl`). `status` probes the thoughts API. It needs the password file described under "The `geldar_glass` role" below.

To run it in the foreground instead, start it by hand from the repository root, with the variables above set:

```powershell
./geldar.ps1 pnpm --filter @geldar/glass start
```

It prints `glass listening on 127.0.0.1:<port>` when it is ready. Stop it with Ctrl+C.

## Seeing the page without a shard

```powershell
node glass/test/preview.ts          # http://127.0.0.1:8788/, sample data, a live entry every 6 seconds
node glass/test/preview.ts 8790 0   # another port, no live entries
```

The preview is the real handler (static files, Content-Security-Policy, Host check and routes) over invented
rows from `glass/test/preview-sample.ts`: long and short journal lines, a parsed and an unparsed thought, a dead
agent, a day of entries to page through, and hostile text. It needs no Postgres, binds loopback only and is not
part of the runtime. It does not model the visibility rules (the delay, hidden living sovereign agents), and its
sample thoughts carry an `action_id` so the receipts table can be seen; the live API returns none today. The
`web-designer` agent (`.claude/agents/web-designer.md`) uses it to look at a change in a browser.

## The `geldar_glass` role

Glass reads Postgres as the role `geldar_glass`. Migration `sql/0005_glass_reader.sql` creates the
role as `NOLOGIN`, with these grants and no others:

- `SELECT` on `thoughts`, `actions`, `receipts` and `intents`.
- `SELECT` on nine columns of `agents`: `agent_id`, `name`, `life_seq`, `shard`, `mode`, `tier`,
  `born_day`, `died_at`, `death_cause`. `personality_seed` is not among them.
- `SELECT` on six columns of `events`: `type`, `agent_id`, `world_day`, `world_tick`, `at`,
  `source_event_id`. `events.payload` carries raw world text and is not granted.

It has no write grants, no sequence grants, no default privileges, and no access to any `mcp_*`
table or to `memories`.

The role gets a login only when its password is set. Run the migrations first, then set the
password from a file in `compose/secrets/`:

```powershell
./geldar.ps1 db migrate
./geldar.ps1 db migrate --set-role-password geldar_glass --password-file compose/secrets/postgres-glass.txt
```

The password file is `compose/secrets/postgres-glass.txt`. It is gitignored with the rest of
`compose/secrets/`. No command creates it today: `./geldar.ps1 shard secrets` makes only the `postgres`, `rcon` and `velocity-forwarding` files. The owner creates it by hand: a random ASCII password on one line, written to that file with the owner-only ACL (the way `shard secrets` writes its files). Then run the `--set-role-password` command above. Never commit or paste the password. The migrate tool drops a leading byte-order mark and one
trailing newline, and refuses a password that starts or ends with whitespace, because Glass trims
its file and would otherwise authenticate differently. The migrate tool stores the password only as
a SCRAM-SHA-256 verifier. The password itself is never printed.

## Threat model

- **Untrusted world text.** Agent speech, chat, sign text and other world text reach the database
  as data. Glass returns it as JSON, and the page packet W6-10 renders it with escaping. The page
  is where cross-site scripting is handled; the API has no HTML to inject into.
- **No write routes.** Glass has no `POST`, `PUT`, `PATCH` or `DELETE` handler, and the database
  role cannot write. A write attempt gets `405` at the HTTP layer and `42501` at the database.
- **Bounded work.** The SSE hub caps clients and drops the oldest frame for a slow client. The
  heartbeat is every 15 seconds. The pool holds at most four connections, and each statement stops
  after 10 seconds. Thought lists take at most 100 rows a page, the stream reads 100 rows a poll,
  and a stream is ended after 10 minutes (the page reconnects).
- **No secrets in output.** Responses and logs carry no connection string, no password file path
  and no token. Postgres errors are not sent to clients; they receive `internal error`.
- **Public behind Caddy, loopback bind, no auth.** Glass is public through Caddy (decision 0072) and
  binds loopback only by default; do not publish its port on a public address. The in-network opt-in (`GELDAR_IN_NETWORK_HOSTS=1`) binds the compose network, and compose publishes the port on host loopback only. Anyone who can reach the
  port directly can read what Caddy would show. Other local users on the same machine can reach the
  port too. The `Host` check above stops DNS rebinding from a browser; it does not stop a local
  process that sends its own `Host`. Caddy sends `Host: localhost` to Glass for that reason.
- **Framing and injection in the page.** The CSP above blocks inline script, so an injected
  attribute or tag cannot run. The page builds its rows from text only: `textContent` and text nodes, with a
  search match inside a `<mark>` (`glass/src/render-view.ts`).
  The adversarial corpus (`glass/test/corpus.ts`) runs through the API, the stream and the page.
- **Copying an entry.** "Copy" writes one entry to the reader's clipboard as plain text, on their click, and
  only where the browser offers the Clipboard API (a secure context). The page never reads the clipboard and
  never writes markup to it. The text is the text on the page (`copyText` in `glass/src/render-model.ts`):
  every invisible character (controls, bidi overrides, zero-width and "tag" characters) is a visible marker
  such as `[U+202E]`, on the page and in the copy alike, so an entry cannot carry hidden text into wherever
  it is pasted. What an entry says in plain sight is still agent-written: treat a pasted entry as a quote,
  not as instructions or commands.
- **Model input and raw replies.** The database role may read the prompt and the raw reply of a
  thought, but Glass does not select or send them. Changing that needs an owner-signed privacy review.

## Tests

- `./geldar.ps1 check` runs the unit tests, which use fake databases and fake stream sources.
- `GELDAR_IT=1` runs `glass/test/glass.it.test.ts` against a scratch database on Postgres. CI runs
  these cases in the `integration` job. Locally they need `compose/secrets/postgres.txt` and a
  running Postgres.
