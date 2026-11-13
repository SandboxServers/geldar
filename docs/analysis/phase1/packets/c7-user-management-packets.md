# Wave C7 packets: user management, bodies as a service, and the terms before sign-up

Written 2026-11-11; replanned 2026-11-13 after the owner's rulings. Source: the registration, accounts and UX research of 2026-11-11 read against `origin/main`. Conventions: [../packet-conventions.md](../packet-conventions.md). Decisions: [0151](../../../decisions/0151-bodies-run-only-in-the-colo.md), [0152](../../../decisions/0152-programmatic-body-management-for-owners.md), [0153](../../../decisions/0153-terms-consent-and-deletion-before-sign-up.md), [0155](../../../decisions/0155-legal-text-v1-approved-and-contact-published.md), [0170](../../../decisions/0170-owner-management-values-and-admin-flag.md), [0171](../../../decisions/0171-account-erasure-rule.md), [0172](../../../decisions/0172-human-skin-upload-held-for-approval.md) (all Decided). Numbers used by this wave: 0151 to 0153, 0155, and 0170 to 0172 (reserved for it).

This file holds the purpose, the rulings, the answered questions, the shared rules and cards C7-01 to C7-07. Cards C7-08 to C7-13 and the C3-04 slice are in [c7b-packets.md](c7b-packets.md). The dependency graph, the waves, the migration numbers and the live lane are in [c7-wave-plan.md](c7-wave-plan.md).

The register service is at `threshold/register/` (package `@geldar/register`). Every `register/` path below means that folder.

## Purpose

Self-registration works end to end on paper (sign-in, create, mint a token), but a registered user gets a token that opens nothing: the Body is started by hand from `shards/colo.yaml`, the account page shows no state, the onboarding text is out of date, and there is no deletion or export. This wave makes a registered user able to run and manage their agents without the operator, and makes sign-up safe to open to outsiders. Sign-up stays closed until the gate in C7-11 is met and the owner approves.

State on `main` (2026-11-13): C7-01 (sessions, migration 0021) and C7-08 (consent, migration 0022, legal text v1, decision 0155) are merged. The highest migration is 0023. C3-04 (the DB roster) is not merged.

## Rulings this wave applies

- **0151 (Colo-only bodies).** Bodies run only in the Colo. No bring-your-own-body.
- **0152 (programmatic management).** Owners manage their agents' bodies by API and web page. Owner credentials are separate from player tokens. A Colo-side supervisor executes lifecycle behind a narrow NATS control interface. The register service never has Docker socket access.
- **0153, 0155 (terms first).** Terms, consent, deletion and export before sign-up opens. Text version 1 is approved.
- **0170 (values and admin flag), 0171 (erasure), 0172 (skin upload).** See the questions below.

## Blockers ranking

| Rank | Gap | Class | Packet |
|---|---|---|---|
| 1 | Body provisioning for self-registered players | B | C3-04s, C7-03a, C7-03b |
| 2 | Terms, privacy notice and consent | B | C7-08 (done) |
| 3 | Account and data deletion and export | B | C7-09 |
| 4 | Onboarding after create or rotate | B | C7-05 |
| 5 | Account page state | B | C7-06 |
| 6 | Mobile and visual design | S | C7-06 |
| 7 | Sessions in memory | S | C7-01 (done) |
| 8 | Operator tooling, ban reason, audit trail | S | C7-12 (audit base), C7-10 |
| 9 | Token lifecycle | S | C7-02a, C7-02b |
| 10 | Rename and skin | L | C7-07 (rename), C7-13a to c (skin) |
| 11 | Admin flag for the operator's own owners | S | C7-12 |

## Shared rules (all C7 packets)

