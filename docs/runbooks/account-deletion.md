---
title: "Account deletion (operator view)"
type: how-to
audience: agents-never
status: draft
last_verified: 2026-11-16 against 03c1f5de
companions: [README.md, open-signup.md, mcp-tokens.md, kino.md]
sources: [../decisions/0171-account-erasure-rule.md, ../decisions/0262-account-deletion-erases-dead-lives-too.md, ../decisions/0085-append-only-audit-tables.md, sql/0025_admin_flag_and_register_audit.sql, sql/0039_account_deletion.sql, sql/0040_account_deletion_all_lives.sql, sql/test/check-schema-account-delete.sql, threshold/register/src/api/account-export.ts]
---

# Account deletion (operator view)

Scope: C7-09a and C7-09a2, the delete half. The export half is C7-09b, built and merged (PR #541;
`threshold/register/src/api/account-export.ts`, mounted by `account-export-wiring.ts`); see "The owner export" below.
Whether it is deployed on the node is not checked here. Rules: decision 0171, with
point 2 superseded by decision 0262 (every life of the owner is erased, dead or alive).

## What a deletion removes

A signed-in owner deletes their account with `POST /api/v1/account/delete` (cookie session, CSRF header, body
`{"confirm":"delete my account"}`), or from the account page at `/register/account/delete`. Both call one service
(`deleteAccountData`). In one database transaction (`register_account_delete`, migrations 0039 and 0040):

- every token of the owner's players (revoked, then deleted);
- every owner API key and the owner's register sessions, consents and kino admin row;
- the owner's players and roster rows, and the owner's body operation rows;
- every life of the owner, dead or alive (the set is the owner's players plus the `agents` rows whose owner link is
  the owner). For each life: the character sheet rows (`sheet_erase_life`: rolls, decisions, xp evidence, sheet
  adoptions, proficiency, proficiency outbox), sleep marks, budget, death records, journal, thoughts, receipts,
  suppressed wakeups, actions, intents, skill runs, memories, goals, skill library, relationships (both sides), ledger,
  votes and events (agent or thinker side);
- every life still alive is retired: its `agents` row gets `died_at` set to now, `death_cause` `owner-erased`,
  `public_camera` and `thoughts_delayed_public` FALSE; the owner link is cleared on every `agents` row of the owner;
- the owner row, and the identity row, unless the identity is banned (see the tombstone).

Before the transaction the register stops every non-retired player's body through the supervisor (the same stop the
retire route uses). If a stop fails the route answers 503 and nothing is removed. With NATS not configured no managed
body can exist, so the stop is skipped.

## A player the operator moved in refuses the delete

