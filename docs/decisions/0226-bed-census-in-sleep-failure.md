# 0226: The sleep failure states the beds in range and how many are occupied

- Status: Proposed (implementer; owner to accept)
- Date: 2026-11-14
- Amends: the tried-beds failure text of decision 0224 (`golem/src/actions/sleep.ts`); adds `golem/src/actions/sleep-census.ts`; adds fields to `detail` in `golem/src/actions/sleep-detail.ts`

## Context

Agents try seven or eight beds per sleep attempt, with 18 to 19 active agents. A census of the village found 14 beds, about 9 of them inside 32 blocks of the white beds. Whether the shortage is real or an artefact of how the loop reads the beds was not known: the failure text gave the agent the last bed's refusal and the position, but not how many beds the Body could see or how many of them were occupied.

## Decision

(a) A failed sleep from the bed loop states the beds within the search range (`BED_RANGE`, 32 blocks) and how many of them are occupied. The text of the two tried-beds failures (decision 0224) gains `; B beds within 32 blocks, O occupied` before `; ended at X, Y, Z`. The singular reads `1 bed within 32 blocks, 1 occupied`. The whole message stays within 160 characters: the last bed's text is shortened first, and `last: ...` is dropped only when a shortened text would not fit. The census and the position are always kept. The `no bed` failure and the monsters, not-night and other refusals keep their text.

(b) The census counts all complete beds within the range, not only the first `MAX_BEDS` the loop tries. A bed is two blocks; a pair counts once. A bed is occupied when either of its two blocks reports `occupied` true in its block state. A bed with no readable state on either block is counted in `unknown` and is not counted as occupied.

(c) The action log records `detail.beds_in_range`, `detail.beds_occupied` and `detail.beds_unknown` on every failure of the bed loop, next to `final_position` and `beds_tried`. The census is read at the start of the attempt, and again when the loop stops; the end values are reported.

(d) Unchanged: `BED_RANGE` (32), `MAX_BEDS` (8), the order in which beds are tried, the stop rules, and the refusal texts of decision 0225.

## What the figure is, and is not

- The figure is the world's bed state at the time the failure is read. It says how many beds the Body can see within its range and how many the server holds occupied. It says nothing about who is in a bed: an occupied bed may hold an agent, a player or no one at all.
- The range is unchanged. Whether to widen the search range is a separate question for geldar-93 and is not part of this decision.

## Consequences

- The agent reads the census in the failure text. An agent that reads `20 beds within 32 blocks, 20 occupied` has the same information the census gives the operator.
- The action log gains three numbers per bed-loop failure. Each attempt reads the census twice and the loop may add a read on a success; the reads are block lookups within the search range.
- A bed whose state is not readable is counted as not occupied, so the occupied figure can be low when the server does not report state. `beds_unknown` shows how often that happens; the first live failure shows whether it happens at all.
- The census uses the same grouping rule as the bed loop: a block next to a bed's first block is that bed's other half. Two beds side by side are counted as two beds.
