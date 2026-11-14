# Wave C7 packets, part 4: the C7-04 split (owner management API v1 in three cards)

Written 2026-11-13. Replaces the single C7-04 card in [c7-user-management-packets.md](c7-user-management-packets.md) (its section now points here). Rulings: decisions [0152](../../../../decisions/0152-programmatic-body-management-for-owners.md) (API, two credentials, supervisor), [0170](../../../../decisions/0170-owner-management-values-and-admin-flag.md) (values, admin flag), [0172](../../../../decisions/0172-human-skin-upload-held-for-approval.md) (skins, not used here), [0108](../../../../decisions/0108-mcp-roster-source-of-truth.md) (roster source). The draft OpenAPI document is moved verbatim into the appendix at the end of this file; each card below names the paths and schemas it ships. The old card's rules and test list are carried into the three cards (git history at `c222d2b3` has the original).

Order: C7-04a (wave 2, after C7-02b), then C7-04b (wave 2, after C7-04a), then C7-04c (wave 3, after C7-04a and C7-03b1). The three share `threshold/register/src/api/`, one file per resource. Each card edits `server.ts` only in its own route-table line, and ops merges those lines one at a time.

Shared facts (checked on `origin/main` c222d2b3 and the wave branch):

- `server.ts` has `createRegisterServer`, `FixedWindow` and `limiterKey`; the register limiter is per address. `account.ts` has `SESSION_COOKIE` (`gr_session`) and a CSRF token derived by HMAC per session (`csrfFor`), compared with `same`.
- `admin.ts` `isAdminOwner` reads `register_is_admin` and returns false on any error (fail closed). `audit.ts` `writeAudit` sets `admin` on each row from it.
- `tokens-service.ts` has `TokenStore` and `TokenDeps` (the admin reader). Its Postgres adapter is not confirmed on main; check before writing one.
- Not on `main` yet: `owner-keys-service.ts` and the `owner_api_keys` definer functions (C7-02b, wave branch `phase1/c7-wave2`, its worknote `worknotes/C7-02b.md`). `nats-ctl.ts` (`requestBodyOp`, `BodyUnavailable`) and the `ctl.body.*` subjects (C7-03b1). `worknotes/C7-05.md` exists on the wave branch only.
- Owner key shape `gowner-` plus 64 hex; player token shape `gmcp-` plus 64 hex; both are refused by the other surface.

Error body for every card: `application/problem+json`, fields `type`, `title`, `status`, `code`, optional `retryAfter`. The `code` enum is exactly: `unauthenticated, csrf_required, scope_missing, not_found, invalid, conflict, quota, rate_limited, body_unavailable, internal`.

---

## C7-04a: API core (route tree, auth, problem errors, limiter exemption, audit-lost wiring)

