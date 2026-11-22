---
title: Glass and Kino
type: reference
audience: agents-never
status: draft
last_verified: 2026-11-16 against 1b114276
companions: [README.md, geldar-core-plugin.md, ../concepts/observation-and-privacy.md, ../operations/monitoring-and-vitals.md, ../runbooks/kino.md, ../runbooks/glass-aliases.md, database-schema.md, compose-stacks.md]
sources: [README.md, glass/README.md, glass/package.json, glass/src/routes.ts, glass/src/http.ts, glass/src/static-files.ts, glass/src/main.ts, glass/src/session.ts, glass/src/alias.ts, glass/test, sql/0005_glass_reader.sql, compose/colo.yml, compose/colo-kino.yml, compose/colo-kino-session.yml, deploy/caddy, .github/workflows/colo-images.yml, docs/spec.md, docs/decisions/README.md, docs/decisions/0361-agents-never-placement-and-public-detail.md]
---

# Glass and Kino

Glass (`glass/`, package `@geldar/glass`) is the Thought Stream server: a read-only web server for humans that shows what agents think, do and say. Kino is the camera page Glass serves when the owner switches it on. This page lists Glass's routes, its read-only guarantees and its data sources, at the level the public [README](../../README.md) and the spec state. Further detail is withheld under decision [0361](../decisions/0361-agents-never-placement-and-public-detail.md).

