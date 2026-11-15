# AN-S0: interface scaffold for the W2 cards

Branch `phase1/an-s0-w2-scaffold`, fast-forwarded from `61343a6b` to `origin/main` `0dcbe0ee` (the branch had no commits of its own). Scaffold only: no file imports these, no existing source file is edited, and psyche/ is untouched.

## Files (path, owning card)

- `golem/src/body/reflexes/threat-policy.ts`: AN-08b. `ThreatPolicy` interface; `LEGACY_THREAT` as `declare const`. The factories are in existing files and are not scaffolded here. No psyche import (AN-08b types the roll as `unknown`).
- `eventsink/src/xp/matrix.ts`: AN-09a. `MINING_ITEMS`, `CROP_ITEMS`, `CROP_BLOCKS` as `declare const ReadonlySet<string>`. The card gives no type; `ReadonlySet<string>` is the scaffold's choice.
- `eventsink/src/xp/awards.ts`: AN-09a. `XpAward`, `awardsFor`.
- `golem/src/body/evidence/chunk-visits.ts`: AN-09b. `ChunkWatchOptions`, `watchChunkVisits`.
- `eventsink/src/xp/ledger.ts`: AN-10a. `XpStore`, `applyAward`.
- `eventsink/src/xp/xp-config.ts`: AN-10a. `xpEnabled`, `xpThresholds` (placement, see conflict 5).
- `eventsink/src/xp/pg-xp-store.ts`: AN-10a. Placeholder (`export {}`): the card names no factory.
- `eventsink/src/xp/outbox.ts`: AN-10b. `LevelPush`, `startOutboxPublisher`.
- `eventsink/src/state/service.ts`: AN-11a. `StateStore`, `serveProficiencyState`; `NatsConnection` is a local stand-in (conflict 7).
- `eventsink/src/state/pg-state-store.ts`: AN-11a. Placeholder (`export {}`).
- `golem/src/character/proficiency-cache.ts`: AN-11b. `StateTransport`, `ProficiencyCache` (methods throw).
- `golem/src/character/runtime.ts`: AN-12. Placeholder (`export {}`): the card describes the runtime but gives no signature.

Not scaffolded: `psyche/*` (AN-08a, excluded). `golem/src/body/reflexes/encounter.ts` (AN-08b): the card describes encounter memory in prose and gives no shape. `eventsink/src/xp/fixtures.ts` (AN-09a): fixtures, not an interface.

## Shape conflicts (listed, not resolved)

1. **Threat decision.** AN-08b `ThreatPolicy.decide({health, armed, suicideMob})` differs from AN-08a `decideThreat(ThreatInput, rollAt)`, which also takes `aggression`, `combat`, `rolls` and the `rollAt` injection. No card says where those bind into the policy. AN-12 `runtime.ts` is described as building the policy but has no signature.
2. **Roll type.** AN-08b `roll: unknown | null`; AN-08a `ThreatCall.roll: Roll | null`.
3. **Reason type.** AN-08b `why: string`; AN-08a `why` is a closed union of five values.
4. **Where `xpEnabled` and `xpThresholds` live.** AN-10a's deliver block puts them in `ledger.ts`; its may-edit line names `xp-config.ts`. Scaffolded in `xp-config.ts`; `ledger.ts` does not re-export them.
5. **CharacterSheet and Score.** Psyche exports `CharacterSheet` and `Score` (`1|2|3|4|5`); the contract's generated types have their own `CharacterSheet` and `Score = number`. AN-11b's `baseline.sheet` and the reply's `ProficiencyState.sheet` name different types. Scaffold uses psyche's type for golem.
6. **`NatsConnection`.** AN-11a's `serveProficiencyState` takes `nats`' `NatsConnection`, but `eventsink/package.json` has no `nats` dependency and AN-11a's may-edit list does not include that file. Scaffold uses a local `object` stand-in marked TODO.
7. **AN-12 plumbing, two routes.** `may-edit` has `create-body.ts` calling `createCombatReflexes(policy)` via `CreateBodyOptions.threat`; `deliver` says the Body "passes `createCombatReflexes(policy)` to the runtime". Internal to AN-12; not resolved.

Agreement checked: `LEGACY_THREAT` (floor 6, 30000 ms) equals `fightFloor(3)` and `fightLimitMs(3)` in AN-08a.

## Shared files (may-edit overlap across W2)

- Exact-path overlap among the may-edit lines of AN-08a to AN-12: **none** (checked by script over every backticked path in the may-edit lines).
- Serialization hints, from may-edit against must-not-edit:
  - `golem/src/body/create-body.ts`: AN-12 may-edit; AN-08b must-not-edit.
  - `eventsink/src/main.ts`, `geldar.ps1`, `compose/*`: AN-12 may-edit; AN-10b and AN-11a must-not-edit.
  - `golem/src/adam/adam-body.ts`: AN-12 may-edit; AN-11b must-not-edit.
  - `golem/src/body/reflex.ts`: AN-08b must-not-edit; not in AN-12.
  - `eventsink/src/xp/` and `eventsink/src/state/`: AN-09a, AN-10a, AN-10b and AN-11a create different files in these directories; no file overlap.