- **Knowledge boundary** (0058, 0068). Agent-visible text is untouched by this wave. The management API and the account page never show another owner's data, another agent's log, or world data an owner cannot see live.
- **No Docker socket outside the supervisor.** Only the Colo supervisor (C7-03) holds it.
- **Least privilege** (0067, 0080). The register service's NATS user may publish only to the supervisor's request subjects. It has no write to `geldar-skins` and never holds the MineSkin key (0172).
- **Append-only audit** (0085). Every state-changing action writes an audit row to `register_audit` (created by C7-12): actor, action, target, outcome, time, and `admin` (true when the actor is an admin owner). Rows are never updated or deleted, except as 0171 says.
- **Admin flag** (0170). An admin owner is exempt from the supervisor start counters and the register fixed-window rate limits only. Every ownership, scope, CSRF, token and audit rule still holds. Every packet that adds a rate limit or a quota names the admin exemption in its tests (exempt at the boundary, and still refused cross-owner), and the revert-check removes the ownership check, not the exemption.
- **Tokens and keys** are never logged, never in a URL, never emailed, and shown once on a `no-store` page.
- **One register-package packet at a time**, unless the wave plan names a pair with disjoint files. The register service is one package; `server.ts` route registration is edited by the packet that adds the route, and a pair may run in parallel only if the plan says they share no file.
- **Common card tail:** branch `phase1/<card-id-lowercase>-<slug>` as written on the card; must-not-edit `docs/spec.md`; worknote `docs/analysis/phase1/worknotes/<id>.md`; commit subject names the item; on cap, commit what passes and report the rest. Size is as in the conventions (about 40k working tokens for M).

## Owner questions: all answered (2026-11-13)

| Q | Ruling | Record |
|---|---|---|
| Q1 | Player token 90 days, warning 14 days before, renewal rotates the token and keeps the player id. | [0170](../../../decisions/0170-owner-management-values-and-admin-flag.md) |
| Q2 | Owner API keys 90 days, scopes `read`, `body`, `manage`, minted, listed and revoked on the account page, shown once. | 0170 |
| Q3 | 1 running body per agent; 3 starts per agent per hour; 10 per owner per day. A start is an accepted `body/start` or `body/restart`; stop, status, log and refused requests do not count. | 0170 |
| Q4 | Erasure rule: identity, owner, players, tokens, keys, consent, owner links removed; dead lives' public thoughts, events and death records stay as world history without an owner link. Legal review stays with the owner. | [0171](../../../decisions/0171-account-erasure-rule.md) |
| Q5 | A banned identity keeps its hash only. | 0171 |
| Q6 | Log tail: 200 events or 7 days, whichever is smaller. | 0170 |
| Q7 | Changed from "deferred": humans upload skins; each upload is held for operator approval; no auto-apply; the MineSkin key stays server-side on the operator side. | [0172](../../../decisions/0172-human-skin-upload-held-for-approval.md) |
| Q8 | Contact address and legal text version 1 approved. | [0155](../../../decisions/0155-legal-text-v1-approved-and-contact-published.md) |
| New | Admin flag: set only by the operator CLI; exempt from body quotas and register rate limits; every ownership check and the audit row stay. | 0170 |

Still the owner's, not blocking any packet: counsel's review of the erasure rule (0171) and the open placeholders of 0155 point 5; sign-up stays closed until the owner approves. Open: what happens to the events of a life still alive at deletion (0171 "Open").

---

## C7-01: sessions that survive a restart (DONE)

Merged: `sql/0021_register_sessions.sql` and `threshold/register/src/session-store.ts` are on `main` (commit b016eaf1). Persisted sessions, sliding 30 minute renewal capped at 12 hours, a session expired page. No further work in this wave except that later packets use `session-store.ts` for the owner session.

## C7-02a: player token lifecycle

