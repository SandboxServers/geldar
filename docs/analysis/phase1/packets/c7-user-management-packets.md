# Wave C7 packets: user management, bodies as a service, and the terms before sign-up

Written 2026-11-11. Source: the registration, accounts and UX research of 2026-11-11 (a working copy, not committed) read against `origin/main` at 5eca859 (PR #187). Conventions: [../packet-conventions.md](../packet-conventions.md). Decisions: [0151](../../../decisions/0151-bodies-run-only-in-the-colo.md), [0152](../../../decisions/0152-programmatic-body-management-for-owners.md), [0153](../../../decisions/0153-terms-consent-and-deletion-before-sign-up.md) (all Decided, owner rulings 2026-11-11). Numbers used by this wave: 0151 to 0153 only.

## Purpose

Self-registration works end to end on paper (sign-in, create, mint a token), but a registered user gets a token that opens nothing: the Body is started by hand from `shards/colo.yaml`, the account page shows no state, the onboarding text is out of date, and there are no terms, consent, deletion or export. This wave makes a registered user able to run and manage their agents without the operator, and makes sign-up safe to open to outsiders. Sign-up stays closed until C7-08, C7-09 and the owner's approval of the legal text are in place (C7-11).

## Rulings this wave applies

- **0151 (Colo-only bodies).** Bodies run only in the Colo. There is no bring-your-own-body. A user's MCP token talks to the Colo-hosted Body. The Mind (the user's own client, for sovereign agents) is unchanged.
- **0152 (programmatic management).** Every registered owner manages their own agents' bodies by API as well as by the web page. Owner credentials are separate from player MCP tokens. A Colo-side supervisor executes lifecycle behind a narrow NATS control interface. The register service never has Docker socket access.
- **0153 (terms first).** Terms, privacy notice, consent, account deletion and data export are required before sign-up opens to outsiders. Legal text is drafted for owner review and is never self-approved.

## Blockers ranking (from the research, mapped to packets)

| Rank | Gap | Class | Packet |
|---|---|---|---|
| 1 | Body provisioning for self-registered players (roster in repo yaml, manual `player-start`) | B | C7-03 (with C7-04 start/stop) |
| 2 | Terms, privacy notice and consent at sign-up | B | C7-08 |
| 3 | Account and data deletion and export; no erasure rule | B | C7-09 |
| 4 | Onboarding after create or rotate: no copy, no MCP snippet, out-of-date `docs/players/README.md` | B | C7-05 |
| 5 | Account page state: no body status, no expiry date, no last-used, no Glass link, missing thoughts form | B | C7-06 |
| 6 | Mobile and visual design: no stylesheet, no viewport, JSON error pages | S | C7-06 |
| 7 | Sessions held in memory; a restart logs everyone out; no sliding renewal | S | C7-01 |
| 8 | Operator tooling: ban reason, owner and player list, no register audit trail | S | C7-10 |
| 9 | Token lifecycle: 30-day fixed expiry with no warning, no revoke-only action, no rotate grace in the UI | S | C7-02 |
| 10 | Edit name, user-chosen skin, model or kit, roster page | L | C7-07 (rename now; skin later) |

Dependency on existing work: C3-04 (the DB roster) is still planned. C7-03 needs it, and C7-03 is where the roster moves out of the yaml.

## Dependency graph

```
C7-01 sessions ------------------+
  |                              |
C7-02 token and owner keys ----+-+-- C7-05 onboarding
  |                            |
C3-04 (DB roster, existing) -> C7-03 supervisor + control
  |                            |
  +------------------------ C7-04 management API v1
                               |
              +----------------+------------------+
              |                                   |
        C7-06 account page v2               C7-07 rename, skin later
              |
C7-08 terms and consent (text, owner-blocked; can start now)
  |
C7-09 deletion and export (needs C7-02, C7-03, C7-08)
C7-10 operator console and audit (needs C7-03, C7-04)
  |
C7-11 sign-up gate (needs C7-05, C7-06, C7-08, C7-09 and owner approval)
```

