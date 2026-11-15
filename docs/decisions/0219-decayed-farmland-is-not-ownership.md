# 0219: Decayed farmland is not ownership

- Status: Decided (owner ruling, 2026-11-14, geldar-93)
- Date: 2026-11-14
- Amends: 0164 (the `till` ownership refusal only; the goto rules are unchanged)
- Relates to: 0165 (the block ownership record), 0167 (the till receipt)

## Context

Farm plots decay. Farmland that is dry, trampled or left uncovered turns back into dirt, and grass can spread over it, with no new block-change row. The CoreProtect record keeps the newest row at that cell, which is the placer's till or place of farmland. So the record names the earlier tiller as owner of a cell that is now plain ground.

Diagnosis (read-only, colo event log, 2026-11-14): one agent's till of a cell completed as farmland at 03:33. About four minutes later another agent's seed place on that cell failed with "seeds need farmland below", because the cell had decayed. The next till of the same cell was refused as "that block is someone else's work". Decision 0164 says tilling is not breaking a build, so a refusal that rests only on an old farmland row is a false refusal.

The owner's ruling: a farmland place row does not count as ownership once the cell is grass or dirt again.

## Decision

`till` does not refuse on ownership when both hold:

1. The record's newest place by a player on the cell was farmland (the record carries that block).
2. The cell now reads as `grass_block` or `dirt`.

In that case the cell is tilled as if no record existed. Any other recorded block, and a record with no block name, is ownership as before.

## What is unchanged

- Planted crops, fences, structures and every other block stay protected by the record (0164, 0165). A cell that now holds a crop, a build or any block other than grass or dirt is refused with the same text.
- A place row for a non-farmland block, such as grass placed by a player, is still ownership.
- The refusal text stays the plain fact: "that block is someone else's work".
- Unknown and unowned records, the bot's own placements (`isOwnPlacement`), and every other `till` rule (tillable blocks, the clear block above, the walk, the confirm) are unchanged.
- The goto protection (0164) and `edit-sign`, `use` and the view's own-placement check still read the record as before.

## Consequences

- The rule needs the record to carry the recorded block. The current block-owner contract (`contract/schemas/block-owner.schema.json`) has no block field, and the plugin's first-row resolver answers only the owner. Until the plugin reply and the Body's cache carry the block, the exemption never applies and `till` refuses as before. The schema and plugin change is a follow-up packet, not part of this decision.
- Cells whose record is missing or only a break row are already allowed; this decision does not change them.
- A cell with no record at all, but refused in diagnosis, is not explained by this rule and needs its own look.

## Revert

Remove the `isDecayedFarmland` exemption from `golem/src/actions/till.ts`. The optional `block` field on `OwnerAnswer` may stay; without the exemption nothing reads it for ownership. The tests in `till.test.ts` under `till: ownership (decision 0164)` for decayed farmland then fail.
