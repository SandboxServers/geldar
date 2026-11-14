# 0216: The Body eats the food that fits the missing hunger

- Status: Proposed (implementer; owner to accept)
- Date: 2026-11-14
- Amends: the food choice in `golem/src/actions/eat.ts` (the biggest food by food points, decision 0168 kept for rotten flesh)

## Context

In the live runs, the Body's `eat` ate at hunger 14 or more in 25 of 39 meals, and in those meals the food was often larger than the room left, so the bar sat at 20 and the surplus was lost. Picking the biggest food was the wrong rule: the aim is the food that fills the missing hunger with the least waste.

## Decision

The Body picks a food from the items it carries, with `missing = 20 - hunger`:

1. Ordinary foods (not banned, not raw chicken, not golden, not rotten flesh): when some food is no bigger than `missing`, the largest of those; otherwise the smallest food (the smallest overshoot). Ties go to the lower saturation, then the name.
2. Raw chicken (`chicken`), only at hunger 6 or below, and only when no ordinary food is carried. The same fit rule.
3. Golden items (`golden_apple`, `enchanted_golden_apple`, `golden_carrot`), at any hunger below full, after chicken. The same fit rule.
4. Rotten flesh, only at hunger 6 or below, and only when nothing else edible is carried (decision 0168).

Always banned: `spider_eye`, `poisonous_potato`, `pufferfish`, `suspicious_stew`, `chorus_fruit`, and every item whose name ends in `_bucket`.

Unchanged: `not hungry` at hunger 20 or more, and `food did not rise within` when the food level does not rise.

When nothing edible is carried above hunger 6, and raw chicken or rotten flesh is carried, `eat` is refused with `not_possible` and a plain sentence that names only what is carried: `only rotten flesh is carried; it is eaten only when hunger is 6 or below` (rotten flesh alone), `only raw chicken is carried; ...` (chicken alone), `only raw chicken and rotten flesh are carried; they are eaten only when hunger is 6 or below`, and `only rotten flesh and inedible food are carried; rotten flesh is eaten only when hunger is 6 or below` (inedible food is a banned food other than rotten flesh). At hunger 20 or more, `not hungry` is returned before any refusal.

On success the action's outcome carries the detail text `<item>: hunger <before> to <after>` (at most 160 characters), read after the food level rises. The Mind's line ("You ate ...") is built by the contract and is not part of this record.

## Consequences

- The Body waits for a food that fits instead of eating the largest one, so fewer points are wasted at high hunger.
- Golden items are kept for when nothing else is carried. Raw chicken and rotten flesh are the last resorts at low hunger only.
- The eat reflex's gate (`edibleAtHunger`) follows the same tiers, so it fires only when `eat` could pick something.
- The Mind's allow-list and the rendered line are owned by another change; this record does not touch them.