### Parallel and sequential

- **Start now, in parallel:** C7-01, C7-03 (after C3-04 is merged; until then it is BlockedDecision on that), and C7-08 (text only; the coder drafts and cannot approve).
- **Then:** C7-02 after C7-01. C7-05 after C7-02. C7-04 after C7-02 and C7-03.
- **Then:** C7-06 and C7-07 after C7-04. C7-09 after C7-02, C7-03 and C7-08. C7-10 after C7-03 and C7-04.
- **Last:** C7-11, a gate, not a code packet.
- All register-service packets edit `register/` files one at a time (the register service is one package). C7-03 is the only packet that edits `shards/` or `deploy/` for the supervisor; C7-04 owns the API route tree.

## Shared rules (all C7 packets)

- **Knowledge boundary** (0058, 0068). Any text an agent can see is untouched by this wave. The management API and the account page never show another owner's data, another agent's log, or world data an owner cannot see live.
- **No Docker socket outside the supervisor.** The register service, the API and the account page never mount or call the Docker socket. Only the Colo supervisor (C7-03) holds it.
- **Least privilege** (0067, 0080). The register service's NATS user may publish only to the supervisor's request subjects. Nothing else.
- **Append-only audit** (0085). Every state-changing action writes an audit row (owner key id, action, target agent, outcome, time), and rows are never updated or deleted except by C7-09's stated erasure rule.
- **Tokens and keys** are never logged, never put in a URL, never emailed (we hold no email), and are shown once on a `no-store` page.
- **Owner decisions** are listed per packet. A packet with an unanswered owner question stays BlockedDecision for that item; the coder does not pick a default and build on it, except where the packet says a proposed default is used for a test fixture only.
- **Common card tail:** must-not-edit `docs/spec.md`; worknote `docs/analysis/phase1/worknotes/<id>.md`; on cap, commit what passes and report the rest; commit subject names the item.

## Owner questions (not decided by this wave)

Each has a proposed default. The default is used only where the packet says so, and the owner confirms or changes it before the packet is dispatched.

