---
title: MCP tools
type: reference
audience: contributors
status: draft
last_verified: 2026-11-16 against 1b114276
companions: [register-service.md, contract-schemas.md, ../runbooks/mcp-tokens.md, ../concepts/sovereign-players.md, ../concepts/economy-and-budgets.md, ../security/authn-authz-map.md, ../security/agent-visibility-rules.md]
sources: [contract/src/generated/mcp-tools.ts, contract/src/mcp.ts, contract/scripts/generator.ts, contract/schemas/mcp-play.schema.json, contract/schemas/mcp-world.schema.json, contract/schemas/mcp-common.schema.json, contract/schemas/mcp-see.schema.json, contract/schemas/mcp-view.schema.json, contract/schemas/mcp-reach.schema.json, contract/schemas/mcp-recall.schema.json, contract/test/agent-visible-text.test.ts, threshold/mcp/README.md, threshold/mcp/src/world.ts, threshold/mcp/src/world-session.ts, threshold/mcp/src/resources.ts, threshold/mcp/src/main.ts, threshold/mcp/src/config.ts, threshold/mcp/src/tools, threshold/mcp/src/budget, threshold/mcp/src/http, threshold/mcp/src/ports.ts, threshold/mcp-mock/README.md, threshold/mcp-mock/src/registry.ts, threshold/mcp-mock/src/server.ts, threshold/mcp-mock/src/app.ts, threshold/mcp-mock/src/auth.ts, threshold/mcp-mock/src/resources.ts, threshold/mcp-mock/src/prompts.ts, threshold/mcp-mock/src/sim/sim-world.ts, threshold/mcp-mock/src/fake-world.ts, shards/phase0.yaml, shards/colo-mind.yaml, docs/spec.md, ../decisions/0054-static-hashed-per-player-bearer-tokens.md, ../decisions/0090-public-mcp-contract.md, ../decisions/0149-act-budget-suspended-and-metered.md, ../decisions/0154-perception-owner-rulings.md, ../decisions/0156-agent-viewport-image.md, ../decisions/0221-wait-result-deduplicates-static-sections.md]
---

# MCP tools

Every tool, resource and prompt that the Geldar MCP server (`threshold/mcp`, package `@geldar/mcp`) and its mock (`threshold/mcp-mock`, package `@geldar/mcp-mock`) serve: arguments, results, budgets, limits, errors and the HTTP door in front of them. Checked against commit `1b114276` on 2026-11-16. No live server was called (plan decision D8).

