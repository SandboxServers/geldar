# AN-08b worknote: the Body reflexes use the threat policy

Card AN-08b (W2, depends on AN-08a). Branch `phase1/an-08b-threat-reflexes`, from origin/main 4cff991d.

Rulings applied (from `AN-S0.md`):

1. `ThreatPolicy.decide` takes only `{ health, armed, suicideMob }`. `createThreatPolicy` (in `golem/src/body/reflexes/threat-policy.ts`) binds aggression, combat level, the rolls flag and the roller into a closure.
2. `decide` returns psyche's `ThreatCall`; `roll` is psyche's `Roll | null`. The local `unknown` and `string` stand-ins are gone.
3. `LEGACY_THREAT` is `createThreatPolicy` at aggression 3, combat 0, rolls false. `floor()` is `fightFloor(3)` (6) and `fightLimitMs()` is `fightLimitMs(3)` (30000). `threat-policy.test.ts` checks every health 0 to 20 against today's rule (armed, not a suicide mob, health above 6 fights).
4. A health that is not finite flees without a roll (`why: at_or_below_floor`). Tested with NaN, +Infinity and -Infinity.

Encounter memory (`encounter.ts`):

- One open encounter per `BodyView` (a `WeakMap`, as the arrow state is).
- Only a band roll's call is reused. An encounter is the same hostile (same armed and suicide facts) hurting again within `ENCOUNTER_GAP_TICKS` (200 ticks, a sliding window), and health still in the band (floor < health <= floor + 4).
- Every other call (above the band, at or below the floor, unarmed, unarmed exception) is decided again from the current health on each hurt. Under the legacy policy (no rolls) every hurt is therefore today's per-hurt decision.
- The band roll's memory is kept while health is above the band. It is dropped by a different hostile, a changed armed or suicide fact, the window, or a respawn.
- A respawn forgets the open encounter: `forgetThreatEncounter` is called from the `respawn` handler in `create-body.ts`, because the view is reused across lives.
- A null or non-finite world tick keeps no memory, so each such hurt is decided afresh. A world tick that goes backwards ends the encounter.
- Accepted limit: the slot holds one encounter per Body. Two hostiles that alternate hits open a new encounter on each switch, so a band roll can be drawn again.
- A throwing decision opens no encounter.

Factories: `createFightOrFleeReflex`, `createRetreatReflex` and `createCombatReflexes` take `policy` (default `LEGACY_THREAT`). The existing exports (`fightOrFleeReflex`, `retreatReflex`, `combatReflexes`) keep their names and values.

Flee reason: a band-roll flee reports the same text as today's flee (`health low` when armed, `unarmed` otherwise), so the Mind-visible wording does not change.

Not edited: `reflex.ts` (AN-12 wires the policy). The hiss, arrow sidestep and suicide-mob code is unchanged.

Fight watch: `fightHostile` aborts at `policy.floor()` with the same `<=` comparison as before.

For AN-12: the card names no audit hook, and none exists. `threatCallFor` returns the `ThreatCall` (with its `roll`) to the reflex, which reads only `action`. AN-12 can record rolls only inside the `rollAt` it supplies to `createThreatPolicy`; nothing else in the Body sees a roll.