- **Q1 Player token expiry.** Today 30 days, fixed, no renewal except a new token. Proposed: 90 days, with a warning 14 days before expiry and a renewal action that rotates the token (keeps the same player id). Blocks C7-02.
- **Q2 Owner API key lifetime and scopes.** Proposed: 90 days, scopes `read`, `body`, `manage`, minted and listed on the account page, shown once. Blocks C7-02 and C7-04 scope names.
- **Q3 Body quotas and limits.** Proposed: at most 1 running body per live agent; at most 3 start or restart calls per agent per hour and 10 per owner per day; CPU and memory per body capped in the Colo budget (0082). Total running bodies capped by the Colo capacity ceiling (the value comes from the Colo budget, not chosen here). Blocks C7-03.
- **Q4 Erasure rule.** What is erased on account deletion (identity hash, owner row, players, tokens, consent, thoughts about a living agent) and what stays as world history (events, a dead life's public thoughts, death records, audit rows keyed by an erasure-safe id). Must be decided before C7-09. Legal input needed.
- **Q5 Ban tombstone after deletion.** Keep a banned identity's hash after deletion so a ban cannot be evaded by deleting and re-signing. Proposed: yes, hash only, no other data. Blocks C7-09 and C7-10.
- **Q6 Log tail retention.** How many lines or days of an agent's own log the owner may read. Proposed: last 200 events or 7 days, whichever is smaller. Blocks C7-04.
- **Q7 Skin choice scope.** A vetted set only (no upload) in a later packet. Proposed: deferred; C7-07 ships rename only. Blocks skin work.
- **Q8 Contact and jurisdiction in the legal text.** A real abuse and privacy contact address and the governing law are the owner's to supply. The drafts carry placeholders. Blocks C7-11.

---

## C7-01: sessions that survive a restart

- **id / wave.** C7-01, C7-A. **depends-on.** none.
- **Goal.** Register sessions (`gr_session`) move from the in-memory Map to a Postgres table keyed by a hash of the session id, so a register restart does not log everyone out. Adds sliding renewal (30 minutes from last activity, capped at 12 hours from sign-in) and a friendly "session expired" page instead of a bare 401. The `gk_session` cookie (read by Glass) stays HMAC-signed and host-only; its lifetime is unchanged.
- **may-edit.** `register/src/session*.ts` and tests, `register/src/pages/` (expired page only), a new `sql/` migration for `register_sessions` (grants to `geldar_register` only, per 0056), `docs/analysis/phase1/worknotes/C7-01.md`.
- **Tests (each fails on revert).**
  - A session created, the register process restarted (new instance on the same DB), the cookie still works.
  - Sliding: activity at minute 25 extends to minute 55; no activity to minute 31 expires.
  - Hard cap: activity at hour 11 does not extend past 12 hours from sign-in.
  - Logout deletes the row; the old cookie is refused afterwards.
  - Abort/close/error: a DB error during lookup refuses the request (fail closed), leaves no half-written row, and the expired page is served.
  - Last-allowed: the session exactly at its expiry second is refused.
  - Revert: restore the in-memory Map; the restart test fails.
- **checks.** `./geldar.ps1 pnpm --filter register test`, typecheck, lint, the migration check, `./geldar.ps1 check`.
- **Owner decisions.** None. Uses 0056 grants.
- **size.** M.

## C7-02: token and owner-key lifecycle

- **id / wave.** C7-02, C7-A. **depends-on.** C7-01.
- **Goal.** (a) Player tokens: record `last_used_at` for display (mcp already writes it); show expiry date and last-used on the account page data; add a revoke-only action (no replacement); add a renewal action that rotates a token before expiry (Q1); add the rotate grace of 10 minutes that the operator CLI already has (default off for the UI until Q1 is answered). (b) Owner API keys: a new `gowner-` plus 64 hex credential, stored as HMAC-SHA256 with the token pepper, with scopes (Q2), minted, listed and revoked on the account page, shown once. Keys are a separate table; they never authenticate the MCP endpoint, and player tokens never authenticate the management API (0152).
- **may-edit.** `register/src/tokens*.ts`, `register/src/owner-keys*.ts` and tests, `sql/` migration for `owner_api_keys` (hash, owner_id, scopes, label, created_at, expires_at, revoked_at, last_used_at), `mcp/src/auth*` only to confirm the separation (no behaviour change there), `docs/analysis/phase1/worknotes/C7-02.md`.
- **Tests (each fails on revert).**
  - A player token refused by the management API; an owner key refused by the MCP endpoint (both directions).
  - Revoke-only: token refused at once; no replacement minted.
  - Expiry: the token at its expiry second is refused; a warning flag is set 14 days before expiry (Q1 value; test uses the proposed default in a fixture).
  - Owner key: hash stored, value never stored or logged; a second listing shows no value.
  - Rotate grace: old token accepted for 10 minutes only, refused at 10 minutes and 1 second (last-allowed boundary).
  - Owner ban: every owner key and token refused (0136).
  - Abort/error: a DB error during mint leaves no row and returns no value.
  - Revert: remove the scope check on owner keys; the cross-use test fails.
- **checks.** Register and mcp tests, `./geldar.ps1 check`.
- **Owner decisions.** Q1, Q2 (the packet is BlockedDecision until both are answered, except the separation tests, which need no answer).
- **size.** L (split into C7-02a tokens and C7-02b owner keys if it does not fit one session).

## C7-03: Colo body supervisor and control interface

- **id / wave.** C7-03, C7-B. **depends-on.** C3-04 (DB roster). BlockedDecision on Q3.
- **Goal.** A Colo-side supervisor replaces the operator-only `colo-admin.sh player-start/stop/list` path for owner use and becomes the only holder of the Docker socket for bodies. It serves a narrow NATS request/reply interface (`ctl.body.start`, `ctl.body.stop`, `ctl.body.restart`, `ctl.body.status`, `ctl.body.logtail`), each request carrying an owner id and an agent (player) id. On every request it checks that the owner owns the agent (reading the DB roster, not the yaml), applies the quotas in Q3 and the resource limits in 0082, and writes an append-only audit row for the attempt and its outcome, including refusals. The roster comes from the DB; `shards/colo.yaml` `sovereign.players` remains only for house rangers and is read as a seed, not as the live list. players-host still refuses unlisted ids; the supervisor is what lists them.
- **may-edit.** `supervisor/` (new package, one service, one container), `compose/colo*.yml` (the supervisor service and its socket mount, no other service gets it), `deploy/colo-admin.sh` (player-start/stop delegate to the supervisor for DB players; yaml stays for rangers), `contract/` only if the control messages need a schema (generated, not hand-written), `register/src/nats*` (the request side only), `docs/analysis/phase1/worknotes/C7-03.md`.
- **Tests (each fails on revert).**
  - Association: owner A asks to stop owner B's agent; refused with the same reply as an unknown agent (no existence leak).
  - Roster from DB: a player added in the DB and absent from the yaml can start; a yaml-only id not in the DB is refused for an owner request.
  - Quotas: the last allowed start in the hour succeeds; the next is refused with a `quota` reply and writes an audit row (last-allowed-attempt test). A per-owner daily cap at its boundary.
  - Concurrency: two starts for the same agent race; exactly one body starts.
  - Resource limits: the generated container config carries the 0082 CPU and memory limits (a config-level test, no live server).
  - Abort/close/error: NATS disconnect mid-request leaves no pending timer and no half-started container (the start is idempotent on retry); a Docker error is reported and audited.
  - Socket isolation: a test asserts only the supervisor service in the compose file mounts the Docker socket.
  - Revert: let the supervisor skip the association check; the cross-owner test fails.
- **checks.** `./geldar.ps1 pnpm --filter supervisor test`, the compose check, `./geldar.ps1 check`. The live start of a body is a live-lane item, `live: pending`.
- **Owner decisions.** Q3 (quotas and limits).
- **size.** L.

## C7-04: management API v1

- **id / wave.** C7-04, C7-B. **depends-on.** C7-02, C7-03.
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
- **may-edit.** `register/src/api/` (new tree, one file per resource), `register/src/problem.ts`, `contract/` only for the OpenAPI document source and the generated types, `docs/analysis/phase1/worknotes/C7-04.md`. Not `docs/spec.md`.
- **Tests (each fails on revert).**
  - Every route: a 401 without credentials; a 404 for another owner's agent (both GET and POST); a 403 `scope_missing` for an owner key without the scope.
  - CSRF: a cookie POST without the token is refused; with the token, accepted.
  - Start while running: 409 `conflict`. Start at the quota boundary: last allowed accepted, next 429 with `Retry-After`.
  - Log: at most 200 lines; lines of another agent never appear (a seeded fixture with two owners); text matches the fixed-text table (no digit or free text from a model).
  - Token rotate returns the token once; a second GET does not return it.
  - Problem bodies: every error is `application/problem+json` with a `code` from the enum.
  - Abort/close/error: a supervisor timeout returns `503 body_unavailable` and no pending state is left; a client disconnect mid-stop does not leave a half-retired agent (idempotent retry).
  - Revert: remove the owner check on `/body/log`; the cross-owner log test fails.
- **checks.** `./geldar.ps1 pnpm --filter register test`, the OpenAPI lint and generator check, typecheck, `./geldar.ps1 check`.
- **Owner decisions.** Q2 (scopes), Q3, Q6.
- **size.** L.

## C7-05: onboarding after create or rotate, and the players README

- **id / wave.** C7-05, C7-B. **depends-on.** C7-02 (expiry and renewal).
- **Goal.** After a token is minted, a `no-store` onboarding page shows the token once with: a copy button for the token and for each snippet (a same-origin script file, no inline script, to keep CSP `script-src 'self'`); a ready `claude mcp add --transport http geldar <url> --header "Authorization: Bearer <token>"` line with the real player id; a headless `.mcp.json` snippet with the real player id; the expiry date; a note that the token is not shown again and is never emailed; a link to `docs/players/README.md` (rendered on the site or linked to the repo). The token is never in a URL, a log line or a query string. `docs/players/README.md` is corrected in the same packet: it drops "access is by hand" and "ask the operator", describes the account page and sign-in (Microsoft only, per 0135 amendment), says the Body is hosted by the Colo and that the user never runs a body (0151), and gives the expiry and renewal rules as they are built.
- **may-edit.** `register/src/pages/onboarding*.ts` and tests, `register/src/static/onboarding.js` (copy buttons, same-origin), `docs/players/README.md`, `docs/analysis/phase1/worknotes/C7-05.md`.
- **Tests (each fails on revert).**
  - The token appears once: a second load of the onboarding page shows no token.
  - The token is absent from the URL, the redirect target and the request log (a log-capture test).
  - The snippets contain the real player id and a `gmcp-` placeholder that matches the token pattern.
  - The page has no inline script and no inline style (CSP check).
  - `docs/players/README.md`: a repo-check test asserts the file no longer contains "access is by hand" or "ask the operator", and that every URL it names is one the register service or Caddy serves.
  - Revert: put the token into the redirect URL; the URL test fails.
- **checks.** Register tests, the docs link check in `pnpm check:repo`, `./geldar.ps1 check`.
- **Owner decisions.** None. Wording of the README for the Body (0151) is confirmed by the owner before merge.
- **size.** M.

## C7-06: account page v2

- **id / wave.** C7-06, C7-B. **depends-on.** C7-04, C7-05.
- **Goal.** Replace the bare HTML account page with a page that works on a phone. It adds: a linked stylesheet (CSP `style-src 'self'`) and a viewport meta; labelled inputs; a status line per agent (body running, starting, waiting or stopped; credits left; token expiry date; last used); the start, stop and restart buttons that call the C7-04 API; links to the agent's Glass and Kino views where 0138 and 0139 allow; the visibility toggles with a plain explanation of public camera and delayed public thoughts; the missing thoughts form (the route exists); and HTML error pages for 403, 404, 429 and 503 (JSON only under `/api/`).
- **may-edit.** `register/src/pages/account*.ts`, `register/src/static/account.css`, `register/src/pages/errors.ts`, tests, `docs/analysis/phase1/worknotes/C7-06.md`.
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

- **id / wave.** C7-07, C7-B. **depends-on.** C7-04.
- **Goal.** An owner renames an agent through the API (`PATCH /agents/{playerId}`) and the account page. The new name passes the same regex and the same rules as create (0145 applies to names in play, not here). Rate limited (the 10 second DB window of the camera toggle, plus an hourly cap). Each rename writes an audit row with the old name's hash, not the name. Renaming updates the display name everywhere that shows it, and the old name stays only in the audit row. Player id and life id never change. Skin choice is out of scope (Q7): the packet adds no upload and no picker.
- **may-edit.** `register/src/api/agents*.ts`, `register/src/pages/account*.ts` (rename form only), `sql/` migration for the rename definer function, tests, `docs/analysis/phase1/worknotes/C7-07.md`.
- **Tests (each fails on revert).**
  - A name with a disallowed character refused; 32 characters accepted, 33 refused (last-allowed boundary).
  - Rename twice within the window: second refused with 429.
  - Another owner's agent: 404.
  - The audit row exists and holds no plain name.
  - Player id unchanged after rename.
  - Revert: skip the owner check in the definer function; the cross-owner test fails.
- **checks.** Register tests and migration check, `./geldar.ps1 check`.
- **Owner decisions.** Q7 (skin deferred). Rename itself needs no answer.
- **size.** S.

## C7-08: terms, privacy notice and consent (drafts for owner review)

- **id / wave.** C7-08, C7-C. **depends-on.** none (text). **Status.** BlockedDecision on owner approval of the text (Q4, Q5, Q8); the coder drafts and cannot approve.
- **Goal.** (a) Draft Terms of Use, a Privacy Notice and an Acceptable Use policy, stored as markdown with a version string, each file headed `DRAFT: owner review required. Not approved.` The drafts say what is kept (an HMAC of the Microsoft subject, the display name, the agent's public behaviour, its thoughts after death under 0138, the death record, no email), what is public, how an agent never learns it is watched, the ban and abuse policy (0136), and how to delete and export (C7-09). (b) Sign-up gets a required consent checkbox linked to the terms version; a new `register_consents(identity_hash, terms_version, accepted_at)` row is written in the same transaction as owner creation. (c) A contact and abuse address appears on every page; until the owner supplies one, the page shows a placeholder and the sign-up gate (C7-11) stays closed.
- **may-edit.** `docs/legal/terms-draft.md`, `docs/legal/privacy-draft.md`, `docs/legal/acceptable-use-draft.md` (new folder, drafts only), `register/src/pages/terms*.ts` and the consent checkbox in the sign-up path, `sql/` migration for `register_consents` (grants per 0056), tests, `docs/analysis/phase1/worknotes/C7-08.md`.
- **Tests (each fails on revert).**
  - Sign-up without the consent box is refused (no owner row created).
  - Consent row and owner row are written in one transaction; a failure of either leaves neither (abort test).
  - The consent row stores the version and the time, not a name or email.
  - Every draft file carries the `DRAFT` marker; a repo check fails if a draft says `Approved`.
  - Revert: drop the consent check; the no-consent test fails.
- **checks.** Register tests, the migration check, `pnpm check:repo`, `./geldar.ps1 check`.
- **Owner decisions.** Q4 (erasure rule as it affects the text), Q5, Q8. The text is approved by the owner, never by the coder or a reviewer agent.
- **size.** M for the code; the legal text is the owner's.

## C7-09: account deletion and data export

- **id / wave.** C7-09, C7-C. **depends-on.** C7-02, C7-03, C7-08. **Status.** BlockedDecision on Q4 and Q5.
- **Goal.** Self-serve deletion and export of a registered owner's data, under the rule the owner sets in Q4.
  - **Delete.** One transaction, idempotent: revoke every token and owner key; retire every player; stop every body through the supervisor (C7-03), and treat "already stopped" as done; null the owner display; remove the identity row (keeping the ban tombstone of Q5 if the identity is banned or Q5 says keep); keep the world-history rows Q4 names. A runbook covers what sits outside Postgres: the `geldar-skins` KV keys and the Velocity life registry entries, which are removed by the operator script, not by a DB trigger.
  - **Export.** JSON of the owner's own rows only (agents, players, flags, consent versions, audit rows about the owner), with a `format_version`. Rate limited (one export per hour). The export never includes another owner's data, another agent's events, or any secret.
  - **Both** are audited (the audit row keeps an erasure-safe id, as Q4 says).
- **may-edit.** `register/src/api/account-data*.ts`, `sql/` migration for the deletion definer function and the export view (grants per 0056), `docs/runbooks/account-deletion.md` (operator runbook, new), `register/src/pages/` (confirm page with a typed confirmation), tests, `docs/analysis/phase1/worknotes/C7-09.md`.
- **Tests (each fails on revert).**
  - Delete removes the owner's tokens, keys and identity; a second delete is a no-op.
  - Delete of an owner with a running body: the body is stopped first; if the stop fails, the deletion is refused and nothing is removed (no half-deleted account).
  - Export contains the owner's rows and no other owner's (two-owner fixture); the format version is present.
  - Export rate limit: the second within the hour is refused; the one at the hour boundary is allowed.
  - Banned identity: deletion keeps the ban tombstone (Q5); a re-sign-in is refused.
  - Abort/error: a DB error mid-delete rolls back every step.
  - Revert: skip the token revoke; the token-refused-after-delete test fails.
- **checks.** Register and supervisor tests, migration check, `./geldar.ps1 check`.
- **Owner decisions.** Q4, Q5. Legal review of the erasure rule (never self-approved).
- **size.** L.

## C7-10: operator console and register audit trail

- **id / wave.** C7-10, C7-D. **depends-on.** C7-03, C7-04.
- **Goal.** (a) An append-only `register_audit` table (0085): sign-up, create, mint, rotate, revoke, rename, flag change, body start and stop, retire, delete, export and ban, each with actor (owner id hash or `operator`), target, outcome and time. No plain names, no emails. (b) `mcp-tokens identity ban --reason <code> [--note <text>]` records the reason and actor in the audit table (today the ban has only `banned_at`, 0136 amended). (c) `mcp-tokens owner list` and `mcp-tokens player list --owner` plus a read-only operator page listing owners, players and body states from the supervisor. (d) An abuse-report intake runbook (`docs/runbooks/abuse-reports.md`, new) with the steps a report takes.
- **may-edit.** `sql/` migration for `register_audit` and the ban reason columns, `tools/mcp-tokens/` (new subcommands), `register/src/operator*.ts`, `docs/runbooks/abuse-reports.md`, tests, `docs/analysis/phase1/worknotes/C7-10.md`.
- **Tests (each fails on revert).**
  - Every listed action writes exactly one audit row (table-driven).
  - The audit table refuses UPDATE and DELETE for the register role (grant test).
  - Ban without a reason code is refused; with the code, the reason and actor are stored.
  - `owner list` output contains no email and no subject (fixture check).
  - Abort: a failed audit write fails the action it records (no action without its row).
  - Revert: drop the audit write from `ban`; the ban audit test fails.
- **checks.** `./geldar.ps1 pnpm --filter mcp-tokens test` (the package name as it exists), register tests, `./geldar.ps1 check`.
- **Owner decisions.** Q5 (tombstone and how bans show in audit). Reason-code list is the owner's (proposed: `abuse`, `spam`, `impersonation`, `other`).
- **size.** M.

## C7-11: sign-up gate (not a code packet)

- **id / wave.** C7-11, C7-E. **depends-on.** C7-05, C7-06, C7-08, C7-09, and the owner's written approval of the terms version and the contact address.
- **Goal.** The sign-up kill switch (`REGISTER_SIGNUP_ENABLED`, default off) turns on only when every item below is true and recorded in the ledger: the owner has approved the terms version (C7-08); the erasure rule is decided and the deletion path has passed its live check (C7-09, live lane); onboarding and account pages are merged (C7-05, C7-06); the supervisor's quotas are set and tested (C7-03); a contact address is published. Until then the switch stays off and the sign-up page answers with a closed-for-now page, not a JSON 503.
- **may-edit.** `register/src/config*.ts` (the gate check: refuse to open if the terms version is not marked approved in a file the owner commits), `docs/analysis/phase1/RESUME.md` (the status line), `docs/analysis/phase1/ledger.md`.
- **Tests.** The gate refuses to open with an unapproved terms version; opens with an approved one; the closed page is served in both states without a JSON body.
- **checks.** Register tests, `./geldar.ps1 check`.
- **Owner decisions.** Opening sign-up is the owner's call.
- **size.** S.

## Live lane

Live work is written and marked `live: pending` in each report. The orchestrator runs: a supervisor start and stop of a DB-listed test player (C7-03), the deletion live check (C7-09), and the account page on the node (C7-06). Nothing in this wave touches the public Minecraft port or the Colo until C2-02c is merged (RESUME stop rule).
