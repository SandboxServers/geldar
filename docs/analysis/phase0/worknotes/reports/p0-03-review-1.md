# P0-03 review 1

Verdict: fix

Commit 1a8f452 (base 449da6d = origin/phase0/wave1, no drift). Trailers verbatim:

```
Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015Wz3WivzkDVS6r65y6RFEk
```

Subject `feat(contract): add action record, receipt and event schemas` matches the packet. (The coder report mentions "Haiku 5.5" in its session reminder; the commit uses Sonnet 5.5, matching the brief. Nothing to fix.)

Run here: `check:generated` up to date; `pnpm test` 4 files / 29 tests pass; `./geldar.ps1 check` "All checks passed."; worktree clean. `index.ts` changes sit only inside the `// --- P0-03 records ---` block; generated files are LF and current.

Checked and fine: every ActionRecord, Receipt and WorldEvent field, enum, bound and required list matches the packet; the D-P0-10 rule and `(action_id, phase)` uniqueness are in the Receipt description; the section 7 types and the `geldar.<shard>.<type>` subject rule are in the WorldEvent description; columns line up with `sql/0001_init.sql` on the wave branch (actions gains `snapshot_revision BIGINT`; receipts has `detail` and `UNIQUE (action_id, phase)`; events columns map 1:1); no oversize files; no helpers/utils.

## Fix notes

1. `contract/schemas/action-record.schema.json` (top-level `description`, and `properties.receipt_id.description`) says receipts attach to "Economic kinds" only and that `receipt_id` is "The final receipt for economic kinds, or null". Decision 0020 and the Receipt schema say every action ends with exactly one final `committed` or `aborted` receipt (Phase 0 exit: "every action has a receipt"); only the `prepared` receipt is economic-only. An implementer following this description would leave receipt_id null for `mine`/`goto` and skip their final receipts. Reword: top-level, "Every action ends with one final receipt (committed or aborted); economic kinds (offer, give, write_book, read_book) first write a prepared receipt. See receipt.schema.json and decision 0020."; `receipt_id`: "The final (committed or aborted) receipt, or null until the action ends." Regenerate (`types.ts` carries the description) and rerun `check:generated`.

2. `contract/test/records.test.ts`: `additionalProperties: false` is tested only for `WorldEvent`. Removing it from `action-record.schema.json` or `receipt.schema.json` leaves every test green. Add one unknown-property rejection test each for `validateActionRecord` and `validateReceipt` (assert the property name appears in an error, as the event test does).

3. `contract/test/records.test.ts`: nullable `intent_id` and `receipt_id` are tested only with valid-or-null values, so replacing the `anyOf` with a bare `{ "type": ["string","null"] }` would pass. Add one failing case each (wrong prefix in `intent_id`, wrong prefix in `receipt_id`).

## Non-blocking notes

- `credits`, `count`, `world_day` have no upper bound while the SQL columns are `INT` (int4). A value above 2147483647 validates but fails the sink insert. Consider `maximum: 2147483647`; not in the packet.
- `thinker_id` is a free 1 to 64 character string; tighten when P0-04 settles the Thinker ID (coder already flagged).
