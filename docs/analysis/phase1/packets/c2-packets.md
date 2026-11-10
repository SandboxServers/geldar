# Phase 1 wave C2 (Doors): packet cards

Status as of 2026-11-10, branch `docs/phase1-packets-c2`, from `origin/main` (which now has the conventions and decisions 0076 to 0080). Planning only: nothing here is implemented. The rules are in [packet-conventions.md](../packet-conventions.md), the plan is [plan.md](../plan.md) section C2, and the wave breakdown is the planner schedule (ids, sizes, lanes, decision blocks and status are its proposals). The schedule's ids `P1-C2-NN` map one to one to the convention ids `C2-NN` used here, as conventions section 1 requires (`P1-C2-00` is `C2-00`).

Decisions this wave relies on: [0070](../../../decisions/0070-phase1-is-the-colo-first-shard.md) (invite-only, gates before invitations), [0071](../../../decisions/0071-public-endpoints-and-ports.md) (new TCP port, SRV record, shared Caddy reloaded never restarted, Azure DNS by owner-authorised `az`), [0072](../../../decisions/0072-glass-and-bluemap-are-public.md) (Glass and BlueMap public, hardening list), [0054](../../../decisions/0054-static-hashed-per-player-bearer-tokens.md) (static hashed bearer tokens, `gmcp-` prefix, HMAC pepper, `/p/<player_id>` must match), [0067](../../../decisions/0067-nats-accounts-and-least-privilege.md) (NATS accounts overlay, opt-in). Pre-packet records on `origin/main`, all Proposed until the owner confirms: [0076](../../../decisions/0076-backup-scope-and-destination.md) (backup scope; not used by C2), [0077](../../../decisions/0077-invitee-auth-and-the-0072-0075-login-rule.md) (invitee auth and the Lakitu login rule; it gates C2-01 issuing, C2-07 and C2b), [0078](../../../decisions/0078-mind-placement-for-phase1.md) and [0079](../../../decisions/0079-credit-numbers-and-charge-rules.md) (not used by C2), and [0080](../../../decisions/0080-nats-auth-cutover.md) (NATS auth cutover; it gates the C2-07 NATS default-on flip). A card that depends on a Proposed record says what to do while it is unconfirmed.

## 0. Facts from the code (run-main, 2026-11-10)

Each path was found with grep or git ls-files. Paths in this list are real; anything not listed must be located with a grep before use.

