# Glass

Glass is the Thought Stream: a read-only web server that shows humans what the agents in the
vivarium think, what they do, and what happens to them. It is a window for people. Glass is
**read-only**, **for humans only**, and **loopback only**. No agent reads from it, and nothing
feeds Glass back into any agent's prompt or plan. Glass has **no authentication in Phase 0**: the
loopback bind is the only access control, so the port must not be published outside the host.

The package is `@geldar/glass` (`glass/`). It is Node 22 and TypeScript, using `node:http` and
`pg`. The page that people look at is in `glass/public`, and this package serves it with the data.

## Routes

Every route is `GET`. Any other method gets `405` with an `Allow: GET` header. An unknown path
gets `404`. All responses are `application/json` except the stream, and carry the headers below.

| Route | What it returns |
| --- | --- |
| `GET /api/agents` | The agents: id, name, life number, shard, mode, tier, birth day, death time and cause. Owner, harness and model configuration are left out. |
| `GET /api/thoughts` | Thoughts, newest first, one page at a time. Query: `agent`, `tier`, `outcome` (`parsed` or `unparsed`), `since`, `limit` (1 to 100, default 50), `cursor`. The reply has `next`, the cursor for the next page, or `null`. |
| `GET /api/thoughts/:id` | One thought with its `model_input`, capped at 64 KiB. |
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

**Host check.** Glass answers only to a `Host` header that names loopback: `127.0.0.1`, `localhost`
or `[::1]`, with an optional port. Any other value, and a missing header, gets `421 Misdirected
Request` and a JSON error, on every route. This defends against DNS rebinding: a page on another
site can point its own name at `127.0.0.1` and then send requests to this port, and the browser
would send that site's name in `Host`. The check refuses those requests before any route runs.

## Configuration

Plain values come from the environment. The password comes from a file.

| Variable | Default | Notes |
| --- | --- | --- |
| `GELDAR_GLASS_HOST` | `127.0.0.1` | Any other value is refused at start. The check runs before every listen. |
| `GELDAR_GLASS_PORT` | `8787` | The port Glass listens on. |
| `GELDAR_GLASS_PG_HOST` | `127.0.0.1` | Postgres host. |
| `GELDAR_GLASS_PG_PORT` | `5432` | Postgres port. |
| `GELDAR_GLASS_PG_DB` | `geldar` | Database. |
| `GELDAR_GLASS_PG_USER` | `geldar_glass` | Any other value is refused. Glass never connects as a write role. |
| `GELDAR_GLASS_PG_PASSWORD_FILE` | none, required | The file holds the `geldar_glass` password. No error message shows its contents. |
| `GELDAR_GLASS_SSE_MAX_CLIENTS` | `8` | Stream clients at once. The next one gets `503`. |
| `GELDAR_GLASS_SSE_BUFFER_FRAMES` | `100` | Frames held for one slow client. The oldest is dropped when it is full. |
| `GELDAR_GLASS_SSE_POLL_MS` | `1000` | How often the stream looks for new thoughts. |

## Running it

Glass has no compose service yet. The `./geldar.ps1 glass up` command arrives with packet W6-13.
Until then, start it by hand from the repository root, with the variables above set:

```powershell
./geldar.ps1 pnpm --filter @geldar/glass start
```

It prints `glass listening on 127.0.0.1:<port>` when it is ready. Stop it with Ctrl+C.

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
`compose/secrets/`. Create it with the password on one line. The migrate tool drops a leading byte-order mark and one
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
  and `model_input` is capped at 64 KiB.
- **No secrets in output.** Responses and logs carry no connection string, no password file path
  and no token. Postgres errors are not sent to clients; they receive `internal error`.
- **Loopback only, no auth in Phase 0.** Anyone who can reach the port can read every thought.
  Do not publish the port, and do not bind it to any other address. Other local users on the same
  machine can reach the port too; Phase 0 has no per-user access control. The `Host` check above
  stops DNS rebinding from a browser; it does not stop a local process that sends its own `Host`.
- **Framing and injection in the page.** The CSP above blocks inline script, so an injected
  attribute or tag cannot run. The page builds its rows with `textContent` only (`glass/src/render-view.ts`).
  The adversarial corpus (`glass/test/corpus.ts`) runs through the API, the stream and the page.
- **Model input and raw replies.** The role grant lets Glass read `thoughts.model_input` and
  `thoughts.raw_output`. Together these are the full prompt and the raw reply of each thought, and
  they can contain world text. Glass shows them to humans only; no agent reads Glass.

## Tests

- `./geldar.ps1 check` runs the unit tests, which use fake databases and fake stream sources.
- `GELDAR_IT=1` runs `glass/test/glass.it.test.ts` against a scratch database on the dev Postgres.
  It needs `compose/secrets/postgres.txt` and a running Postgres, so only the operator runs it.