- **id / wave / lane.** C7-02a, wave 1. **depends-on.** C7-12 (the audit table). **branch.** `phase1/c7-02a-token-lifecycle`. **migration.** none (if a column is needed, ask the orchestrator; 0033 is spare).
- **Goal.** Player tokens (0170 point 1): the account data shows the expiry date and `last_used_at` (mcp already writes it); the token lifetime is 90 days; a `renewal_due` flag is true from 14 days before expiry; a renewal action rotates the token, keeps the player id and shows the new token once; a revoke-only action (no replacement); the rotate grace of 10 minutes the operator CLI already has is available to the renewal. Each action writes a `register_audit` row. Rate limits on token actions use the register fixed windows, and an admin owner is exempt from those windows (0170).
- **may-edit.** `threshold/register/src/tokens*.ts` and tests (new), `threshold/register/src/account.ts` (token lines only), `tools/mcp-tokens/src/` only to read the 90 day default from one shared constant (no behaviour change to the CLI), `docs/analysis/phase1/worknotes/C7-02a.md`.
- **must-not-edit.** `threshold/mcp/src/` (the separation is tested from the register side; a change there goes in the worknote), `sql/`, `contract/`, `docs/spec.md`.
- **Tests (each fails on revert).**
  - Expiry: a token at its expiry second is refused; one second earlier is accepted (last-allowed boundary); lifetime is 90 days.
  - `renewal_due` is false at day 75 and 14 days minus a second before expiry, true at exactly 14 days before (boundary).
  - Renewal: the new token works, the player id is unchanged, the old token is accepted for 10 minutes only and refused at 10 minutes and 1 second.
  - Revoke-only: refused at once, no replacement minted.
  - Owner ban refuses every token (0136).
  - Rate limit: the second renewal inside the window is refused with 429 for a normal owner; the same sequence for an admin owner is accepted; an admin owner's renewal of another owner's agent is still a 404 (both in one test file).
  - Abort/error: a DB error during renewal leaves the old token valid and shows no new value.
  - Every action wrote exactly one audit row, `admin` true only for the admin.
  - Revert: remove the owner check in the renewal; the cross-owner test fails. Revert the admin exemption; the admin boundary test fails.
- **checks.** `./geldar.ps1 pnpm --filter @geldar/register test`, typecheck, `pnpm format`, `./geldar.ps1 check`.
- **size.** M.

## C7-02b: owner API keys

- **id / wave / lane.** C7-02b, wave 2. **depends-on.** C7-02a. **branch.** `phase1/c7-02b-owner-keys`. **migration.** 0026 (`owner_api_keys`).
- **Goal.** A `gowner-` plus 64 hex credential, stored as HMAC-SHA256 with the token pepper, with scopes `read`, `body`, `manage` (0170 point 2), 90 days, minted, listed and revoked on the account page data, shown once. Keys never authenticate the MCP endpoint; player tokens never authenticate the management API. A key's owner being banned, or the key being revoked or expired, refuses it. Mint, revoke and use-failure write audit rows. Mint and revoke are rate limited by the register windows (admin exempt).
- **may-edit.** `sql/0026_owner_api_keys.sql` and its sql test, `threshold/register/src/owner-keys*.ts` and tests (new), `threshold/register/src/server.ts` (the key routes only), `docs/analysis/phase1/worknotes/C7-02b.md`.
- **must-not-edit.** `threshold/mcp/`, `contract/`, `docs/spec.md`, earlier migrations.
- **Tests (each fails on revert).**
  - A player token refused by the key-guarded routes; an owner key refused by the MCP endpoint (both directions; the MCP side is a black-box request in a test, no edit to mcp).
  - The hash is stored; the value is never stored or logged; a second listing shows no value.
  - Scope: a key without `manage` cannot mint a key (403 `scope_missing`); expiry at the second; revoke is immediate.
  - A DB error during mint leaves no row and returns no value.
  - Admin: an admin owner mints beyond the normal window (exempt); an admin's key still cannot read another owner's agent (404). A normal owner at the window boundary: the last allowed mint succeeds, the next is refused.
  - Revert: remove the scope check; the scope test fails. Remove the owner check on revoke; the cross-owner revoke test fails.
- **checks.** Register tests, the migration check (`sql/test`), `./geldar.ps1 check`.
- **size.** M.

## C7-03a: Colo body supervisor (package and logic, no compose)

