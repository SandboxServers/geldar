# 0262. Account deletion erases every life of the owner, dead or alive

- Status: Decided (owner ruling, 2026-11-15)
- Date: 2026-11-15
- Spec: 5.15 (self-registration); related 0085 (append-only audit), 0136 (bans), 0138 (thoughts after death), 0153, 0155
- Supersedes: 0171 point 2 only. Points 1, 3, 4, 5 and 6 of 0171 stand.
- Related: cards C7-09 and C7-09a2 (`docs/analysis/phase1/packets/c7-user-management-packets.md`); 0051 (character sheet, `sheet_erase_life`); 0039 (the first deletion migration, living lives)

## Context

0171 point 2 kept the public thoughts, events and death records of dead lives as world history, with the owner link removed. The owner has ruled otherwise. C7-09a (migration 0039) erased the owner's living lives and kept the dead ones. C7-09a2 completes the rule: a deletion erases every life of the owner, dead or alive.

## Decision

1. **Erased on deletion, for every life of the owner (dead or alive).** The life set is the owner's players plus the agents rows whose owner link is the owner, read once before any player row is removed. For each life:
   - the character sheet rows through `sheet_erase_life` (0051): rolls, decisions, xp evidence, character sheet adoptions, proficiency and proficiency outbox;
   - sleep marks, budget, death records (`mcp_life_deaths`, `mcp_death_events`);
   - journal (`mcp_journal`), thoughts, receipts and suppressed wakeups (the four append-only tables, erased inside the same short lock window 0039 uses; their triggers are switched off for that transaction only);
   - actions, intents, skill runs, memories, goals, skill library, relationships (both sides), ledger, votes and events (agent or thinker side);
   - every token of the owner's players (revoked first, so cached MCP sessions end, then removed).
2. **A living life is retired** as in 0039: dead, with death cause `owner-erased`, no public camera and no delayed public thoughts.
3. **Kept, and why.**
   - The agents rows of the owner's lives stay, with the owner link removed. The sheet columns stay with the row (geldar-sheet). The player id, game account and name on the row are typed by the owner at sign-up and can carry a real name; nothing checks them against anyone's identity, so the row can name a person.
   - **Shared world objects are kept:** `skills.author`, `books.author`, `proposals.proposer` and `laws`. Other lives depend on them: skill library and books reference skills and books by foreign key, and laws stand by enactment. The author or proposer is an agent row whose owner link is removed, so nothing in the kept row ties the object to a person.
   - **`kino_audit` rows of the deleted identity are erased** (C7-09a2, geldar-93 ruling, owner asleep: the recommended default, revertable before sign-up opens). The login hash of a signed-in viewer is the identity hash itself as hex (`glass/src/kino/audit.ts` `loginHash`), so `register_account_delete` removes exactly the rows whose `login_hash = encode(identity_hash, 'hex')`. Other owners' rows stay under their 90-day retention (`kino_audit_purge`). The table has no append-only trigger, so no lock window is needed.
   - **`register_audit` is kept** (0085): the single deletion row, with a random erasure actor and no owner id.
   - **The ban tombstone is kept** (0171 point 4, 0136): the identity hash and the ban, nothing else.
4. **The rest of 0171 is unchanged**: identity, owner row, owner keys, consent rows, kino admin rows, sessions, roster and body operations are removed; a second call for the same identity finds no owner and returns false with no audit row.

## Why

- The owner ruled that a person's deletion removes what their agents did, thought and recorded, not only the lives that were still running. A dead life's thoughts are a record of that person's agent.
- Shared world objects stay so that other lives are not broken. The link to a person is cut at the agent row, which is the only place it was kept.

## What it changes

- Migration 0040 (`sql/0040_account_deletion_all_lives.sql`) replaces `register_account_delete` with the same signature, grants and pinned search path. 0039 is not edited.
- The check `sql/test/check-schema-account-delete.sql` asserts the per-table result for four lives of one owner and two of another.
- The runbook `docs/runbooks/account-deletion.md` lists "What stays" exactly.

## Open

- `kino_audit` rows of the identity: erased at deletion (owner call (b), built as the geldar-93 default, revertable before sign-up opens).
- The shared world objects keep the agent id of their author; the owner may rule that the author column is nulled instead.
- (a) Kept agent rows may carry a typed real name (player id, game account, name): anonymise on deletion, or accept.
- (c) Accounts deleted under 0039, before 0040: their dead lives have no owner link and no player row, so 0040 cannot reach them. Cleanup is follow-up card `C7-09c`.
- Also kept: `memories.source_agent` of other lives and other lives' event payloads that name an erased life.
- Stale comments, not corrected here (0050 and 0051 are not edited): `sql/0051` (lines 10, 124-128, 155) and `sql/0050` (lines 133-134) still say that the rows of dead lives stay as world history with no owner link, which 0040 now contradicts (`sheet_erase_life` runs for dead lives too). The `rolls` table comment on a sorted-order database says the same. Follow-up needed to correct the comments and the export and retention map.
