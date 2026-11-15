# C7-09a worknote: the SQL side of account deletion (migration 0039)

Scope: `sql/0039_account_deletion.sql`, `sql/test/check-schema-account-delete.sql`, and the CLI unban in
`tools/mcp-tokens/src/identities.ts`. Decision 0171 is the reference. The register side (route, page, supervisor
stop) is in its own worknote, C7-09.md.

## What the function removes

`register_account_delete(identity_hash)` (SECURITY DEFINER, pinned search_path, EXECUTE for geldar_register only)
runs in one transaction:

- every token of the owner's players: revoked first (this fires `mcp_token_revoked`, which ends cached MCP
  sessions), then deleted;
- the owner's API keys, players, roster rows and body_ops rows;
- the identity's register sessions, consents and kino admin row;
- sleep marks and budget rows of the living lives (not trigger-protected);
- journal and thought rows of the living lives (the only rows removed from append-only tables);
- the owner row, and the identity row (unbanned) or its tombstone (banned, see below).

Each DELETE or UPDATE is scoped by the owner (derived inside the function from the identity hash) or by the
identity hash. The check file asserts these filters with two owners (A deleted, B kept), a banned owner C, a
living and a dead life each, and a token capture trigger.

## Living lives (F5)

A life with no `died_at` is retired by the function: `died_at = now()`, `death_cause = 'owner-erased'`,
`public_camera = FALSE`, `thoughts_delayed_public = FALSE`, owner link NULL. The reason: a living agent with no
owner and no body would otherwise stay public and alive with nobody behind it. `agents.death_cause` is TEXT with
no CHECK in any `sql/` file, so the value is legal without a schema change.

A dead life keeps its agents row, with owner NULL (0171 point 2 as first written). Migration 0040 (C7-09a2, decision
0262) supersedes that point: every life of the owner (dead or alive) loses its sheet rows, sleep marks, budget, death
records, journal, thoughts, receipts, suppressed wakeups, actions, intents, skill runs, memories, goals, skill library,
relationships, ledger, votes and events. Shared world objects, kino_audit, audit rows and the tombstone stay.

## Lock behaviour (F2)

- `set_config('lock_timeout', '3s', true)` at the top of the function, so every lock wait in the transaction is
  bounded to 3 s.
- `ALTER TABLE ... DISABLE TRIGGER` on `mcp_journal` and `thoughts` takes SHARE ROW EXCLUSIVE on each table until
  the transaction ends. The window covers only the two journal/thought deletes; the triggers are enabled right
  after them.
- Measured by the reviewer before this fix (not re-measured in this pass): a journal INSERT for another life
  blocked for 4.97 s while the delete's transaction was open. With the 3 s bound a waiting delete fails with
  55P03 and removes nothing; the register answers 500 and the owner may retry.
- Stated, not measured here: a failure after the disable rolls the disable back (DDL is transactional), so no
  trigger stays off. The forced-failure block in the check file confirms `tgenabled = 'O'` after a raise.
- Enable is plain `ENABLE TRIGGER`, as 0007 installed it. A future `ENABLE ALWAYS` hardening of 0007 must change
  this function too.

## Residual races (known, accepted for this card)

1. A journal write by a still-connected agent session that is blocked by the table lock can land after the
   commit, leaving one `mcp_journal` row for the erased living life. The NOTIFY that ends that session fires only
   at commit, so the row is written before the session is ended.
2. A sign-in racing the deletion can insert a `register_sessions` row for the removed owner after the delete
   committed. The row has no foreign key. Later writes refuse it (the owner lookup returns nothing), but the row
   lingers until it expires.

## Deviations from 0171 (for the owner to accept or change)

- Tombstone content (point 4 says "the identity hash and the ban, and nothing else"). A banned identity keeps its
  hash, `banned_at`, and also `provider` and `created_at`, which are NOT NULL columns. The owner id is set to
  NULL. This is a small deviation, kept so the row stays valid without a schema change.
- Audit actor (point 3 says a salted hash). The audit row carries a random 16-hex erasure id, not a salted hash
  of the owner id. A deletion cannot be correlated to the owner's earlier audit rows. The owner may prefer the
  salted form; changing it is a one-line change to the function.
- The audit detail says only "no tombstone" or "tombstone kept". The owner id is never written to the audit row.

## Unban after deletion (F4)

`unbanIdentity` (CLI) first clears the ban on an identity that has an owner. If the identity is a tombstone
(`owner_id IS NULL`, `banned_at` set), it deletes the row, so the person can sign up as new. Without this, a
NULL owner read as the string `'null'` in `PgStore.findOwner`, which made the next sign-in a dead session
for no owner, and sign-up was impossible because the identity hash is the primary key.

## Not in this migration

- Skin upload rows: C7-13a adds them to this function. C7-11 must not ship before that.
- Quotas after re-sign-up (F7): owner ids are deterministic from the identity hash, so a deleted and unbanned
  person comes back with the same id and no memory of the lifetime cap. This is an owner decision.
- Operator-started Bodies (F6): the register stops supervisor-managed bodies only. The runbook has to tell the
  operator about hosts run by hand; see docs/runbooks/account-deletion.md.