- **id / wave / lane.** C7-04a, wave 2. Register lane (one register-package packet at a time, per the wave plan: C7-02b, then C7-04a, then C7-04b).
- **depends-on.** C7-02b (merged to `phase1/c7-wave2`, PR #321 draft), C7-12 (merged). **branch.** `phase1/c7-04a-api-core`. **migration.** none. **size.** M (one session; if it runs past 40k, stop after the auth tests and report).
- **Goal.** The skeleton of `/register/api/v1/` with one resource route (`GET /agents/{playerId}`, the ownership guard) and the rules every later route uses.

### Files

- may-edit: `threshold/register/src/api/index.ts` (router, prefix check, dispatch), `threshold/register/src/api/auth.ts` (credential resolve), `threshold/register/src/api/guard.ts` (ownership check, 404), `threshold/register/src/problem.ts` (problem body and code enum), `threshold/register/src/api/agents-read.ts` (the one GET route), the limiter and wiring lines in `threshold/register/src/server.ts` (route table and the admin exemption only), `threshold/register/src/main.ts` (`onAuditLost` passed to the composition root, if it has an audit sink), their tests under `threshold/register/test/`, `docs/analysis/phase1/worknotes/C7-04a.md`.
- must-not-edit: `account*.ts` (C7-06 owns the page), `tokens-service.ts`, `owner-keys-service.ts` (used read-only), `docs/spec.md`, `supervisor/`, `contract/` (see the note below).
- Note on `contract/`. C7-03b1 also edits `contract/`. Do not edit it here. The OpenAPI source lives at `threshold/register/src/api/owner-api-v1.yaml`, lint-checked by the register test; generated types wait until `contract/` is free (a worknote line says so).

### Rules to implement

1. **Route tree.** Paths under `/register/api/v1/` only. Anything else under `/register/api/` is 404 `not_found` problem, not handled by the API router. Unknown path under v1 is 404 `not_found`.
2. **Credentials, in order.**
   - Cookie `gr_session` (the web UI). Resolve through the existing session store. A state-changing request (POST, PATCH, DELETE) needs the CSRF token in header `x-csrf-token`, compared with `same`. Missing or wrong token: 403 `csrf_required`.
   - `Authorization: Bearer gowner-...`. Resolve through the C7-02b resolve function. A key with a scope the route does not list: 403 `scope_missing`. Bearer keys need no CSRF token.
   - Player token (`gmcp-`) in Bearer: 401 `unauthenticated`. Owner key of a banned owner: 401 `unauthenticated` (the resolve refuses; the refusal is audited by C7-02b).
   - No credentials, or an unreadable session: 401 `unauthenticated`.
   - Scope per route is given by the card that adds the route (04b, 04c). This card ships the scope check and tests it on `GET /agents/{playerId}` (scope `read`).
3. **Ownership, 404 only.** `guard.ts` loads the agent for the owner. Another owner's agent and a missing agent return the same 404 body (byte-identical, same `code` and `title`). Never 403 for a foreign agent.
4. **Problem bodies.** Every error response, including the 404 for an unknown path, is `application/problem+json` with a `code` from the enum. `problem.ts` is the only place that builds one.
5. **Limiter admin exemption (carry-forward, review-5).** `server.ts` skips the register fixed-window limiter for an owner where `isAdminOwner` is true. An admin owner is still subject to ownership, scope, CSRF and audit. A `isAdminOwner` error means not admin (fail closed to the limit). The admin check reads the flag on each request, not from a cache (0170).
6. **onAuditLost (carry-forward).** Pass the audit-lost callback in the register composition root (`main.ts`) if the root has an audit sink. If it has none, do not invent one; write that in the worknote and the report.

### Tests (each fails on revert)

- Route tree: an unknown path under `/register/api/v1/` returns 404 `not_found` problem JSON; `/register/api/v2/x` is not handled by the API router. Revert: drop the prefix check; the v2 case is handled and the test fails.
- 401 without credentials on `GET /agents/{id}`; 401 for a `gmcp-` Bearer; 401 for a banned owner's key (fixture, resolve refuses). Revert: skip the Bearer resolve; the 401 tests fail.
- 403 `scope_missing` for a key with `body` only on `GET /agents/{id}` (needs `read`). Revert: remove the scope check; the test fails.
- CSRF: a cookie POST to a state-changing test route without `x-csrf-token` returns 403 `csrf_required`; with the token it is accepted; with a wrong token it is refused. A Bearer POST with no CSRF is accepted. Revert: remove the comparison; the first test fails.
- 404 for another owner's agent on `GET /agents/{id}`, byte-equal to the 404 for a missing agent. Revert: return 403 for a foreign agent; the byte-equal test fails.
- Problem bodies: a table test over every error path produces `content-type: application/problem+json` and a `code` in the enum. Revert: send one error as text; the test fails.
- Admin exemption (cookie and key): an admin owner makes N+1 writes past the register limit and none is 429; a normal owner's N+1th write is 429 with `Retry-After`. The admin's write audit row has `admin = true`. An admin's foreign-agent GET is still 404. Abort path: `isAdminOwner` rejects, the owner is treated as normal and the 429 applies. Revert: remove the admin check in `server.ts`; the admin test fails.
- onAuditLost: when the audit write for a state change fails, the callback is called once with the entry and the response is `500 internal` (fail closed; no change is reported as done). Revert: pass no callback; the callback test fails.

### Checks

`./geldar.ps1 pnpm --filter @geldar/register test`, the OpenAPI lint (`owner-api-v1.yaml`), `./geldar.ps1 pnpm --filter @geldar/register typecheck`, `pwsh -NoProfile -File ./geldar.ps1 check`. The live lane is not run.

---

## C7-04b: agents and tokens resources (owner-keys routes, token renew and revoke, onboarding hand-off)

- **id / wave / lane.** C7-04b, wave 2 (after C7-04a merges). Register lane, serial after C7-04a. **branch.** `phase1/c7-04b-agents-tokens`. **migration.** none. **size.** M (one session; the owner-key routes are the first thing to cut if it runs long, and go to a C7-04b2 card).
- **Goal.** The resource routes for agents, player tokens and owner keys, wired to the services that exist (`tokens-service.ts`, `owner-keys-service.ts`), with the Postgres adapter for the key store that C7-02b did not ship.

### Files

- may-edit: `threshold/register/src/api/agents.ts` (list, GET one, PATCH), `threshold/register/src/api/tokens.ts` (rotate, revoke), `threshold/register/src/api/owner-keys.ts` (list, mint, revoke), `threshold/register/src/owner-keys-pg.ts` (adapter over the four `register_*_owner_key*` definer functions, one file), `threshold/register/src/tokens-pg.ts` only if `TokenStore` has no Postgres adapter yet, the route-table lines in `server.ts`, their tests, `docs/analysis/phase1/worknotes/C7-04b.md`.
- must-not-edit: `api/agents-read.ts` beyond what the list needs, `account*.ts` (C7-06), `supervisor/`, `docs/spec.md`, `contract/`.
- The onboarding hand-off (rotate) goes to the C7-05 page on the wave branch; read its path from `worknotes/C7-05.md` there, do not guess it.
- Follow-up (wave 2 fix H, orchestrator ruling F4): the onboarding page and `docs/players/README.md` describe only what works today. "New token" revokes the old token immediately, and there is no expiry-date display, no 14-day renewal warning and no 10-minute grace. When renewal wires up and the account page shows expiry, change the onboarding expiry paragraph, the README "Making a new token" section and the 401 troubleshooting line together, and the pinned wording in `threshold/register/test/revocation-wording.test.ts` with them. The 90-day expiry sentence (F3) stays in the README and the onboarding text when renewal wires up: renewal adds the expiry display and the warning beside it and does not remove the sentence.

### Routes

- `GET /agents` (scope `read`): own agents only, `Agent` shape from the draft (`playerId, displayName, status, body, creditsLeft, publicCamera, thoughtsDelayedPublic, createdAt`, plus `tokenExpiresAt, tokenLastUsedAt, lastSeenAt` when known). `body` is read from the stored state here; the live body state comes in 04c.
- `GET /agents/{playerId}` (scope `read`): the same shape, through the 04a guard.
- `PATCH /agents/{playerId}` (scope `manage`): body `AgentPatch`. Accepts `publicCamera` and `thoughtsDelayedPublic` (booleans). A `displayName` field is refused with 422 `invalid` in this card, because rename is C7-07 and stays out. Any other field is 422 `invalid`. A foreign agent is 404.
- `POST /agents/{playerId}/tokens` (scope `manage`): rotate through `tokens-service`. 201 `TokenOnce` (`token` matches `^gmcp-[0-9a-f]{64}$`, `expiresAt` 90 days out, 0170 point 1). The token is returned once. A `GET` of the agent never returns it. Hand-off: the response carries `Link: </register/...onboarding path from C7-05>; rel="next"` when C7-05 is merged, otherwise no Link and the report says so.
- `POST /agents/{playerId}/tokens/revoke` (scope `manage`): 204. The revoked token fails on the next use.
- `GET /owner-keys` (scope `manage`): `KeyMeta` list (`keyId, label, scopes, expiresAt, lastUsedAt, createdAt`). Never a key value.
- `POST /owner-keys` (scope `manage`): mint through `owner-keys-service`; 201 `KeyOnce` (`key` matches `^gowner-[0-9a-f]{64}$`, shown once). Requested scopes must be a subset of the presenting key's scopes (C7-02b `bad_scopes`, mapped to 422 `invalid`). Mint and revoke are windowed through the service's `charge`; an admin skips the window (0170 point 5). SQLSTATE mapping (fix J): `42501` (scope escalation, refused in SQL) is 403 `scope_missing`; `53400` (live key cap) is 409 `conflict`.
- `POST /owner-keys/{keyId}/revoke` (scope `manage`): 204. A key of another owner is 404. The next resolve of the revoked key is refused.

### Tests (each fails on revert)

- Agents list returns only the caller's agents (two-owner fixture). Revert: drop the owner filter; the test fails.
- PATCH accepts `publicCamera`; `displayName` is 422 `invalid`; an unknown field is 422. Revert: drop the field check; the displayName test fails.
- PATCH with a `read` key is 403 `scope_missing`; with `manage` it is accepted; a foreign agent is 404.
- Rotate returns 201 with a `gmcp-` token once; a second `GET` of the agent and a second list never contain it. Revert: include the token in the GET; the once-test fails.
- Rotate abort: the store fails after issuing; the response is `500 internal`, and the previous token still works (no half-rotated state). Revert: issue before the store write check; the old-token test fails.
- Revoke: 204, then the token is refused on the next use. Revert: skip the revoke call; the refused test fails.
- Owner keys: mint returns one `gowner-` key; list shows no value; a scope the presenter lacks is 422 `invalid` and nothing is written. Revert: drop the subset check; the escalation test fails.
- Key revoke: 204, the next resolve is refused; a key of another owner is 404. Revert: revoke by key id without the owner check; the cross-owner test fails.
- Key mint and revoke windows: the normal owner's last allowed action succeeds and the next is 429 `quota` (or `rate_limited`) with `Retry-After`; an admin is never limited. Revert: remove the `charge` call; the 429 test fails.
- Owner-key adapter (`owner-keys-pg.ts`): a DB error during mint is rethrown, returns no value and leaves no row (the definer call is one statement). Test against the pg fixture the register suite already uses; if no pg fixture exists, test the adapter's error mapping with a fake client and say so in the worknote.
- SQL error mappings (`owner-keys-pg.ts`, fix J): a fake client that throws SQLSTATE `42501` gives 403 `scope_missing` and writes no key; one that throws `53400` gives 409 `conflict` and writes no key. Each test asserts the status and the `code`. Revert: drop the mapping line; the matching test sees 500 `internal` and fails.

### Checks

`./geldar.ps1 pnpm --filter @geldar/register test`, typecheck, the OpenAPI lint, `pwsh -NoProfile -File ./geldar.ps1 check`. The live lane is not run.

---

## C7-04c: body routes (start, stop, restart, status, log, retire) through the supervisor

- **id / wave / lane.** C7-04c, wave 3 (after C7-04a and C7-03b1 merge). Register lane, serial after C7-06 (the wave plan order), or beside it only if the files are disjoint (they are: `api/body*.ts`). **branch.** `phase1/c7-04c-body-routes`. **migration.** none. **size.** M, at the top of the range. If the retire route runs past 40k, split retire into C7-04d and report it.
- **Goal.** The body routes of 0152 point 1, each a thin mapping over `requestBodyOp` (C7-03b1). The supervisor does the work and the counters. The register side maps replies and limits repeat starts.

### Files

- may-edit: `threshold/register/src/api/body.ts` (start, stop, restart, status, log, retire), `threshold/register/src/api/body-log.ts` (the fixed-text table and the tail filter), the route-table lines in `server.ts`, their tests, `docs/analysis/phase1/worknotes/C7-04c.md`.
- must-not-edit: `supervisor/` (the counters are the supervisor's; the register does not count them), `nats-ctl.ts` (C7-03b1 owns it; read only), `contract/` (the `ctl.body.*` op list is C7-03b1's; this card uses ops it defines, no new op), `account*.ts`, `docs/spec.md`.
- If the supervisor's op list has no log op, stop and report. Do not add one here.
- A start the supervisor refuses with `login_name` (the display name is not a Minecraft login name) returns 422 `invalid`. The body tells the owner that the player's name must be 3 to 16 letters, digits or underscore. The register writes that text from a fixed string; the supervisor's error text never reaches the owner. Test the body text, and test that a supervisor error string is absent from the body. Revert: pass the supervisor text through; the body test fails.

### Routes

- `POST /agents/{playerId}/body/start` (scope `body`): 202 `BodyOp` (`opId`, `state` queued, done or refused). 429 `quota` (supervisor refusal) or `rate_limited` (the register limit on repeat starts) with `Retry-After`. 409 `conflict` only from the register's in-flight guard. Replies map by the table in the reply-mapping paragraph below.
- `POST .../body/stop` (scope `body`): 202 `BodyOp`. 409 `conflict` from the in-flight guard only. 429 as above.
- `POST .../body/restart` (scope `body`): 202 `BodyOp`. 429 as above.
- `GET .../body/status` (scope `read`): 200 `BodyStatus` (`state` in running, starting, waiting, stopped, unavailable; `health` and `hunger` integers 0 to 20; `lastSeenAt`).
- `GET .../body/log` (scope `read`): 200 `LogTail`. `limit` defaults to 200; a `limit` above 200 is 422 `invalid`. Only events of the owner's own agent (its life id), no older than 7 days (0170 point 4: the smaller of 200 events or 7 days). Each line is `{at, text}` where `text` is picked from a fixed table of codes. No model text, no digits from a model, no free text.
- `POST .../retire` (scope `manage`): stop the body through the supervisor, then revoke the tokens (C7-04b service), then retire the player; 202 `BodyOp`. A supervisor timeout on the stop leaves the agent not retired (the retry is safe).
- Every body route: a foreign agent is 404 (including `/body/log`). A supervisor timeout or no-responders is 503 `body_unavailable` with `Retry-After`; no pending reply is kept in the process (the in-flight slot below is the only per-owner state).
- **Reply mapping (fix L).** The table covers the real supervisor codes (`ReplyCode` and `Refusal` in `supervisor/src/ports.ts`). A repeat start replies `started`, so `noop` and `conflict` are not supervisor codes and are not in the table. `conflict` 409 comes only from the register's own in-flight guard (below).

  | Supervisor code | Route reply |
  |---|---|
  | `started`, `restarted`, `stopped` | 202 `BodyOp`, state `done` |
  | `running`, `idle` | 200 `BodyStatus` |
  | `logs` | 200 `LogTail` |
  | `quota` | 429 `quota` with `Retry-After` |
  | `unknown` | 404 `not_found` (foreign or unknown player, as above) |
  | `login_name` | 422 `invalid`; the body tells the owner the name must be 3 to 16 letters, digits or underscore |
  | `invalid` | 500 `internal` (a register bug: the route sent a shape the supervisor refuses) |
  | `error`, `busy`, and any code not in this table | 503 `body_unavailable` with `Retry-After` |

  No reply maps to 200 unless the table says 200. Tests: one per row, and an unknown code `zzz` gives 503, never 200. Revert: map unknown codes to 202; the unknown-code test fails.
- **Op binding (fix J).** `requestBodyOp` (C7-03b1, `threshold/register/src/nats-ctl.ts`) fills the payload `op` from the subject and throws before anything is sent when the payload names another op. Each route passes only its own op. Tests: a route's request carries its own op; a payload naming another op is refused before the request is sent (the nats-ctl op-binding tests pin it). Revert: drop the mismatch check; the mismatch test fails.
- **One in flight per owner (fix J).** At the register an owner has at most one body request in flight (start, stop, restart, retire). A second one while the first is pending gets 409 `conflict` and makes no supervisor call. It is 409, not 429, because it is a state conflict, not a rate. The slot is taken before the supervisor call and released in a `finally`. Tests: the first request (slot free) is accepted with 202; the last allowed request (the slot is freed by completion, then a new request takes it) is accepted; a concurrent request past the cap is 409 `conflict` and the supervisor fake is called once; a timeout releases the slot and the next request is accepted. Revert: remove the slot check; the past-cap test fails.

### Carry-forward from review-5 that lands here

- **Repeat start (rate limit).** The supervisor counts nothing for a repeat start of a running body, so the register limits it: a per-agent window on `start` requests, so a loop of repeats is refused with 429 `rate_limited` and `Retry-After`.
- **409 (review fix F, fix L).** A repeat start is idempotent. The supervisor replies `started` for it, and the route maps that to 202 `BodyOp` with state `done`. A repeat start is never 409. 409 `conflict` comes only from the register's in-flight guard, never from a supervisor reply.

### Tests (each fails on revert)

- Start: a `started` reply is 202 `done`; a repeat start (also `started`) is 202 `done`, never 409 (fix F). Revert: map `started` to 409 on a repeat; the repeat test fails.
- Repeat start limit: the N+1th repeat within the window is 429 `rate_limited` with `Retry-After`; the supervisor fake is called N times only. Revert: remove the repeat window; the 429 test fails.
- Quota (fixture of supervisor replies): a normal owner's 3rd start in an hour is accepted and the 4th returns the supervisor's `quota` refusal as 429 `quota` with `Retry-After`. The counter itself is tested in the supervisor package (C7-03a), not here; this card tests the mapping. Revert: map `quota` to 202; the 429 test fails.
- Admin (fixture): the admin's 4th start and 11th start map to 202 (the supervisor reply is `started`), and a second start while running is 202 `done`. The counter exemption is the supervisor's test (re-slice note below). Revert: map admin-flagged replies to 429; the admin test fails.
- 503 mapping: `BodyUnavailable` from a timeout, a no-responders reply and a disconnect each give 503 `body_unavailable` with `Retry-After`. Revert: map a timeout to 500; the 503 test fails.
- Abort: a disconnect mid-stop returns 503, and a retry of the same stop returns 202 (idempotent). No pending entry remains in the process map after the timeout (a counter test). Revert: keep the pending entry; the no-pending test fails.
- Cross-owner: every body route returns 404 for another owner's agent, including `/body/log`. Revert: drop the owner check on `/body/log`; the cross-owner log test fails (the classic regression, so this test runs first).
- Status: a `BodyStatus` fixture validates against the schema, `health` 21 is refused. Revert: drop the range check; the test fails.
- Log: at most 200 lines; a `limit` of 201 is 422; a fixture with events of two owners never shows the other owner's line; an event 8 days old is absent. Revert: remove the 7-day filter; the age test fails. Revert: remove the owner filter; the cross-owner test fails.
- Log text: every `text` value is one of the fixed table's strings; a fixture with a model-supplied string is rendered as the fixed code, never the string. Revert: pass the raw text through; the fixed-text test fails.
- Retire: a supervisor timeout on the stop leaves the agent not retired; the retry retires it once. Revert: retire before stop; the not-retired test fails.

### Re-slice note

The counter exemption for admin starts (per-agent hourly, per-owner daily) is enforced in the supervisor, which reads the flag from the database on every request (0170). Its test belongs to the supervisor package (C7-03a and C7-03b1). This card tests the register mapping only. The black-box admin-start test runs in the live lane, not in this card. The wave review checks that both tests exist.

### Checks

`./geldar.ps1 pnpm --filter @geldar/register test`, `./geldar.ps1 pnpm --filter @geldar/supervisor test` (only if the card touches shared fixtures), typecheck, `pwsh -NoProfile -File ./geldar.ps1 check`. The live lane (one start and one stop of a DB-listed test player) is run by ops in wave 3 with the C7-03b2 rollout, not here.

---

## Appendix: draft OpenAPI document (moved verbatim from the old C7-04 card)

The generator, not hand-written types, produces the types from `contract/` once that directory is free (see C7-04a). Until then the source is `threshold/register/src/api/owner-api-v1.yaml`.

```yaml
openapi: 3.1.0
info: { title: Geldar owner API, version: 1.0.0 }
servers: [{ url: https://glass.example.invalid/register/api/v1 }]
security: [{ sessionCookie: [] }, { ownerKey: [read] }]
paths:
  /agents:
    get: { summary: List my agents, scope: read, responses: { 200: { description: array of Agent } } }
  /agents/{playerId}:
    get: { summary: One agent, scope: read, responses: { 200: Agent, 404: NotFound } }
    patch: { summary: Rename or set visibility flags, scope: manage, requestBody: AgentPatch, responses: { 200: Agent, 422: Invalid } }
  /agents/{playerId}/body/start:   { post: { scope: body, responses: { 202: BodyOp, 409: Conflict, 429: RateLimited } } }
  /agents/{playerId}/body/stop:    { post: { scope: body, responses: { 202: BodyOp, 409: Conflict, 429: RateLimited } } }
  /agents/{playerId}/body/restart: { post: { scope: body, responses: { 202: BodyOp, 429: RateLimited } } }
  /agents/{playerId}/body/status:  { get: { scope: read, responses: { 200: BodyStatus } } }
  /agents/{playerId}/body/log:     { get: { scope: read, parameters: [limit (max 200), since], responses: { 200: LogTail } } }
  /agents/{playerId}/tokens:       { post: { summary: Rotate the player token (shown once), scope: manage, responses: { 201: TokenOnce } } }
  /agents/{playerId}/tokens/revoke:{ post: { scope: manage, responses: { 204: {} } } }
  /agents/{playerId}/retire:       { post: { summary: Stop the body, revoke tokens, retire the player, scope: manage, responses: { 202: BodyOp } } }
  /owner-keys:
    get:  { scope: manage, responses: { 200: array of KeyMeta } }
    post: { scope: manage, responses: { 201: KeyOnce } }
  /owner-keys/{keyId}/revoke: { post: { scope: manage, responses: { 204: {} } } }
components:
  securitySchemes:
    sessionCookie: { type: apiKey, in: cookie, name: gr_session }
    ownerKey: { type: http, scheme: bearer }
  schemas:
    Agent: { required: [playerId, displayName, status, body, creditsLeft, publicCamera, thoughtsDelayedPublic, createdAt], properties: { playerId: string, displayName: string, status: { enum: [active, paused, retired] }, body: { enum: [running, starting, waiting, stopped, unavailable] }, creditsLeft: integer, tokenExpiresAt: date-time, tokenLastUsedAt: date-time, lastSeenAt: date-time, publicCamera: boolean, thoughtsDelayedPublic: boolean, createdAt: date-time } }
    AgentPatch: { properties: { displayName: { pattern: "^[A-Za-z0-9 _-]{1,32}$" }, publicCamera: boolean, thoughtsDelayedPublic: boolean } }
    BodyStatus: { required: [state, lastSeenAt], properties: { state: { enum: [running, starting, waiting, stopped, unavailable] }, health: { type: integer, minimum: 0, maximum: 20 }, hunger: { type: integer, minimum: 0, maximum: 20 }, lastSeenAt: date-time } }
    LogTail: { required: [lines], properties: { lines: { type: array, maxItems: 200, items: { required: [at, text], properties: { at: date-time, text: { description: fixed text from enumerated codes, never model or observer text } } } } } }
    BodyOp: { required: [opId, state], properties: { opId: string, state: { enum: [queued, done, refused] } } }
    TokenOnce: { required: [token, expiresAt], properties: { token: { pattern: "^gmcp-[0-9a-f]{64}$" }, expiresAt: date-time } }
    KeyOnce: { required: [key, keyId, scopes, expiresAt], properties: { key: { pattern: "^gowner-[0-9a-f]{64}$" } } }
    KeyMeta: { required: [keyId, scopes, createdAt], properties: { keyId: string, label: string, scopes: array, expiresAt: date-time, lastUsedAt: date-time } }
    Problem: { required: [type, title, status, code], properties: { type: uri, title: string, status: integer, code: { enum: [unauthenticated, csrf_required, scope_missing, not_found, invalid, conflict, quota, rate_limited, body_unavailable, internal] }, retryAfter: integer } }
```