**Audience: agents-never.** Never link, copy or quote this page from a path an agent reads ([documentation style](../agents/documentation-style.md#paths-an-agent-reads)).

Everything below was read from the files in `sources:` at commit `1b114276` on 2026-11-16. Nothing was read from the node (plan decision D8): whether Kino is on there is unverified.

Related: [Geldar-Core](geldar-core-plugin.md) (the world side of the Kino feed), the runbooks [kino](../runbooks/kino.md) and [glass-aliases](../runbooks/glass-aliases.md), [observation-and-privacy](../concepts/observation-and-privacy.md) (the why), [database-schema](database-schema.md) and [compose-stacks](compose-stacks.md). Alerts and vitals: [monitoring-and-vitals](../operations/monitoring-and-vitals.md).

## Public rules

These are the rules the public README and the spec state. Nothing on this page goes further.

| Rule | Source |
|---|---|
| The Observatory is what humans use to watch: the map, the thought stream, dashboards and spectators. | spec sections 2a, 3 and 5.13 |
| Glass is the thought stream: what agents think, say and do. | root `README.md`, "Watch it live" |
| The live pages are read-only, with no login, and nothing on them lets a viewer reach into the world. | root `README.md` |
| Kino: agent cameras in the browser, "coming soon". | root `README.md` |
| Agents are not told they are watched; no viewer link or hint appears in anything an agent can read. | root `README.md`, "Principles"; decision [0059](../decisions/0059-identity-mode-is-about-human-observation-not-agent-belief.md) |
| Glass and BlueMap are public, read-only, hardened before exposure. | decision [0072](../decisions/0072-glass-and-bluemap-are-public.md) |
| Anonymous viewers read the thought stream and the map; cameras need an owner or admin login. | decision [0077](../decisions/0077-invitee-auth-and-the-0072-0075-login-rule.md) (index title) |

## Package

| Field | Value | Evidence |
|---|---|---|
| Runtime | Node 22, TypeScript run directly (`node src/main.ts`), `node:http` and `pg` | `glass/README.md`, `glass/package.json` |
| Files | 170 tracked; 80 test files | `git ls-files glass \| Measure-Object -Line`; `git ls-files glass/src glass/test \| Select-String 'test.ts$'`, 2026-11-16 at 1b114276 |
| Image | `glass/Dockerfile`, job `glass` in `.github/workflows/colo-images.yml` | workflow |
| Local run | `./geldar.ps1 glass up\|down\|status\|logs` (logic in `tools/glass-ctl`), on `127.0.0.1` | `glass/README.md` |
| Colo service | `glass` in `compose/colo.yml`; Kino overlays `compose/colo-kino.yml` and `compose/colo-kino-session.yml` | compose files |
| Public entry | Caddy site file `deploy/caddy/glass.caddy` | `glass/README.md` |
| Owner | Not named in the code or the plan. Plan decision D3 asks for a campaign or coordinator role; none is assigned yet. | `docs/analysis/docs-library/plan.md` sections 7 and 12 |

## Routes

The Thought Stream routes and static files answer `GET` and `HEAD`; any other method on a known path gets `405`, an unknown path `404`. A `Host` header that is not loopback or a configured public name gets `421` before any route runs (`glass/src/http.ts`, `glass/README.md`).

### Thought Stream API

The route table is `ROUTES` in `glass/src/routes.ts`; `routes.test.ts` enumerates it.

| Route | Returns |
|---|---|
| `GET /api/agents` | The agents, without owner, harness or model configuration. |
| `GET /api/thoughts` | Thoughts, newest first, one page at a time, with a cursor. |
| `GET /api/thoughts/:id` | One thought. |
| `GET /api/receipts?action_id=` | The receipts of one action. |
| `GET /api/stream` | Server-sent events, one `thought` event per new thought. |
| `GET /api/session` | The viewer: signed in or not, admin or not. |

### Static files

From `glass/public/`: `/`, the stylesheets `/fonts.css`, `/app.css`, `/entries.css` and `/reader.css`, the page script `/app.js`, the service worker `/sw.js`, `/manifest.webmanifest`, the typefaces under `/fonts/` and the app icons under `/icons/`. From `glass/src/` with types stripped: the `render-*.ts` modules under `/js/`. The table is `glass/src/static-files.ts`; a request picks an entry of it and never names a file on disk (decision [0410](../decisions/0410-glass-mobile-redesign-and-pwa.md)).

### Kino (only when enabled)

Without `GELDAR_KINO_ENABLED` set to `1` or `true`, Glass opens no NATS connection and serves no Kino page (`glass/src/main.ts`). With it, Glass serves the Kino page under `/kino/` (decision [0075](../decisions/0075-glass-is-a-lakitu-camera.md)). Kino routes and their rules are withheld under decision 0361.

## Read-only guarantees

| Guarantee | How it holds | Enforced by |
|---|---|---|
| No write routes | Only `GET` and `HEAD` are served. | `glass/test/readonly-routes.test.ts` (every path and method over a real socket) |
| Read-only database role | Glass connects only as `geldar_glass`, and refuses any other user. The role has `SELECT` grants and `EXECUTE` on named functions, no table write grants. | `sql/0005_glass_reader.sql` and later grants; `GELDAR_GLASS_PG_USER` check (`glass/README.md`) |
| Read-only SQL | The shipped source may send only `SELECT`, `BEGIN READ ONLY`, `ROLLBACK` and `SET`. | `glass/test/import-graph.test.ts` |
| No path back into the agents | Glass imports nothing from `animus`, `golem` or `threshold`. Nothing feeds Glass back into any agent's prompt or plan. | `import-graph.test.ts`; `glass/README.md` |
| No secrets in output | No reply or log carries the password, its file path or the connection target. | `glass/test/no-secrets.test.ts` |
| No agent board | The static file set is exactly the page, its stylesheet and its script. | `glass/test/no-board.test.ts` |
| Model input not shown | Glass does not send a thought's model input. Changing that needs an owner-signed privacy review. | `glass/README.md` |

## Data sources

| Source | What Glass reads | Evidence |
|---|---|---|
| Postgres tables | `SELECT` on `thoughts`, `actions`, `receipts`, `intents`; listed columns of `agents` and `events` (not `events.payload`) | `sql/0005_glass_reader.sql` and later grants |
| Postgres functions | `EXECUTE` on named functions; the full list is the re-derive below | `GRANT EXECUTE ... TO geldar_glass` in `sql/` |
| Not granted | `memories`, any `mcp_*` table, character-sheet data | `glass/README.md`; `sql/0050_character_sheet_xp.sql`, `sql/0051_character_audit.sql` comments |
| Sign-in | Reads the viewer's sign-in; never sets, extends or clears it | `glass/src/session.ts` |
| Display aliases | Display names only (runbook [glass-aliases](../runbooks/glass-aliases.md)) | `glass/src/alias.ts` |

Re-derive: `git grep -n 'TO geldar_glass' -- sql`.

## Configuration

Names only, read from `glass/src` (`git grep -ohE 'GELDAR_[A-Z0-9_]+' -- glass/src`, 2026-11-16). Defaults, limits and the remaining settings are withheld under decision 0361. Secrets are files named by a variable, held by the operator, never in the repo.

| Group | Variables |
|---|---|
| Bind and hosts | `GELDAR_GLASS_HOST`, `GELDAR_GLASS_PORT`, `GELDAR_GLASS_PUBLIC_HOSTS`, `GELDAR_IN_NETWORK_HOSTS` |
| Database | `GELDAR_GLASS_PG_HOST`, `GELDAR_GLASS_PG_PORT`, `GELDAR_GLASS_PG_DB`, `GELDAR_GLASS_PG_USER`, `GELDAR_GLASS_PG_PASSWORD_FILE` |
| Switches | `GELDAR_GLASS_ENABLED` (service kill switch, read at start), `GELDAR_KINO_ENABLED` (Kino, off unless `1` or `true`) |

## Build, test, deploy

- Tests: `./geldar.ps1 pnpm test glass` (Vitest, fake databases and stream sources). `$env:GELDAR_IT = '1'` adds `glass/test/glass.it.test.ts` against a scratch Postgres; CI runs it in the `integration` job (`glass/README.md`).
- Image: built by `.github/workflows/colo-images.yml`, whose path filter includes `glass/**`.
- Deploy and the Kino switch: [kino](../runbooks/kino.md); [deploy-scripts](deploy-scripts.md) and [compose-stacks](compose-stacks.md).

## Failure modes

| Cause | Behaviour | Evidence |
|---|---|---|
| Postgres error | Clients get `internal error`; the error is not sent. | `glass/README.md` |
| NATS unreachable with Kino on | Kino stays off; the Thought Stream starts regardless. | `glass/src/main.ts` |

## Retirement and reset

- Off switches: `GELDAR_GLASS_ENABLED=false` (restart, drops every stream), or the Caddy off switch (`glass/README.md`). Kino has its own switch, `GELDAR_KINO_ENABLED`.
- The Thought Stream keeps no state of its own; it reads the tables above.

## Conflicts recorded

1. **Kino status.** Root `README.md`: Kino "coming soon". Code: Kino exists in `glass/src/kino/`, `glass/web/kino/`, `plugin/core` and migrations 0014 to 0019, off by default. Plan finding F-8 asks the owner whether the gap is deliberate; still open.
2. **Route list.** `glass/README.md` lists five API routes. `glass/src/routes.ts` has six: `/api/session` is missing from the README.
3. **"Writes nothing to NATS."** The header of `glass/test/import-graph.test.ts` says Glass must not import a package that can write to NATS; the same file makes one exception for Kino (decision 0075).
4. **Spec section 5.14 (Watched row, line 806) and Appendix B.3 (line 1633) against decision [0059](../decisions/0059-identity-mode-is-about-human-observation-not-agent-belief.md)** (cited in [Public rules](#public-rules)). Open, owner decision.

## Detail withheld, owner decision D9

Further detail is withheld under decision [0361](../decisions/0361-agents-never-placement-and-public-detail.md). Who may read a thought is set by decision [0138](../decisions/0138-thought-visibility.md).
