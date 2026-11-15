# 0331: Phantoms are fought in place

- Status: Decided
- Date: 2026-11-15
- Owner direction: geldar-93, "fix Body survival gaps, facts-only".
- Builds on: 0154 (phantom is an always-hostile mob, so it is a danger), 0191 (cancel on death), 0213 (night reflexes need a threat; dark_shelter and panic_burrow keep their triggers).
- Why: on the night of day 275, three Bodies died to a phantom pack on open ground (ENTITY_ATTACK). Six attacks ended as `timeout` with "the path search ran out of time", because the attack walked toward an airborne target and the path failed. No fight_or_flee trigger fired, since a phantom swoops out of the 4-block cone before the health is read. Fleeing on foot from a flyer does not help, and the shelter reflexes need a block to dig into, which open ground does not give.

## What changes

1. **Attack on a flying mob** (`golem/src/actions/attack.ts`, `phantom` and `bat`). The attack never paths to a flying target. It waits in short steps (2 ticks) and swings as soon as the target is within reach. If it is not within reach for 200 world ticks (10 s), it ends as `out_of_reach` with the text "the phantom was not within reach". No coordinates and no advice. A ground target keeps the walk.
2. **fight_or_flee sees a phantom** (`golem/src/body/reflexes/threats.ts`, `fight-or-flee.ts`). A visible phantom within 16 blocks fires the reflex when the Body is armed and its health is above the policy floor. The reflex runs the `attack` action in place. It does not run on foot, not at the start and not when health falls to the floor mid-fight.

## What does NOT change

- Ground mobs: the hurt trigger (4 blocks, facing, in sight), the armed and floor rules, the flight on foot, and the hiss and arrow triggers are unchanged.
- An unarmed Body does not get the new trigger. A phantom that already hurt the Body within 4 blocks still takes the existing hurt path.
- `dark_shelter` and `panic_burrow` keep their triggers and their conditions (decision 0213). The new trigger does not add any call to them.
- Hostile classification (0154) and the sight rule (0154, ruling 6) are unchanged.
- No sleep, schedule, coaching or world change.

## Rollback

Revert the packet commit. No data, schema or wire format changes, so the revert alone restores the old behaviour.
