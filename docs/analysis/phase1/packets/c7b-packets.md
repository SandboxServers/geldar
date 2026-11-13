# Wave C7 packets, part 2: roster slice, admin flag, supervisor wiring, deletion, operator console, skin upload

Continues [c7-user-management-packets.md](c7-user-management-packets.md) (rulings, answered questions, shared rules, C7-01 to C7-07). The waves, migration numbers, dependency graph and live lane are in [c7-wave-plan.md](c7-wave-plan.md). Paths: the register service is `threshold/register/` (`@geldar/register`). Same card tail as part 1: must-not-edit `docs/spec.md`, a worknote per card, commit subject names the item, on cap commit what passes and report the rest. Decisions: [0170](../../../decisions/0170-owner-management-values-and-admin-flag.md), [0171](../../../decisions/0171-account-erasure-rule.md), [0172](../../../decisions/0172-human-skin-upload-held-for-approval.md). These packets write no new record; if a design point needs one, the worknote asks the orchestrator, who has 0173 to 0179 in reserve.

## C3-04s: DB roster slice (the first packet)

- **id / wave / lane.** C3-04s, wave 1, unblocker. **depends-on.** C1-08 (owner cap default read from the yaml; confirm it is merged, else the slice reads the cap with the code that exists and says so in the worknote). **branch.** `phase1/c3-04s-db-roster`. **migration.** 0024 (`mcp_roster`).
- **What it is.** The slice of [C3-04](c3-packets.md) that C7-03a needs: the roster and the agents-per-player limit move into the database. The original C3-04 also measures the thought deadline (its step 4); that stays in the C3-04 card as C3-04m (measurement only, not a C7 dependency) and is not part of this slice. `mcp_roster` is not on `main` (no migration creates it; C3-00 is not merged). This slice therefore creates it, with the shape in c3-packets.md section 2 (`player_name` primary key, `owner_id` references `mcp_owners`, `max_agents` 1 to 4 default 1, `created_at`), and the C3-00 card drops that one table from its migration (index line in the C3-04s worknote; the orchestrator edits C3-00).
- **may-edit.** `sql/0024_mcp_roster.sql` and its sql test; the `owner` and roster command code in `tools/mcp-tokens/src/` (new file `roster.ts` and its test; the command registration in `cli.ts` is a one-line change); `threshold/mcp/src/` only where a sovereign player start reads the roster (find by grep for `owner add` and `max_agents`); `docs/decisions/0108-*.md` (C3-04's own record, Proposed: roster source of truth and the default of 1); `docs/analysis/phase1/worknotes/C3-04s.md`.
- **must-not-edit.** `contract/`, `golem/`, `shards/phase0.yaml`, `compose/`, `docs/spec.md`, `threshold/register/`, earlier migrations.
- **Steps.** (1) Migration and sql test. (2) `mcp-tokens roster add|list|remove --owner` (the roster seeds from `shards/colo.yaml` `sovereign.players` once, by an explicit `roster seed` command, never on boot). (3) Starting a sovereign player refuses an id that is not in the roster or whose owner is at `max_agents`, with a stable error code. (4) Keep trigger 0006 and its owner cap (decision 0052).
- **Tests (each fails on revert).** A roster row for another owner's name cannot be added by this owner; a start for an unlisted player is refused; `max_agents` at its boundary (the Nth start is accepted, the N+1th refused, last-allowed attempt); the owner-cap trigger still refuses the 21st agent; `roster seed` is idempotent; abort: a failed insert leaves no half roster. Revert: skip the `max_agents` check; the boundary test fails.
- **checks.** `./geldar.ps1 pnpm --filter @geldar/mcp-tokens test`, `--filter @geldar/mcp test`, the migration check, typecheck, `pnpm format`, `./geldar.ps1 check`; the integration test under `GELDAR_IT=1` is a live-lane item.
- **size.** M.

## C7-12: admin flag, operator CLI and the audit table base

- **id / wave / lane.** C7-12, wave 1, unblocker (runs in parallel with C3-04s; they share `tools/mcp-tokens/src/cli.ts` registration only, and ops merges C3-04s first). **depends-on.** none. **branch.** `phase1/c7-12-admin-flag`. **migration.** 0025.
- **Goal.** (a) `mcp_owners.is_admin boolean not null default false`. The `geldar_register` role and the supervisor role get SELECT on it and no UPDATE on that column; only the operator role can write it. (b) `mcp-tokens owner admin set|unset <owner>` and `owner admin list`, which write the flag and one audit row each (`admin_set`, `admin_unset`, actor `operator`). No API route, page or key scope can set it. (c) The append-only `register_audit` base table (0085): `id`, `at`, `actor` (owner id hash or `operator`), `action`, `target`, `outcome`, `admin boolean`, `detail` (at most 256 characters, no names or emails). The register and supervisor roles may INSERT and SELECT; nothing may UPDATE or DELETE (a trigger refuses it, as the other 0085 tables do). C7-10 adds ban reasons and the operator views on top. (d) A small shared function in `threshold/register/src/admin.ts` and the same query in `supervisor/` (C7-03a) that read the flag fail closed: a missing owner or an error gives `false`.
- **may-edit.** `sql/0025_admin_flag_and_register_audit.sql` and its sql test, `tools/mcp-tokens/src/owner-admin.ts` and test (new; one-line registration in `cli.ts`), `threshold/register/src/admin.ts` and `audit.ts` and tests (new), `docs/analysis/phase1/worknotes/C7-12.md`.
- **must-not-edit.** `supervisor/`, `contract/`, `compose/`, `docs/spec.md`, earlier migrations, `threshold/mcp/`.
- **Tests (each fails on revert).**
  - The register role cannot UPDATE `mcp_owners.is_admin` (a grant test); the operator role can.
  - `owner admin set` and `unset` each write exactly one audit row with actor `operator`; an unknown owner is refused and writes no row; a failed audit write fails the set (no flag change without its row).
  - `register_audit` refuses UPDATE and DELETE from every role including the operator.
  - The admin reader returns false for an unknown owner and when the query errors (fail closed), true only for a flagged owner.
  - The register-side `audit.ts` writes `admin = true` only for a flagged owner.
  - An admin owner still has no extra reach: a test calls the owner-data query as an admin for another owner's player and gets no row (the "admin sees only their own data" rule, 0170).
  - Revert: grant UPDATE on the column to the register role; the grant test fails.
- **checks.** `./geldar.ps1 pnpm --filter @geldar/mcp-tokens test`, `--filter @geldar/register test`, the migration check, `./geldar.ps1 check`.
- **size.** M.

## C7-03b: replaced by three cards

C7-03b is split into C7-03b1 (NATS contract, user binding and request/reply transport), C7-03b2 (compose service, deploy script, budget and runbook) and C7-03b3 (Postgres adapter and Docker client). The cards, with the carry-forward list, are in [c7c-packets.md](c7c-packets.md). Wave placement is in [c7-wave-plan.md](c7-wave-plan.md).

## C7-08: terms, privacy notice and consent (DONE)

Merged: version 1 approved by the owner on 2026-11-11 (decision 0155); `register_consents` is `sql/0022_register_consents.sql`. Nothing remains in this wave except what C7-09 and C7-11 say.

## C7-09: account deletion and data export

- **id / wave / lane.** C7-09, wave 4. **depends-on.** C7-02b, C7-03b, C7-13a (for the skin rows), C7-08 (done). **branch.** `phase1/c7-09-deletion-export`. **migration.** 0029. **Status.** Unblocked by 0171 (legal review of the rule stays with the owner and does not gate the code; it gates C7-11).
- **Goal.** Self-serve deletion and export under [0171](../../../decisions/0171-account-erasure-rule.md).
  - **Delete.** One transaction, idempotent: stop every body through the supervisor first (treat "already stopped" as done; if a stop fails, refuse and remove nothing); revoke every token and owner key; retire every player (a life still alive is retired and its thoughts removed); delete skin upload rows and PNG data; remove owner links from rows that stay (dead lives' public thoughts, events, death records); remove consent, owner and identity rows, keeping only the ban tombstone (identity hash and ban) when the identity is banned; write one audit row keyed by an erasure-safe id. A runbook covers what sits outside Postgres: the `geldar-skins` KV key and the Velocity life registry entries, removed by the operator script.
  - **Export.** JSON of the owner's own rows only with a `format_version`; one per hour (admin exempt).
- **may-edit.** `threshold/register/src/api/account-data*.ts`, `threshold/register/src/pages/` (confirm page with a typed confirmation), `sql/0029_account_deletion.sql` (definer function and the export view, grants per 0056) and test, `docs/runbooks/account-deletion.md` (new), `docs/analysis/phase1/worknotes/C7-09.md`.
- **must-not-edit.** `supervisor/`, `contract/`, `docs/spec.md`, `docs/legal/` (a text change is a version bump, 0155).
- **Tests (each fails on revert).** Delete removes tokens, keys, identity and skin rows and a second delete is a no-op; delete with a running body stops it first, and if the stop fails nothing is removed; a dead life's thoughts and death record remain with no owner link while a living life's thoughts are gone; export holds only the owner's rows (two-owner fixture) and has `format_version`; export at the hour boundary: the second inside the hour is refused, the one at the boundary allowed, and an admin owner is exempt; a banned identity keeps the hash tombstone and re-sign-in is refused, an unbanned one leaves no hash; an admin owner deleting still leaves an audit row and cannot delete or export another owner (404); a DB error mid-delete rolls back every step. Revert: skip the token revoke; the token-refused-after-delete test fails.
- **checks.** Register and supervisor tests, the migration check, `./geldar.ps1 check`. Live (`live: pending`): the deletion check on the node.
- **size.** L (two sessions; split at "delete" and "export").

## C7-10: operator console and ban reasons

Carry-forward from the wave 1 review (review-5, 2026-11-13). Apply in this packet:

- **Actor encoding.** The audit actor is a sha256 prefix everywhere, one encoding and no raw ids.
- **Refusals.** A refused action is audited as `not_found` with no reason, so the audit row does not say which check failed.
- **Per-name hourly counts.** They follow the name, so a new roster owner inherits up to one hour of the old owner's starts. Confirm this is intended, or change it, before the packet merges.
- **Redundant index.** `mcp_roster_name_lower` duplicates the CHECK plus the primary key. Migration 0024 is now applied on the node, so dropping it is a new migration (0033 is the only spare). Owner decision: drop it or keep it.
- **Seed probe.** `check-schema-mcp-roster.sql` never runs the seed SQL. Add a statement that runs the seed twice, if wanted.
- **Not enforced elsewhere.** The golem `player-config`, `players-host`, the Velocity gate and `threshold/mcp` do not read `mcp_roster`, so a lower-case seeded name is not enforced on those paths.

- **id / wave / lane.** C7-10, wave 3. **depends-on.** C7-03a, C7-04, C7-12 (the audit table). **branch.** `phase1/c7-10-operator-console`. **migration.** 0030.
- **Goal.** (a) Extend `register_audit` (from C7-12) with the ban reason columns and the actions not yet written (sign-up, create, mint, rotate, revoke, rename, flag change, body start and stop, retire, delete, export, ban, skin events); a table-driven test lists them. (b) `mcp-tokens identity ban --reason <code> [--note <text>]` records reason and actor (codes `abuse`, `spam`, `impersonation`, `other`, the owner's to change; today the ban has only `banned_at`, 0136). (c) `mcp-tokens owner list` and `player list --owner` and a read-only operator page of owners, players and body states from the supervisor, showing the admin flag. The operator page is the only place that lists other owners, and it is operator-only (the operator database role, not an owner session). (d) `docs/runbooks/abuse-reports.md`.
- **may-edit.** `sql/0030_register_audit_ban_reasons.sql` and test, `tools/mcp-tokens/src/` (new subcommand files), `threshold/register/src/operator*.ts`, `docs/runbooks/abuse-reports.md`, `docs/analysis/phase1/worknotes/C7-10.md`.
- **must-not-edit.** `supervisor/`, `contract/`, `docs/spec.md`.
- **Tests (each fails on revert).** Every listed action writes exactly one audit row (table-driven); the audit table refuses UPDATE and DELETE for every role; ban without a reason code is refused; `owner list` output has no email and no subject; an admin owner's session cannot open the operator page (it is not an admin view, 0170) and gets 404; a failed audit write fails the action. Revert: drop the audit write from `ban`; the ban audit test fails.
- **checks.** `./geldar.ps1 pnpm --filter @geldar/mcp-tokens test`, register tests, the migration check, `./geldar.ps1 check`.
- **size.** M.

## C7-11: sign-up gate (not a code packet)

- **id / wave / lane.** C7-11, wave 4 close. **depends-on.** C7-05, C7-06, C7-09, C7-13c, and the owner's written approval. **Status.** Legal text gate cleared (0155). Open: the code packets, the owner's review of the erasure rule (0171), and the owner opening sign-up.
- **Goal.** `REGISTER_SIGNUP_ENABLED` (default off) turns on only when each item is recorded in the ledger: terms version approved (done); erasure rule reviewed by the owner and the deletion path passed its live check (C7-09); onboarding and account pages merged (C7-05, C7-06); supervisor quotas set and tested (C7-03a, C7-03b live); contact published (done); skin moderation steps exist (C7-13b). The sign-up page answers a closed-for-now page, not JSON.
- **may-edit.** `threshold/register/src/config*.ts` (the gate check: refuse to open if the terms version is not marked approved in a file the owner commits), `docs/analysis/phase1/RESUME.md`, `docs/analysis/phase1/ledger.md`. **branch.** `phase1/c7-11-signup-gate`.
- **Tests.** The gate refuses to open with an unapproved terms version and opens with an approved one; the closed page is served in both states without a JSON body.
- **Owner decisions.** Opening sign-up is the owner's call.
- **size.** S.

## C7-13a: skin upload, API and held store

- **id / wave / lane.** C7-13a, wave 3. **depends-on.** C7-04, C7-12. **branch.** `phase1/c7-13a-skin-upload-api`. **migration.** 0031 (`skin_uploads`). Decision [0172](../../../decisions/0172-human-skin-upload-held-for-approval.md).
- **Goal.** `POST /agents/{playerId}/skin` (scope `manage`, CSRF for cookies) takes one PNG, validates it, stores it as `pending`, and writes an audit row; `GET /agents/{playerId}/skin` gives the status (`none`, `pending`, `approved`, `rejected` with its reason code, `applied`); the validator is a pure module. `skin_uploads(id, owner_id, player_id, png bytea, sha256, status, reason_code, created_at, decided_at, decided_by)`; the register role may INSERT and SELECT its own rows and has no UPDATE of `status`; only the operator role moves a row out of `pending`. Rules per 0172 point 2 and 5: 64x64, 8-bit RGB or RGBA, at most 32 KiB, only IHDR, IDAT and IEND chunks, inflated size equal to the pixel data, one pending per agent, 3 uploads per agent per day (admin exempt), 1 hour after a reject, a lock after 3 rejects in 30 days (admin exempt from the rate rules, not from approval). The MineSkin key and the KV bucket are not touched here. The PNG is never logged and never served from a public path (the status endpoint returns no image).
- **may-edit.** `sql/0031_skin_uploads.sql` and test, `threshold/register/src/api/skins*.ts`, `threshold/register/src/skin-validate.ts` and tests (the PNG reading may reuse the logic of `tools/players-cli/src/png-decode.ts` by copying a small header check, not by importing the CLI), `docs/analysis/phase1/worknotes/C7-13a.md`. Not the account page (C7-13c).
- **must-not-edit.** `tools/players-cli/`, `supervisor/`, `compose/`, `contract/`, `docs/spec.md`.
- **Tests (each fails on revert).**
  - Validator table: valid RGB and RGBA 64x64 accepted; 64x32, 128x128, 16-bit, palette, interlaced-with-extra-chunks, a `tEXt` chunk, a bad CRC, a truncated file and a decompression bomb each refused with a stable code; 32 KiB accepted and 32 KiB plus one byte refused (last-allowed boundary).
  - Another owner's agent: 404 on both routes.
  - One pending per agent: the second upload is refused (409); after a decision it is allowed; the reject-hour wait: refused at 59 minutes 59 seconds, allowed at 60 minutes; the third upload of a day accepted and the fourth refused; three rejects in 30 days lock the owner.
  - Admin: the fourth upload of a day is accepted and the reject wait does not apply; another owner's agent is still 404; the row is still `pending` (no auto-apply for an admin).
  - The status route returns no image bytes; the PNG is absent from the request log (log-capture test).
  - Abort/error: a DB error stores nothing and returns a stable error; a client disconnect mid-upload leaves no partial row.
  - The register role cannot UPDATE `status` (a grant test).
  - Revert: skip the owner check on upload; the cross-owner test fails. Revert the chunk allowlist; the `tEXt` case fails.
- **checks.** Register tests, the migration check, `./geldar.ps1 check`.
- **size.** L (two sessions; split at "validator and table" and "routes and limits").

## C7-13b: skin moderation CLI, MineSkin and the KV write (operator side)

- **id / wave / lane.** C7-13b, wave 4. **depends-on.** C7-13a. **branch.** `phase1/c7-13b-skin-moderation`. **migration.** none (the operator role's grants are in 0031; C7-13a owns them).
- **Goal.** In `tools/players-cli`, `skin uploads list|show|export|approve|reject` per 0172 point 4. `export` writes the PNG to a path the operator names so it can be looked at. `approve` re-validates the PNG, signs it through the existing MineSkin client in `tools/players-cli/src/mineskin.ts` (unlisted, the key from the operator's environment only), writes the signed record to `geldar-skins` under the life id (the existing `skin import` path), sets the row `applied` and writes an audit row; a MineSkin or KV failure leaves the row `pending` and writes a `failed` audit row (no half state). `reject --reason <code>` takes `inappropriate`, `impersonation`, `not_a_skin`, `invalid_format` or `other` and an optional note kept off the owner's view. A rate-limit reply from MineSkin leaves the row pending and prints the retry time. An update to `docs/runbooks/skins.md`: the moderation steps, the key handling, how to confirm the skin applied (the existing "Verify a skin was applied" steps), and removal on deletion.
- **may-edit.** `tools/players-cli/src/` (new `uploads*.ts` files and tests; one-line registration in `cli.ts`), `docs/runbooks/skins.md`, `docs/analysis/phase1/worknotes/C7-13b.md`.
- **must-not-edit.** `threshold/register/`, `compose/`, `contract/`, `docs/spec.md`; no key, signed value or PNG in any file in the repo.
- **Tests (each fails on revert).** Approve calls the (fake) MineSkin client once and writes one KV record keyed by the life id, then marks `applied`; approve with a MineSkin error leaves `pending`, writes no KV record and one `failed` audit row; approve with a KV error after a successful signature leaves `pending` and the signed value is not lost (printed to the operator only, not stored in the repo or the database); reject without a code is refused; the owner-visible status carries the code and not the note (a query test through the register role); `export` writes the exact PNG bytes; the MineSkin key never appears in output or in a thrown error (leak scan, as `leak-scan.ts` does for the ranger files); approving an already decided row is refused. Revert: drop the re-validation in `approve`; the tampered-row test fails.
- **checks.** `./geldar.ps1 pnpm --filter @geldar/players-cli test`, typecheck, `./geldar.ps1 check`. Live (`live: pending`): approve one test upload with the real MineSkin key (the owner's key, one generation) and log in the test agent to see the skin; the skins runbook steps verify it.
- **size.** M.

## C7-13c: account page skin form, status and deletion hook

- **id / wave / lane.** C7-13c, wave 4. **depends-on.** C7-06, C7-13a (and C7-13b merged before the live check). **branch.** `phase1/c7-13c-skin-form`. **migration.** none.
- **Goal.** A skin section on the account page: a file form posting to the C7-13a route with CSRF, the rules in plain words (64x64, held until a person approves it, may be refused), the current status per agent (`pending`, `applied`, `rejected` with the code in words, and when a re-upload is allowed), and an HTML error page for each refusal. No inline script or style (CSP). The C7-09 deletion path already removes the rows; this card adds only the page text that says so.
- **may-edit.** `threshold/register/src/pages/skin*.ts` and tests, `threshold/register/src/pages/account*.ts` (one include of the skin section), `threshold/register/src/static/account.css` (skin rules only), `docs/analysis/phase1/worknotes/C7-13c.md`.
- **must-not-edit.** `threshold/register/src/api/`, `tools/`, `docs/spec.md`.
- **Tests (each fails on revert).** The form has a labelled file input, an `enctype` of multipart and the CSRF field; another owner's agent's skin status never appears (two-owner fixture); a rejected row shows the code text and never an operator note; the re-upload wait text shows the right time at the boundary; no inline script or style; an admin owner sees the same page and the same "held for approval" text. Revert: show the note field; the leak test fails.
- **checks.** Register tests, `./geldar.ps1 check`.
- **size.** S.
