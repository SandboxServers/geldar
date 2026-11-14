# Account deletion (operator view)

Scope: C7-09a, the delete half. The export half is C7-09b and is not built. Rule: decision 0171.

## What a deletion removes

A signed-in owner deletes their account with `POST /api/v1/account/delete` (cookie session, CSRF header, body
`{"confirm":"delete my account"}`). In one database transaction (`register_account_delete`, migration 0039):

- every token of the owner's players (revoked, then deleted);
- every owner API key and the owner's register sessions, consents and kino admin row;
- the owner's players and roster rows, and the owner's body operation rows;
- every life still alive is retired: its journal (`mcp_journal`), thoughts, sleep marks and budget rows are removed;
- the owner row, and the identity row, unless the identity is banned (see the tombstone).

Before the transaction the register stops every player's body through the supervisor (the same stop the retire route
uses). If a stop fails the route answers 503 and nothing is removed. With NATS not configured no managed body can
exist, so the stop is skipped.

## What stays, and why

- Dead lives keep their public thoughts, events and death records, with the owner link (`agents.owner`) set to NULL.
  They are facts about the world; after deletion nothing joins them to an owner or an identity (0171, point 2).
- Events are not owner-linked and are not removed. Events of a life that was alive at deletion stay too; this is the
  open point of 0171 and needs the owner's ruling before C7-09 is treated as final.
- Audit rows (`register_audit`) stay, because the table is append-only (0025). The deletion writes one row with a
  random erasure id as actor. The owner id is not written to it, so the row cannot be joined back to the owner.
- Skin upload rows are not referenced by 0039. C7-13a adds them to the function (and the operator removes the PNG data
  under the `geldar-skins` key, per 0171 point 1). Until then a deletion does not remove skin uploads.

## The tombstone

An identity that is banned keeps its hash and its ban: `mcp_identities` keeps `identity_hash` and `banned_at`, and
`owner_id` becomes NULL. A banned person therefore cannot sign up again to get a fresh account. An unbanned identity
leaves no row at all. A sign-in with a tombstone is refused by the banned check, as before.

A banned owner cannot call the delete route (it is refused 401 like a banned sign-in).

## Running a deletion by hand

Use this only with an owner's written request. Name the owner by its owner id, never by the identity or provider
subject in a shared channel.

1. Confirm the owner exists: `SELECT owner_id, banned FROM mcp_owners WHERE owner_id = '<owner id>';`
2. Stop the owner's bodies first, through the supervisor (the body stop of the owner console), for each live player.
   A deletion does not stop bodies on its own when run from SQL.
3. Find the identity hash: `SELECT identity_hash FROM mcp_identities WHERE owner_id = '<owner id>';`
4. Run the function as the register role: `SELECT register_account_delete('\x<identity hash hex>'::bytea);`
   It returns `true` when the account was removed and `false` when there was nothing to remove.
5. Record the request in the operator log by owner id and date only. Do not copy the identity hash or any provider data.

Do not disable the append-only triggers by hand. The function does that inside its own transaction and turns them back
on before it returns.

## Checks

`sql/test/check-schema-account-delete.sql` covers the function: the second call is a no-op with no audit row, a banned
identity keeps its tombstone, an unbanned identity leaves nothing, and a failure after the trigger disable leaves the
append-only triggers enabled.