| Surface | Real paths | State on main |
|---|---|---|
| Public MCP HTTP front | `threshold/mcp/src/http/front.ts`, `auth.ts` (`clientAddress`, `trustedProxies`), `limits.ts`, `log.ts`; tests `http/client-address.test.ts`, `http/front-address.test.ts`, `http/limits.test.ts`, `http/auth-reasons.test.ts` | Trusted-proxy and forwarded-address code exists. It is inconsistent: `client-address.test.ts` uses `x-geldar-client-ip`, `front-address.test.ts` uses `CF-Connecting-IP`. C2-00 picks one. |
| MCP config | `threshold/mcp/src/config.ts`, `config-proxy.test.ts`; image `threshold/mcp/Dockerfile` (copies the whole repo, then `pnpm install --filter "@geldar/mcp..."`) | No public-surface config yet. |
| MCP tokens | `threshold/mcp/src/store/pg-tokens.ts`, `token-hash.ts`; CLI `tools/mcp-tokens` | Hashed tokens exist (0054). |
| Look tool | `threshold/mcp/src/tools/look.ts`, `play-view.ts`, `world.ts` | Look output still carries the fields C2-05 removes (locate with `grep -rn body_generation threshold/mcp/src`). |
| Compose MCP overlay | `compose/mcp.yml` (publishes on loopback) | Loopback only. |
| Velocity identity plugin | `plugin/velocity-identity/src/main/java/dev/geldar/identity/` (`IdentityPlugin.java`, `LoginGate.java`, `DenialLimiter.java`, `RegistryClient.java`, `LifeRegistry.java`) | Admits usernames found in the NATS life registry. Paper's whitelist is a second check. |
| Velocity config | `compose/velocity/velocity.toml` (`bind = "0.0.0.0:25565"` inside the container, modern forwarding) | No whitelist or spectator config yet. |
| Compose base | `compose/phase0.yml` (velocity published as `127.0.0.1:25565`; NATS `127.0.0.1:4222` with no accounts); overlay `compose/nats-auth.yml` | NATS accounts are opt-in (0067, 0080). |
| Cloudflare example | `compose/cloudflared/config.example.yml` | An example only. 0071 chose Caddy, so this file is not wired. |
| Glass server | `glass/src/http.ts` (already sends `Content-Security-Policy` and `X-Content-Type-Options: nosniff`, lines 26 and 28), `routes.ts`, `query.ts` (`limit` 1 to 100 is a query parameter, not a rate limit), `sse.ts`, `render-view.ts`, `page-safety.test.ts`, `config.ts`, `main.ts` | No rate limit, size cap, delay option or kill switch. |
| Glass DB role | `sql/0005_glass_reader.sql`, `sql/test/check-schema.sql` | The read-only role exists (`geldar_glass`). |
| BlueMap | none in the repo | C1 installs it (C1-09). |
| Caddy | none in the repo | C2-04 creates `deploy/caddy/`. |
| Port scan | none | C2-06 creates `tools/portscan/`. `tools/repo-checks/src/loopback-ports.ts` exists and is a related check. |
| Repo checks registry | `tools/repo-checks/src/*.ts` (`cli.ts` is the registry) | Owned by the C2-07 integration packet. |
| Entry point | `geldar.ps1` (`check` runs biome, typecheck, `pnpm test`, `check:repo`, `check:generated`, compose config for each `compose/*.yml`, then the plugin Gradle build) | Owned by C2-07. |
| Contract | `contract/schemas/*.json`, `contract/src/mcp.ts`, `contract/src/generated/*` (generated), `contract/scripts/generate.ts`; the top-level `oneOf` guard test is named in plan.md as `contract/test/mcp-toplevel.test.ts` (locate with `grep -rn mcp-toplevel contract`) | C2-00 is the only C2 packet that edits this. |
| Packages | `@geldar/mcp` (`threshold/mcp`), `@geldar/glass` (`glass`), `@geldar/contract` (`contract`), `@geldar/repo-checks` (`tools/repo-checks`), `@geldar/eventsink`, `@geldar/animus` | |
| Decisions index | `docs/decisions/README.md`; 0053 Status "Accepted (owner ruling, 2026-11-09 ...)" | 0053 is still Accepted; 0071 supersedes it. |

Gaps the cards must close (do not assume they are done): the header name is not fixed; Glass has no rate limit, size cap, delay or kill switch; the public MCP has no negative cache; the Velocity plugin has no spectator path; there is no Caddy snippet, no port scan and no BlueMap.

## 1. Card conventions for this file

- Each card has the fields of section 1 of the conventions, in order: `id`, `title`, `wave`, `lane`, `depends-on`, `status`, `size`, `may-edit`, `must-not-edit`, `decisions`, `checks`, `worknote`, `commit`, `on-cap`.
- `size`: S is about 25k working tokens and 25 to 35 tool uses; M is about 40k and 40 to 60; L is two sessions. Compose and live-stack packets are L.
- `must-not-edit` always includes `docs/spec.md` and the shared files of conventions section 3 (`geldar.ps1`, the repo-checks registry, `compose/*.yml`, `shards/*`, golem `view.ts`, `package.json` and the lockfile, `contract/`, and `docs/decisions/README.md`), unless the card owns them.
- Every card's worknote is `docs/analysis/phase1/worknotes/<id>.md`. Any index line is written there in the form `index: | [NNNN](NNNN-slug.md) | Title | Status |`.
- Status: B is buildable and testable on the desktop; O is blocked on owner or node access; B/O means build on the desktop and do the live step with the owner.
- Every behaviour change has a revert-check: revert the named line locally, run the named test, confirm it fails, restore it. The report names the test.
- Global never-do list for every brief: no `adam up`, and no `adam up --help` on a live node; no state-changing probe against a live shard; never weaken a test to pass; never `git reset`, `git stash` or `git checkout` on tracked work; never edit `docs/spec.md`; never push, open a PR, or prune a worktree; no IPs other than `127.0.0.1` and no account names or secrets in any file.

---

## 2. Cards: unblocker and fan-out (lanes A to C)

### C2-00: contract unblocker for the public surfaces