A player that the operator moved to an owner with `mcp-tokens player set-owner` (delete-guard, C7) carries one
`register_audit` row, action `player.set_owner`, target the player id. While the owner has any non-retired player with
that row, the delete is refused before anything else runs: `POST` answers 409 with a problem (`conflict`, detail "A
player was moved to this account by the operator"), the account page shows the same text, no body is stopped, nothing
is erased, and the only log line is `account delete refused reason=moved-in` (no name, no id, no owner id).

A retired moved-in player does not block. A player that was moved in and later moved out is no longer on the owner, so
it does not block either. Self-registered players carry no such row and never block.

To clear the block the operator moves the player away (`player set-owner` to another owner, which writes its own
audit row), or the owner asks the operator to retire it. The register audit rows stay: the table is append-only.

The check does not cover players the operator added with `player-add` for an owner (no move row). The operator must
check those by hand before the owner deletes.

The guard stops an accidental one-click delete. It does not stop a deliberate act: the owner can retire the moved-in
player (a retired player does not block) and then delete. Say so when the move is made.

The block is keyed on the audit row and the player id, not on the owner. It can block a delete the owner expects to
work in two cases: a player id reused after an earlier erase (the old row still names the id), and a player moved to
this owner, moved away and moved back (the row stays on the live player). The only clearing is a move of the player to
another owner, which writes its own row; the old row stays. A tighter match needs the identity-to-owner join, which is
not in this change.

The check is read twice: before the body stops and again just before the erase. A move that lands between the second
read and the erase is not seen. Closing that window needs the erase function to check the same rule (database change,
not in this change). Until then, an operator does not move a player to an owner while that owner is being deleted.

## Accounts deleted under 0039 (before 0040)

Deletions made under 0039 removed the owner link and the player rows of the owner's dead lives. Those dead lives
no longer have an owner link or a player row, so 0040 cannot reach them: their thoughts, events and death records
stay. The operator script `tools/players-cli/src/erase-owner.ts` can remove the skins and registry keys of these lives
only if the operator has their life ids and login names from another record: step 3a cannot find them, because 0039
cleared `agents.owner` and removed the player rows. The database cleanup of the 0039 dead lives is not done; the owner
decides it.

## What stays, and why

Exact list of what stays (decision 0262):

- the `agents` rows of the owner's lives, with the owner link (`agents.owner`) set to NULL. The sheet columns stay with
  the row. the player id, game account and name on the row are typed by the owner and can carry a real name;
- audit rows (`register_audit`), because the table is append-only (migration `sql/0025_admin_flag_and_register_audit.sql`,
  under decision 0170; its header points to migration `sql/0007_journals_append_only.sql` for the trigger's limits;
  decision 0085 applies the same append-only pattern to `receipts`, `thoughts`, `suppressed_wakeups` and `mcp_journal`,
  not to `register_audit`). The deletion writes one row with a random
  erasure id as actor and no owner id;
- the ban tombstone (the identity hash and the ban, nothing else), when the identity is banned (0171, point 4); from 0068 the tombstone's Minecraft ownership columns `owns_java`, `mc_checked_at` and `mc_profile_uuid` are cleared with the owner link (the `mc.ownership` audit row keeps no answer, only the action, outcome `recorded` and an empty detail, so nothing about the answer outlives the deletion);
- `kino_audit` rows of the deleted identity (the viewer's own Glass pane audit; the login hash is the identity hash as hex) are erased at deletion (the node operator's default, revertable before sign-up opens). Other owners' rows stay under their 90-day retention (`kino_audit_purge`);
- shared world objects whose author lost the owner link: `skills.author`, `books.author`, `proposals.proposer` and
  `laws`. Other lives depend on them (skill library and books by foreign key; laws by enactment). The author is an agent
  row with no owner link, so nothing ties the object to a person;
- the owner's skin upload rows (`skin_uploads`: pending and decided, with the PNG bytes and the sha256), deleted by
  `register_account_delete` from migration 0067 (decision 0172, point 7). The `geldar-skins` KV key is not removed by
  the function (see the manual steps below);
- nothing else keyed by life.

## What a deletion does to live writes

A deletion takes table locks on `mcp_journal`, `thoughts`, `receipts` and `suppressed_wakeups` for the length of its
transaction, because it turns off their append-only triggers inside the transaction and turns them back on before it
returns. While it runs, writes to those four tables from other owners wait. The rows to erase are collected before the window, under ordinary locks (that scan is not under the lock); the window itself deletes only those collected rows. The collection scans thoughts, receipts and suppressed_wakeups, which have no index on life id (mcp_journal has one), so a large table makes the collection slow, though it does not hold the window. The function sets a 3 second `lock_timeout`: if the lock is not free in time the
deletion fails and nothing is removed. Retry it; that is safe, because a failed deletion removes nothing.

Residual races (review F10, open): a journal write from a still-connected agent session can land after the commit, and
a sign-in that races the deletion can leave a `register_sessions` row for the removed owner. Later writes refuse that
owner (no owner row), so the row is inert, but it lingers until it expires. A row of the owner's life that a writer commits while the function waits for one of the four table locks is not in the collected set, so it survives; a second call returns false and cannot erase it. A pane open at the deletion, or a `gk_session` cookie still valid (30 minutes), can write `kino_audit` rows with the deleted identity hash after the erase; those rows leave only at the 90-day purge.

## The tombstone

An identity that is banned keeps its hash, its ban and its `created_at` and `provider` (NOT NULL columns):
`mcp_identities` keeps the row, and `owner_id` becomes NULL. A banned person therefore cannot sign up again to get a
fresh account. An unbanned identity leaves no row at all.

A tombstone is refused at sign-in while its ban stands: `findOwner` treats a NULL owner as banned and never returns the
owner `'null'`. `identity unban` on a tombstone DELETES the tombstone row (the hash and the ban go). The person can then
sign up again as a new owner, with fresh quotas (the F7 reset, accepted). If the operator does not want that, do not
unban.

A banned owner cannot call the delete route (it is refused 401 like a banned sign-in).

## Running a deletion by hand

Use this only with an owner's written request. Name the owner by its owner id, never by the identity or provider
subject in a shared channel.

1. Confirm the owner exists: `SELECT owner_id, display FROM mcp_owners WHERE owner_id = '<owner id>';`
2. List the owner's players and find any operator-started host for them. A deletion does not stop these; the register
   stops only the supervisor-managed bodies. Check with `./geldar.ps1 players status`, then stop each host of the
   owner's players with `./geldar.ps1 players down --player <player id>` (on the colo node, the same stop is
   `deploy/colo-admin.sh player-stop`). Do this before the deletion, so no host keeps running in the world with its
   tokens removed.
