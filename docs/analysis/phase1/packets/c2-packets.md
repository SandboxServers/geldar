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
- `may-edit`: `compose/mcp.yml`, `compose/phase0.yml` (the new velocity TCP publish, and the NATS default-on change under 0080), `compose/velocity/velocity.toml` (only the whitelist and forwarding keys C2-02 names), `compose/nats-auth.yml` (only if 0080 changes it), `shards/phase0.yaml` (the `public` block values), `geldar.ps1` (new commands: the public up, Caddy validate and reload, and scan), `tools/repo-checks/src/` (the registry entries for the new checks and the port-list test), `package.json` and the lockfile (one change, adding the `tools/portscan` workspace), `deploy/caddy/` (the reload wiring, and the `glass` and `mcp` site snippets under `deploy/caddy/sites/`; C2-04 owns the `map` snippet), `docs/analysis/phase1/worknotes/C2-07.md`, and the golem `view.ts` only if the look change needs it (not expected).
- `must-not-edit`: `docs/spec.md`, `contract/` (already merged in C2-00; any later change is a new unblocker), the Paper plugin, the ops runbook's real values (the runbook is written by the owner or ops, not committed with real addresses).
- `decisions`: 0096 only. It records the public topology as built, the NATS default-on flip (0080 point), and the reload procedure.
- `checks`: `./geldar.ps1 check` with the integration case-count floor (conventions 4.2 item 1); `docker compose -f compose/phase0.yml -f compose/mcp.yml -f compose/nats-auth.yml config --quiet`; the port-list test from C2-06 against the fixture list; the live steps below.
- `worknote`: `docs/analysis/phase1/worknotes/C2-07.md`, with the live record (live step 9, and section 5.2).
- `commit`: one commit for the desktop wiring (`feat(compose): public surfaces wired behind Caddy (0096)`), one for the NATS flip after 0080 is confirmed, one for the record of the live run (worknote only).
- `on-cap`: the desktop items commit; the live items stay in the worknote as "not run" with the reason.

