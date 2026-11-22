---
title: Register service
type: reference
audience: operators
status: draft
last_verified: 2026-11-16 against 1b114276
companions: [../concepts/life-cycle-of-a-life.md, ../security/authn-authz-map.md, ../security/privacy-and-data-retention.md, ../runbooks/open-signup.md, ../runbooks/account-deletion.md, ../runbooks/skins.md, mcp-tools.md, database-schema.md, glossary.md, repo-layout.md]
sources: [threshold/register/src, threshold/register/test, threshold/register/README.md, threshold/register/package.json, threshold/register/.env.example, threshold/register/Dockerfile, threshold/register/scripts/gen-legal.ts, compose/colo.yml, compose/colo-kino-session.yml, deploy/caddy/glass.caddy, deploy/caddy/README.md, .github/workflows/colo-images.yml, sql/0006_owner_cap_trigger.sql, sql/0010_register_definer_functions.sql, sql/0012_register_read_functions.sql, sql/0013_register_daily_owner_cap.sql, sql/0014_kino_access.sql, sql/0016_thought_visibility.sql, sql/0021_register_sessions.sql, sql/0022_register_consents.sql, sql/0025_admin_flag_and_register_audit.sql, sql/0026_owner_api_keys.sql, sql/0032_token_lifecycle.sql, sql/0035_owner_keys_by_session.sql, sql/0036_owner_agents_by_owner_id.sql, sql/0039_account_deletion.sql, sql/0040_account_deletion_all_lives.sql, sql/0061_roster_auto.sql, sql/0062_owner_export.sql, sql/0065_owner_export_budget.sql, docs/legal, docs/spec.md, docs/decisions/0054-static-hashed-per-player-bearer-tokens.md, docs/decisions/0135-self-registration-with-github-and-discord.md, docs/decisions/0150-register-loopback-port-18090.md, docs/decisions/0153-terms-consent-and-deletion-before-sign-up.md, docs/decisions/0155-legal-text-v1-approved-and-contact-published.md, docs/decisions/0170-owner-management-values-and-admin-flag.md, docs/decisions/0172-human-skin-upload-held-for-approval.md, docs/decisions/0173-owner-keys-by-session-and-bearer-scope.md, docs/decisions/0261-open-signup-player-host-bodies-and-auto-roster.md]
---

# Register service

The self-registration service in `threshold/register/` (package `@geldar/register`): sign-in, owners, sovereign players, player tokens, owner keys, the owner API, account deletion and export. This page lists its routes, sign-in, sessions, consent, limits, configuration names, database functions, build and tests as the code stands at `1b114276` (read 2026-11-16). No node, database or live service was read (plan decision D8).

For why sign-up works this way, see the [life cycle of a life](../concepts/life-cycle-of-a-life.md). For every credential in one table, see the [authn and authz map](../security/authn-authz-map.md). For the steps to open sign-up, use the [open-signup runbook](../runbooks/open-signup.md).

## At a glance

| Item | Value | Evidence |
|---|---|---|
| Owner (role) | The operator runs it; the owner rules on sign-up posture | decisions 0135, 0261 |
| Entry point | `node src/main.ts` | `threshold/register/Dockerfile`, `src/main.ts` |
| Listens on | `REGISTER_HOST`:`REGISTER_PORT`, default `127.0.0.1:8090` | `src/config.ts` lines 158 to 159 |
| Colo stack | Service `register`, compose profile `register`, off by default; published on loopback port `GELDAR_PORT_REGISTER` (default 18090) | `compose/colo.yml` lines 390 to 448; decision 0150 |
| Public path | `/register` and `/register/*` on the Glass host, through Caddy | `deploy/caddy/glass.caddy`; decision 0135 ruling R42 |
| Database role | `geldar_register` | `src/db-url.ts`; `threshold/register/README.md` |
| Kill switch | On unless `REGISTER_KILL_SWITCH` is exactly `false` | `src/config.ts` line 155 |
| Image | Built by job `register` in `.github/workflows/colo-images.yml` from `threshold/register/Dockerfile`; runs as UID 1000 with a read-only root in compose | `colo-images.yml` line 297; `compose/colo.yml` |

## Request pipeline

Every request passes these steps in order (`src/server.ts` lines 224 to 271):

