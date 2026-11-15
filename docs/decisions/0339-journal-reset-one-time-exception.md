# 0339. One-time journal and sleep-mark reset (0085 exception)

- Status: Accepted (owner reset order, 2026-11-15; one-time, not a routine)
- Date: 2026-11-15
- Spec: none; an operator decision. Makes one exception to 0085 (append-only audit tables). Related: 0064, 0076, 0262.

## Context

On 2026-11-15 the owner ordered all agents wiped and started over in the new spawn town. The wipe, at 21:25:51Z, did not touch `mcp_journal` or `mcp_sleep_marks`. The Minds were then handed pre-wipe journal lines: 13,997 rows written before the wipe across 19 lives, read as the newest 20 per life with no time filter. Their days-since-sleep were stale too: 13 of the 19 sleep marks sat at days 297 to 310 against world day 312.

## Decision

A one-time operator step, run by the worldops session on 2026-11-15 at about 21:57 to 21:58Z, under the owner's reset order and the coordinator's OK:

1. First, a full database dump and a dump of the two tables. They are kept in the operator state directory, operator-only, mode 0600.
2. `mcp_journal`: in one transaction, the 13,997 rows of the 19 lives written before 21:25:51Z are copied to `mcp_journal_archive_20261115`. The copied count must equal the count to delete. Then the rows are deleted. The append-only trigger is bypassed for that transaction only, with `SET LOCAL session_replication_role = replica`, the same one-transaction bypass 0262 uses for account deletion. The trigger stays installed and enabled.
3. `mcp_sleep_marks` (not append-only): the 19 rows are archived to `mcp_sleep_marks_archive_20261115`, and the 13 stale marks are set to the current world day. `sleep_cursor` is not touched.
4. Both archive tables are readable by the table owner role only. No grant to `geldar_mcp`, Glass or the register role.

## Why

The Minds must not be handed a history from before a wipe the owner ordered. The removed rows are not lost: they are in the archive tables and in the dumps. The live tables keep only what follows the reset.

## Consequences

- The Mind-facing journal read and the public Glass journal page show only rows written after the reset.
- Owner exports no longer include the pre-reset journal rows. They are in the archive tables and the dumps.
- The append-only rule of 0085 otherwise stands unchanged. The trigger is not dropped or disabled, and every other journal write stays append-only.
- This is not a reset routine. No new reset verb, script or migration is added. Any future journal reset needs its own decision and the owner's order.
- Known gap: the archive tables are not part of any export or erase function, and an account deletion (0262) does not reach them. Follow-up question for the owner: should deletion also erase the archive rows of a deleted owner's lives, and which role should own that cleanup?