- `wave`: C2. `lane`: A. `depends-on`: C1-00 (merged). Schedule decision 0090. `status`: B. `size`: S.
- `may-edit`: `contract/schemas/mcp-common.schema.json`, `contract/schemas/mcp-play.schema.json`, `contract/src/mcp.ts`, `contract/src/generated/` (generator output only), the contract's test for the top-level guard (locate with `grep -rn mcp-toplevel contract`), `docs/decisions/0090-public-mcp-contract.md` (new; the file name is a suggestion, the number is reserved), `docs/decisions/0053-*.md` (Status line only).
- `must-not-edit`: `docs/spec.md`, `docs/decisions/README.md`, every `threshold/`, `glass/` and `plugin/` file, `compose/*`, `shards/*`, `geldar.ps1`, `package.json`.
- `decisions`: 0090 only. The record is the contract for the public MCP error shapes and the config key names; it also records that 0071 supersedes 0053, and the 0053 Status line changes to "Superseded by 0071 (2026-11-10)".
- `checks`: `./geldar.ps1 pnpm --filter @geldar/contract check:generated`; `./geldar.ps1 pnpm --filter @geldar/contract typecheck`; the top-level guard test (`./geldar.ps1 pnpm exec vitest run` on the file located above); `./geldar.ps1 check`.
- `worknote`: `docs/analysis/phase1/worknotes/C2-00.md`.
- `commit`: one commit, `contract: public MCP error shapes, client-ip header and kill-switch config (0090)`.
- `on-cap`: commit what passes, write the rest in the worknote, stop.

Steps:
1. Read `docs/analysis/phase1/worknotes/` for any C1 contract change, and `contract/src/mcp.ts` for the existing error shapes.
2. Fix one client-address header name for the whole stack. Use `x-geldar-client-ip`, since `client-address.test.ts` already uses it and 0071 only requires Caddy to set it. Record in 0090 that `CF-Connecting-IP` is not used, and that `front-address.test.ts` moves to the same name in C2-01.
3. Add the public error shapes to the schema: an unauthenticated refusal body (no detail that says whether a token is valid), a rate-limit refusal with a retry hint, and a kill-switch refusal. Each shape has a fixed `error.code` and no stack, no path and no internal host.
4. Add the config key names the packets read: `public.trustedProxies`, `public.clientIpHeader`, `public.rateLimit.*`, `public.killSwitch` (boolean). Name them in 0090; the shard file that carries values is owned by C2-07.
5. Run `./geldar.ps1 pnpm --filter @geldar/contract generate`, confirm that `check:generated` is clean, and confirm that the top-level guard test still passes (no top-level `oneOf`, `anyOf` or `allOf` in any new tool shape).
6. Write 0090 (status Proposed until the owner confirms) and the 0053 Status line.

Acceptance: `check:generated` clean; the guard test passes; a new schema test asserts each error shape has no key named `stack`, `path` or `host`.
Revert-check: in `contract/schemas/mcp-common.schema.json`, remove the `retryAfter` property from the rate-limit shape; the new shape test must fail. Restore.
Index line to add: `index: | [0090](0090-public-mcp-contract.md) | Public MCP contract: client-ip header, error shapes, kill-switch config | Proposed |`, and the 0053 Status change.

### C2-01: public MCP behind Caddy

- `wave`: C2. `lane`: A. `depends-on`: C2-00 (merged). Schedule decision 0091. `status`: B. `size`: M.
- `may-edit`: `threshold/mcp/src/http/` (the files named in section 0, plus new siblings), `threshold/mcp/src/config.ts`, `threshold/mcp/src/config-proxy.test.ts`, `threshold/mcp/src/store/pg-tokens.ts`, `threshold/mcp/src/tools/` only for the unauthenticated refusal path, and their tests. The invitee token issuing path in `tools/mcp-tokens/src/` (locate with `grep -rn "mint" tools/mcp-tokens/src`).
- `must-not-edit`: `docs/spec.md`, `contract/`, `compose/*`, `shards/*`, `geldar.ps1`, `tools/repo-checks/src/cli.ts`, `package.json`, `deploy/`.
- `decisions`: 0091 only. Invitee token issuing follows 0077 (`docs/decisions/0077-invitee-auth-and-the-0072-0075-login-rule.md`, Proposed) and 0054. If 0077 is not confirmed when the card starts, implement the issuing only behind a flag that defaults off, and say so in the worknote.
- `checks`: `./geldar.ps1 pnpm --filter @geldar/mcp typecheck`; `./geldar.ps1 pnpm exec vitest run threshold/mcp/src/http`; `./geldar.ps1 pnpm exec vitest run tools/mcp-tokens`; `./geldar.ps1 check`.
- `worknote`: `docs/analysis/phase1/worknotes/C2-01.md`.
- `commit`: `feat(mcp): trust only Caddy for the client address; negative cache for unauthenticated requests` (one per item: header and trusted peer; negative cache; invitee issuing).
- `on-cap`: commit what passes, write the rest, stop.

