# Wave M interface requests and open points

Requests from a Wave M packet to a packet that owns the shared interface. Each section names the packet that raised the request.

## WM-03 requests

### R1: `TokenStore.resolve` looks up by digest, not by token (owner: WM-01 / WM-02)

The front door passes `resolve` the HMAC-SHA256 digest of the presented bearer, keyed with the pepper (spec 5.15.3, `tokenDigest` in `threshold/mcp/src/http/auth.ts`). The store must find the row by that digest, as an indexed lookup. Equality on a digest of a high-entropy token is not a practical timing channel, so no constant-time scan of tokens is needed in the store. The raw token must never reach the store.

### R2: `FakeTokenStore` should compare digests in constant time (owner: WM-01)

`threshold/mcp/src/fakes/stores.fakes.ts` loops over tokens with `equalBytes`. The fake should compare the digests in constant time (`timingSafeEqual` on equal-length buffers), so a test cannot depend on a timing shortcut. WM-03 did not edit this WM-01 file.

### R3: The resolved player id is compared in constant time (done in WM-03)

`verifyBearer` compares the resolved player id with the URL's player id using `timingSafeEqual` (`sameText` in `auth.ts`). Nothing for WM-01 to change.

## Owner questions

### Q1: Rate-limit numbers the front door relies on

The limiter's capacities come from the injected `RateLimiter`, so the WM-01 wiring must set them. The numbers below come from `threshold/mcp/src/config.ts` and `phase0.yaml`:

- `calls_per_minute: 60` per player (`player:<id>` bucket)
- `owner_calls_per_minute: 600` per owner (`owner:<id>` bucket)
- `failed_auth_per_minute: 30` per client address (`auth-failed:address:<addr>`)
- Global failed-auth limit of 300 a minute: stated in the `phase0.yaml` comment as "in code", but no config key exists. The front door takes it from the limiter's `auth-failed:global` bucket, so the wiring must set 300 there.
- Open requests per player: 4 (`MAX_OPEN_PER_PLAYER` in `threshold/mcp/src/http/limits.ts`, a code constant).

Question for the owner: confirm 300 a minute for the global failed-auth bucket, and whether it should be a config key. Until confirmed, the constant stays in the wiring, not in the front door.

### Q2: Token for another player, and an unknown player

A valid token sent to another player's path is refused with 403 (the stricter reading: the token is valid, its scope is wrong). An unknown player with an unknown token is 401. Confirm this matches decision 0035.

### Q3: Trailing whitespace in the Authorization header

Node's HTTP parser strips trailing whitespace from header values before the handler sees them, so `Bearer <token> ` cannot be tested through HTTP and is accepted as `Bearer <token>`. The stricter parse still refuses lowercase `bearer` and a double space. Confirm this is acceptable.

## Decisions

The orchestrator decided these questions. They close Q1 to Q3 and confirm R1 and R2.

- Q1: The global failed-auth limit of 300 a minute is accepted. It stays a wiring constant for now and is tunable later.
- Q2: A valid token sent to another player's path returns 403. An unknown player with an unknown token returns 401.
- Q3: The trailing-space header gap is accepted. Node strips trailing whitespace from header values, so the gap cannot be reached through HTTP.
- R1 and R2 (owner: WM-01 / WM-02): `TokenStore.resolve` must look up the row by the HMAC digest of the bearer, not by the raw token. `FakeTokenStore` must compare digests in constant time.

## WM-04

(a) `PresenceStore` needs `touch(playerId)`. The `wait` tool calls it when the wait opens, on each poll, and when it closes. Until the store has it, `wait` takes `touchPresence` as an optional dependency and leaves it out. WM-11 owns the WM-01 ports, so WM-11 adds the method.

(b) `threshold/mcp-mock` should export `present.ts` from its index. WM-04 carries a copy at `threshold/mcp/src/events/present.ts` so the MCP package can build the presence view without the mock's index. Once the mock exports it, the copy can be removed.

(c) The event texts `You slept.`, `You died and woke at spawn.` and `Your actions finished: N done, M failed` are not defined by the packet or the mock. None were added. Whoever owns the event wording should decide them.

## WM-05