Steps (desktop, session 1):
1. Wire compose: the velocity TCP publish on the chosen port (bound to the host interface the UniFi forward uses, not `0.0.0.0` on the node's other services); the MCP overlay publish stays on loopback for Caddy to reach.
2. Add the `public` config values to `shards/phase0.yaml` (trusted proxy is the Caddy peer; client-IP header from C2-00; rate limits; kill switch off).
2a. Caddy site cards for `glass` and `mcp` (the Caddy plan named only C2-04 for `map`; this step adds the other two hosts). One snippet file per site under `deploy/caddy/sites/`, named `<host>.caddy`: `glass.caddy` and `mcp.caddy` here; the `map` snippet from C2-04 uses the same directory and naming. `glass`: reverse proxy to the Glass listener on loopback, `GET` and `HEAD` only, the CSP headers from C2-03, the client-IP header set from the connecting client. `mcp`: reverse proxy to the MCP loopback publish, the `Authorization` header passed through and not logged, the same client-IP header, no request bodies in logs. Each snippet is checked with `public-validate`. The rules for every site: the shared Caddy is reloaded with `caddy reload`, never restarted (no `systemctl restart caddy`, no container restart); each site is one snippet file, so a site is added or removed without touching the others; rollback of a site is removing its snippet file and running `caddy reload`.
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
10. Rollback, in order, if any stop condition fires: remove the snippet file of the failing site under `deploy/caddy/sites/` and run `caddy reload` (never a restart); remove the UniFi forward; set `GELDAR_GLASS_ENABLED` off and the BlueMap kill switch on; stop the public services only (not the shard).

Stop conditions (any one stops the live steps and goes to the report): a port not in the expected list open from outside; a DNS name pointing elsewhere; `caddy validate` failure; a 500 from any public route; a token visible in any log; a real-client run that fails a tool the mock passed.
Revert-check: the NATS flip and the Velocity publish are each reverted in the compose file and the compose config check must still pass; the scan list test must fail when one expected port is removed from the fixture.

---

## 4. Cards: wave-boundary reviews and the fix round

Preamble for C2-R1 to C2-R4 (a reviewer gets its card and this preamble):

- Read-only. No edits, no commits, no branches, no pushes, no worktree changes. The output is the final message, not a file.
- Local only. Read the code and run the local tests the card names. Make no request to any live host (public or node), and run no scan. The external scan is C2-07 live step 7, not a reviewer's job.
- Turn limit: 60 tool turns. If the limit comes first, return what is covered, list the paths not read, and mark the review partial.
- Output: findings ranked high, medium, low. Each has an id (`R1-01` and so on), `file:line`, the failing scenario (the request or sequence, and what the attacker gets), and a verdict: CONFIRMED (reproduced by a local test you ran, or traced step by step through named lines) or PLAUSIBLE (not reproduced). A finding without a failing scenario is dropped. Then list the surfaces not covered and the local tests run, with results.
- If a file shows a secret, give its path and line only. Never print the value.
- Records: a review writes no record and reserves no number. Fix-round numbers are in the card of each surface (0097 for R1, 0098 for R2, 0099 for R3). C2-R4 has no number: the C2 block (0090 to 0099) is fully used (0090 to 0096 by the cards, 0097 to 0099 by the fix rounds), so there is no next free number in it. If the R4 fix round needs a record, the worknote asks the orchestrator, who reserves a number from the first free range after 0130 (see the registry, decision-number-registry.md).

### C2-R1: MCP public endpoint

- `wave`: C2. `lane`: R. `depends-on`: C2-00, C2-01, C2-05 merged. `status`: B. `size`: M. `turns`: 60 max.
- `may-edit`: none (read-only). Scope to read: `threshold/mcp/src/http/` (`front.ts`, `auth.ts`, `limits.ts`, `log.ts` and tests), `threshold/mcp/src/config.ts`, `threshold/mcp/src/store/pg-tokens.ts`, `threshold/mcp/src/store/token-hash.ts`, `tools/mcp-tokens/src/`, the tool handlers reachable without a token, `compose/mcp.yml`, `threshold/mcp/Dockerfile` (listen address and `EXPOSE` only).
- `must-not-edit`: everything.
- `decisions`: read 0071, 0054, 0077 (issuing), 0090 (error shapes and header name), 0091. Fix-round record if needed: 0097.
- `checks` (local only): `./geldar.ps1 pnpm exec vitest run threshold/mcp/src/http`; `./geldar.ps1 pnpm exec vitest run tools/mcp-tokens`.
- `worknote`: none. `commit`: none. `on-cap`: the partial rule in the preamble.
- Attacker's checklist:
  - Every route and every tool reachable with no token. Each refusal must match an unknown token in status, body and headers.
  - Client address: send `x-geldar-client-ip` and `CF-Connecting-IP` from an untrusted peer, with several values and with commas. The rate-limit key and the log line must not change. Repeat from the trusted peer.
  - Tokens: prefix check, HMAC with the pepper, constant-time compare, a missing pepper fails closed. The token never appears in logs, error text, URLs, tool output or a stack trace.
  - `/p/<player_id>`: a valid token for player A on player B's path gives 403. Does the 403 and 401 split let a holder list which player ids exist? What does the split cost?
  - Negative cache and rate limit: table bound, eviction, memory growth under many spoofed addresses, fail-open when full, and whether a hit and a miss differ in timing class.
  - Kill switch: `public.killSwitch` is read on every request, not only at start. Check in-flight requests too.
  - Leakage: stack, path, host, NATS URL or database host in any error. A 404 that differs from a 401. Any look or status field that says the shard is watched, lists observers or viewers, or carries `shard`, `snapshot_id` or `body_generation`.
  - Port scan expectation: the MCP listens on loopback, Caddy is the only peer, and `compose/mcp.yml` publishes nothing else.

### C2-R2: Velocity and the public Minecraft port

- `wave`: C2. `lane`: R. `depends-on`: C2-02 and C2-07 desktop wiring merged. `status`: B. `size`: M. `turns`: 60 max.
- `may-edit`: none (read-only). Scope to read: `plugin/velocity-identity/src/main/java/dev/geldar/identity/` (`IdentityPlugin`, `LoginGate`, `DenialLimiter`, `RegistryClient`, `LifeRegistry`, `ReadinessFeed` and new siblings), `plugin/velocity-identity/src/test/`, `compose/velocity/velocity.toml`, the Velocity publish in `compose/phase0.yml`.
- `must-not-edit`: everything.
- `decisions`: read 0071 (port, SRV, whitelist), 0072, 0075 and 0077 (what a visitor may learn), 0092, 0067 and 0080 (the registry's NATS credential). Fix-round record if needed: 0098.
- `checks` (local only): `cd plugin` then `./gradlew :velocity-identity:test --tests "dev.geldar.identity.*"`.
- `worknote`: none. `commit`: none. `on-cap`: the partial rule in the preamble.
- Attacker's checklist:
  - Login order: the registry check is the first gate. An unregistered name is refused before any state change, and the refusal names neither the registry nor the life.
  - Ghost rule: a registered ghost is forced to spectator. Compare the message, the timing and any difference a stranger can measure between live, ghost and unregistered. Any difference reveals the watched state.
  - Server list ping: MOTD, player count, player sample names, version and protocol. Any field that shows humans are on, or which lives are sovereign.
  - Online mode and forwarding: `online-mode` true, and the modern forwarding secret set to a non-default value. Can a client reach Paper's backend port directly, skipping Velocity and the name check? The Paper whitelist is a second check, not the first.
  - Name spoofing: username case and Unicode folding, offline-mode UUIDs, a name that matches a registered life with a different account.
  - `DenialLimiter`: keyed on the connection's real peer address (never a header), bounded memory, and rotating usernames does not reset the limit.
  - Listeners: query protocol, metrics, console, or any extra listener in `velocity.toml`. The container binds `0.0.0.0:25565` only, and the host publish is one port on one interface.
  - SRV: documented in the worknote only (0071). Nothing in the repo names the real port.
  - Port scan expectation: from outside, the only open Minecraft port on this host is the chosen one.

### C2-R3: Glass and BlueMap

- `wave`: C2. `lane`: R. `depends-on`: C2-03 and C2-04 merged. `status`: B. `size`: M. `turns`: 60 max.
- `may-edit`: none (read-only). Scope to read: `glass/src/` (`http.ts`, `routes.ts`, `query.ts`, `sse.ts`, `render-*.ts`, `guard.ts` if added, `config.ts`, `main.ts`) and their tests, and the BlueMap snippet and README in `deploy/caddy/`.
- `must-not-edit`: everything.
- `decisions`: read 0072 (the hardening list is the acceptance), 0075 and 0077 (anonymous visitors get no camera), 0093, 0094. Fix-round record if needed: 0099.
- `checks` (local only): `./geldar.ps1 pnpm exec vitest run glass/src`.
- `worknote`: none. `commit`: none. `on-cap`: the partial rule in the preamble.
- Attacker's checklist:
  - Anonymous reach: every route. Response bodies carry only the thought stream. No camera position, coordinates, inventory, human chat, or list of living sovereigns while the sovereign filter is on.
  - Header: the rate-limit key uses the client header only when the peer is Caddy. An untrusted peer's header is ignored.
  - Rate limit and size: token bucket bound, SSE connection count per client, slow headers and slow bodies (read timeouts), a body far above the cap, and a `limit` above 100 refused.
  - Escaping and CSP: adversarial thoughts (script tags, `</script>`, attribute breakouts, `javascript:` and `data:` links, images that the CSP does not cover). `default-src 'none'`, `script-src 'self'`, no `unsafe-inline`, on error responses too.
  - BlueMap: GET and HEAD only, the inline-style exception recorded in 0094 and nowhere else, and no host reached other than the BlueMap service.
  - Delay and sovereign filter: the delay applies in the API and in SSE, not only in the page. The sovereign filter is on by default.
  - Kill switch: `GELDAR_GLASS_ENABLED` off gives 503 on every route, assets included, and SSE closes within one heartbeat. The Caddy `respond 503` for BlueMap touches only the map host.
  - Leakage: database errors passed through (host, role, password path); a `Server` header with a version; viewer counts or heartbeat payloads that show how many people are watching; response timing that reveals a live stream.
  - Port scan expectation: Glass and BlueMap listen on loopback, and Caddy is their only public listener.

### C2-R4: NATS, node and Caddy

- `wave`: C2. `lane`: R. `depends-on`: C2-07 desktop wiring merged. `status`: B. `size`: M. `turns`: 60 max.
- `may-edit`: none (read-only). Scope to read: `compose/phase0.yml`, `compose/nats-auth.yml`, `compose/mcp.yml`, `compose/velocity/velocity.toml` (publish and listener lines), `deploy/caddy/` (all files), the public block in `shards/phase0.yaml`, `sql/0005_glass_reader.sql` and `sql/test/check-schema.sql` (grants only), the `public-*` commands in `geldar.ps1`.
- `must-not-edit`: everything.
- `decisions`: read 0067, 0080 (NATS default-on), 0071 (port, shared Caddy, the 18443 forward unchanged), 0072, 0096. Fix-round record: none assigned.
- `checks` (local only): `./geldar.ps1 pnpm --filter @geldar/repo-checks test` if it exists (locate with `grep -rn "repo-checks" package.json`); `docker compose -f compose/phase0.yml -f compose/mcp.yml -f compose/nats-auth.yml config` piped to a file outside the repo, read for secret values only by path and line.
- `worknote`: none. `commit`: none. `on-cap`: the partial rule in the preamble.
- Attacker's checklist:
  - Every `ports:` entry in every compose file. A binding to `0.0.0.0` or with no host address is a finding, since Docker publishes past the host firewall. NATS (4222 and the monitoring port 8222), Postgres and the MCP port must be loopback or absent.
  - NATS: the accounts overlay is on (0080), or opt-in with the reason recorded. Without accounts, NATS must not be reachable from outside loopback. Monitoring is off or loopback.
  - Caddy header handling: the client's `X-Geldar-Client-Ip` is removed or overwritten before Caddy sets its own, on every site. The trusted peer is the MCP site only.
  - SSRF: no upstream built from `{header.*}`, `{http.request.host}` or any query value. Each `reverse_proxy` targets a service name or loopback.
  - Caddy surface: the `respond 503` kill switch for BlueMap; security headers on every site; the `Server` header and default error pages removed or generic.
  - Logs: Caddy access logs do not record `Authorization` or the query string; the MCP and Glass logs carry no token.
  - Secrets: the compose config output must not show a secret value. Env file location and mode. No secret in the repo.
  - Reload: every script and README says `caddy reload` only, with no `systemctl restart caddy` and no shared-Caddy container restart (0071 item 6).
  - Port scan expectation: predict the node's listening set from the compose and Caddy config, and name each extra listener. It must equal the C2-07 live step 7 list (the Minecraft TCP port, the 18443 placeholder and HTTPS).

### C2-R5: fix round for the reviews

- `wave`: C2. `lane`: R. `depends-on`: the review outputs C2-R1 to C2-R4 returned, and each owning card merged. `status`: B. `size`: S. One round only.
- `may-edit`: only the files of the findings being fixed, within the owning card's `may-edit` list (sections 2 and 3). Each fix adds its test in the same file.
- `must-not-edit`: `docs/spec.md`, `contract/` (a finding that needs a contract change is an index line for the integration packet, not a fix here), `geldar.ps1`, `package.json`, the lockfile, `docs/decisions/README.md`, and `compose/*` unless the owner has run the card's live steps.
- `decisions`: the number its surface's review card names (0097 R1, 0098 R2, 0099 R3). R4 uses none unless the orchestrator assigns one.
- `checks`: the owning card's checks, and `./geldar.ps1 check`.
- `worknote`: `docs/analysis/phase1/worknotes/C2-R5.md`.
- `commit`: one per finding; the subject names the finding id, for example `fix(mcp): ignore the client header from an untrusted peer (R1-02)`.
- Scope: CONFIRMED high and medium findings only. PLAUSIBLE findings go to the owner with a request for a repro. Lows go to the worknote. No new features.
- Each fix: first a test that reproduces the failing scenario and fails on the current code; then the fix; then the revert-check on the changed line.
- `on-cap`: commit the fixes that pass, list the open findings in the worknote, stop. Any open high finding blocks the live steps.

---

## 5. Wave section

Lane diagram (lanes are the cards' `lane` fields; R is the review lane):

```
C2-00 (lane A, unblocker, contract only)
  |
  +--> A: C2-01 MCP behind Caddy ----------------+
  +--> B: C2-02 Velocity TCP port ---------------+
  +--> C: C2-03 Glass hardening -----------------+--> C2-07 desktop wiring (A)
  +--> D: C2-04 BlueMap snippet -----------------+        |
  +--> E: C2-05 look and image slimming ---------+        v
  +--> F: C2-06 port scan tool ------------------+   5.1 wave-boundary gates
                                                    (C2-R1 to R4, fix round C2-R5)
                                                           |
                                                           v
                                                    5.2 real-client live run
                                                    and C2-07 live steps
```

### 5.1 Wave-boundary gates

Conventions 4.2, with the C2 specifics. Nothing goes to an invitee (0070) until all of these hold.

1. Full `./geldar.ps1 check` on the wave branch after the last desktop merge. The integration case-count floor is the count of integration tests run at the C1 merge (recorded in the C1 worknotes). The run must execute at least that many. A skipped integration test is a failure, not a warning (Phase 0 CI skipped 43).
2. Reviews: C2-R1 to C2-R4 each returned. No CONFIRMED high finding is open. A PLAUSIBLE high finding needs an owner answer before the live steps. C2-R5 is merged or each open finding is recorded with an owner decision.
3. Port-scan expectation: the C2-06 tool run from outside the node with the runbook list (C2-07 live step 7). The open set must equal the expected list exactly. An extra open port stops the run.
4. The real-client live run in 5.2 is recorded in the C2-07 worknote.
5. Provisional decisions: 0090 to 0096 get owner confirmation or a superseding record. Any of 0097 to 0099 that is written gets the same.
6. The wave retro is `retro/phase1-wave-c2.md`, written by ops. Cards do not write it.
7. Ops merge: index lines applied to `docs/decisions/README.md`, the ledger rows in 5.3 added to the Phase 1 ledger, and the `tools/portscan` workspace line added once to `package.json`.

### 5.2 Real-client live run

C2-07 live step 9 refers here. Preconditions: 5.1 items 1 to 3 pass, 0077 is Accepted, and invitations are still off (this run uses one owner token, not an invitation). Every step needs the owner's go.

1. Token. The owner mints one invitee token with the C2-01 `mint` path and keeps it in the owner's password store. Put it in the environment variable `GELDAR_LIVE_TOKEN` in the owner's shell only. Never echo it, and never write it into a repo file, worknote, log or chat. Revoke it in step 13.
2. Client. Install the Claude Code version the owner names and record it. Use a clean configuration directory so that no other MCP server loads.
3. Register the public MCP as an HTTP server at `https://mcp.<project domain>/` with the header `Authorization: Bearer ${GELDAR_LIVE_TOKEN}`. The token must not be on a command line that lands in shell history.
4. Tool list. Start a session and list the tools. Record the count and the names. Confirm each input schema is an object with `properties` and has no top-level `oneOf`, `anyOf` or `allOf`. The C2-00 guard test checks this in the repo; this step checks it on the wire. Any missing tool, or a combinator at the top, stops the run.
5. Wake. Call the wake tool and record the status field of the reply.
6. Look. One `look`. Confirm there is no `shard`, `snapshot_id` or `body_generation` key anywhere in the output, and that the in-world time is present.
7. Act. One `act` with `gather` on a resource the look listed. Confirm the result shape matches the contract.
8. Wait. One `wait` with the shortest duration the tool allows. Confirm it returns within its stated bound.
9. Rate limit. From the same client, repeat `look` until the `public.rateLimit` refusal appears. Confirm the C2-00 shape: the status C2-00 fixes (429 unless C2-00 says otherwise), a `retryAfter` value, and a fixed body. Stop at the first refusal and do not try to get past it. Record the request count and the time.
10. Auth. Repeat with a made-up `gmcp-` value, typed in the session and not saved. Confirm the status and body equal the missing-token case (C2-07 live step 8).
11. Kill switch. The owner sets `public.killSwitch` to true in the shard config and applies it by the reload path C2-01 records in its worknote, touching the MCP service only and never Caddy. The next call gets the kill-switch shape from C2-00. The owner sets it back to false, and the next call succeeds. Record both times.
12. Glass. In a browser with no login, as an anonymous visitor, open Glass. Confirm the thought stream shows this run's thoughts (wake, look, gather, wait), and that no camera view is on the page or in its network responses (0077, 0075). Record yes or no for each. Do not save screenshots in the repo.
13. Stop. Remove the client's MCP entry, unset `GELDAR_LIVE_TOKEN`, and revoke the run token with the `tools/mcp-tokens` revoke command. Confirm the revoked token now gets 401.
14. Record in `docs/analysis/phase1/worknotes/C2-07.md` (live section): client name and version, tool count and names, one line each for look, act and wait, the rate-limit count and retry hint, the kill-switch times, the Glass result, and the outcome. No token, no account name, no address.
15. Stop conditions: a tool the mock passed fails with the real client; a 500 from any public route; a token in any log; a camera for an anonymous visitor on Glass.
16. Retro: what the real client did that the mock did not goes into the wave retro (5.1 item 6).

### 5.3 Ledger rows

For pasting into the Phase 1 ledger at the ops merge. Do not edit the ledger README from a card.

| id | title | lane | depends | status |
|---|---|---|---|---|
| C2-00 | contract unblocker for the public surfaces | A | C1-00 | planned |
| C2-01 | public MCP behind Caddy | A | C2-00 | planned |
| C2-02 | Velocity on the new TCP port | B | C2-00 | planned |
| C2-03 | Glass hardening (0072) | C | C2-00 | planned |
| C2-04 | BlueMap public through Caddy | D | C1-09, C2-00 | planned |
| C2-05 | look projection cleanup and MCP image slimming | E | C2-00 | planned |
| C2-06 | external port scan tool | F | C2-00 | planned |
| C2-07 | integration, public deploy, scan, live run | A | C2-01 to C2-06, 0077, 0080 | planned (O) |
| C2-R1 | review: MCP public endpoint | R | C2-00, C2-01, C2-05 | planned |
| C2-R2 | review: Velocity and public Minecraft port | R | C2-02, C2-07 desktop | planned |
| C2-R3 | review: Glass and BlueMap | R | C2-03, C2-04 | planned |
| C2-R4 | review: NATS, node and Caddy | R | C2-07 desktop | planned |
| C2-R5 | fix round for C2-R1 to R4 | R | C2-R1 to R4 | planned |

### 5.4 Open owner questions

Each gates the item named. None is answered by a card.

1. UniFi forward: confirm the owner creates one TCP forward for the chosen Minecraft port to the node, and nothing else (0071 item 4). Gates C2-07 live step 4.
2. DNS: confirm the owner authorises the `az` flow for `glass`, `map`, `mcp`, `play` and the `_minecraft._tcp` SRV record, with a read-only list first, and who runs it (the owner, or an ops agent for that step). Gates C2-07 live step 3.
3. Tokens policy: who receives invitee tokens, how long they last, how they are revoked, and whether the 5.2 run token is revoked after the run. Gates C2-01 issuing (behind a flag until 0077) and 5.2.
4. Invitations wait for the gates: confirm no invitation goes out until 5.1 passes and 0077 is Accepted (0070). Gates every invitation.
5. 0077 confirmation: the camera rule (anonymous visitors see no camera; login is for cameras) and the interim auth. Gates C2-01 issuing, C2-03 camera removal and 5.2 step 12.
6. Glass delay value: the number for `GELDAR_GLASS_DELAY_SECONDS`. The default stays 0 until confirmed. Gates the C2-07 live pre-gate.
7. Living sovereign players on Glass: whether a living sovereign's thoughts may show on Glass. The sovereign filter stays on until confirmed. Gates C2-03 defaults.
8. Agent board readability: whether a public visitor may read the agent-facing board text on Glass or BlueMap. This is my reading of "agent board"; the default is no until the owner rules. Gates the C2-03 render scope.
9. BlueMap rate limit: accept the snippet without a rate limit, or approve a pinned Caddy module (a supply-chain change). Gates the C2-07 live pre-gate (C2-04 item 3).
10. Caddy sites for `glass` and `mcp`: no card writes them, and C2-04 covers `map` only. The owner or orchestrator must assign them (a new card or an extension of C2-04). Gates C2-07 step 1 and live step 5.
11. NATS default-on: confirm 0080. Gates C2-07 desktop step 5.
12. UDP scan: an owner request, out of scope. C2-06 is TCP only.