Steps:
1. Make the trusted peer list come only from config (`public.trustedProxies`, C2-00). The default is empty, so the header is ignored unless Caddy is the peer. Test: `client-address.test.ts` "ignores a forwarded header sent by a peer that is not trusted".
2. Read the client address from the header C2-00 fixed, and only from a trusted peer. Update `front-address.test.ts` to that header name, so both tests agree.
3. Add a negative cache for unauthenticated requests on `/p/<player_id>`: a short bounded table of recent failed bearer prefixes per client address, with a fixed size and an injected clock. A failed token gets 401 on every try, with the same body and the same latency class, and no reason is reported.
4. Keep the existing 403 (wrong player) and 401 (unknown token) split from 0054. Do not add a new reason. Confirm that `auth-reasons.test.ts` still pins the reasons.
5. Invitee issuing: a `mint` subcommand path for an invitee, gated by 0077. The token is printed once and only its HMAC is stored (0054, `token-hash.ts`).
6. Add the `public` config block, and the Dockerfile's `EXPOSE` is not changed here (the image slimming is C2-05).

Acceptance: the client-address and front-address tests pass; the negative-cache test passes with an injected clock (no real sleep); an invitee token is refused when 0077 is off.
Revert-checks: (a) in `threshold/mcp/src/http/auth.ts`, `clientAddress`, make it read the forwarded header when the peer is not trusted; `client-address.test.ts` test 1 must fail. (b) in the negative-cache code, skip the record step; the negative-cache test must fail. Restore both.
Index line to add: none unless C2-07 needs the `public` config keys in the shard file.

### C2-02: Velocity on the new TCP port

- `wave`: C2. `lane`: B. `depends-on`: C2-00. Schedule decision 0092. `status`: B; the port number and the live check are B/O. `size`: M.
- `may-edit`: `plugin/velocity-identity/src/main/java/dev/geldar/identity/` (new siblings, the `LoginGate` and `ReadinessFeed` files), `plugin/velocity-identity/src/test/` (the matching tests), `compose/velocity/velocity.toml` (only the forwarding and whitelist keys), `plugin/velocity-identity/build.gradle.kts` (no new dependency unless pinned with the lockfile).
- `must-not-edit`: `docs/spec.md`, `contract/`, `compose/phase0.yml` and any other compose file (the port publish is C2-07), `shards/*`, `geldar.ps1`, the Paper plugin under `plugin/core/`.
- `decisions`: 0092 only.
- `checks`: `cd plugin` then `./gradlew :velocity-identity:test --tests "dev.geldar.identity.*"` (confirm the project path in `plugin/settings.gradle.kts`); `./geldar.ps1 check` (includes the plugin build).
- `worknote`: `docs/analysis/phase1/worknotes/C2-02.md`.
- `commit`: `feat(velocity): spectator whitelist tied to the registry; ghosts forced to spectator` (one per item).
- `on-cap`: commit what passes, write the rest, stop.

Steps:
1. Read `LoginGate.java` and `LifeRegistry.java` to confirm that the registry check is the first gate. The whitelist for spectators is the registry membership (an admitted username), not a second list.
2. A username not in the registry is refused at login with a fixed message that does not name the registry or the life.
3. A registered username whose life is not live (ghost) is forced to spectator, not refused. The rule is taken from `ReadinessFeed` and `LifeRegistry`; document the exact state in 0092.
4. The port number is chosen at build time and is not in the repo until C2-07 publishes it. Put the value in the ops runbook section of the worknote, not in code. Confirm it is not a port already forwarded at the edge.
5. The SRV record is documented in the worknote only (`_minecraft._tcp` pointing at the chosen port); the record is created by the owner (0071).

Acceptance: JUnit tests for the three login outcomes (registered live, registered ghost, unregistered), each with a fake registry; no test opens a real socket.
Revert-check: in `LoginGate.java`, remove the unregistered-refusal branch; the unregistered test must fail. Restore.
Index line to add: `index: | [0092](0092-velocity-spectator-whitelist.md) | Velocity spectator whitelist and ghost rule | Proposed |`.

---

### C2-03: Glass hardening (0072)

