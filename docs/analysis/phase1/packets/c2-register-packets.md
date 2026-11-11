# Wave C2 addition: self-registration (decision 0135)

Status as of 2026-11-11 (orchestrator). The owner ruled for GitHub and Discord sign-in with no manual approval. The design is [decision 0135](../../../decisions/0135-self-registration-with-github-and-discord.md). These cards follow [packet-conventions.md](../packet-conventions.md) and c2-packets.md section 1. Decision numbers: 0135 (the record) and 0136 (C2-08b implementation details, if needed). The C2 block 0090 to 0099 is full.

Global never-do list for every brief: no `adam up`; no state-changing probe against a live shard; never weaken a test; never `git reset`, `git stash` or `git checkout` on tracked work; never edit `docs/spec.md`; never push, open a PR, or prune a worktree; no IPs other than `127.0.0.1` and documentation ranges, and no account names, domains or secrets in any file. Each packet adds its own decision-index row (orchestrator ruling R11).

Order: C2-08a (schema) first. C2-08b (service) and C2-08c (deploy wiring) then run in parallel. C2-08d (the per-player Body lifecycle) must merge before registration is switched on.

---

### C2-08a: identities table and the register role

- `depends-on`: none (main). `status`: B. `size`: S.
- `may-edit`: `sql/0008_register_identities.sql` (new), `sql/test/` (the schema check and a new test for the role), `sql/README.md` (one line), `docs/analysis/phase1/worknotes/C2-08a.md`.
- `must-not-edit`: earlier migrations, `contract/`, `threshold/`, `compose/`, `docs/spec.md`.

Steps:
1. Read `sql/0002_sovereign_mcp.sql` (`mcp_owners`, `mcp_players`, `mcp_tokens`), `sql/0006_owner_cap_trigger.sql` and `sql/0007_journals_append_only.sql` for style, and how migrations register in `schema_migrations`.
2. `CREATE TABLE mcp_identities`:
   - `identity_hash BYTEA PRIMARY KEY CHECK (octet_length(identity_hash) = 32)`
   - `provider TEXT NOT NULL CHECK (provider IN ('github','discord'))`
   - `owner_id TEXT NOT NULL UNIQUE REFERENCES mcp_owners`
   - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
   - `banned_at TIMESTAMPTZ`
   - No column for an email, a raw provider id or a token.
3. A login role `geldar_register` (NOLOGIN in the migration; the deploy grants the login, the way the MCP's role is handled in the Colo deploy; check `deploy/colo-up.sh` for the pattern). Grants:
   - INSERT and SELECT on `mcp_identities`, `mcp_owners`, `mcp_players`, and the `agents` columns that player creation needs (find the exact columns in `tools/mcp-tokens`'s add-player path);
   - INSERT on `mcp_tokens`, and UPDATE of `revoked_at` only;
   - no access to thoughts, events, receipts or any journal.
4. Tests, in the style of `sql/test`: the role cannot SELECT `thoughts` or `events`; it cannot UPDATE `mcp_tokens.token_hash`; the owner-cap trigger still fires for its inserts.
5. Revert-check: grant SELECT on `thoughts` to the role; the "cannot read thoughts" test must fail.

### C2-08b: the register service

- `depends-on`: C2-08a. `status`: B. `size`: L (two sessions; split at "sign-in done" and "player creation").
- `may-edit`: `threshold/register/` (new package), `docs/decisions/0136-*.md` (only if a design point needs a record), `docs/analysis/phase1/worknotes/C2-08b.md`, and `pnpm-lock.yaml` (the new importer only).
- `must-not-edit`: `threshold/mcp/`, `contract/`, `sql/`, `compose/`, `docs/spec.md`.

Steps:
1. Package skeleton, mirroring `threshold/mcp`'s structure (node `http`, no framework). Add no new runtime dependency unless it is pinned and at least two weeks old, and ask first in the worknote.
2. OAuth for GitHub and Discord: authorization code with PKCE (S256), a `state` bound to a short-lived HttpOnly, Secure, SameSite=Lax cookie, single use, with a 10-minute expiry. Make the provider calls through an injected fetch, so tests use fakes and no test calls a real provider.
3. Verification per 0135 item 2 (verified email or flag, and an account age of at least `minAccountAgeDays`, default 30, with an injected clock). A refusal is a fixed page that does not say which check failed.
4. Identity: `identity_hash = HMAC-SHA256(pepper, provider + ":" + id)`. Drop the access token after the callback. Store the handle only as `mcp_owners.display`.
5. Player creation and token: reuse the token library behind `tools/mcp-tokens` (hashing per 0054). Do not reimplement it; if it is not importable, move the shared code into a module both can import, in its own commit. Show the token once, on a no-store page.
6. Session pages: list my players, mint a new token (revoking the old one), retire a player. Every route is CSRF-protected (the state cookie plus a per-form token).
7. Controls: `kill_switch` (default **true**, so registration is off until the owner turns it on), `max_new_owners_per_day` (10), and a per-address limit using the 0090 header and its trusted peers. Refusals use the 0090 shapes.
8. Security headers: the same strict CSP as Glass, no inline script, and HSTS.
9. Tests: verified and unverified for each provider; the age floor at 29 and 30 days; state replay refused; state expired; PKCE verifier mismatch; daily cap at its last allowed and first refused registration; kill switch; a banned identity refused; the token shown once (a second visit doesn't show it); no email, raw id or provider token in any log line or database write (assert on fakes).
10. Revert-checks: (a) drop the `verified` check, and the unverified tests fail; (b) skip the state single-use mark, and the replay test fails.

### C2-08c: deploy wiring for register

- `depends-on`: C2-08a. `status`: B (desktop), O (live). `size`: S.
- `may-edit`: `compose/colo.yml` (a `register` service, hardened like `geldar-mcp`: read-only root, `cap_drop: ALL`, limits, a loopback publish, the Watchtower opt-out label), `shards/colo.yaml` (budget totals), `deploy/caddy/register.caddy` and `register-off.caddy` (same rules as `mcp.caddy`: strip and set `x-geldar-client-ip`, GET and POST only, body cap), the C2-04 snippet test (add the register site), `deploy/README.md` (the secrets list), `.github/workflows/colo-images.yml` (the image job), and `tools/repo-checks` tests for the service caps.
- Secrets: `register-github-secret`, `register-discord-secret`, `register-pepper`, and the DB password for `geldar_register`. All are file secrets; none is in the repo.

### C2-08d: per-player Body lifecycle (gate for turning registration on)

- `depends-on`: C3-04 (roster and cap), C1-11a. `status`: planned. Written as a full card when C3 starts.
- Goal: a registered player's Body process starts when its presence opens and stops when it closes, inside the node budget, with no hand-run `docker compose --profile sovereign up` per ranger.

### Live steps (owner and ops, after the C2 gates)

1. The owner creates the GitHub OAuth app and the Discord application, with callbacks on the register host.
2. Ops adds the `register` DNS name (Azure CLI, same as the other C2 names), loads the Caddy site, and sets the kill switch off.
3. Real run: sign in with a verified GitHub account and with a verified Discord account; register a player; connect a real MCP client with the token; retire the player; confirm the token is refused. Record the run in the worknote, with no handles, emails or tokens.