- **WM-11: use PlayerLog.head() from WM-04 for say's start cursor; plan_result needs thought_id and said.** `say` reads the Body's `plan_result` from the life's event log. WM-05 takes its start cursor from the `PlayerEventLog` port WM-01 defined (the newest sequence `since(lifeId, 0)` returns, taken before the plan is sent), because WM-04's `head()` cursor is on an unmerged branch. WM-11 should swap that for `PlayerLog.head()`. The `plan_result` event must carry `thought_id` and `said`; `planResultFor` in `threshold/mcp/src/tools/say.ts` reads both.
- **Body rate-limit refusal maps to `body_refused`.** `plan_result` has no reason field, so a refusal by the Body's own rate limit (`said: false`) is reported as the existing `body_refused` outcome, not as a separate reason. Revisit if the Body starts sending a reason.

## WM-06

- (a) No contract pattern exists for `book_id`. `contract/schemas/common.schema.json` (`book_id`, line 72) and `mcp-world.schema.json` only bound it with `minLength: 1` and `maxLength: 64`. The MCP tool code uses `bk_` followed by 26 hex characters, derived from a SHA-256 over title, author and text (`threshold/mcp/src/tools/read-book.ts`). A contract pattern is requested so the id format is checked at the boundary.
- (b) The sleep-mark port (`SleepMark`, `SleepMarks` in `threshold/mcp/src/tools/sleep.ts`) and the agent-profile port (`AgentProfile`, `AgentProfiles` in `threshold/mcp/src/resources.ts`) are defined in tool and resource modules. They should move to `threshold/mcp/src/ports.ts` (WM-11), next to the existing ports.
- (c) `buildSleepPlan` is injected into the sleep tool (`sleep.ts`, dependency `buildSleepPlan`). WM-11 must wire it to the animus sleep plan builder in production.
- (d) Sleep waits for the plan acknowledgement only. It calls `body.submitPlan` and returns on `ack.accepted`; a refusal raises `sleep_refused`. It does not wait for the plan to finish executing.

## WM-08 (player host: whitelist, presence, Body)

(a) Latent bug in the Adam host. `golem/src/adam/main.ts` `BodySupervisor` only listens for stop after start has begun, so a stop issued during start hangs until the bot ends. The player session (`golem/src/players/session.ts`) works around it. Follow-up for the Adam host: listen for stop from the beginning of start, the same way the player session does.

(b) `golem/src/players/main.ts` opens `PRESENCE_BUCKET` with `open`, and fails if the MCP has not created it. WM-11 must create the bucket first, so that the player host can open it on a fresh stack.

(c) No test covers the `extraServe` path of `startPlayerBody`. It needs a live case later, against a running stack.

## WM-09

Open points from the WM-09 token and seed work. Each needs an owner decision or a follow-up; none blocks the merge.

a. Initial life budget. The initial life budget is set to cap_credits (240). Owner to confirm.

b. Rotate grace period. The default grace period for `rotate` is 10 minutes. The spec is silent on the value. Owner to confirm.

c. Token-hash helper export. WM-09 imports the token-hash helper by relative path. threshold/mcp should add a subpath export for it so consumers do not reach into the package by path.

d. Integration round trips for the CLI are not written. Ops follow-up against the dev Postgres: mint then resolve; revoke then expect 401; rotate and check the grace window.

e. `init --force` re-creates the Postgres password file too. After a forced init, the role password must be set again with `migrate --set-role-password`.

f. Seed input and storage (decision 0060):
   - The seed input is `--identity-file` (max 8192 bytes) and `--goals-file` (max 4096 bytes).
   - Goals are stored under a `## Goals` heading appended to personality_seed. There is no goals column.

## WM-10

Raised by WM-10 (container, compose overlay, tunnel template, threat model). No request against a WM-01
file. Follow-ups, each for the orchestrator to schedule:

1. **WM-10b: least-privilege NATS user for the MCP.** Needs a credentials mechanism, a NATS config file
   and the `nats` block in `compose/phase0.yml`. WM-10 did not touch that block (owner decision Q6): the
   block stays as it is, and the MCP reaches NATS as any local process does until WM-10b lands. The
   subjects for the `mcp` user are: `snapshot`, `plan` and `book` bodies, `sovereign_call`, `day_night`,
   the `geldar-presence` KV bucket, the stream and consumer API for `GELDAR_EVENTS`, and `_INBOX.>`.
2. **Ops: build the image and decide `pnpm deploy`.** `threshold/mcp/Dockerfile` uses the mock's
   `pnpm install --filter` pattern, not yet built. Build it with `docker build -f threshold/mcp/Dockerfile .`
   once WM-11 adds `src/cli.ts` (the entry point), then decide whether to switch to `pnpm deploy`.
3. **Base image digest.** The Node base digest is the one `threshold/mcp-mock` pins (`node:22.23.2-trixie-slim`).
   It is not a placeholder. Re-check it at the next base-image update.
