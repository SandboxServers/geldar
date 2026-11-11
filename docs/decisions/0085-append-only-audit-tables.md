# 0085. Append-only audit tables

- Status: Accepted (orchestrator, under owner decisions 0064 and 0076)
- Date: 2026-11-10
- Spec: decision 0064 item 5 (journals are append-only evidence); decision 0076 (backup scope, append-only journals); Phase 1 packet C1-05a. Registry number 0085 is reserved for this packet.

## Decision

1. **Covered tables.** `receipts`, `thoughts`, `suppressed_wakeups` and `mcp_journal` are append-only. A changed or deleted row is evidence lost, so the database refuses it.
2. **Excluded tables, and why.** `memories`, `goals` and `relationships` are mutable by design: `animus/src/memory/pg-memory-store.ts` updates `memories` (`active`, `resolved`, `embedding`) and rewrites `goals`. `intents` and `actions` are state machines that the projection writes in place. None of them is evidence in the sense of this decision. The reset of the test life still deletes from these three mutable tables (`golem/test/live/adam-reset.ts`).
3. **Triggers.** Migration `sql/0007_journals_append_only.sql` adds a `BEFORE UPDATE OR DELETE ... FOR EACH ROW` trigger per covered table. The function `journal_append_only()` raises `check_violation` on every UPDATE and DELETE statement. `INSERT` is unchanged. The precise scope: the triggers refuse UPDATE and DELETE statements. The table owner or a superuser can still TRUNCATE, disable the trigger or change `session_replication_role`, and every service currently connects as the superuser. So the guarantee holds against accidental statements and against the `geldar_mcp` role. It does not hold against a superuser who bypasses it. Hardening (non-superuser service roles, `ENABLE ALWAYS TRIGGER`, a TRUNCATE gate) is a C2 security-review item. `sql/test/check-schema.sql` asserts each trigger, and `threshold/mcp/test/it/append-only.it.test.ts` asserts the refusals against a scratch database.
4. **MCP role.** Migration 0003 granted `geldar_mcp` DELETE on `mcp_journal` for the trim. 0007 revokes `UPDATE` and `DELETE` on it, so the sovereign MCP keeps `INSERT` and `SELECT` only.
5. **Journal writes and reads.** `threshold/mcp/src/store/pg-journal.ts` appends with a plain `INSERT`. The old statement also deleted the life's older lines to keep 1000 per life; that trim is gone. The journal is a bounded read window: a read returns the most recent lines, and no row is removed.
6. **Thoughts replay.** `animus/src/memory/journal.ts` writes `INSERT ... ON CONFLICT (thought_id) DO NOTHING`. A replayed thought changes nothing, and the first row stays. The former `DO UPDATE` would be refused by the trigger.
7. **TRUNCATE.** TRUNCATE is not blocked by the triggers (see item 3 for the superuser caveat). The integration cleanups use `TRUNCATE` on the covered tables, and only on a throwaway database. The guards `assertThrowawayDatabase` and `assertConnectedToThrowaway` (`animus/src/memory/throwaway-db.ts`, `eventsink/test/throwaway-db.ts`) are allowlists: a scratch database `geldar_it_<hex>` is always allowed, and the shared CI database `geldar` only with `GELDAR_IT_ALLOW_SHARED_DB=1` on GitHub Actions. Every other name is refused, including the dev database, the config default, an empty name, and a name with a space or an upper-case letter. The guards run before any TRUNCATE or DELETE.
8. **Reset.** The reset of the test life does not run DELETE on `thoughts` or `suppressed_wakeups`. It logs the statement it would have run, and the rows stay. The tier check, the mutable deletes and the `agents` day reset are unchanged.
   - Consequence: the old thoughts stay in the table and reach the Mind's prompts, because the Mind reads its journal by `life_id`. The reset does not hide them.
   - Follow-up: a new life id (for example `ag_adam_03`) gives the Mind a clean history. It needs `ADAM_LIFE_ID` in `golem/test/live/adam-stack.ts`, which is outside the packet's may-edit list. Until that change, the reset is non-destructive and the Mind's prompts carry the old thoughts.
9. **Spacing bucket dropped.** The card's journal-spacing item is not implemented. No journal write is bucketed by this packet. The attention controller's `minWakeupSpacingS` defers wakes and is not a journal write.

## Consequences

- An audit row written in error cannot be fixed in place. A correction is a new row.
- A throwaway database may be cleared with `TRUNCATE`; the dev database may not, and the guards enforce it in the tests that do so.
- Any future migration that needs to change a covered table must add its own decision.

## Index

- Row for `docs/decisions/README.md`: `| [0085](0085-append-only-audit-tables.md) | Append-only audit tables: receipts, thoughts, suppressed_wakeups and mcp_journal refuse UPDATE and DELETE for every role (0007); the mcp role has no UPDATE or DELETE; thought replays do nothing; the reset logs its audit deletes and runs none | Accepted (orchestrator, under owner decisions 0064 and 0076) |`