- `wave`: C2. `lane`: C. `depends-on`: C2-00. Schedule decision 0093. `status`: B. `size`: M.
- `may-edit`: `glass/src/` (`http.ts`, `routes.ts`, `query.ts`, `config.ts`, `main.ts`, `sse.ts`, `render-*.ts` and their tests, new siblings such as `guard.ts` for the limiter), `glass/README.md`, `glass/test/` if it exists (locate with `ls glass`).
- `must-not-edit`: `docs/spec.md`, `sql/` (no new migration; a grant change is an index line for the integration packet), `contract/`, `compose/*`, `geldar.ps1`, `deploy/` (C2-04), `eventsink/`.
- `decisions`: 0093 only. The defaults the owner must confirm (the delay value, and whether a living sovereign's thoughts are shown on Glass) are listed in section 5 and gate this card's defaults: until confirmed, ship the delay option with the delay off, and the sovereign filter on.
- `checks`: `./geldar.ps1 pnpm --filter @geldar/glass typecheck`; `./geldar.ps1 pnpm exec vitest run glass/src`; `./geldar.ps1 check`.
- `worknote`: `docs/analysis/phase1/worknotes/C2-03.md`.
- `commit`: one commit per item, e.g. `feat(glass): per-client rate limit and request size cap` (0072 item 1 and 2), `fix(glass): escape agent text under the strict CSP` (item 3, where a gap is found), `feat(glass): delay option and kill switch` (items 4 and 5).
- `on-cap`: commit what passes, write the rest, stop.

Steps:
1. The strict CSP and `nosniff` already exist in `glass/src/http.ts` (lines 26 and 28). Confirm the policy is `default-src 'none'`, `script-src 'self'`, no `unsafe-inline`, and that it is on every response including errors (the "every response" rule).
2. Escaped agent text: `render-view.ts` and `page-safety.test.ts` already exist. Add adversarial fixtures (script tags, attribute breakouts, `javascript:` links, a closing tag in a thought) and assert that the rendered output has no raw markup from agent text. Revert-check: the escape call in `render-view.ts`.
3. Rate limit: a per-client-address token bucket with an injected clock, using the address rule from C2-00 (the trusted header from Caddy only). A refusal is 429 with `Retry-After`, a fixed body, and no state detail.
4. Size cap: reject a request body or query above a fixed bound before parsing; the `limit` query stays 1 to 100 (`query.ts`).
5. Delay option: `GELDAR_GLASS_DELAY_SECONDS` (default 0 until the owner confirms the value). Thoughts newer than the delay are not returned by the API or the SSE stream. Test with a fake clock.
6. Kill switch: a config flag (`GELDAR_GLASS_ENABLED`, default on) that makes every route return a fixed 503 and closes SSE streams. Test that the stream closes within one heartbeat.
7. No secret in any response or log: a test that greps the response bodies and logs for the connection string and the password path.
8. Confirm the `geldar_glass` role is the one the Glass test connects as (the backlog item). If the test currently uses another role, change it and note it in the worknote; the grant file is not edited.

Acceptance: each item has its test; the SSE kill-switch test and the delay test use fake clocks; the 0072 hardening list is fully covered (the list is the acceptance, and each item maps to a named test in the worknote).
Revert-checks: (a) `glass/src/http.ts` line 26, remove `script-src 'self'` from the CSP string; the CSP test must fail. (b) the rate limiter's refusal branch; the 429 test must fail. Restore both.
Index line to add: any grant change for `geldar_glass` (none expected).

### C2-04: BlueMap public through Caddy (0072, 0071)

- `wave`: C2. `lane`: D. `depends-on`: C1-09 (BlueMap installed), C2-00. Schedule decision 0094. `status`: B for the snippet and its checks; B/O for the live reload (owner or ops step). `size`: S.
- `may-edit`: `deploy/caddy/` (new directory: a site or snippet file for the BlueMap host, a README, and a validation script under `tools/` only if one is needed; name it in the worknote), `docs/analysis/phase1/worknotes/C2-04.md`.
- `must-not-edit`: `docs/spec.md`, `compose/*` (C2-07 wires the reload), `geldar.ps1`, `tools/repo-checks/src/cli.ts`, `shards/*`, `glass/`, `threshold/`.
- `decisions`: 0094 only.
- `checks`: `caddy validate --config <the snippet>` run in a pinned Caddy container (pin by digest; the coder records the digest and its release date, and the release must be at least two weeks old); `./geldar.ps1 check`.
- `worknote`: `docs/analysis/phase1/worknotes/C2-04.md`.
- `commit`: `feat(caddy): BlueMap read-only site snippet with a kill switch`.
- `on-cap`: commit what passes, write the rest, stop.

Steps:
1. The snippet serves only `GET` and `HEAD`; every other method gets 405 at Caddy. Test with `caddy validate` plus a matcher assertion in the README's check list.
2. Set the response headers that match Glass (the same CSP shape where BlueMap allows it; where BlueMap needs an inline style, record the exception in 0094 and do not widen it elsewhere).
3. Rate limit: core Caddy has no built-in rate limiter. Either a pinned third-party module (a build step that must be owner-approved, since it adds a supply-chain dependency) or the limit moves to the BlueMap host. Default for this card: write the snippet without a rate limit, record the gap in 0094, and open the question in section 5. Do not add an unpinned plugin.
4. Kill switch: a Caddy `respond 503` block, kept in a separate file so a single `caddy reload` turns BlueMap off without touching other sites.
5. Document the reload procedure in `deploy/caddy/README.md`: `caddy reload` only, never `systemctl restart caddy` or a container restart, because the node's shared Caddy serves other sites (0071 item 6).
6. The host name is `map.<project domain>`; the domain is a placeholder in the file, not a real value.

Acceptance: `caddy validate` passes; a test or check asserts that the snippet has no `reverse_proxy` to an internal address other than the BlueMap service name, and no `127.0.0.1` other than the BlueMap listener.
Revert-check: in the snippet, remove the method matcher; the method test must fail. Restore.
Index line to add: `index: | [0094](0094-bluemap-public-read-only.md) | BlueMap public, Caddy snippet, kill switch | Proposed |`.

### C2-05: look projection cleanup and MCP image slimming

- `wave`: C2. `lane`: E. `depends-on`: C2-00. Schedule decision 0095. `status`: B. `size`: M.
- `may-edit`: `threshold/mcp/src/tools/look.ts`, `threshold/mcp/src/play-view.ts`, `threshold/mcp/src/world.ts` (if the projection lives there), their tests, `threshold/mcp/Dockerfile`, `threshold/mcp/Dockerfile.dockerignore`, `threshold/mcp/README.md`.
- `must-not-edit`: `docs/spec.md`, `contract/` (see the note below), `compose/*`, `geldar.ps1`, `threshold/mcp-mock/`, `animus/`, `tools/repo-checks/`, `golem/src/view.ts`.
- `decisions`: 0095 only.
- `checks`: `./geldar.ps1 pnpm --filter @geldar/mcp typecheck`; `./geldar.ps1 pnpm exec vitest run threshold/mcp/src/tools threshold/mcp/src/play-view.test.ts`; the image build `docker build -f threshold/mcp/Dockerfile .` (run once, record the size before and after); `./geldar.ps1 check`.
- `worknote`: `docs/analysis/phase1/worknotes/C2-05.md`.
- `commit`: `refactor(mcp): drop shard, snapshot_id and body_generation from look; add in-world time`, and `build(mcp): slim the image to the MCP package only`.
- `on-cap`: commit what passes, write the rest, stop.

Steps:
1. Find every place `look` emits `shard`, `snapshot_id` or `body_generation` (`grep -rn "snapshot_id\|body_generation\|shard" threshold/mcp/src/tools/look.ts threshold/mcp/src/play-view.ts`). Remove them from the output. They are internal identifiers an agent does not need, and `snapshot_id` and `body_generation` leak Body bookkeeping.
2. Add an in-world time field from the snapshot's `world_time` (day and tick), rendered the same way `status` renders it.
3. Contract note: the look output shape lives in `contract/schemas/mcp-world.schema.json`. Fan-out packets do not edit `contract/`. If the field removal or the new field changes a required property, write an index line for the C2-07 integration packet to apply, and keep the schema's required list unchanged in this packet. Tests run against the handler output, so the handler change is independent of the schema change.
4. Image: `threshold/mcp/Dockerfile` does `COPY . .` before `pnpm install --filter "@geldar/mcp..."`. Narrow it: copy only the workspace files the MCP package needs (its `package.json`, `contract/`, `threshold/mcp/`), so `animus/`, `threshold/mcp-mock/` and `tools/repo-checks/` are not in the image. Add the same exclusions to `Dockerfile.dockerignore`. Record the image size before and after in the worknote.
5. The runtime stage stays uid 1000 on a read-only root (the existing comment in the Dockerfile); do not change the user.

Acceptance: a test asserts that the `look` handler output has no key named `shard`, `snapshot_id` or `body_generation` (recursively), and has the in-world time; an image check asserts the built image has no `/opt/geldar/animus` or `/opt/geldar/threshold/mcp-mock` path.
Revert-check: in `look.ts`, re-add the `body_generation` key to the output; the recursive key test must fail. Restore.
Index line to add: the schema change for `contract/schemas/mcp-world.schema.json` (remove the three keys from any `properties` and add `in_world_time`), for the C2-07 integration packet.

---

### C2-06: external port scan tool and the expected-ports test (0071, 0072 exit check)

- `wave`: C2. `lane`: F. `depends-on`: C2-00. Schedule decision: none reserved (0096 belongs to C2-07; ask the orchestrator if a record is needed). `status`: B for the tool and its tests; the live scan is O (run from outside the node, in C2-07). `size`: S.
- `may-edit`: `tools/portscan/` (new package: source, tests, a README), `docs/analysis/phase1/worknotes/C2-06.md`.
- `must-not-edit`: `docs/spec.md`, `geldar.ps1`, `tools/repo-checks/src/cli.ts` (the registry is C2-07's), `compose/*`, `shards/*`, `package.json` (the new package is added by an index line; the lockfile change is made by C2-07 or the ops merge step), `contract/`.
- `decisions`: none. The schedule reserves no number for C2-06 (0096 belongs to C2-07); if a record is needed, ask the orchestrator for a number in the C2 block (0090 to 0099) rather than taking one.
- `checks`: `./geldar.ps1 pnpm --filter @geldar/portscan typecheck` (after the package is registered; until then `./geldar.ps1 pnpm exec vitest run tools/portscan`); `./geldar.ps1 check`.
- `worknote`: `docs/analysis/phase1/worknotes/C2-06.md`.
- `commit`: `feat(portscan): TCP scan that must match the expected port list exactly`.
- `on-cap`: commit what passes, write the rest, stop.

Steps:
1. The scanner takes a target host and a range (default 1 to 65535, TCP only, since Minecraft Java is TCP and the UDP check is an owner request). It connects with a timeout and a fixed rate, so it does not look like an attack on the node.
2. The connector is injected. The tests use a fake connector that reports a fixed open set; no test opens a socket.
3. The verdict is exact-set equality: every open port must be in the expected list and every expected port must be open. An extra open port fails. A missing expected port fails.
4. The expected list is read from a file or argument supplied at run time (the ops runbook holds the real list, 0071 item 3). The repo holds only synthetic fixtures. No real port of the Minecraft endpoint is written into the repo by this card.
5. Output is a JSON report with the target, time, range, the open set and the verdict. It contains no host name beyond the target argument, no banner, and nothing read from a service.

Acceptance: tests cover exact match (pass), one extra open port (fail), one missing expected port (fail), and a closed-range run (pass). The report contains no banner field.
Revert-check: in the verdict function, change the extra-port test to ignore extras; the "extra open port fails" test must fail. Restore.
Index line to add: none. The workspace entry for `package.json` (`tools/portscan`) goes to C2-07 in its worknote, as "workspace: tools/portscan".

---

## 3. Cards: integration (owner and ops)

### C2-07: integration, public deploy, scan, live run (O)

- `wave`: C2. `lane`: A. `depends-on`: C2-01, C2-02, C2-03, C2-04, C2-05, C2-06 (all merged to the wave branch), and the owner confirmation of 0077 and 0080. Schedule decision 0096. `status`: O (owner and node access). `size`: L (two sessions; the second is the live steps).
- `may-edit`: `compose/mcp.yml`, `compose/phase0.yml` (the new velocity TCP publish, and the NATS default-on change under 0080), `compose/velocity/velocity.toml` (only the whitelist and forwarding keys C2-02 names), `compose/nats-auth.yml` (only if 0080 changes it), `shards/phase0.yaml` (the `public` block values), `geldar.ps1` (new commands: the public up, Caddy validate and reload, and scan), `tools/repo-checks/src/` (the registry entries for the new checks and the port-list test), `package.json` and the lockfile (one change, adding the `tools/portscan` workspace), `deploy/caddy/` (the reload wiring only), `docs/analysis/phase1/worknotes/C2-07.md`, and the golem `view.ts` only if the look change needs it (not expected).
- `must-not-edit`: `docs/spec.md`, `contract/` (already merged in C2-00; any later change is a new unblocker), the Paper plugin, the ops runbook's real values (the runbook is written by the owner or ops, not committed with real addresses).
- `decisions`: 0096 only. It records the public topology as built, the NATS default-on flip (0080 point), and the reload procedure.
- `checks`: `./geldar.ps1 check` with the integration case-count floor (conventions 4.2 item 1); `docker compose -f compose/phase0.yml -f compose/mcp.yml -f compose/nats-auth.yml config --quiet`; the port-list test from C2-06 against the fixture list; the live steps below.
- `worknote`: `docs/analysis/phase1/worknotes/C2-07.md`, with the live record (live step 9, and section 5.2).
- `commit`: one commit for the desktop wiring (`feat(compose): public surfaces wired behind Caddy (0096)`), one for the NATS flip after 0080 is confirmed, one for the record of the live run (worknote only).
- `on-cap`: the desktop items commit; the live items stay in the worknote as "not run" with the reason.

Steps (desktop, session 1):
1. Wire compose: the velocity TCP publish on the chosen port (bound to the host interface the UniFi forward uses, not `0.0.0.0` on the node's other services); the MCP overlay publish stays on loopback for Caddy to reach.
2. Add the `public` config values to `shards/phase0.yaml` (trusted proxy is the Caddy peer; client-IP header from C2-00; rate limits; kill switch off).
3. Register the new repo checks in `tools/repo-checks/src/cli.ts`: the Caddy snippet check (C2-04), the look key test (C2-05), the port-list fixture test (C2-06).
4. Add the `geldar.ps1` commands: `public-validate` (runs `caddy validate` on the snippet, read-only), `public-reload` (runs `caddy reload` only), `public-scan` (runs the C2-06 tool against the runbook list). Add each command's help text in the same change, and write the index line for the ops merge step.
5. Flip the NATS overlay to default-on only if 0080 is confirmed. If not confirmed, leave `nats-auth` opt-in and record that in 0096.
6. Run `./geldar.ps1 check`; confirm the case-count floor.

Steps (live, session 2; every step needs the owner's go):
1. Pre-gates. Stop unless all hold: 0077 and 0080 are Accepted; C2-01..C2-06 are merged; the C2-R1..R4 reviews have no open high finding; the Glass delay value and the BlueMap rate-limit ruling are recorded.
2. Read-only first, on the node, with the owner's deploy account: `docker compose ps` and `ss -ltn` (listening ports only). Confirm the chosen Minecraft TCP port is free and is not forwarded elsewhere at the edge. Stop if it is taken.
3. DNS (owner or an ops agent the owner has authorised for this step, with `az`): read the current records first with a read-only `az network dns record-set list` for the zone. Create `glass`, `map`, `mcp`, `play` and the `_minecraft._tcp` SRV record only if absent. Stop if a name already points somewhere unexpected. Subscription and account identifiers stay in the owner's terminal, not in the worknote.
4. UniFi (owner): create the TCP forward for the chosen Minecraft port to the node, and nothing else. The existing 18443 forward is not changed (0071 item 4).
5. Caddy, read-only then reload: `caddy validate` on the combined config; `caddy adapt` to see the result. Stop on any error. Then `caddy reload` only. Never `systemctl restart caddy`, never a container restart of the shared Caddy (0071 item 6).
6. Start the shard services with `docker compose -f compose/phase0.yml -f compose/mcp.yml [-f compose/nats-auth.yml] up -d <named services>`. Do not run `adam up`, and do not run `adam up --help` on the node. Watch `docker compose logs --tail` for the MCP, Velocity and Glass services. Stop on a crash loop.
7. External scan from a host outside the node's network: `./geldar.ps1 public-scan` with the runbook list. Expectation: the open set equals the expected list exactly (the Minecraft TCP port, the 18443 placeholder and HTTPS as the runbook names them, and nothing else). Stop on any extra port: close the UniFi forward for it, do not fix forward.
8. Public checks from outside: HEAD and GET on `glass`, `map`, `mcp` answer with the CSP headers; a POST to Glass and BlueMap is refused; a request without a token to `mcp` is refused with the same body as an unknown token.
9. Real-client live run through the public URL, step by step as in section 5.2. Record: the client name and version, the tool list it saw, one look, one act gather, one wait, and the outcome. The bearer token is never pasted into the worknote, a log or a chat.
10. Rollback, in order, if any stop condition fires: `caddy reload` with the previous snippet; remove the UniFi forward; set `GELDAR_GLASS_ENABLED` off and the BlueMap kill switch on; stop the public services only (not the shard).

Stop conditions (any one stops the live steps and goes to the report): a port not in the expected list open from outside; a DNS name pointing elsewhere; `caddy validate` failure; a 500 from any public route; a token visible in any log; a real-client run that fails a tool the mock passed.
Revert-check: the NATS flip and the Velocity publish are each reverted in the compose file and the compose config check must still pass; the scan list test must fail when one expected port is removed from the fixture.

---

<!-- next: section 4 reviews -->


