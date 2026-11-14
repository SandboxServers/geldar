# 0168: Rotten flesh may be eaten only when it is the only food and hunger is 6 or below

- Status: Accepted (owner ruling, 2026-11-13, given in the geldar-ops session and relayed to the campaign orchestrator, who records it here)
- Date: 2026-11-13
- Amends: the `BANNED_FOODS` list in `golem/src/actions/eat.ts` (Wave 4 left it open: "Wave 4 refines this list"); no earlier decision record covered what the Body may eat.

## Context

The Body's `eat` action and the eat reflex never pick a food on `BANNED_FOODS`: `rotten_flesh`, `spider_eye`, `poisonous_potato`, `pufferfish`, `suspicious_stew` and `chorus_fruit`. In the live Colo run on 2026-11-13, starving rangers who held only rotten flesh were told "no food", so they stayed hungry while holding something that would feed them. In the game, rotten flesh restores 4 food points with a chance of the Hunger effect. It is an ordinary last resort for a player.

## Decision

Owner ruling, 2026-11-13: `eat` (and the eat reflex) may pick `rotten_flesh` only when:

1. it is the only food the character carries (banned or not, nothing else on the list of edible items is held), and
2. hunger is 6 or below (6 food points or fewer; the bar is at three icons or less).

`spider_eye`, `poisonous_potato`, `pufferfish`, `suspicious_stew` and `chorus_fruit` stay banned in every case.

Above hunger 6, with only rotten flesh carried, `eat` fails with the reason `not_possible` and the plain text `only rotten flesh is carried; it is eaten only when hunger is 6 or below`. The text states a fact about the rule and gives no advice, per decisions 0058 and 0154. With no food at all the existing text for "no food" stays.

## Consequences

- A starving ranger holding only rotten flesh can eat it and may suffer the Hunger effect. The Body's existing eat handling reads the food and health packets as before; no other food is affected.
- The rule lives in the Body (`golem/src/actions/eat.ts` and the eat reflex). The Mind's allow-list and prompts are unchanged.
- The ruling does not tell the Mind which foods are edible. It only decides what the Body will pick or refuse. What a character knows about food stays under decision 0058 and the baseline-knowledge question that is still open.
- If other food is carried, rotten flesh is never chosen, whatever the hunger.