3. Find the identity hash: `SELECT identity_hash FROM mcp_identities WHERE owner_id = '<owner id>';`
3a. Capture the lives list BEFORE step 4, and save it as the JSON file that step 5 reads. Run
   `SELECT a.agent_id, a.game_account FROM agents a WHERE a.owner = '<owner id>' UNION SELECT a.agent_id, a.game_account FROM agents a JOIN mcp_players p ON p.life_id = a.agent_id WHERE p.owner_id = '<owner id>';`
   and write one entry per row: `lifeId` is `agent_id`, and `username` is `game_account` (the Body's login name). Check the
   file against the output of this query. The file cannot be rebuilt after step 4. Then, with `GELDAR_NATS_URL` set as in
   step 5, run the script with no flags
   (`node tools/players-cli/src/erase-owner.ts --owner <owner id> --lives <file>`, a dry run that prints counts only).
   The registry key of each life is its username, lowercased, and it must equal the Body's `game_account`. 0 present
   on a dry run before step 4 means the username is wrong or the Body never registered: check before going on.
4. Run the function as the register role: `SELECT register_account_delete('\x<identity hash hex>'::bytea);`
   It returns `true` when the account was removed and `false` when there was nothing to remove. If it fails on a lock
   timeout, wait and run it again.
5. Remove what the function does not reach, on the owner's written request, after step 4, with the operator script
   `tools/players-cli/src/erase-owner.ts` (C7-09c) and the lives file captured in step 3a. The file is JSON, one entry
   per life of the owner: `[{"lifeId": "<life id>", "username": "<login name>"}]`. With `GELDAR_NATS_URL` set, run
   `node tools/players-cli/src/erase-owner.ts --owner <owner id> --lives <file> --execute --confirm <owner id>` (the owner
   id exactly). `--confirm` guards a typo in the command only. The script does not check the file's contents, and the
   file is the target, so check it against the step 3a query output before running. It purges every revision of:
   - the `geldar-skins` key of each life (the PNG data in the KV store; the skin upload rows are erased by the function, 0067);
   - the `geldar-life-registry` key of each life's username (the Velocity admission entry).
   It does not remove the 0039 dead-life cleanup (open question (c) in decision 0262; the owner decides it).
6. Record the request in the operator log by owner id and date only. Do not copy the identity hash or any provider data.

Do not disable the append-only triggers by hand. The function does that inside its own transaction and turns them back
on before it returns.

Migration 0067 extends `register_account_delete` with the `skin_uploads` delete (decision 0172, point 7). The `geldar-skins` KV key stays a manual step above.

## After a self-serve deletion

The self-serve delete (the account page or the API) stops only the bodies the supervisor manages. A host an operator
started by player id is not stopped, and a stored name that is not a Body login is skipped, so the register logs
`account delete skipped body stop reason=login-name` (no name, no ids) when it skips one. Do this after every
self-serve deletion, and at once when that log line appears:

1. Run `./geldar.ps1 players status` and list the hosts that are running.
2. For each host whose player id is no longer in `mcp_players` (the deleted owner's players are gone), stop it:
   `./geldar.ps1 players down --player <player id>`. On the colo node the same stop is
   `deploy/colo-admin.sh player-stop <player id>`. `player-stop` works only while the player id is still listed in the
   shard file. If the id was already removed from the shard file, stop the container by hand:
   `docker stop geldar-colo-players-host-<player id>`.
3. Record the stop in the operator log by player id and date only.

## Checks

`sql/test/check-schema-account-delete.sql` covers the function: the second call is a no-op with no audit row, a banned
identity keeps its tombstone, an unbanned identity leaves nothing, a living life is retired, a dead life is erased too (0262), a failure after the
trigger disable leaves the append-only triggers enabled, and the lock timeout is transaction-local (an autocommit call
is followed by a check that `lock_timeout` is back at 0). The register unit tests cover the cookie clear on success and
on logout (the same list), the body slot release on every path, the stop-before-erase order, the account page path,
the skip log line, and the production mount (the page deps and the delete route, from `mountAccountDelete`).

## The owner export (C7-09b)

`GET /api/v1/account/export` is a same-origin navigation. A cross-site or same-site request is answered 404. A request with no `Sec-Fetch-Site` header is allowed, because some older browsers and proxies strip it; such a browser can be made to spend the owner's one-per-minute export window by a cross-site link, so the owner's own click can get 429 for up to a minute. The export writes one audit row per successful call (`owner.export`); no other state changes. One export runs at a time per process: a second one while it runs is 503 with `retry-after: 5`. A document over 8,000,000 bytes is answered 500 internal and is never sent; free-text fields are cut at 200 characters and every list and table is row- and byte-capped, so the document stays under 8 MB while identifiers (player ids, token ids, life ids) stay under about 1,000 characters (the operator writers keep them short); the 8 MB route cap is the backstop and answers 500 without content. The bulky tables (thoughts, mcp_journal) hold at most 3 MB of text each, and a per-list `truncated` object says which list was cut; a larger export is a later card (streaming). The export has a 60 s statement timeout. A busy answer (503) does not spend the owner's one-per-minute window.
