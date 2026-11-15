# AN-08a worknote: the pure threat policy in psyche

Status: DONE on phase1/an-08a-threat-policy, base origin/main 61343a6b. Not pushed. Not tagged: `psyche-v1.1.0` is for ops after merge, with owner approval.

## What changed

- `psyche/src/threat.ts` (new): `fightFloor`, `fightLimitMs`, `decideThreat` (pure; the Body supplies `rollAt`).
- `psyche/src/index.ts`: exports the three functions and the `ThreatInput` and `ThreatCall` types.
- `psyche/package.json`: 1.0.0 to 1.1.0. `ENGINE_VERSION` stays 1; `version.ts` is not edited.
- `psyche/RELEASE.json`: regenerated with `node tools/psyche-release/src/cli.ts --write`; `--check` passes. The tag field is `psyche-v1.1.0`.
- `psyche/test/threat.test.ts` (new): floors, limits, band edges, armed and unarmed, suicide mob, legacy equality, exact probabilities by enumeration, `rolls: false` draws nothing.

## Rules as implemented

- Floor = `step(aggression, 6, -2, 2, 14)`: 10, 8, 6, 4, 2 for aggression 1 to 5.
- `health <= floor` flees (`at_or_below_floor`), armed or not.
- Armed, `health > floor + 4`: fights (`above_band`). Inside the band with `rolls: true`: `rollAt('threat', aggression, 11, combat)`, success fights and failure flees (`band_roll`). With `rolls: false` the band is skipped and the Body fights (`above_band`).
- Unarmed, or a suicide mob: flees (`unarmed`), except aggression 5 against a non-suicide mob. That exception rolls `rollAt('threat_unarmed', 5, 14, combat)` (success fights with `unarmed_exception`, failure flees with `unarmed`), or with `rolls: false` fights with `unarmed_exception`.
- Judgement call: an armed suicide mob flees with `why: 'unarmed'`, since the card's type has no separate reason for it.
- Exact chances: the aggression-3 band wins 10, 11, 12, 13 of 20 for combat 0 to 3. The aggression-5 exception wins 279 of 400 (combat 0), the card's "70 percent" (69.75 exactly). The aggression-1 band wins 64 of 400.

## D-CS-05: awaits owner confirmation

The aggression-5 unarmed exception row (fight when `rolls: false`, because the exact chance is about 70 percent) is implemented as the card states. It is not yet confirmed by the owner. Until it is, treat that row as provisional.

## Environment notes

- The worktree runs node_modules through a junction to the main checkout. `pnpm` is not used: the local `./geldar.ps1 pnpm` wrapper is broken, so vitest, tsc and biome run as node scripts.
- `psyche/test/sheet.test.ts` and `psyche/test/temperament.test.ts` fail at import (`@geldar/contract` not resolvable) because workspace links are not installed in this worktree. Not caused by this change.