1. Strip the `/register` prefix from the path.
2. Kill switch on: browser paths get an HTML 503 page, `/api/` paths get problem `unavailable` (503).
3. Source limit: `REGISTER_PER_MINUTE` per client address. Over it: 429 with `Retry-After`.
4. `/api/` paths go to the owner API router (below).
5. Account paths go to `Account.handle` (`src/account.ts`).
6. Any other method than GET: 405 JSON `method_not_allowed`.
7. Home, legal pages, then `/login` and `/callback` (with the sign-in limit). Anything else: HTML 404.

The client address is the socket peer, or the `x-geldar-client-ip` header when the peer is listed in `REGISTER_TRUSTED_PEERS` (`clientAddress` in `src/server.ts`; header from decision 0090, Proposed). Limiter keys group IPv6 addresses by their /64 (`limiterKey`). Each limiter is a fixed 60-second window holding at most 10,000 keys, dropping the oldest first (`FixedWindow`, `LIMITER_MAX_KEYS`).

Every HTML and JSON response carries the headers in `SECURITY_HEADERS` (`src/pages.ts` lines 7 to 14): a `default-src 'none'` content security policy, HSTS, `nosniff`, `no-referrer` and `cache-control: no-store`.

## Browser routes

Paths are under `/register`. Re-derive: `git grep -n -E "pathname|exec\(" -- threshold/register/src/server.ts threshold/register/src/account.ts`.

