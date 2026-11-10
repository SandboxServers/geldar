# Phase 1 wave C2 (Doors): packet cards

Status as of 2026-11-10, branch `docs/phase1-packets-c2`, from `origin/main`. Planning only: nothing here is implemented. The rules are in [packet-conventions.md](../packet-conventions.md) (on branch `docs/phase1-analysis`, not yet on `origin/main`), the plan is [plan.md](../plan.md) section C2, and the wave breakdown is the planner schedule (ids, sizes, lanes, decision blocks and status are its proposals). The schedule names the unblocker `P1-C2-00`; this file uses the convention id `C2-00`.

Decisions this wave relies on: [0070](../../../decisions/0070-phase1-is-the-colo-first-shard.md) (invite-only, gates before invitations), [0071](../../../decisions/0071-public-endpoints-and-ports.md) (new TCP port, SRV record, shared Caddy reloaded never restarted, Azure DNS by owner-authorised `az`), [0072](../../../decisions/0072-glass-and-bluemap-are-public.md) (Glass and BlueMap public, hardening list), [0054](../../../decisions/0054-static-hashed-per-player-bearer-tokens.md) (static hashed bearer tokens, `gmcp-` prefix, HMAC pepper, `/p/<player_id>` must match), [0067](../../../decisions/0067-nats-accounts-and-least-privilege.md) (NATS accounts overlay, opt-in). Four records are not on `origin/main` yet; they live on branch `docs/phase1-analysis` under `docs/decisions/`: `0076` (backup scope), `0077-invitee-auth-and-the-0072-0075-login-rule.md` (invitee auth and the Lakitu login rule; it gates C2 and C2b, and is Proposed), `0078` and `0079`. Decision `0080-nats-auth-cutover.md` is also on that branch, and is Proposed. Until they merge, cite them by these names and do not link to them.

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
- `decisions`: 0091 only. Invitee token issuing follows 0077 (in `docs/analysis/phase1/` on the analysis branch) and 0054. If 0077 is not confirmed when the card starts, implement the issuing only behind a flag that defaults off, and say so in the worknote.
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

<!-- next: C2-03 -->