- **id / wave / lane.** C7-03a, wave 1. **depends-on.** C3-04s (DB roster), C7-12 (`is_admin`, `register_audit`). **branch.** `phase1/c7-03a-supervisor`. **migration.** 0027 (`body_ops`: one row per accepted start, for the counters).
- **Goal.** A new package `supervisor/` (`@geldar/supervisor`), one service. It serves a narrow NATS request/reply interface: `ctl.body.start`, `ctl.body.stop`, `ctl.body.restart`, `ctl.body.status`, `ctl.body.logtail`, each carrying an owner id and a player id. On every request: (1) the owner must own the player, read from the DB roster (not the yaml); a wrong owner and an unknown player get the same reply; (2) quotas of 0170 point 3, counted from `body_ops`: 1 running body per agent (always), 3 accepted starts per agent per hour and 10 per owner per day, unless the owner is an admin (the flag is read from the database on each request, unreadable means not admin); only accepted `start` and `restart` insert a `body_ops` row; (3) the 0082 CPU and memory limits are put in the container config it generates; (4) an audit row is written for the attempt and its outcome, including refusals, with `admin` set. `logtail` returns at most 200 events and nothing older than 7 days, built from fixed-text codes. The Docker call sits behind an interface so tests use a fake; the real Docker client is wired in C7-03b. `shards/colo.yaml` `sovereign.players` stays as a seed for house rangers.
- **may-edit.** `supervisor/` (new), `sql/0027_body_ops.sql` and its test, `contract/` only if the control messages need a schema (generated), `pnpm-workspace`/lockfile importer for the new package only, `docs/analysis/phase1/worknotes/C7-03a.md`.
- **must-not-edit.** `compose/`, `deploy/`, `shards/`, `threshold/`, `docs/spec.md`.
- **Tests (each fails on revert).**
  - Association: owner A stops owner B's agent; the reply equals the unknown-agent reply and no row is inserted.
  - Roster from DB: a DB-listed player absent from the yaml can start; a yaml-only id is refused for an owner request.
  - Quotas at the boundary: the third start in the hour is accepted, the fourth is refused with `quota` and audited; the tenth start of the owner's day is accepted, the eleventh refused; a refused request does not count; stop, status and log do not count.
  - Admin: the same sequence for an admin owner accepts the fourth and the eleventh start; an admin still gets a refusal for a second running body on one agent and for another owner's agent. A flag read that errors is treated as not admin (the fourth start is refused).
  - Concurrency: two starts for one agent race; exactly one body starts.
  - Generated container config carries the 0082 limits.
  - Abort/error: a NATS disconnect mid-request leaves no timer and no half-started body (the start is idempotent on retry); a Docker error is reported and audited, and no `body_ops` row is kept for it.
  - Log tail: 200 events at most and none older than 7 days (fixed clock).
  - Revert: skip the association check; the cross-owner test fails. Drop the admin read; the admin boundary test fails.
- **checks.** `./geldar.ps1 pnpm --filter @geldar/supervisor test`, typecheck, `pnpm format`, the migration check, `./geldar.ps1 check`.
- **size.** L (two sessions; split at "association and roster" and "quotas, limits and log").

## C7-04: management API v1

- **id / wave / lane.** C7-04, wave 2 (starts after C7-02b merges). **depends-on.** C7-02b, C7-03a, C7-12. **branch.** `phase1/c7-04-management-api`. **migration.** none.
- **Goal.** The authenticated API of 0152, under `/register/api/v1/`. Two credentials: the owner session cookie (for the web UI; state-changing calls need the CSRF token) and an owner key (`Authorization: Bearer gowner-...`, for scripts), with the scope rule of C7-02. Every error is `application/problem+json`. Another owner's agent always gets 404, never 403, so existence is not leaked.

Draft contract (OpenAPI 3.1 style; the generator, not hand-written, produces the types from `contract/` in the implementation):

