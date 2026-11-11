# Wave C2b packets: Kino cards K01 to K08

Written 2026-11-11 after packet C2b-K00. Record: [0075](../../../decisions/0075-glass-is-a-lakitu-camera.md), amended 2026-11-11 with the owner rulings (the name is Kino). The older [c2b-packets.md](c2b-packets.md) keeps the Lakitu-era cards; these cards supersede its numbering. Conventions: [packet-conventions.md](../packet-conventions.md).

## Shared rules

- **Contract.** K00 defines the feed: `contract/schemas/kino-feed.schema.json` (server to browser: `hello`, `chunk_section`, `block_update`, `entity_positions`, `target_moved`, `bye`) and `kino-client.schema.json` (browser to server: `subscribe`, `unsubscribe` only). Cards consume the generated code and do not edit the schemas; a schema change is its own packet.
- **Principle 1.** Nothing in Kino can act on the world. No card adds a browser-to-server message beyond the two above.
- **Invisible.** No entity, tab-list entry, message or effect in the world. The feed reads loaded chunks only and never loads one.
- **Rulings.** Logged-in Microsoft personal accounts open cameras; owners target their own players' agents; admins (Postgres flag) target any agent; anonymous visitors watch only agents flagged for public viewing. Vanilla textures from the Mojang client jar via the map's `textures.json`, cached in the browser, never in the repo. 4 panes per session (a setting). Audit retained 90 days. No load cap at first: measure first. Kill switch and SigNoz metric.
- **Secrets.** No secrets, account names or IPs in the repo. The Entra app id is not a secret but is read from env, not committed.

## Order

K00 is done. **K01, K03 and K04 run in parallel after K00.** K02 needs K01 and K03. K05 needs K04. K06 needs K02 and K05. K07 needs K02. K08 needs everything else.

## K01: the feed plugin in Geldar-Core

- **Goal.** A plugin package that reads loaded chunks around a target agent and publishes the K00 messages on NATS.
- **May edit.**
  - `plugin/core/src/main/java/dev/geldar/core/kino/` (new)
  - `plugin/core/src/test/java/dev/geldar/core/kino/` (new)
  - `plugin/core/src/main/java/dev/geldar/core/GeldarCore.java` (one registration call behind a `kino.enabled` config key, default false)
  - `contract/src/subjects.ts` (the Kino subjects only)
- **Tests.**
  - Static scan: no `setCancelled`, `teleport`, `spawn`, `Scoreboard`, `BossBar`, `sendMessage`, `dispatchCommand`, `setType` and no generating chunk accessor in the package.
  - A fake world with an unloaded chunk returns no section and never calls a loading accessor (the fake throws).
  - The palette-v1 encoder round-trips against the documented packing for every bit width 0 to 12, and its output validates against the generated validators.
  - Block updates and entity positions validate against `kino-feed`.
  - Revert-check: skip the loaded check; the unloaded-chunk test must fail.

## K02: the Glass feed relay

- **Goal.** WebSocket (or SSE) from NATS to the browser, with auth checks and the pane cap.
- **May edit.**
  - `glass/src/kino/` (new), `glass/test/kino/` (new)
  - `glass/src/server.ts` (route registration only)
- **Tests.**
  - Target scope per request: owner on own agent allowed, owner on another's refused (`bye` `target_not_permitted`), admin allowed, anonymous allowed only on a public-flagged agent.
  - Pane cap: the fifth pane is refused with `pane_cap_reached`; a cap setting of 3 refuses the fourth; closing a pane frees its slot; an aborted or errored connection frees its slot (abort, close and error paths).
  - Inbound messages other than `subscribe` and `unsubscribe` are rejected and close the socket.
  - The relay uses a SELECT-only role and publishes nothing to NATS (decision 0072).

## K03: Microsoft sign-in, kino_admins, public flag, admin CLI

- **Goal.** Sign-in in Glass (Entra app "Geldar Kino", consumers authority, PKCE), the admin table, the public-view flag and the admin CLI.
- **May edit.**
  - `glass/src/auth/` (new), `glass/test/auth/` (new)
  - `db/migrations/` (one new migration: `kino_admins`, the public-view flag)
  - `tools/kino-admin/` (new CLI)
  - `.env.example` (variable names only: the app id and redirect URI)
- **Tests.**
  - PKCE: verifier and challenge match; a wrong state or verifier fails the callback.
  - Session cookie flags; an expired session is refused.
  - Admin CLI: grant and revoke change the flag; only the CLI writes `kino_admins`; the Glass role cannot.
  - The public-view flag is settable by the agent's owner and by an admin, and by no one else.
  - No token, account name or app id appears in logs or the repo.

## K04: the three.js renderer

- **Goal.** Render palette-v1 sections with vanilla textures fetched from the map's `textures.json`, cached in the browser.
- **May edit.**
  - `glass/web/kino/` (new), `glass/test/kino-web/` (new)
  - `glass/package.json` (pin three.js exactly)
- **Tests.**
  - Decoder: palette-v1 unpacking for every bit width, with the bit-0 case.
  - Mesher: face culling between neighbours, across section borders, and for air.
  - Texture loader uses the cache on the second load and never writes under the repo.
  - A repo check finds no texture image committed.

## K05: camera modes and collision

- **Goal.** Follow, orbit and free modes, bound by collision to the same voxels the mesher draws.
- **May edit.**
  - `glass/web/kino/camera/` (new), `glass/test/kino-web/camera/` (new)
- **Tests.**
  - The camera stops at a solid wall on each axis and each sign (+x, -x, +y, -y, +z, -z).
  - Orbit radius shrinks against a wall and recovers.
  - Follow keeps its offset in open space; free passes through air only.
  - The camera sends nothing to the server (no message other than `subscribe` and `unsubscribe`).

## K06: multi-pane and audit

- **Goal.** Up to the pane setting (4 by default) of independent panes per page, and an audit trail retained 90 days.
- **May edit.**
  - `glass/web/kino/panes/` (new), `glass/src/kino/audit.ts` (new), `glass/test/kino/audit.test.ts` (new)
  - `db/migrations/` (one new migration: the audit table and its retention)
- **Tests.**
  - Each pane has its own target and mode; closing one leaves the others up.
  - Audit rows record login hash, agent, pane, mode, start and stop, and no token or name (validates against `lakitu-audit` or its Kino successor).
  - Retention: rows older than 90 days are purged; rows at 89 days stay (boundary test).
  - A failed audit write is reported and does not leave a pane unaudited and open.

## K07: kill switch and SigNoz metric

- **Goal.** One switch that turns Kino off everywhere, and a metric for use.
- **May edit.**
  - `glass/src/kino/killswitch.ts` (new), `glass/src/kino/metrics.ts` (new), their tests under `glass/test/kino/`
  - `plugin/core/src/main/java/dev/geldar/core/kino/` (config reload hook only)
- **Tests.**
  - With the switch off, subscribe gets `bye` `kill_switch`; live panes receive `bye` `kill_switch` and close; flipping it back allows new panes.
  - The metric counts open panes, bytes sent and refusals by reason, with no agent, login or account label.
  - The plugin stops publishing when the switch is off.

## K08: deploy wiring

- **Goal.** Compose, Caddy and env wiring for Kino on the Colo.
- **May edit.**
  - `compose/` files for Glass and Caddy (Kino routes, env names), `docs/runbooks/` (one Kino runbook)
- **Tests.**
  - Compose config validates; the Kino route requires TLS and forwards the WebSocket upgrade.
  - The Entra app id and redirect URI come from env; `check:repo` finds no secret, account name or address.
  - Kino defaults to off until the owner enables it.