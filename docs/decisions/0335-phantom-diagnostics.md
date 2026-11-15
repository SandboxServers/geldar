# 0335: Phantom diagnostics (operator log only)

- Status: Decided (owner-side ruling via geldar-93, diagnostics only)
- Date: 2026-11-15
- Builds on: 0331 (phantoms are fought in place), 0154 (a phantom is a hostile), 0213 (dark_shelter and panic_burrow keep their triggers).
- Why: Colo events 10:22Z to 14:01Z on 2026-11-15 (ag_colo_01 excluded): 12 deaths, all ENTITY_ATTACK. The 0331 phantom trigger left no reflex row in that window, and attack outcomes do not record the target, so it could not be told whether swings reached phantoms. The next night needs the trigger's reason and the target of each attack before any change is chosen.

## What changes

1. `phantom_diag` operator line (`golem/src/body/reflexes/phantom-diag.ts`, called from the phantom trigger in `fight-or-flee.ts`). At each evaluation of the phantom trigger, when a phantom is listed within 24 blocks, one JSON line goes to the Body's own log, at most one per 5 s per Body. Fields: armed, health, armed_cutoff, reason (health_too_low, no_weapon, not_in_range, fired, other), weapon carried, phantoms_24, nearest_phantom, others_16 (non-phantom hostiles within 16), in_open (no block in the 3 cells above the head), tick.
2. `attack_diag` operator line (`golem/src/actions/attack.ts`). When an attack starts on a found target, one JSON line: the target name (the name the attack was asked for), the entity name it matched, its distance and the target kind. At most one line per bot (one bot per Body connection) per 2 s; an attack call inside that window writes nothing, and a call that fails before the swing starts (for example an equip error) writes nothing and does not start the window.
3. An optional view read, `roofWithin` (`golem/src/body/view.ts`), used only for in_open.

## What does NOT change

- No agent-visible text, no contract or wire change, no action_outcome field.
- No behaviour change: the trigger rules, the armed floor, the attack, flight, shelter and sleep are as before.
- Held for later: option (2), shelter at low health, and option (3), a change to the armed cutoff. Both wait for the next night's numbers from these lines.

## Limits of the lines

- `cooldown` and `not_visible` are never written: the runner skips `check` during a cooldown, and the view lists only hostiles in sight.
- No phantom_diag line is written when a hurt, hiss or arrow trigger answers first, since the phantom trigger is then not evaluated.
- "weapon" is the weapon carried; the view has no held-item read.

## Rollback

Revert the packet commit. No data, schema or wire format changes, so the revert alone restores the old behaviour.
