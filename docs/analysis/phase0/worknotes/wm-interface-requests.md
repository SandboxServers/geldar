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

## WM-13

Status: CLI part committed (980edfb, e63f13e). Velocity plugin part (plugin/velocity-identity) not started. Docs part is this section.

- `shards/phase0.yaml` `skin:` key is not added: the packet lists only the CLI, plugin and docs files for WM-13. Decide with WM-12 whether the config key lands with the plugin or in WM-12.
- Live steps owed, none run in this job:
  - MineSkin upload of the six PNGs. Needs the owner's explicit yes at that time (third-party service receives the PNGs), and the key in `compose/secrets/mineskin.txt`.
  - A `geldar-skins` write against a real NATS (`GELDAR_NATS_URL`).
  - A Velocity login with a third client to see both rangers' textures (after the plugin part lands).
- Endpoint assumptions to verify before the live upload (read from docs.mineskin.org on 2026-11-09, not from a live call):
  - Endpoint is `POST https://api.mineskin.org/v2/generate` (V2 Changes and Migrating to V2 pages). The V2 OpenAPI viewer did not expose a fetchable spec, so the request body is unverified.
  - Auth is `Authorization: Bearer <key>` (getting-started page and the V1 spec).
  - `User-Agent` header is sent; the V1 spec marks it required. Unverified for V2.
  - Request body is multipart with fields `file` (PNG) and `variant` (`classic` or `slim`). The V1 spec labels the body `application/x-www-form-urlencoded` with a binary file, which is inconsistent; multipart is assumed.
  - Reply: `skin.texture.data.value` and `skin.texture.data.signature`. The V1 `data.texture` shape is refused.
  - The docs describe a queue (`POST /v2/queue`, `GET /queue/:jobId`) for the new generation path. The basic migration keeps `POST /v2/generate` synchronous; if it returns a job id instead, `mineskin.ts` must change.
  - Rate limit: 429 is treated as a refusal with the status only.