4. **Decision 0053 (owner).** The public-hostname decision is reserved, not written. `compose/mcp.yml`
   and the threat model refer to it. The tunnel stays unrun until the owner takes it.

## WM-11a

Done (branch `wave-m/wm-11-integration`):

- Interface requests against the WM-01 ports (`9d31d96`): `PresenceStore.touch`, `PlayerEventLog.head`
  for the say start cursor, `SleepMark` and `AgentProfile` moved into `ports.ts`, the `book_id`
  pattern `^bk_[a-z0-9_]{1,61}$`, `wait` `max_seconds` validation, and a constant-time fake token store.
- `body-gateway.ts` (`f23a155`): one animus `NatsBodyLink` per life for snapshot and plan, and the
  `book` request with a 5 s window. The gateway asks only the snapshot, plan and book subjects. Every
  failure, a timeout, a missing responder or an invalid reply, rejects with `BodyUnavailable`.
- Stream ingest (`d25f20d`): every message is checked against the WorldEvent envelope before it is
  routed, and `day_night` payloads against their schema. Invalid messages are counted and dropped
  without a throw. The consumer subscribes to the Mind subjects plus `sovereign_call` and `day_night`.
- `presence.ts` (`2ac9210`): `openPresenceBucket` creates `geldar-presence` when it is missing; the
  KV store writes awake, dim and hibernating records (`presenceAt`: 60 s and 10 min) that match the
  presence record schema. `settle` keeps the last touch time, so the state ages.
- Revert checks (mutation of one line each, restored from a backup copy, `git diff --stat` empty):
  untrusted-event validation fails `drops a day_night event whose envelope or payload is not the
  contract shape`; player-id binding fails `refuses a token for another player`; the BodyUnavailable
  mapping fails `maps a timeout or a missing responder to BodyUnavailable`; presence
  create-before-open fails `creates the presence bucket when the host has not yet opened it`.

Left for finisher B: world.ts (14 handlers, keepalive, logging capability), worknote final pass.
Wiring the finisher must do: call `KvPresenceStore.touch` and `wantBody` from the tool handlers, and call
`settle` for each life on a timer (the dim and hibernate states are written only by `settle`).
The `day_night` publisher is not written yet; the consumer only reads it.

Left for 11b: main.ts, cli.ts, golem extraServe wiring, image build test, e2e.

world part 1 done: look, status, journal, read_book, unavailable, resources, keepalive, logging; part 2 left: act, say, sleep, wait wiring (touch-on-poll, timed settle) replacing the not_wired answers; the packet says not_available for pending tools, part 2 must check which is right.

## WM-11 finisher B status (stopped at the context limit)

Done: the step 1 check passes on this branch (`./geldar.ps1 check`, exit 0, `b5d9bec`). The WM-11a worknote is committed on its own.

Not started: `threshold/mcp/src/world.ts` (the 14 handlers, keepalive, logging capability) and its tests. Not done: the observer-word scan extension to world.ts strings, the wait `touch` and `wantBody` wiring, the timed `settle`, and the four revert checks.

Facts a finisher needs: the 8 wired handlers take `ToolCall { playerId, lifeId }` from the bound token; the 6 unavailable tools go through `notAvailableTool`. `WaitDeps` needs `WakeConfig`, `RunState` (events/mapper.ts), `createWaitState`, `touchPresence` and a `FakeKeepAlive`. `ActDeps` and `SayDeps` need an `OutputValidator` and a `Clock`; the `OutputValidator` and `WakeConfig` definitions were not located in this pass. The MCP tool registration pattern is in `threshold/mcp-mock/src/server.ts`, not yet read.

Left for 11b: main.ts, cli.ts, golem extraServe wiring, image build test, e2e.
WM-11a complete; 11b left: main.ts, cli.ts, golem extraServe wiring, image build test, e2e

## WM-11b

part 1 done: main, cli, pg-agents; left: golem extraServe wiring, image build test (ops), e2e with a scripted stub client; known gaps: sleep cursor column, startup lives resolved lazily

Known gap for the owner: the sleep cursor has no column, so `PgAgentStore.read` returns cursor 0 and `write` keeps only the day. A sleep cursor column would need a migration 0003.

Correction to the line above: the living lives are no longer a startup snapshot. `lazyLifeRegistry` (threshold/mcp/src/main.ts) reads them on first use and again after 5 s, and each life's speech identity (name, game_account) is read the same way, so a life added while the server runs is picked up within 5 s.