```yaml
openapi: 3.1.0
info: { title: Geldar owner API, version: 1.0.0 }
servers: [{ url: https://glass.geldar.sandboxservers.games/register/api/v1 }]
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

- **Rules.** Rate limits: the fixed windows of the register service plus the supervisor quotas (Q3); a 429 carries `Retry-After`. The log endpoint returns only the owner's own agent's events (its life id); no other player, no observer data, no raw model text. Log lines are fixed text built from codes (as 0143 does), and the count and window follow Q6.
- **may-edit.** `threshold/register/src/api/` (new tree, one file per resource), `threshold/register/src/problem.ts`, `contract/` only for the OpenAPI document source and the generated types, `docs/analysis/phase1/worknotes/C7-04.md`. Not `docs/spec.md`.
- **Tests (each fails on revert).**
  - Every route: a 401 without credentials; a 404 for another owner's agent (both GET and POST); a 403 `scope_missing` for an owner key without the scope.
  - CSRF: a cookie POST without the token is refused; with the token, accepted.
  - Start while running: 409 `conflict`. Start at the quota boundary: last allowed accepted, next 429 with `Retry-After`.
  - Log: at most 200 lines; lines of another agent never appear (a seeded fixture with two owners); text matches the fixed-text table (no digit or free text from a model).
  - Token rotate returns the token once; a second GET does not return it.
  - Problem bodies: every error is `application/problem+json` with a `code` from the enum.
  - Abort/close/error: a supervisor timeout returns `503 body_unavailable` and no pending state is left; a client disconnect mid-stop does not leave a half-retired agent (idempotent retry).
  - Admin owner (key and cookie): the 4th start in an hour and the 11th in a day are accepted (the supervisor exempts them); a second start while one runs is still 409; another owner's agent is still 404 on every route, including `/body/log`; the register fixed-window 429 does not apply to the admin. The audit row carries `admin = true`. A normal owner at the same boundary: the 3rd start accepted, the 4th is 429 `quota` with `Retry-After`.
  - Revert: remove the owner check on `/body/log`; the cross-owner log test fails. Remove the admin lookup; the admin boundary test fails.
- **checks.** `./geldar.ps1 pnpm --filter @geldar/register test`, the OpenAPI lint and generator check, typecheck, `./geldar.ps1 check`.
- **Owner decisions.** None left (0170: scopes, quotas, 200 events or 7 days).
- **size.** L (two sessions; split at "agents, token and key routes" and "body routes and log").

## C7-05: onboarding after create or rotate, and the players README

- **id / wave / lane.** C7-05, wave 2. **depends-on.** C7-02a. **branch.** `phase1/c7-05-onboarding`. **migration.** none. **Parallel with C7-02b** (disjoint files: `pages/onboarding*.ts`, `static/onboarding.js`, `docs/players/README.md`; it does not edit `server.ts`, the route is added through the existing page router, or the worknote names a one-line index request to C7-04).
- **Goal.** After a token is minted, a `no-store` onboarding page shows the token once with: a copy button for the token and for each snippet (a same-origin script file, no inline script, to keep CSP `script-src 'self'`); a ready `claude mcp add --transport http geldar <url> --header "Authorization: Bearer <token>"` line with the real player id; a headless `.mcp.json` snippet with the real player id; the expiry date; a note that the token is not shown again and is never emailed; a link to `docs/players/README.md` (rendered on the site or linked to the repo). The token is never in a URL, a log line or a query string. `docs/players/README.md` is corrected in the same packet: it drops "access is by hand" and "ask the operator", describes the account page and sign-in (Microsoft only, per 0135 amendment), says the Body is hosted by the Colo and that the user never runs a body (0151), and gives the expiry and renewal rules as they are built.
- **may-edit.** `threshold/register/src/pages/onboarding*.ts` and tests, `threshold/register/src/static/onboarding.js` (copy buttons, same-origin), `docs/players/README.md`, `docs/analysis/phase1/worknotes/C7-05.md`.
- **Tests (each fails on revert).**
  - The token appears once: a second load of the onboarding page shows no token.
  - The token is absent from the URL, the redirect target and the request log (a log-capture test).
  - The snippets contain the real player id and a `gmcp-` placeholder that matches the token pattern.
  - The page has no inline script and no inline style (CSP check).
  - `docs/players/README.md`: a repo-check test asserts the file no longer contains "access is by hand" or "ask the operator", and that every URL it names is one the register service or Caddy serves.
  - Revert: put the token into the redirect URL; the URL test fails.
- **checks.** Register tests, the docs link check in `pnpm check:repo`, `./geldar.ps1 check`.
- **Owner decisions.** None. Expiry text uses 0170 (90 days, warning at 14, renewal keeps the player id). Wording of the README for the Body (0151) is confirmed by the owner before merge.
- **size.** M.

## C7-06: account page v2

- **id / wave / lane.** C7-06, wave 3. **depends-on.** C7-04, C7-05. **branch.** `phase1/c7-06-account-page-v2`. **migration.** none. It owns `pages/account*.ts`; C7-13c adds the skin section after it merges.
- **Goal.** Replace the bare HTML account page with a page that works on a phone. It adds: a linked stylesheet (CSP `style-src 'self'`) and a viewport meta; labelled inputs; a status line per agent (body running, starting, waiting or stopped; credits left; token expiry date; last used); the start, stop and restart buttons that call the C7-04 API; links to the agent's Glass and Kino views where 0138 and 0139 allow; the visibility toggles with a plain explanation of public camera and delayed public thoughts; the missing thoughts form (the route exists); and HTML error pages for 403, 404, 429 and 503 (JSON only under `/api/`).
- **may-edit.** `threshold/register/src/pages/account*.ts`, `threshold/register/src/static/account.css`, `threshold/register/src/pages/errors.ts`, tests, `docs/analysis/phase1/worknotes/C7-06.md`.
- **Tests (each fails on revert).**
  - Viewport meta present; the stylesheet is linked; no inline style attribute (CSP).
  - Every input has a label (an accessibility check on the rendered HTML).
  - Another owner's agent does not appear in the list (seeded two-owner fixture).
  - Error pages: a 429 and a 503 render HTML with a retry hint; the same path under `/api/` returns problem JSON.
  - The thoughts form posts with the CSRF token and the route accepts only the owner's agent.
  - The Glass link is absent when the agent's visibility does not allow it (0138).
  - Revert: drop the viewport meta; the mobile test fails.
- **checks.** Register tests, `./geldar.ps1 check`.
- **Owner decisions.** None.
- **size.** M.

## C7-07: agent rename (skin choice is deferred)

- **id / wave / lane.** C7-07, wave 3. **depends-on.** C7-04. **branch.** `phase1/c7-07-agent-rename`. **migration.** 0028 (rename definer function).
- **Goal.** An owner renames an agent through the API (`PATCH /agents/{playerId}`) and the account page. The new name passes the same regex and the same rules as create (0145 applies to names in play, not here). Rate limited (the 10 second DB window of the camera toggle, plus an hourly cap). Each rename writes an audit row with the old name's hash, not the name. Renaming updates the display name everywhere that shows it, and the old name stays only in the audit row. Player id and life id never change. Skin upload is not in this packet (it is C7-13a to c, 0172).
- **may-edit.** `threshold/register/src/api/agents*.ts`, `threshold/register/src/pages/account*.ts` (rename form only), `sql/` migration for the rename definer function, tests, `docs/analysis/phase1/worknotes/C7-07.md`.
- **Tests (each fails on revert).**
  - A name with a disallowed character refused; 32 characters accepted, 33 refused (last-allowed boundary).
  - Rename twice within the window: second refused with 429.
  - Another owner's agent: 404.
  - The audit row exists and holds no plain name.
  - Player id unchanged after rename.
  - Admin owner: a second rename inside the window is accepted (exempt); the hourly cap is not applied; another owner's agent is still 404 and the audit row has `admin = true`. A normal owner: the second rename inside the window is 429.
  - Revert: skip the owner check in the definer function; the cross-owner test fails. Remove the admin exemption; the admin test fails.
- **checks.** Register tests and migration check, `./geldar.ps1 check`.
- **Owner decisions.** None.
- **size.** S.