| Method | Path | Auth | Does | Answers | Source |
|---|---|---|---|---|---|
| GET | `/` | none | Home page: consent checkbox and "Sign in with Microsoft" form to `/register/login` | 200 HTML | `src/pages.ts` `HOME_PAGE` |
| GET | `/terms`, `/privacy`, `/acceptable-use` | none | The legal texts, version 1 | 200 HTML | `LEGAL_PAGES` in `src/pages.ts` |
| GET | `/login` | none; sign-in limit | Starts sign-in. Query `consent=yes` records the box. Sets the state cookie | 302 to the provider; 429 | `src/server.ts` lines 249 to 265 |
| GET | `/callback` | state cookie; sign-in limit | Checks state, exchanges the code, signs in or signs up | 302 to `/register/account`; 403 refusal page; 429 | `callback` in `src/server.ts` |
| GET | `/account` | session | Lists the owner's players, harness choice and forms | 200 HTML; 302 to `/register` with no cookie; 401 expired page | `Account.show` |
| GET | `/onboarding` | session | Shows a newly minted player token once | 200 HTML (own CSP) | `Account.onboarding` |
| GET | `/onboarding.js`, `/account.css` | none | Static script and style | 200 | `Account.handle` |
| GET | `/account/delete` | session | Delete confirmation page | 200 HTML | `src/account-delete-page.ts` |
| POST | `/players` | session, form `csrf` | Creates a player and its first token | 303 to `/register/onboarding`; 200 account page with a notice | `Account.create` |
| POST | `/players/<player_id>/token` | session, `csrf` | Mints a new token for the player | 303 to `/register/onboarding`; notice | `Account.mint` |
| POST | `/players/<player_id>/retire` | session, `csrf` | Retires the player and revokes its tokens | 200 account page with a notice | `Account.retire` |
| POST | `/players/<player_id>/public-camera` | session, `csrf`; field `value` = `on` or `off` | Sets the owner's camera setting | notice | `Account.camera`; decision 0075 |
| POST | `/players/<player_id>/public-thoughts` | session, `csrf`; `value` = `on` or `off` | Sets the owner's public-thoughts setting | notice | `Account.thoughts`; decision 0138 |
| POST | `/account/delete` | session, `csrf`, typed phrase | Erases the account | see [Account deletion and export](#account-deletion-and-export) | `runAccountDelete` |
| POST | `/logout` | session, `csrf` | Deletes the session row, clears cookies | 302 to `/register` | `Account.handle` |

Rules for every account POST (`Account.handle`): the body must be `application/x-www-form-urlencoded` and at most 4096 bytes; an `Origin` header, when sent, must equal `REGISTER_PUBLIC_URL`; the `csrf` field must match `HMAC-SHA256(session key, "register-csrf-v1:" + session id)`. A failure is HTML 403. Except for logout, the owner is re-read: a banned owner is refused 403. The owner limit then applies to every POST except retire.

Player creation fields (`Account.create`, `src/account.ts` lines 374 to 408):

| Field | Rule |
|---|---|
| `player_id` | `^ag-[a-z0-9]+(-[a-z0-9]+)*$`, at most 40 characters. The life id is the player id with `-` replaced by `_`. |
| `name` | `^[A-Za-z0-9_]{3,16}$` (a Minecraft login; decision 0261 item 2c). Also checked in SQL (0061). |
| `harness` | One of `REGISTER_HARNESSES`. |

Refusal notices map from the store result: `cap` (owner cap), `limit` (lifetime cap), `taken` (player id), `name`, `name_taken` (roster). The player and its roster row commit in one transaction (`PgStore.createPlayer`).

## Sign-in

The code signs in with Microsoft personal accounts only (`src/providers.ts`, `src/main.ts` line 32). See [conflict 1](#conflicts-recorded) for the documents that still say GitHub and Discord.

| Step | Behaviour | Source |
|---|---|---|
| Authority | The Microsoft identity platform's `consumers` OAuth 2.0 base, `https://login.microsoftonline.com/consumers/oauth2/v2.0` (`MS_AUTHORITY`); authorize and token are its `/authorize` and `/token` | `src/providers.ts` line 28 (`MS_AUTHORITY`) |
| Request | Authorization code, `response_mode=query`, scope `openid`, PKCE S256. Redirect URI `REGISTER_PUBLIC_URL` + `/register/callback` | `microsoftProvider.authorizeUrl` |
| State | 24 random bytes, single use, 10 minutes, in process memory (a restart asks the user to retry), at most 5000 pending | `src/pkce.ts` |
| State cookie | `__Host-gr_state`, `Max-Age=600; Path=/; HttpOnly; Secure; SameSite=Lax`; must equal the `state` query value | `src/server.ts` lines 93, 193 to 198 |
| Token exchange | POST to the token endpoint with the client secret and verifier | `fetchProfile` |
| Checks | The id token's `aud` equals `REGISTER_MS_CLIENT_ID`; `tid` equals the fixed consumers tenant; `sub` is non-empty. No signature check (id token taken straight from the token endpoint over TLS) | `src/providers.ts` lines 73 to 77 (`microsoftProvider`) |
| Kept | Only `sub`. Identity hash = `HMAC-SHA256(pepper, "microsoft:" + sub)`, hex. No email, name or access token | `src/identity.ts` |
| Owner | Existing identity: its owner. New identity: refused unless the consent box was ticked; otherwise owner id `reg-` + the first 24 hex characters of the identity hash | `Account.signedIn` |
| Refusals | Bad state, provider error, banned owner, deleted-account tombstone, missing consent: one 403 page that does not say which check failed | `REFUSED_PAGE`; `PgStore.findOwner` |

Sign-ups run one at a time in the process (`Account.serial`). Log lines name the event and provider only (`RegisterDeps.log` comment, `src/server.ts` line 28).

## Sessions and cookies

| Cookie | Set by | Attributes | Lifetime | Holds |
|---|---|---|---|---|
| `__Host-gr_state` | `/login` | HttpOnly, Secure, SameSite=Lax, Path=/ | 10 minutes | Sign-in state |
| `__Host-gr_session` | callback | HttpOnly, Secure, SameSite=Lax, Path=/ | Browser `Max-Age` 12 hours; server side see below | 32 random bytes, base64url |
| `gk_session` | callback | HttpOnly, Secure, SameSite=Lax, Path=/ | 30 minutes from sign-in, not slid | `base64url(JSON {h, exp})` + `.` + HMAC-SHA256 under the session key; Glass verifies it read-only (decision 0135 R42) |

Server-side sessions (`src/session-store.ts`, `PgStore`):

- Table `register_sessions` (migration 0021): `session_hash` (SHA-256 of the cookie id; the id is never stored), `owner_id`, `identity_hash`, `signed_in_ms`, `last_seen_ms`, `expires_ms`.
- Sliding expiry: 30 minutes after the last request, never more than 12 hours after sign-in. One `UPDATE` slides it (`PgStore.touch`). A session is refused at its expiry instant.
- Expired rows are deleted at each sign-in (`sweep`).
- A cookie name sent twice is no session (`cookieOf`, CF-5). A database error refuses the request (fail closed).
- Logout and account deletion clear `__Host-gr_session`, `gk_session` and the legacy names `gr_session` and `gr_state` (`signOutCookies`).

## Consent and legal texts

| Item | Value | Source |
|---|---|---|
| Texts | `docs/legal/terms.md`, `privacy.md`, `acceptable-use.md`, embedded at build time in `src/legal-texts.generated.ts` | `scripts/gen-legal.ts`; decisions 0153, 0155 |
| Regenerate | `node threshold/register/scripts/gen-legal.ts` (gated: see the [doc-update map](../agents/doc-update-map.md)) | `threshold/register/test/legal-pages.test.ts` |
| Version stamp | "Version 1, effective 2026-11-11, approved by the owner" on every page footer | `LEGAL_VERSION_STAMP` in `src/pages.ts` |
| Consent row | `register_consents (identity_hash, terms_version, accepted_at)`, primary key on the first two; written with the owner in one transaction | `sql/0022_register_consents.sql`; `PgStore.createOwner` |
| Version recorded | `TERMS_VERSION = 'v1'` | `src/account.ts` line 38 |
| Contact | `abuse@sandboxservers.games` | `CONTACT_ADDRESS` in `src/pages.ts` |

Consent is asked only when a new owner is created. See [conflict 6](#conflicts-recorded) on re-consent.

## Player tokens and onboarding

| Item | Value | Source |
|---|---|---|
| Format | `gmcp-` plus 64 hex characters; only its HMAC under the MCP token pepper is stored | `threshold/mcp/src/store/token-hash.ts` (imported by relative path); decision 0054 |
| Token id | `tk_` plus 16 hex characters | `src/account.ts` |
| Lifetime | 90 days; renewal flag from 14 days before expiry | `src/tokens-policy.ts`; decision 0170 point 1 |
| Rotation grace | A rotated-out token works 10 minutes (refused from 10 minutes and 1 second) | `ROTATE_GRACE_MS`, `graceEndsAt` |
| Hand-off | The new token is held in process memory under the session hash for 10 minutes, shown once at `/register/onboarding`, never put in a redirect | `HANDOFF_TTL_MS`, `OnboardingHandoff` in `src/onboarding-pages.ts` |
| Fetch rule | `/onboarding` releases the token only when `Sec-Fetch-Site` is absent, `same-origin` or `none` (CF-4) | `Account.onboarding` |
| MCP address shown | `REGISTER_MCP_PUBLIC_URL` when set, otherwise derived from `REGISTER_PUBLIC_URL` | `mcpBaseFor` |
| Start credits | 240, a constant in `register_create_player`, pinned equal to `sovereign.budget.cap_credits` in `shards/colo-mind.yaml` by a repo check | `sql/0012_register_read_functions.sql` line 111; `tools/repo-checks/src/colo-services.test.ts` |

## Owner API

Base path `/register/api/v1`. Errors are `application/problem+json` with `type`, `title`, `status`, `code` and an optional fixed `detail` (`src/problem.ts`). `src/api/owner-api-v1.yaml` describes the agent routes (`GET` and `PATCH /agents/{playerId}`) and the skin routes (`POST` and `GET /agents/{playerId}/skin`); the rest is read from code.

Router order (`src/api/index.ts`): path (404 or 405), credential (401), cookie-only check (401), CSRF header for a cookie write (403), scope (403), owner limit for a write unless admin (429), handler (500 on an error; a banned owner is 401).

Credentials (`src/api/auth.ts`):

- **Cookie session** `__Host-gr_session`: scopes `read`, `body`, `manage`. A write needs header `x-csrf-token` with the session's CSRF value. A cookie, when present, decides: a Bearer header is then not tried.
- **Bearer owner key** `gowner-` plus 64 hex characters: the scopes stored with the key. A player token is never accepted.

Re-derive the route list: `git grep -n -A1 "method: '" -- threshold/register/src/api` and `git grep -n -E "(write|read)\(/" -- threshold/register/src/api/body.ts`.

| Method | Path | Scope | Cookie only | Mounted | Success | Source |
|---|---|---|---|---|---|---|
| GET | `/agents` | read | no | always | 200 `{agents: [Agent]}` | `api/agents-list.ts` |
| GET | `/agents/{playerId}` | read | no | always | 200 Agent | `api/agents-read.ts` |
| PATCH | `/agents/{playerId}` | manage | yes | always | 200 Agent | `api/agents.ts` |
| POST | `/agents/{playerId}/tokens` | manage | yes | always | 201 `{token, expiresAt}` | `api/tokens.ts` |
| POST | `/agents/{playerId}/tokens/revoke` | manage | yes | always | 204 | `api/tokens.ts` |
| GET | `/owner-keys` | manage | yes | always | 200 `[{keyId, scopes, createdAt, expiresAt, lastUsedAt}]` | `api/owner-keys.ts` |
| POST | `/owner-keys` | manage | yes | always | 201 `{keyId, key, scopes, expiresAt}` | `api/owner-keys.ts` |
| POST | `/owner-keys/{keyId}/revoke` | manage | yes | always | 204 | `api/owner-keys.ts` |
| POST | `/agents/{playerId}/body/start`, `/stop`, `/restart` | body | no | NATS set | 202 `{opId, state: "done"}` | `api/body.ts` |
| GET | `/agents/{playerId}/body/status` | read | no | NATS set | 200 `{state: running \| stopped}` | `api/body.ts` |
| GET | `/agents/{playerId}/body/log?limit=1..200` | read | no | NATS set | 200 `{lines: [{at, text}]}`, newest events up to 7 days old | `api/body.ts`, `api/body-log.ts` |
| POST | `/agents/{playerId}/retire` | manage | yes | NATS set | 202: body stopped, tokens revoked, player retired | `api/body-retire.ts` |
| POST | `/account/delete` | manage | yes | always | see below | `api/account-data-delete.ts` |
| GET | `/account/export` | manage | yes | always (store has the export) | 200 JSON download | `api/account-export.ts` |

Agent fields (`AGENT_FIELDS` in `api/agents-list.ts`): `playerId`, `displayName`, `status`, `body`, `creditsLeft`, `publicCamera`, `thoughtsDelayedPublic`, `createdAt`, `tokenExpiresAt`, `tokenLastUsedAt`, `lastSeenAt`. Nothing else leaves the server.

`PATCH /agents/{playerId}` body: `publicCamera` and or `thoughtsDelayedPublic`, booleans, no other field (`AgentPatch` in the OpenAPI file). Turn-offs are written before turn-ons. A foreign, missing or retired agent is 404, never 403 (`api/guard.ts`).

Body routes send `{ownerId, playerName}` to the supervisor on `geldar.<shard>.ctl.body.<op>` (`src/nats-ctl.ts`) and map its reply (`mapReply` in `api/body.ts`):

| Supervisor reply | API answer |
|---|---|
| ok `started`, `restarted`, `stopped` | 202 |
| ok `running`, `idle` | 200 `running`, `stopped` |
| ok `logs` | 200 lines |
| `quota` | 429 `quota`, `Retry-After: 3600` |
| `unknown` | 404 |
| `login_name` | 422 `invalid` with a fixed detail |
| `invalid` | 500 `internal` |
| anything else, timeout, no responders | 503 `body_unavailable`, `Retry-After: 30` |

The supervisor keys a Body by the agent's display name; a name outside `^[A-Za-z0-9_]{3,16}$` is 422 before any call.

Problem codes (`PROBLEM_CODES`): `not_found` 404, `method_not_allowed` 405, `unauthenticated` 401, `csrf_required` 403, `scope_missing` 403, `invalid` 422, `conflict` 409, `rate_limited` 429, `quota` 429, `unavailable` 503, `body_unavailable` 503, `internal` 500.

## Owner keys

| Item | Value | Source |
|---|---|---|
| Format | Id `gok-` plus 16 hex; value `gowner-` plus 64 hex, shown once | `src/owner-keys-policy.ts` |
| Stored | HMAC-SHA256 of the value under the MCP token pepper | `hashOwnerKey` |
| Scopes | Any non-empty, non-repeating subset of `read`, `body`, `manage` | `parseScopes`; `sql/0035_owner_keys_by_session.sql` |
| Lifetime | 90 days | `OWNER_KEY_LIFETIME_MS`; decision 0170 point 2 |
| Live cap | 10 live keys per owner, admins included; over it 409 `conflict` (SQLSTATE 53400) | `sql/0026_owner_api_keys.sql`, `sql/0035_owner_keys_by_session.sql` |
| Managed by | Cookie session only (mint, list, revoke) | decision 0173; `api/owner-keys.ts` |

## Account deletion and export

- **Delete** (page and API share one service, `src/api/account-data-delete.ts`): the typed phrase `delete my account` in the form, or JSON `{"confirm": "delete my account"}` on the API. Then: owner check (missing or banned: 401), the owner's body slot (busy: 409), a stop of every non-retired player's Body (any failure: 503 and nothing removed), then `register_account_delete` in one transaction (migrations 0039, 0040). The session rows go and the cookies are cleared. What is erased is set by decisions 0171 and 0262; see the [account-deletion runbook](../runbooks/account-deletion.md).
- **Export** (`src/api/account-export.ts`, `src/account-export-wiring.ts`): `register_owner_export` (migrations 0062, 0065) as JSON text. One export at a time per process (a second gets 503 with `Retry-After: 5`), one per owner per minute, 60-second statement timeout, 70-second call bound, at most 8,000,000 bytes (larger is 500). The same fetch-metadata rule as onboarding applies (cross-site is 404). The file name holds only the UTC date (decision 0261).

## Limits

Re-derive: `git grep -n -E "PER_MINUTE|_MAX|_MS =|_SECONDS =|CONSTANT INT" -- threshold/register/src sql/0010_register_definer_functions.sql sql/0012_register_read_functions.sql sql/0026_owner_api_keys.sql`.

| Limit | Value | Applies to | Source |
|---|---|---|---|
| Source window | `REGISTER_PER_MINUTE`, default 30, per address | every request | `src/server.ts` |
| Sign-in window | `REGISTER_SIGNIN_PER_MINUTE`, default 10, per address | `/login`, `/callback` | `src/server.ts`; R41 |
| Owner window | `REGISTER_OWNER_PER_MINUTE`, default 6, per owner | account POSTs except retire; API writes (admins exempt on the API only) | `src/server.ts`, `src/api/index.ts`; R41 |
| Owner cap | `mcp_owners.player_cap`, default 3, enforced by trigger | player creation (`cap`) | `sql/0006_owner_cap_trigger.sql`; [glossary, owner cap](glossary.md#owner-cap-in-detail) |
| Lifetime creation cap | 10 players per owner, retired ones included (SQLSTATE 54000) | player creation (`limit`) | `register_create_player` in `sql/0012_register_read_functions.sql`; R36 |
| Daily new-owner cap | none (removed) | sign-up | `sql/0014_kino_access.sql` header; R41 |
| Thoughts setting | one change per 10 seconds per player (SQLSTATE 54000; API 429 `Retry-After: 10`) | public-thoughts setting | `sql/0016_thought_visibility.sql` line 42; `api/agents.ts` |
| Body start | 5 starts per agent per 60 seconds | API body start | `START_WINDOW_MAX` in `api/body.ts` |
| Body in flight | one body request per owner; a second is 409 | body routes, retire, delete | `withSlot`, `src/api/body-slot.ts` |
| Body quotas | set by the supervisor, reported as `quota` | body start | decision 0170; `supervisor/src/quotas.ts` |
| Form body | 4096 bytes | account POSTs | `MAX_BODY` in `src/account.ts` |
| Caddy body | 8 KiB | `/register*` | `deploy/caddy/glass.caddy` |

## Configuration names

Names only. A `*_FILE` variable names a mounted secret file; the secret's value and the file's place on disk are not part of this page. Re-derive: `git grep -h -o -E "REGISTER_[A-Z_]+" -- threshold/register/src compose/colo.yml | sort -u`.

| Name | Default in code | Set in `compose/colo.yml` | Meaning |
|---|---|---|---|
| `REGISTER_KILL_SWITCH` | on | yes, default `true` | Off only when exactly `false` |
| `REGISTER_REQUIRE_MC_OWNERSHIP` | off | yes, default off | On only when exactly `true`: NEW sign-ups must own Minecraft: Java Edition (see the draft wording note) |
| `REGISTER_PUBLIC_URL` | required, `https://` | yes (deploy value) | Base for the redirect URI and the Origin check |
| `REGISTER_MCP_PUBLIC_URL` | empty | yes (deploy value) | MCP address on the onboarding page |
| `REGISTER_HOST`, `REGISTER_PORT` | `127.0.0.1`, `8090` | yes | Listen address |
| `REGISTER_MS_CLIENT_ID` | empty | yes (deploy value) | The Entra app's client id |
| `REGISTER_MS_CLIENT_SECRET_FILE` | required | yes | The Entra client secret, provided by the owner |
| `REGISTER_SESSION_KEY_FILE` | required, at least 32 characters | yes | Signs `gk_session` and derives CSRF tokens; Glass reads the same secret (`compose/colo-kino-session.yml`) |
| `REGISTER_PEPPER_FILE` | required, at least 32 characters | yes | Identity-hash pepper |
| `REGISTER_TOKEN_PEPPER_FILE` | required, at least 32 bytes, no BOM | yes | The MCP's token pepper |
| `REGISTER_SHARD` | required | yes, `colo` | Shard of new players and body subjects |
| `REGISTER_HARNESSES` | `claude-code` | no | Allowed harness names |
| `REGISTER_SIGNIN_PER_MINUTE`, `REGISTER_OWNER_PER_MINUTE`, `REGISTER_PER_MINUTE` | 10, 6, 30 | no | Limits above |
| `REGISTER_TRUSTED_PEERS` | `127.0.0.1`; IP literals only, a CIDR range fails the start | yes | Peers whose client-address header is honoured |
| `REGISTER_DB_URL_FILE` or `REGISTER_DB_PASSWORD_FILE` with `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB` | one of the two required | password form | Database connection as `geldar_register` (`src/db-url.ts`) |
| `REGISTER_NATS_URL`, `REGISTER_NATS_USER`, `REGISTER_NATS_PASSWORD_FILE` | unset: NATS off | no | All three set: body and retire routes mount; otherwise they answer 404 |
| `REGISTER_NATS_TIMEOUT_MS` | 5000, from 1 to 60000 | no | Supervisor reply wait |

Because `compose/colo.yml` sets no `REGISTER_NATS_*` at `1b114276`, the body and retire routes are unmounted in the Colo stack; the [open-signup runbook](../runbooks/open-signup.md) tracks the card that adds them. Budget defaults: `GELDAR_COLO_REGISTER_CPUS` 0.25, `GELDAR_COLO_REGISTER_MEM` 128m, 64 pids.

## Database interface

`geldar_register` reads and writes owners, identities, players, tokens and budgets only through `SECURITY DEFINER` functions. It has direct grants on three tables: `register_sessions` (SELECT, INSERT, UPDATE, DELETE; migration 0021), `register_consents` (INSERT; 0022) and `register_audit` (SELECT, INSERT; 0025). Re-derive: `git grep -h -o -E "register_[a-z_]+" -- threshold/register/src | sort -u` and `git grep -n "TO geldar_register" -- sql`.

| Function | Latest migration | Called by |
|---|---|---|
| `register_find_owner` | 0012 | sign-in, every account write |
| `register_create_owner` | 0014 (Microsoft only) | sign-up |
| `register_create_player` | 0012 | player creation |
| `register_roster_add` | 0061 | player creation |
| `register_list_players` | 0012 | account page |
| `register_mint_token`, `register_renew_token`, `register_revoke_tokens`, `register_token_info` | 0032 | tokens |
| `register_retire_player` | 0011 | retire |
| `register_set_public_camera` | 0014 | camera setting |
| `register_set_thoughts_delayed_public` | 0016 | public-thoughts setting |
| `register_is_admin` | 0025 | admin flag (fails closed to false) |
| `register_owner_list_players`, `register_owner_get_player` | 0036 | owner API agents |
| `register_owner_key_resolve`, `register_mint_owner_key`, `register_revoke_owner_key`, `register_list_owner_keys` | 0026 | Bearer key resolve |
| `register_session_mint_owner_key`, `register_session_revoke_owner_key`, `register_session_list_owner_keys` | 0035 | owner keys by session |
| `register_account_delete` | 0040 | account deletion |
| `register_owner_export` | 0065 | export |

Each owner-API action writes one `register_audit` row (actor = first 16 hex characters of SHA-256 of the owner id, `auditActor` in `src/production-api.ts`). A failed audit write fails the request with 500 and logs `audit_lost` with a counter. The [database schema](database-schema.md) reference lists the tables.

## Skins

The register service has no skin route and never holds the MineSkin key (`git grep -n -i skin -- threshold/register/src` finds nothing at `1b114276`). Decision 0172 keeps the MineSkin key, held by the owner, on the operator side (`tools/players-cli`). Operator steps are in the [skins runbook](../runbooks/skins.md). See [conflict 5](#conflicts-recorded).

## Build, test and deploy

| Task | Command or file |
|---|---|
| Test | `./geldar.ps1 pnpm test threshold/register` (48 tracked files in `threshold/register/test` on 2026-11-16: `git ls-files threshold/register/test`) |
| Typecheck | `./geldar.ps1 pnpm --filter @geldar/register typecheck` |
| Image | `docker build -f threshold/register/Dockerfile .` from the repo root; CI job `register` in `.github/workflows/colo-images.yml` publishes it, and the release env carries its digest as `GELDAR_REGISTER_IMAGE` |
| Health | Compose probe: `GET /` inside the container, 200 or 503 is healthy (503 is the kill switch) |
| Start | Compose profile `register` in the Colo stack; steps in the [open-signup runbook](../runbooks/open-signup.md) and the [colo-deploy runbook](../runbooks/colo-deploy.md) |
| Turn off | `REGISTER_KILL_SWITCH` (read at start), the `register` profile, and `deploy/caddy/glass-off.caddy`, which covers Glass and register together (`deploy/caddy/README.md`); steps in the [open-signup runbook, Rollback summary](../runbooks/open-signup.md#rollback-summary) |

Two test files gate documents: `players-readme.test.ts` and `revocation-wording.test.ts` read `docs/players/README.md` ([doc-update map](../agents/doc-update-map.md)).

## Known gaps in code

Facts read from code; each is a candidate follow-up, not a decision.

1. The account page never shows a body status line in production: `createRegisterServer` builds `Account` without `bodyState` (`src/server.ts` lines 159 to 170).
2. `POST /api/v1/agents/{playerId}/tokens` returns the token in the response body and never holds it for `/onboarding` in production: the server's API dependencies carry no `handoff` (`src/server.ts` lines 172 to 179; `holdForOnboarding` in `api/tokens.ts`).
3. Sign-up stores `display` as the literal `microsoft` (`src/server.ts` line 213), while the comment in `src/identity.ts` calls it "the provider login handle".
4. Caddy forwards `/roster` and `/roster/*` to the service (`deploy/caddy/glass.caddy` line 7; R42), but the service strips only `/register` and has no roster route, so those paths answer 404 (`src/server.ts` lines 228 to 250).

## Conflicts recorded

Not resolved here (persona rule 8).

1. **Sign-in provider.** GitHub and Discord: decision 0135 title, original body and status line; `threshold/register/package.json` description; `threshold/register/README.md` line 3; `sql/0013_register_daily_owner_cap.sql` (accepts `github`, `discord`). Microsoft personal accounts only: decision 0135 amendment R40; decision 0261 item 1; the 0135 row in `docs/decisions/README.md`; `sql/0014_kino_access.sql`; `src/providers.ts`; `src/main.ts`; `.env.example`; `compose/colo.yml`. The type `ProviderName` keeps `github` and `discord` for old identities (`src/identity.ts` line 4). Also [glossary conflict 6](glossary.md#conflicts-recorded).
2. **Daily new-owner cap.** `threshold/register/README.md` ("Known limits") and the comment on `Account.serial` (`src/account.ts` line 138) describe a daily cap of 10 new owners in `register_create_owner`. `sql/0014_kino_access.sql` lines 4 and 13 to 35 replace that function without it (R41), and `register_create_owner` has not been replaced since (`git grep -n "FUNCTION register_create_owner" -- sql`).
3. **Table privileges.** `threshold/register/README.md`: "The role holds no table privilege at all". Migrations 0021, 0022 and 0025 grant it `register_sessions`, `register_consents` and `register_audit`.
4. **Sign-up and MCP authorization in the spec.** Spec 5.15.5 step 1 and 5.15.6: sign-in to the Observatory with Entra ID by invited guests, an Allocator that creates the player repo, and an OAuth flow per player that issues the MCP token. Code and decisions: open sign-up for everyone (decision 0261 item 1); the register service creates no repo (no repo call in `threshold/register/src`); the token is a static hashed Bearer token minted by the register service and shown once (decision 0054, Accepted). The spec is not edited (owner only).
5. **Skin upload.** Decision 0172 item 2 (Decided 2026-11-13): owners upload a skin "on the account page or the API". No register route accepts a skin at `1b114276`.
6. **Re-consent.** Decision 0155: a changed legal text bumps the version and asks owners to consent again. The code records consent only when an owner is created (`Account.signedIn`); an existing owner is never asked again. Only version `v1` exists today, so nothing is pending.
7. **PATCH through Caddy.** The owner API serves `PATCH /agents/{playerId}` (`api/agents.ts`). `deploy/caddy/glass.caddy` lines 20 to 26 answer 405 to any method on `/register*` other than GET, HEAD and POST, so the route cannot be reached through the public path.

## Unverified

- Whether the service runs, which profile is up, and the kill-switch value on the node (D8: no node read). The [open-signup runbook](../runbooks/open-signup.md) is the operator's record.
- Whether migrations 0014 to 0065 are applied on the node's database. The check on the node is the `schema_migrations` rows.