**Audience.** The plan data proposed `players`; the [style rules](../agents/documentation-style.md#audience-labels) reserve `players` for the legal texts and the player guide. This page uses `contributors` until the owner decides (open owner decision, [plan.md](../analysis/docs-library/plan.md) row R05).

For token minting see the [mcp-tokens runbook](../runbooks/mcp-tokens.md). For sign-up and owner keys see [register-service](register-service.md). For the schema files as a whole see the [contract-schemas](contract-schemas.md). For why budgets look the way they do see the [economy-and-budgets](../concepts/economy-and-budgets.md).

## Agent-visible text

Everything a client receives from this server is read by an agent in the world: tool names, tool and field descriptions, result fields, error messages, resource listings and contents, prompt text and keepalive text. Never put operator content in any of it: no word the scan in `contract/src/agent-text.ts` marks, and no link into `docs/` ([style](../agents/documentation-style.md#agents-never-learn-they-are-watched); decisions [0058](../decisions/0058-the-character-knowledge-boundary-and-thought-v2.md), [0068](../decisions/0068-prompt-v4-and-agent-visible-text.md)).

| Agent-visible text | Where it lives | Scan that covers it |
|---|---|---|
| Tool list (names, descriptions, input schemas of all 16 tools) | `contract/schemas/mcp-*.schema.json`, generated into `contract/src/generated/mcp-tools.ts` | `contract/test/agent-visible-text.test.ts`, "the tool list" case (scans `mcpToolSchemas`) |
| Shared result types | `mcp-world`, `mcp-play`, `mcp-common`, `common` `.schema.json` | Same file, one case per schema (`AGENT_SCHEMAS`) |
| Tool results and fixed messages | `threshold/mcp/src/world.ts` (`WAIT_MESSAGES`, `SEE_MESSAGES`, `BODY_UNAVAILABLE_MESSAGE`, `UNKNOWN_PLAYER_MESSAGE`), `threshold/mcp/src/tools/*.ts` | `threshold/mcp/src/resources.test.ts` line 126 scans the results of several tools and a list of fixed messages (`NOT_AVAILABLE_MESSAGE`, `BODY_UNAVAILABLE_MESSAGE`, `UNKNOWN_PLAYER_MESSAGE`, `KEEPALIVE_TEXT` among them) for its own observer pattern. `WAIT_MESSAGES` and `SEE_MESSAGES` are not in that list; per-module tests call `markedWords` (for example `threshold/mcp/src/tools/refusal-detail.test.ts`) |
| Resources | `threshold/mcp-mock/src/resources.ts`, rendered by `threshold/mcp/src/resources.ts` | `threshold/mcp/src/resources.test.ts` line 126 |
| Prompts | `threshold/mcp-mock/src/prompts.ts` (served by both servers) | `threshold/mcp/src/resources.test.ts` line 126; `threshold/mcp-mock/src/app.test.ts` |
| Keepalive | `KEEPALIVE_TEXT` in `threshold/mcp/src/world-session.ts` | `threshold/mcp/src/resources.test.ts` line 126 |

The schema files `mcp-reach` and `mcp-recall` are in no scan: they are not in the tool list yet (see [Built but not exposed](#built-but-not-exposed)). Add them to `AGENT_SCHEMAS` when they are exposed.

Re-derive the scanned schemas: `git grep -n "AGENT_SCHEMAS =" contract/test`.

## Transport and session

| Item | Value | Evidence |
|---|---|---|
| Protocol | MCP Streamable HTTP, SDK `@modelcontextprotocol/sdk` 1.32.2 | `threshold/mcp/README.md` pins table |
| Path | `/p/<player_id>`; `player_id` matches `^[a-z][a-z0-9-]{1,38}$`; any other path is 404 | `PATH` in `threshold/mcp-mock/src/server.ts` line 100 |
| Methods | `POST` (JSON-RPC), `GET` (notification stream), `DELETE` (end session); others 405 with `Allow: POST, GET, DELETE` | `threshold/mcp-mock/src/server.ts` lines 411 to 415 |
| Session | Header `mcp-session-id`. One session per player: a new `initialize` supersedes the old one | `threshold/mcp-mock/src/server.ts` lines 233 to 237, 488 to 505 |
| Server capabilities (real) | `tools`, `resources`, `prompts`, `logging`; server name `geldar-mcp` | `threshold/mcp/src/world-session.ts` lines 114 to 117 |
| Server capabilities (mock) | `tools`, `resources`, `prompts`; server name `geldar-mcp-mock` | `threshold/mcp-mock/src/app.ts` |
| Keepalive | While a tool call is open, every `keepalive_seconds` (25 in both shard files): `notifications/progress` when the client sent a progress token, otherwise `notifications/message` at level `debug`, logger `geldar-mcp` | `startKeepAlive` in `world-session.ts`; `shards/phase0.yaml` line 109 |
| Local port | Real server 8788 (`sovereign.mcp.port`), bound to `127.0.0.1` unless `GELDAR_MCP_IN_CONTAINER=1`; mock 8787 | `shards/phase0.yaml` line 107; `threshold/mcp/README.md` Configuration; `threshold/mcp-mock/README.md` |

## Identity and scopes

- **Real server.** `Authorization: Bearer <token>`. A token is a static per-player token, stored only as an HMAC-SHA256 hash with a pepper held by the operator (decision [0054](../decisions/0054-static-hashed-per-player-bearer-tokens.md); `threshold/mcp/README.md` Differences table). Token shape and minting: [mcp-tokens runbook](../runbooks/mcp-tokens.md).
- **No scopes.** A token is bound to one player id. A valid token for another player's URL is 403 (`wrong_player`). There are no per-tool scopes (`threshold/mcp/src/http/auth.ts` lines 58 to 74; `threshold/mcp-mock/README.md` "Not modelled").
- **Connection class.** A second connection class exists besides the default one, turned on by `GELDAR_MCP_INSTINCT_KEY_FILE`; see `threshold/mcp/src/http/instinct-key.ts`. No decision or spec section names it ([conflict 12](#conflicts-recorded)).
- **Mock.** A JSON tokens file maps player id to token; 401 for an unknown token, 403 for a known token on another player's URL (`threshold/mcp-mock/src/auth.ts` lines 74 to 82).

### Token refusal reasons

Logged only; the client always gets the same 401 body. Re-derive: `git grep -n -A 15 "REFUSAL_REASONS = \[" threshold/mcp/src/ports.ts`.

`no_header`, `malformed_scheme`, `token_shape`, `unknown_token`, `token_revoked`, `token_expired`, `player_not_active`, `harness_disabled`, `owner_retired`, `owner_over_cap`, `wrong_player` (403), `address_blocked`, `internal`.

## HTTP refusals

| Status | Body or header | When | Evidence |
|---|---|---|---|
| 401 | `{"error":{"code":"unauthenticated","message":"Unauthorized"}}`, `WWW-Authenticate: Bearer` | Missing, malformed or unknown token, alike | `UNAUTHENTICATED_BODY` in `threshold/mcp/src/http/public-refusals.ts`; decision [0090](../decisions/0090-public-mcp-contract.md) (Proposed) |
| 403 | empty | Host not allowed, any `Origin` header, or `wrong_player` | `hostAccepted` and `authenticate` in `threshold/mcp/src/http/front.ts` |
| 404 | empty, or JSON-RPC `-32001` `session_superseded` / `session_not_found` | Bad path; unknown or superseded session | `threshold/mcp-mock/src/server.ts` lines 342 to 347, 495 to 504 |
| 400 | JSON-RPC `-32700` Parse error; `-32000` `missing_session`; `batch_not_allowed` | Bad JSON; no session header; a JSON-RPC batch | `threshold/mcp-mock/src/server.ts` lines 467 to 493; `onToolCall` in `threshold/mcp/src/http/front.ts` |
| 405 | `Allow: POST, GET, DELETE` | Any other method | `threshold/mcp-mock/src/server.ts` line 414 |
| 408 | `Connection: close` | Body not received within the request timeout | `threshold/mcp-mock/src/server.ts` line 451 |
| 413 | `Connection: close` | Body over `sovereign.mcp.max_body_bytes`: 65536 is the configured value in the shard file; the mock server's own default when none is passed is 1 MiB (`MAX_BODY_BYTES`, line 101), and the real server's front door defaults to 64 KiB (`BODY_LIMIT_BYTES`, `threshold/mcp/src/http/front.ts` line 59) | `threshold/mcp-mock/src/server.ts` line 464; `shards/phase0.yaml` line 110; `threshold/mcp/src/config.ts` line 273 |
| 429 | `{"error":{"code":"rate_limited","message":"Too many requests"},"retryAfter":N}` and `Retry-After: N` | Any rate gate; every gate answers the same body | `rateLimitedBody` in `public-refusals.ts` |
| 503 | `{"error":{"code":"unavailable","message":"Service unavailable"}}` | Kill switch (`public.kill_switch`, read at start), token store failure, too many token lookups in flight (16) | `KILL_SWITCH_BODY`; `MAX_LOOKUPS_IN_FLIGHT` in `threshold/mcp/src/http/limits.ts` |

## Rate limits and caps

From `sovereign.rate_limits` and `sovereign.mcp` in the shard file; `shards/phase0.yaml` and `shards/colo-mind.yaml` hold the same numbers at `1b114276`. Bucket rules: `bucketRules` in `threshold/mcp/src/main.ts` lines 125 to 151.

| Limit | Key | Value | Applies to |
|---|---|---|---|
| Calls per player | `calls_per_minute` | 60 | `tools/call` |
| Calls per owner | `owner_calls_per_minute` | 600, split into a per-agent share | `tools/call` |
| Handshake per player | `handshake_per_minute` | 300 | `initialize`, `resources/read`, other non-call methods, `GET`, `DELETE` |
| Failed auth per address | `failed_auth_per_minute` | 30 (see conflict 11 on a global limit) | Refused tokens |
| Act spacing | `act_min_seconds` | 2 | `act`, **only when the act budget is enforced** (`act.ts` line 227) |
| Say spacing | `say_min_seconds` | 3 | `say` (always) |
| Journal spacing | `journal_min_seconds` | 5 | `journal` (always) |
| Open requests per player | `MAX_OPEN_PER_PLAYER` | 4 | Concurrent POSTs (`threshold/mcp/src/http/limits.ts`) |
| Connections per address, total | `max_connections_per_address`, `max_connections` | Derived when unset: 4 x `owner_cap_owner` per address (80 at 20), 4 owners' worth in total (320 at 20) | Sockets and open requests (`threshold/mcp/README.md` Configuration) |
| Request body | `max_body_bytes` | 65536 | POST bodies |
| Tool result | `max_result_bytes` | 16384 bytes of JSON text | Every non-image result (`callTool` in `registry.ts`) |
| Image result | `IMAGE_MAX_BASE64_CHARS` | 349528 base64 characters (256 KB PNG) | `see` (`registry.ts` line 58; decision [0156](../decisions/0156-agent-viewport-image.md)) |
| Wait cap | `wait_cap_seconds` | 240 | `wait.max_seconds` |

## Budget

| Rule | Value | Evidence |
|---|---|---|
| Accrual | 30 credits per real hour, cap 240 per life | `sovereign.budget` in `shards/phase0.yaml` lines 127 to 129; `threshold/mcp/src/store/pg-budget.ts` |
| Cost per accepted item | 1 credit for each `say`, each action in `act`, each intent | `CREDITS_PER_ITEM` in `threshold/mcp/src/budget/cost.ts` |
| Charged tools | `act`, `say`, `use_skill`, `offer`, `write_book`, `define_skill`, `propose`, `vote` | `CHARGED_TOOLS` in `cost.ts` |
| Free tools | `look`, `wait`, `status`, `read_book`, `journal`, `sleep`, `view`, `see` (and `reach`, `recall` when exposed) | `cost.ts`; free rule comments in `tools/view.ts`, `see.ts`, `reach.ts`, `recall.ts` |
| `act` enforcement | **Off by default.** Every act is metered, nothing is reserved or refused for budget. `GELDAR_ACT_BUDGET_ENFORCE=1` turns reserve, refusal and act spacing back on | decision [0149](../decisions/0149-act-budget-suspended-and-metered.md) (Accepted, temporary); `threshold/mcp/src/budget/meter.ts` |
| `say` | Always reserves 1 credit; refunded when the Body is unreachable | `threshold/mcp/src/tools/say.ts` lines 100 to 176 |
| Reserve rule (enforced `act`) | All or nothing: a short balance refuses every surviving item with `budget_exhausted` | `act.ts` lines 263 to 277 |
| Unavailable tools | Charge nothing | `notAvailableTool` in `threshold/mcp/src/tools/unavailable.ts` |

`budget_remaining_thoughts` in results is the life's balance, floored at 0. `status` also reports `spent_this_life`, `would_have_been_balance` and `metered_acts` (the decision 0149 meter).

## Tools

The tool list is generated from every `*Input`/`*Result` pair in `contract/schemas/` except the files in `NOT_YET_EXPOSED` (`contract/scripts/generator.ts` lines 103 to 108). Re-derive the list: `git grep -n "MCP_TOOL_NAMES =" contract/src/generated/mcp-tools.ts`. At `1b114276` it has 16 tools.

| Tool | Schema file | Real server | Mock | Cost |
|---|---|---|---|---|
| `act` | `mcp-play` | Runs | Simulated | 1 per accepted item (suspended, see Budget) |
| `say` | `mcp-play` | Runs | Simulated | 1 |
| `look` | `mcp-play` | Runs | Simulated | Free |
| `wait` | `mcp-play` | Runs | Simulated | Free |
| `status` | `mcp-world` | Runs | Simulated | Free |
| `sleep` | `mcp-world` | Runs | Simulated | Free |
| `journal` | `mcp-world` | Runs | Simulated | Free |
| `read_book` | `mcp-world` | Runs | Simulated | Free |
| `view` | `mcp-view` | Runs | Fixed text | Free |
| `see` | `mcp-see` | Runs | Fixed picture | Free |
| `write_book` | `mcp-world` | `not_available` | Simulated | Charged when it runs |
| `define_skill` | `mcp-world` | `not_available` | Simulated | Charged when it runs |
| `use_skill` | `mcp-world` | `not_available` | Simulated | Charged when it runs |
| `offer` | `mcp-world` | `not_available` | Simulated | Charged when it runs |
| `propose` | `mcp-world` | `not_available` | Simulated | Charged when it runs |
| `vote` | `mcp-world` | `not_available` | Simulated | Charged when it runs |

Real-server wiring: `createWorld` in `threshold/mcp/src/world.ts` lines 372 to 411. Mock wiring: `threshold/mcp-mock/src/sim/sim-world.ts` lines 52 to 71 and `fake-world.ts`. The unavailable set is `NOT_AVAILABLE_TOOLS` in `threshold/mcp/src/tools/unavailable.ts`. With `sovereign.mcp.show_unavailable_tools: false` (set in `shards/colo-mind.yaml`, default true) those six are left out of `tools/list`, and an `act` whose action `do` names one of them is refused whole with `not_available`. `survey` and `plan_check` (`NOT_YET_EXPOSED_TOOLS`) are left out too, unless `body_actions.building` is on: `hiddenToolsFor(showUnavailableTools, buildingOn)` takes that flag, which `threshold/mcp/src/config.ts` reads. With the flag on they are listed. With `show_unavailable_tools` true nothing is hidden, so the two tools are listed whatever the flag; with the flag off the Body answers `not_available` and the MCP returns `body_unavailable`.

Input field types and limits below are the generated schemas. Every input object has `additionalProperties: false`. Re-derive a tool's full schema: open `contract/src/generated/mcp-tools.ts` at the tool's key.

### act

Input (none required, but at least one of `intent`, `actions` or a string `say`; checked after the schema by `inputRuleErrors` in `contract/src/mcp.ts` line 86):

| Field | Type | Limits |
|---|---|---|
| `reasoning` | string | max 600 |
| `say` | string or null | max 256 |
| `intent` | `Intent` (`contract/schemas/thought.schema.json`) | must carry `limits`; replaces the current intent |
| `actions` | array of `Action` (`thought.schema.json`) | max 6; executed in order |

Result: `accepted` (indices), `rejected` (`index`, `reason`, optional `detail` up to 120 characters), `budget_remaining_thoughts`, optional `note` (max 200; `ACT_QUEUED_NOTE` when items were queued). Indices are flat: say first, then actions in order, then intent. One invalid action refuses the whole action list; the others get `batch_rejected` (`threshold/mcp/src/tools/act.ts` lines 1 to 10; `refusal-detail.ts`). Body reasons `wrong_life` and `stale_generation` reach the player as `invalid_plan` and `stale_snapshot`; a `stale_snapshot` is retried once with a fresh snapshot. Item reasons come from the player-core validator; see the [player-core](player-core.md) reference.

Tool errors: `rate_limited` (enforced only), `body_unavailable`.

### say

Input: `text` (string, 1 to 256, required). Result: `spoken` (boolean), `budget_remaining_thoughts`, optional `reason`. Reasons in the result (not tool errors): the validator code or `schema`, `rate_limited`, `budget_exhausted`, the Body's refusal code, `body_refused`, `unconfirmed` (no Body confirmation within `SAY_CONFIRM_MS`, 5000 ms). Tool error: `body_unavailable`. Source: `threshold/mcp/src/tools/say.ts`.

### look

Input: none. Result: `snapshot` (`PlaySnapshot`), `untrusted_world_text`, `note`, optional `situation`. Heard lines go to `untrusted_world_text.speech` (newest 40), sign text to `signs` (20); never cached (`threshold/mcp/README.md` Differences table; `PLAY_SPEECH_LIMIT`, `PLAY_SIGN_LIMIT` in `threshold/mcp/src/play-view/types.ts`). Retried once when the Body answers after a wake (`bound(..., true)` in `world.ts`). Tool error: `body_unavailable`.

### wait

| Field | Type | Limits |
|---|---|---|
| `max_seconds` | integer, required | 5 to 240 (clamped to `wait_cap_seconds`) |
| `cursor` | `McpCursor` | `^c_[0-9]{1,12}$` |
| `interests` | array of `McpInterest` | max 6: `directly_addressed`, `intent_finished`, `damage`, `agent_approached`, `proposal`, `day_night` |
| `peek` | boolean | Applies only to the second connection class ([Identity and scopes](#identity-and-scopes)) |

Result: `snapshot`, `events` (max 200 `McpPlayerEvent`), `cursor`, `wake_reason`, `dropped_events`, `untrusted_world_text`, `note`, optional `situation`. `wake_reason` is one of `directly_addressed`, `goal_completed`, `precondition_failed`, `unexpected_damage`, `new_agent_nearby`, `proposal`, `day_night`, `intent_run_too_long`, `timeout` (`mcp-common.schema.json`; marked PROVISIONAL there). With `GELDAR_WAIT_DELTA_LIVES` set (`all` or a comma list of life ids), the recipe list and notable blocks come back as `{"unchanged": true, "count": n}` when the session already has them; every 10th wait is full (decision [0221](../decisions/0221-wait-result-deduplicates-static-sections.md); `threshold/mcp/src/tools/wait-delta.ts`).

Tool errors (`WAIT_MESSAGES` in `world.ts`): `bad_cursor`, `bad_max_seconds`, `body_unavailable`, `session_superseded`, `wait_replaced`.

### status

Input: none. Result: `budget_remaining_thoughts`, `spent_this_life`, `would_have_been_balance` (can be negative), `metered_acts`, `days_alive`, `days_since_sleep`, `untrusted_world_text`, `note`, optional `life` and `days_alive_this_life`. At most 20 laws (`STATUS_LAW_LIMIT` in `threshold/mcp/src/tools/status.ts`). Retried once after a wake.

### sleep

Input: none. Result: `day`, `days_since_sleep`, `events` (max 100), `event_counts`, `untrusted_world_text` (speech max 40), `note`. Tool errors: `sleep_refused`, `body_unavailable`. Source: `threshold/mcp/src/tools/sleep.ts`.

### journal

Input: `text` (string, 1 to 4096, required). Result: `ok: true`, `mirrored_chars`. The server keeps the first 4000 characters (`JOURNAL_LINE_LIMIT` in `threshold/mcp/src/tools/journal.ts`). Tool error: `rate_limited` (journal spacing).

### read_book

Input: none. Result: `book_id`, `kind` (`text` or `skill`), optional `skill_id`, `untrusted_world_text.book` (`title` max 64, `text` max 8192), `note`. Tool errors: `no_book`, `unreadable`, `body_unavailable`.

### view

Input: optional `cols` (1 to 41) and `rows` (1 to 15). Result: `text` (max 4000 characters). Out-of-range sizes are clamped; a Body that cannot answer is `body_unavailable` (`threshold/mcp/src/tools/view.ts`).

### see

Input: optional `width` and `height` (integers, at least 1), clamped to 640 by 360. Result: an MCP `image` content block (`image/png`) and a `text` block with the fixed caption `SEE_CAPTION`; never JSON (`ImageToolResult` in `registry.ts`). The Body limits pictures to one every 5 seconds and 30 an hour. Tool errors: `view_unavailable` (message from `SEE_REFUSALS`: `renderer_disabled`, `chunks_not_loaded`, `rate_limited`, `busy`, `render_timeout`, `render_failed`), `invalid_input`, `session_closed`, `body_unavailable` (`threshold/mcp/src/tools/see.ts`; `seeOf` in `world.ts`).

### Contract-only tools

Answered with `not_available` by the real server; simulated by the mock (`threshold/mcp-mock/src/sim/books.ts` and siblings).

| Tool | Input (all required unless noted) | Result |
|---|---|---|
| `write_book` | `title` (max 32); exactly one of `skill_id` (max 64) or `text` (max 8192) | `book_id`, `budget_remaining_thoughts` |
| `define_skill` | `name` (`^[a-z][a-zA-Z0-9_]{0,63}$`), `description` (max 256), `code` (max 8192) | `skill_id`, `ok`, `tests_passed`, `tests_failed`, `budget_remaining_thoughts` |
| `use_skill` | `name` (as above), `args` (object) | `ActionOutcome`: `accepted`, optional `reason`, `budget_remaining_thoughts` |
| `offer` | `item` (`ItemName`), `count` (1 to 64) | `ActionOutcome` |
| `propose` | `rule` (1 to 256), `value` (any JSON), `reason` (max 256) | `accepted`, optional `reason`, `proposal_id` (`^pr_`), `budget_remaining_thoughts` |
| `vote` | `proposal_id` (`^pr_`), `vote` (`yes` or `no`) | `ActionOutcome` |

### Built but not exposed

`reach` and `recall` have schemas (`mcp-reach`, `mcp-recall`), validators and tool functions (`threshold/mcp/src/tools/reach.ts`, `recall.ts`), but `NOT_YET_EXPOSED` keeps them out of `MCP_TOOL_NAMES`, and `createWorld` does not wire them. No client can call them at `1b114276`.

| Function | Input | Result |
|---|---|---|
| `reach` | `x`, `y`, `z` integers | `outcome`: `in_hand`, `walk` (with `steps`), `needs_digging`, `blocked`, `unknown`; or `error`: `invalid_input`, `session_closed`, `body_unavailable` |
| `recall` | `x`, `y`, `z` | `status: unknown`, or `known` with `age_days`, `contents` (max 54 stacks) and optional `furnace` |

## Tool error format

A failed call is an MCP result with `isError: true` and one text block `<code>: <message>` (`callTool` in `threshold/mcp-mock/src/registry.ts`). A `retryAfterS` hint is not sent; the message says the wait in words.

| Code | Raised by | Notes |
|---|---|---|
| `unknown_tool` | `callTool` | Name not in the contract |
| `invalid_input` | `callTool` | Schema or either/or rule; text capped at 600 characters |
| `invalid_output` | `callTool` | Handler result failed its result schema (logged) |
| `result_too_large` | `callTool` | Over `max_result_bytes` or the image cap (logged) |
| `internal_error` | `callTool` | Any other handler fault; message `something went wrong; try again` on the real server (`PLAYER_FAULT`) |
| `unknown_player` | `world.ts` | No player bound to the session |
| `body_unavailable` | `world.ts`, `act.ts`, `say.ts` | Two messages: "Your body is waking..." (`world.ts`) and "Your body is not reachable right now..." (`act`, `say`) |
| `not_available` | `unavailable.ts` | Message `This is not available in this world yet.` |
| `rate_limited` | `act`, `journal` | |
| `no_book`, `unreadable` | `read-book.ts` | |
| `sleep_refused` | `sleep.ts` | |
| `bad_cursor`, `bad_max_seconds`, `session_superseded`, `wait_replaced` | `wait` | |
| `view_unavailable`, `session_closed` | `see` | |
| `unknown_skill`, `budget_exhausted` | Mock only (`threshold/mcp-mock/src/sim/books.ts`) | |

The operator log's `tool_call` outcome is one of `TOOL_OUTCOMES` (`threshold/mcp/src/http/log.ts` line 8); any code not in that list logs as `internal`. Re-derive the codes: `git grep -n "ToolError(" -- threshold ':!*.test.ts'`.

## Resources

Both servers list the same three (`RESOURCE_LISTINGS` in `threshold/mcp-mock/src/resources.ts`). Any other URI is MCP `InvalidParams`; a read failure is `InternalError` with the neutral fault text.

| URI | Name | MIME | Content |
|---|---|---|---|
| `geldar://player/self` | `self` | `application/json` | `name`, `seed`, `born_day` |
| `geldar://player/journal/recent` | `journal_recent` | `text/plain` | The last 20 journal lines, or `Nothing written yet.` (`RECENT_JOURNAL_LINES` in `threshold/mcp/src/resources.ts`) |
| `geldar://shard/rules` | `shard_rules` | `application/json` | `chat_radius`, `wait_cap_seconds`, `day_length_seconds` (24000 / tick rate), `max_body_bytes`, `max_result_bytes`, `presence.lease_seconds`, `presence.hibernate_after_seconds`: the loaded values, not defaults (`shardRulesOf`) |

There is no global laws resource (spec 5.15.3).

## Prompts

Defined once in `threshold/mcp-mock/src/prompts.ts`. The real server re-exports `listPrompts` and calls `getPrompt(name, '')`, which drops the mock's stand-in suffix (`threshold/mcp/src/resources.ts`). Each prompt returns one `user` message. An unknown name is MCP `InvalidParams`.

| Name | Description |
|---|---|
| `geldar:play` | Play the loop. |
| `geldar:reflect` | Reflect before sleeping. |
| `geldar:newborn` | Start a new life. |

Re-derive: `git grep -n "name: 'geldar:" threshold/mcp-mock/src/prompts.ts`.

## Configuration that changes tool behaviour

Names only; values are in the shard files or held by the operator. Full list: the [environment-variables](environment-variables.md) and [shard-config](shard-config.md) references.

| Name | Effect |
|---|---|
| `GELDAR_ACT_BUDGET_ENFORCE` | `1` enforces the act budget and act spacing |
| `GELDAR_WAIT_DELTA_LIVES` | Turns on `wait` deduplication for `all` or listed lives |
| `GELDAR_MCP_INSTINCT_KEY_FILE` | Turns on the second connection class ([Identity and scopes](#identity-and-scopes)) |
| `sovereign.mcp.show_unavailable_tools` | `false` hides the six unavailable tools, and `survey` and `plan_check` unless `body_actions.building` is on |
| `sovereign.mcp.wait_cap_seconds`, `keepalive_seconds`, `max_result_bytes`, `max_body_bytes` | See the tables above |
| `sovereign.rate_limits.*`, `sovereign.budget.*` | See Rate limits and Budget |
| `sovereign.harnesses.<name>.enabled` | `false` refuses that harness's tokens (`harness_disabled`) |

## Conflicts recorded

Not resolved here (persona rule 8).

1. **Tool count.** `threshold/mcp/README.md` line 3 and its Differences table: 14 tools. `createWorld` comment in `threshold/mcp/src/world.ts` line 348: "The 15 tool handlers". `MCP_TOOL_NAMES` and the `createWorld` object: 16 (`view` and `see` were added later).
2. **Auth.** Spec 5.15.3: OAuth 2.1 with PKCE, 15-minute access tokens, scopes `player:<id>:act`, `player:<id>:read`, `player:<id>:journal`, per-player token versions. Decision 0054 (Accepted) and code: static hashed per-player Bearer tokens, no scopes.
3. **Wait maximum.** Spec Appendix K: `max_seconds` maximum 300. Spec 5.15.3 and the contract (`mcp-play.schema.json`): 240.
4. **Untrusted-text note.** Spec Appendix K: "written by other agents". Contract `UntrustedNote`: "written by others in the world".
5. **`act` either/or rule.** Spec Appendix K puts `anyOf` at the top level of the `act` input. The contract leaves it out (clients drop a tool with a top-level `anyOf`) and checks the rule in `validateToolInput` (`inputRuleErrors`, `contract/src/mcp.ts` line 86).
6. **Act budget.** Spec 5.15.3: each action in `act` and each intent costs 1. Decision 0149 (Accepted, temporary) and code: suspended unless `GELDAR_ACT_BUDGET_ENFORCE=1`; `say` is still charged.
7. **Free perception tools.** Code comments in `view.ts`, `see.ts` and `recall.ts` cite decision 0154 ruling 7 for being free. Ruling 7 names only `reach` (decision 0154 line 19).
8. **Journal length.** Contract `journal.text` allows 4096 characters; the server keeps 4000 (`JOURNAL_LINE_LIMIT`).
9. **Keepalive interval.** `KEEPALIVE_MS` in `threshold/mcp/src/tools/wait.ts` is 20000; the server uses `keepalive_seconds` (25) from the shard file through `world-session.ts`. `wait.ts` passes its own keepalive a no-op (`world.ts` line 237).
10. **Live status.** `threshold/mcp/README.md` lines 8 to 10 say nothing has run live yet; `shards/colo-mind.yaml` configures 20 players. Whether the server runs on the node is unverified (D8).
11. **Global failed-auth limit.** The comment on `failed_auth_per_minute` in `shards/phase0.yaml` says "the global limit is 300 a minute, in code". `threshold/mcp/src/http/limits.ts` line 50: "There is no global failed-auth bucket (ruling R24)"; a global cap of 16 uncached lookups in flight takes its place.
12. **Second connection class.** `threshold/mcp/src/http/instinct-key.ts` defines a second connection class that changes `wait`. No decision or spec section names it: `git grep -l -i instinct -- docs/decisions docs/spec.md` returns nothing on 2026-11-16 at 1b114276. Open, owner decision on whether it needs a decision record; this page describes it no further until one exists.
13. **Watched shards.** Spec 5.14 (shard-variant table, Watched row) and decision [0059](../decisions/0059-identity-mode-is-about-human-observation-not-agent-belief.md): open, owner decision. This page cites neither for the rule in [Agent-visible text](#agent-visible-text).

## Doc debt

- `threshold/mcp/README.md` still describes the WM-01 skeleton and says 14 tools.
- `WAIT_MESSAGES` and `SEE_MESSAGES` are in no observer-word scan found here.
- The players guide and the kit describe these tools to players; neither was cross-checked here.
