# 0182: The eat reflex fires only when the Body is starving or badly hurt

- Status: Accepted (owner ruling, 2026-11-14, "Only when starving", given in the geldar-ops session and relayed to the campaign orchestrator, who records it here)
- Date: 2026-11-14
- Amends: the firing rule of the eat reflex in `golem/src/body/reflexes/eat.ts` (spec 5.2 gave "hunger 14 or below"; the health branch used "health below 20 and hunger below 18").

## Context

The eat reflex ate whenever hunger was 14 or below, and also whenever health was below 20 and hunger below 18. In the live Colo run (2026-11-14, 06:55 to 07:15Z), rangers carried food to a starving friend, and the reflex ate that food on the way, at hunger 16 to 17 with health 9 to 18. The friend then arrived with none.

## Decision

Owner ruling, 2026-11-14: the eat reflex fires only when:

1. hunger is 6 or below (`EAT_HUNGER_AT`), or
2. health is 6 or below and hunger is below 18 (`EAT_LOW_HEALTH_AT` and `EAT_REGEN_HUNGER`).

The Body with food and hunger 7 or more, at health above 6, keeps its food. The `eat` action does not change: it still refuses at full food and still applies decision 0168 to rotten flesh.

Decision 0168 is unaffected. Its rule for rotten flesh (only when it is the only food carried, and hunger 6 or below) already uses the same 6, and the reflex asks the same `edibleAtHunger` question before it fires, so it never fires for rotten flesh above hunger 6.

## Consequences

- A Body with food at hunger 7 to 17 and health above 6 no longer eats; it eats when hunger falls to 6.
- A Body at health 6 or below and hunger 7 to 17 eats its ordinary food; if the only food is rotten flesh, the reflex stays silent until hunger is 6 or below.
- The `not_hungry` precondition (hunger above 14) is a separate rule and is not changed by this record.
- The Mind's prompts and allow-list are not changed by this record.
