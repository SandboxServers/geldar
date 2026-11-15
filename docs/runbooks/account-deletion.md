# Account deletion (operator view)

Scope: C7-09a, the delete half. The export half is C7-09b and is not built. Rule: decision 0171.

## What a deletion removes

A signed-in owner deletes their account with `POST /api/v1/account/delete` (cookie session, CSRF header, body
`{"confirm":"delete my account"}`), or from the account page at `/register/account/delete`. Both call one service
(`deleteAccountData`). In one database transaction (`register_account_delete`, migration 0039):

- every token of the owner's players (revoked, then deleted);
- every owner API key and the owner's register sessions, consents and kino admin row;
- the owner's players and roster rows, and the owner's body operation rows;
- every life still alive: its journal (`mcp_journal`), thoughts, sleep marks and budget rows are removed, and its
  `agents` row is retired: `died_at` is set to now, `death_cause` is `owner-erased`, `public_camera` and
  `thoughts_delayed_public` are FALSE, and the owner link is cleared;
- the owner row, and the identity row, unless the identity is banned (see the tombstone).

Before the transaction the register stops every non-retired player's body through the supervisor (the same stop the
retire route uses). If a stop fails the route answers 503 and nothing is removed. With NATS not configured no managed
body can exist, so the stop is skipped.

## What stays, and why

- Dead lives keep their public thoughts, events and death records, with the owner link (`agents.owner`) set to NULL.
  They are facts about the world; after deletion nothing joins them to an owner or an identity (0171, point 2).
- Events are not owner-linked and are not removed. Events of a life that was alive at deletion stay too; this is the
  open point of 0171 and needs the owner's ruling.
- Audit rows (`register_audit`) stay, because the table is append-only (0025). The deletion writes one row with a
  random erasure id as actor. The owner id is not written to it, so the row cannot be joined back to the owner.
- `kino_audit` rows (one login hash per identity, 90-day retention) are not removed by the function. They age out under
  their own retention.
- Skin upload rows are not referenced by 0039. C7-13a adds them to the function. Until then a deletion does not remove
  skin uploads, and the PNG data under the `geldar-skins` KV key is not removed (see the manual steps below).

## What a deletion does to live writes

A deletion takes table locks on `mcp_journal` and `thoughts` for the length of its transaction, because it turns off
their append-only triggers inside the transaction and turns them back on before it returns. While it runs, journal and
thought writes from other owners wait. The function sets a 3 second `lock_timeout`: if the lock is not free in time the
deletion fails and nothing is removed. Retry it; that is safe, because a failed deletion removes nothing.

Residual races (review F10, open): a journal write from a still-connected agent session can land after the commit, and
a sign-in that races the deletion can leave a `register_sessions` row for the removed owner. Later writes refuse that
owner (no owner row), so the row is inert, but it lingers until it expires.

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
4. Run the function as the register role: `SELECT register_account_delete('\x<identity hash hex>'::bytea);`
   It returns `true` when the account was removed and `false` when there was nothing to remove. If it fails on a lock
   timeout, wait and run it again.
5. Remove what the function does not reach, by hand, on the owner's written request. No script in this repository does
   these steps yet (operator erasure script, C7-09c, is not built):
   - the `geldar-skins` KV key for the owner's skin uploads (the PNG data; C7-13a adds the rows to the function);
   - the Velocity life registry entries for the owner's lives.
6. Record the request in the operator log by owner id and date only. Do not copy the identity hash or any provider data.

Do not disable the append-only triggers by hand. The function does that inside its own transaction and turns them back
on before it returns.

C7-13a must extend `register_account_delete` (skin uploads) before C7-11 (the sign-up gate) is opened.

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
identity keeps its tombstone, an unbanned identity leaves nothing, a living life is retired, a failure after the
trigger disable leaves the append-only triggers enabled, and the lock timeout is transaction-local (an autocommit call
is followed by a check that `lock_timeout` is back at 0). The register unit tests cover the cookie clear on success and
on logout (the same list), the body slot release on every path, the stop-before-erase order, the account page path,
the skip log line, and the production mount (the page deps and the delete route, from `mountAccountDelete`).
