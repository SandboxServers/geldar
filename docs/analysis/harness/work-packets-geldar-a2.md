Continues [work-packets-geldar-a.md](work-packets-geldar-a.md), cards GX-01a to AN-04b.
## AN-05: Body and roster loaders: the sheet, config and adoption (Body paths only)

- **id** AN-05 **wave** W1 **depends-on** GX-01b, AN-03a, AN-04b **size** 50k. **branch** `codex/an-05-loaders`.
- **Trim against the original:** `animus/src/config.ts` and the Mind agent store are out. Paths: Adam's Body config, the player Body config, `tools/mcp-tokens` roster creation.
- **may-edit** `golem/src/character/character-config.ts` (new) and `character-config.test.ts` (new); `golem/src/adam/adam-config.ts`; `golem/src/adam/adam-config.character.test.ts` (new); `golem/src/players/player-config.ts` and `player-config.test.ts`; `tools/mcp-tokens/src/players.ts`, `players.test.ts`, `cli.ts`, `cli.test.ts`, `roster.ts` is not touched.
- **must-not-edit** R6; `animus/*`; `threshold/register/*` and the SQL register functions (0010 to 0012: see open items); shard files (AN-07).
- **decisions** D-CS-03, D-CS-05 (assumed: omitted `character` means off); ADR `<allocate via registry>` (P0).
- **shapes.** Shard YAML (read by loaders only; no schema edit):
  ```yaml
  character:                      # omitted = off
    mode: off                     # off | sheet
    rolls: true                   # d20 checks (D-CS-05); read only when mode: sheet
    proficiency: { enabled: true, thresholds: [10, 30, 70] }
  mind: { agent: { character_sheet: { ... } } }              # Adam
  sovereign: { players: [ { player_id: ..., life_id: ..., name: ..., character_sheet: { ... } } ] }
  ```
  ```ts
  export interface CharacterConfig { mode: 'off' | 'sheet'; rolls: boolean; proficiency: { enabled: boolean; thresholds: [number, number, number] } }
  export const CHARACTER_OFF: CharacterConfig;
  export function parseCharacterConfig(block: unknown): CharacterConfig;  // undefined/null -> CHARACTER_OFF; rejects unknown keys and bad thresholds (ascending, positive, integer)
  export interface LifeCharacter { config: CharacterConfig; sheet: CharacterSheet | null; source: 'config' | 'standard' | 'off' }
  export function lifeCharacter(config: CharacterConfig, rawSheet: unknown, lifeId: string, log: (l: string) => void): LifeCharacter;
  ```
  Keys the brief gave to the instinct step (`idle_think_probability`, `max_heuristic_picks`, `failure_hard_cap`, `sanity_check`, `tom`, `morality_hooks`, `drift`) are **tolerated and ignored** by `parseCharacterConfig` with one log line each ("owned by the kit or a later wave"), so an operator may keep the brief's block; any other key throws. `mode: off` gives `sheet: null` even when a non-standard sheet is present. `mode: sheet` with no sheet logs "standard sheet for <life>" and uses `STANDARD_SHEET`. A malformed sheet throws and names the life and field (never repaired). `AdamConfig` gains `character?: LifeCharacter`; `parseAdamConfig` fills it from `root.character` and `mind.agent.character_sheet`; `parsePlayerConfig` passes `entry.character_sheet` through the replacement `mind.agent` it builds (the same place GX-01b passes `harness` and `model`; today that object holds only `username` and `name`, so a sheet would be silently dropped). The MCP's own `sovereign.players` parser (`threshold/mcp/src/config.ts`) ignores unknown entry keys, so the extra key is safe there.
  **Roster creation** (`tools/mcp-tokens`): `SovereignShard` reads `character.mode`; `NewPlayer.characterSheet?: unknown`; `player add ... [--sheet-file <yaml|json>]`. When the shard mode is `sheet`, `addPlayer` writes, in its existing transaction, `agents.character_sheet` (the given sheet, or `STANDARD_SHEET`), `sheet_hash` (SHA-256 of `canonicalSheetJson`, `node:crypto`) and `sheet_adopted_at`, plus one `character_sheet_adoptions` row (`source: 'roster'`, `result: 'adopted'`). When the shard mode is `off` or absent it writes nothing new (`--sheet-file` then errors: "the shard has character mode off"). Invalid sheet: refused before any write.
- **checks** `GATE`; `./geldar.ps1 pnpm test golem/src/character`, `golem/src/adam/adam-config`, `golem/src/players/player-config`, `tools/mcp-tokens/src/players`, `tools/mcp-tokens/src/cli`; parse the real `shards/phase0.yaml` and `shards/colo-mind.yaml` through both loaders (a test, files unchanged, so `character` omitted gives off). The roster tests run against the repo's existing fake `Sql` (`players.test.ts` style); the real-DB `addPlayer` case is an ops lane under `GATE-S`.
- **revert-checks** Make `parsePlayerConfig` drop `character_sheet`: "carries the sheet into the replacement identity" fails. Make `mode: off` keep the sheet: "off yields no sheet even with a non-standard stored sheet" fails. Remove the adoption insert in `addPlayer`: "records adoption in the same transaction" fails.
- **worknote** `.../AN-05.md` **commit** `feat(character): Body and roster loaders for the sheet and character block` **on-cap** R5; split line: `AN-05a` golem loaders, `AN-05b` roster and CLI.

## AN-06a: sink audit projection (rolls, decisions, adoptions)

- **id** AN-06a **wave** W1 **depends-on** AN-04b, AN-02a **size** 45k. **branch** `codex/an-06a-sink-audit`.
- **may-edit** `eventsink/src/audit/projection.ts` (new), `audit/store.ts` (new: `pgAuditStore(db)`), `audit/projection.test.ts` (new), `audit/projection.fakes.ts` (new); `eventsink/src/writer.ts` (the dispatch: one added branch); `eventsink/src/writer.projection.test.ts`; `eventsink/test/audit.it.test.ts` (new, real DB, ops).
- **must-not-edit** R6; `eventsink/src/projection.ts` and its `ProjectionStore` interface (a second store keeps its large fake untouched); `eventsink/src/consumer.ts`.
- **decisions** D-CS-07 (assumed). No number.
- **deliver.**
  ```ts
  export const AUDIT_TYPES: ReadonlySet<string> = new Set(['roll', 'decision', 'sheet_adopted']);
  export interface AuditStore { insertRoll(row): Promise<void>; insertDecision(row): Promise<void>;
    adopt(life: string, sheet: CharacterSheet, hash: string, source: string, sourceEventId: string): Promise<'adopted' | 'same' | 'conflict'>; }
  export async function projectAudit(event: WorldEvent, store: AuditStore): Promise<void>;
  ```
  The writer already runs `projectEvent` inside the batch transaction for `isProjected` events; extend that condition and loop with `AUDIT_TYPES` and `projectAudit(event, pgAuditStore(client))` in the same transaction after the `events` insert.
  Rules: validate the payload (`validateRollEventPayload` etc.); `payload.life_id` must equal `event.agent_id` or the event is rejected with `ProjectionRejectedError('23514', ...)` (poison: the consumer dead-letters it, as for a bad intent); roll and decision inserts are `ON CONFLICT DO NOTHING` (redelivery and a producer retry converge); a `d20` decision whose `roll_event_ids` are missing from `rolls` is stored anyway (arrival order is not guaranteed; no FK on that array); `sheet_adopted`: `adopt` runs `UPDATE agents SET character_sheet = $2, sheet_hash = $3, sheet_adopted_at = now() WHERE agent_id = $1 AND character_sheet IS NULL`; result `adopted` when a row changed, else it compares `sheet_hash` with the stored one: equal gives `same`, different gives `conflict` (baseline untouched); every attempt writes one `character_sheet_adoptions` row. An unknown life (FK failure, SQLSTATE 23503) is the existing poison path (row-by-row retry, dead letter). Bounded policy for an audit backlog: none in the sink; the producer side bounds (AN-06b).
- **checks** `GATE`; `./geldar.ps1 pnpm test eventsink/src/audit`, `eventsink/src/writer`; ops: `$env:GELDAR_IT = '1'; ./geldar.ps1 pnpm test eventsink/test/audit` against a scratch DB (redeliver the same roll twice: one row; kill the transaction mid-batch: no roll row and no event row; malformed roll: dead letter with the reason; second different-sheet adoption: `conflict` row, baseline unchanged). A `Map`-only fake is not accepted as the durability proof.
- **revert-checks** Remove `ON CONFLICT DO NOTHING` on `rolls`: the IT redelivery case fails. Skip the `life_id` equals `agent_id` check: "rejects a payload for another life" fails.
- **worknote** `.../AN-06a.md` **commit** `feat(character): project roll, decision and adoption events in the sink` **on-cap** R5; split line: rolls and decisions first, adoption second.

## AN-06b: the Body's audit producer (stable ids, bounded buffer, gap evidence)

- **id** AN-06b **wave** W1 **depends-on** AN-03b, AN-02a **size** 45k. **branch** `codex/an-06b-audit-producer`.
- **may-edit** `golem/src/character/audit-publisher.ts` (new), `audit-publisher.test.ts` (new); `golem/src/character/audit-events.ts` (new), `audit-events.test.ts` (new).
- **must-not-edit** R6; reflexes, `adam-body.ts` (AN-12 binds it), `golem/src/body/records-nats.ts`.
- **decisions** D-CS-07 (assumed: emergency reflexes proceed, buffer within a fixed limit, emit recoverable gap evidence).
- **deliver.**
  ```ts
  export interface AuditPublisherOptions { publisher: EventPublisher; shard: string; lifeId: string; generation: number;
    tick: () => number; now?: () => Date; maxPending?: number /* default 2000 */; log: (l: string) => void }
  export class AuditPublisher {
    recordRoll(key: DrawKey, roll: Roll, drawIndex: number, inputs?: Record<string, string | number | boolean | null>): string; // returns the decision-less roll event id
    recordDecision(key: DrawKey, d: Omit<DecisionEventPayload, 'life_id' | 'decision_id' | 'engine_version' | 'producer'>): void;
    recordAdoption(sheet: CharacterSheet, hash: string, source: 'config' | 'roster' | 'birth'): void;
    get gaps(): number;  async flush(): Promise<void>;
  }
  ```
  Event ids are stable: `eventIdFor('roll:' + decisionId + ':' + drawIndex)`, `eventIdFor('decision:' + decisionId)`, `eventIdFor('sheet_adopted:' + lifeId + ':' + sheetHash)` (`golem/src/body/derived-id.ts`), so a retry or a Body restart that replays the same key is one event. Every call validates the payload and the envelope (drop and log on failure, never throw), then queues. The call returns at once and never awaits the network (a fleeing Body never waits on audit). Publishing: capped backoff as in `NatsRecordSink.send`; when the queue is at `maxPending` the **oldest** entry is dropped, `gaps` increases, and the next successful publish emits one `decision` event `kind: 'audit_gap'`, `decision_id` `body:<life>:<generation>:<tick>:audit_gap:<n>`, `dropped`, `since_tick` (so a lost stretch is visible). `maxPending` and the drop rule are the recorded D-CS-07 numbers (unmeasured).
- **checks** `GATE`; `./geldar.ps1 pnpm test golem/src/character/audit`. Cases: stable ids (same key twice, one id); a failing then recovering publisher delivers once each; full queue drops the oldest and emits one gap event with the right count; closed or throwing publisher never throws to the caller; a burst of 5000 calls with a hung publisher returns to the caller each time without waiting; a malformed roll is dropped and logged. Real NATS reconnect and a full buffer under JetStream are ops cases in AN-07.
- **revert-checks** Make the queue unbounded: "bounded queue drops the oldest" fails. Use a fresh id per call: "same key gives one id" fails.
- **worknote** `.../AN-06b.md` **commit** `feat(character): Body audit producer with stable ids and gap evidence` **on-cap** R5; split line: events and ids first, queue and gaps second.

## AN-07: foundation wiring, inactive

- **id** AN-07 **wave** W1 **depends-on** AN-05, AN-06a, AN-06b **size** 45k plus ops evidence. **branch** `codex/an-07-wiring`. **Shared-wiring, shard and ACL owner of W1.**
- **Trim against the original:** no Mind startup, no Mind Dockerfile (`animus/Dockerfile.mind` is not touched).
- **may-edit** `golem/src/adam/adam-body.ts` (an optional `character?: LifeCharacter` and `audit?: AuditPublisher` on the env, stored and passed nowhere yet; plus the `sheet_adopted` emission when `character.sheet` is not null), `adam-body.test.ts`; `golem/src/body/reflex.ts` (optional `character?` on `ReflexContext`, unused until AN-08b); `golem/src/players/main.ts` and `golem/src/adam/main.ts` (build `LifeCharacter` from the parsed config and pass it; no behaviour change when off); `shards/phase0.yaml` and `shards/colo-mind.yaml` (a commented sample `character:` block with `mode: off`, and no sheet values: the real values wait on D-CS-10); `threshold/mcp/src/events/audit-types-hidden.test.ts` (new); `tools/repo-checks/src/nats-auth.test.ts` (one added case) or a new `tools/repo-checks/src/nats-auth-character.test.ts` (to confirm which file holds the role table tests).
- **must-not-edit** R6; `geldar.ps1` and `compose/*` (no change is needed: see below); `animus/*`; the Dockerfiles (AN-03a did them).
- **decisions** D-CS-10 (this card merges inactive code only, D-HC-11). No number.
- **findings that shape this card.** (1) The `body` NATS role may already publish `geldar.<shard>.>`, so `roll`, `decision`, `sheet_adopted` and `chunk_visited` need **no ACL edit**; the eventsink reads them through its JetStream consumer. The proof is a test of the generated role table plus an ops case with real roles. (2) The MCP stream consumes an explicit list, `MIND_EVENT_TYPES` in `animus/src/link/mind-event.ts` (via `threshold/mcp/src/events/stream.ts`), so these four types never reach an agent; AN-07 adds the guard test. (3) `threshold/mcp` imports `@geldar/animus` source, so `animus/` cannot be deleted; it is frozen, not removed.
- **deliver.** `adam-body.ts`: when `character?.sheet` is set, emit one `sheet_adopted` via `AuditPublisher.recordAdoption` at start (source `config`); nothing else uses the sheet yet. `audit-types-hidden.test.ts`: assert none of `roll decision sheet_adopted chunk_visited` is in `MIND_EVENT_TYPES` and none is in `streamSubjects('colo')`; a synthetic `roll` envelope fed to `handleStreamMessage` appends nothing to any life's log. ACL test: parse `Get-NatsUsers` output (as `nats-auth.test.ts` does) and assert `body` can publish the four subjects, `mcp` cannot, `mind` cannot. Off test: with `character` omitted `startAdamBody` emits no `sheet_adopted`, builds no `AuditPublisher`, and `stampedPublisher` and reflex wiring are unchanged. With `character` on and a sheet present, the sheet never appears in a log line (`log` spy scan for any score digit pattern from the sheet).
- **checks** `GATE`; `./geldar.ps1 pnpm test golem/src/adam`, `golem/src/players`, `threshold/mcp/src/events/audit-types-hidden`, `tools/repo-checks`; ops: `./geldar.ps1 check` full; images load psyche with the frozen lockfile; a real-NATS run with the actual role credentials: `body` publishes `roll` and a deny case for `mcp`; DB and NATS integration (`GELDAR_IT=1`) before the wave closes.
- **revert-checks** Add `roll` to `MIND_EVENT_TYPES` locally: `audit-types-hidden.test.ts` fails. Make the off path build an `AuditPublisher`: "off builds nothing" fails.
- **worknote** `.../AN-07.md` **commit** `feat(character): inactive wiring for the character block, adoption event and leak guard` **on-cap** R5; split line: `AN-07a` Body wiring, `AN-07b` guard and ACL tests and sample blocks.

---

## Wave W2: Body diversity and proficiency

## AN-08a: the pure threat policy, in psyche

- **id** AN-08a **wave** W2 **depends-on** AN-07, AN-03b **size** 40k. **branch** `codex/an-08a-threat-policy`.
- **may-edit** `psyche/src/threat.ts` (new); `psyche/src/index.ts` (exports); `psyche/src/version.ts` is not edited (`ENGINE_VERSION` stays 1: this adds a function and changes no released behaviour; only the package version moves); `psyche/package.json` (version, to 1.1.0); `psyche/RELEASE.json` (regenerated by `node tools/psyche-release/src/cli.ts --write`); `psyche/test/threat.test.ts` (new).
- **must-not-edit** R6; `golem/*`.
- **decisions** D-CS-05 (assumed per function: threat with `rolls: false` skips the courage band and uses the floor; the aggression-5 unarmed exception is deterministic **fight** when `rolls: false` because the exact chance is 70 percent; `(to confirm)` this row of the truth table with the owner). ADR `<allocate via registry>` (P0).
- **shapes** (brief 5.2; `floor = step(aggression, 6, -2, 2, 14)`; health is out of 20):
  ```ts
  export function fightFloor(aggression: Score): number;          // 10, 8, 6, 4, 2 for 1..5
  export function fightLimitMs(aggression: Score): number;        // Math.round(factor(aggression, 30_000, 1.25))
  export interface ThreatInput { aggression: Score; combat: 0|1|2|3; health: number; armed: boolean; suicideMob: boolean; rolls: boolean }
  export type ThreatCall = { action: 'fight' | 'flee';
    why: 'above_band' | 'band_roll' | 'at_or_below_floor' | 'unarmed' | 'unarmed_exception'; floor: number; roll: Roll | null };
  export function decideThreat(input: ThreatInput, rollAt: (fx: string, score: Score, dc: number, proficiency: 0|1|2|3) => Roll): ThreatCall;
  ```
  Rules: `health <= floor` flees (armed or not). Armed, `health > floor + 4`: fight (`above_band`). Armed, `floor < health <= floor + 4`: with `rolls` true, `rollAt('threat', aggression, 11, combat)` success fights, failure flees (`band_roll`); with `rolls` false the band is skipped and the Body fights (`above_band`, the floor is the fixed threshold). Unarmed (or a suicide mob): flees, except `aggression === 5` and not `suicideMob`: with `rolls` true `rollAt('threat_unarmed', 5, 14, combat)`; with `rolls` false fight; reason `unarmed_exception`. At the standard sheet with `rolls: false` the result equals today's rule (armed and health > 6 fights, otherwise flees). The `rollAt` injection keeps the engine pure: the Body supplies the RNG and records.
- **tests.** Floors 10/8/6/4/2; every aggression against band edges (floor, floor+1, floor+4, floor+5); armed and unarmed; creeper (suicide) never fights even at aggression 5; all-3 with `rolls: false` equals the legacy rule over health 0 to 20 (the legacy rule is written in the test); exact flee and fight probabilities in the band (3 by enumeration with `exactChance`); `rolls: false` calls `rollAt` zero times; `fightLimitMs` 24000, 30000, 37500 around 3 (aggression 2, 3, 4 give 24000, 30000, 37500).
- **checks** `GATE`; `./geldar.ps1 pnpm test psyche/test/threat`; `node tools/psyche-release/src/cli.ts --check` after `--write`; **after merge a new tag `psyche-v1.1.0`** (ops).
- **revert-checks** Replace the floor `step` base 6 with 5: "all-3 equals legacy" fails. Let `rolls: false` call `rollAt`: "rolls false draws nothing" fails.
- **worknote** `.../AN-08a.md` **commit** `feat(character): pure per-life threat policy in psyche` **on-cap** R5; split line: floors and limit first, `decideThreat` second.

## AN-08b: the Body reflexes use the policy

- **id** AN-08b **wave** W2 **depends-on** AN-08a **size** 50k. **branch** `codex/an-08b-threat-reflexes`.
- **may-edit** `golem/src/body/reflexes/threat-policy.ts` (new); `golem/src/body/reflexes/fight-or-flee.ts`; `golem/src/body/reflexes/retreat.ts`; `golem/src/body/reflexes/combat.ts`; `golem/src/body/reflexes/encounter.ts` (new); and the tests `golem/src/body/reflexes/threat-policy.test.ts`, `encounter.test.ts` (new), `fight-or-flee.test.ts`, `retreat.test.ts` (existing, extended).
- **must-not-edit** R6; `golem/src/body/create-body.ts` and `reflex.ts` (AN-12 wires; the policy arrives through a factory argument); the hiss, arrow-sidestep and suicide-mob code in `fight-or-flee.ts` stay as they are (they are physics, not temperament).
- **decisions** D-CS-05 (as AN-08a). No number.
- **why factories.** `fightOrFleeReflex`, `retreatReflex` and `combatReflexes` are module constants read by `enabledReflexes` (`create-body.ts`); nothing per life reaches them. Existing imports must keep working.
- **deliver.**
  ```ts
  export interface ThreatPolicy { floor(): number; fightLimitMs(): number;
    decide(input: { health: number; armed: boolean; suicideMob: boolean }): { action: 'fight' | 'flee'; why: string; roll: unknown | null } }
  export const LEGACY_THREAT: ThreatPolicy;                  // floor 6, 30000 ms, fight iff armed && health > 6: today's behaviour
  export function createFightOrFleeReflex(policy?: ThreatPolicy): Reflex;  // default LEGACY_THREAT
  export function createRetreatReflex(policy?: ThreatPolicy): Reflex;
  export function createCombatReflexes(policy?: ThreatPolicy): readonly Reflex[];
  export const fightOrFleeReflex = createFightOrFleeReflex();  // unchanged exports
  export const retreatReflex = createRetreatReflex();
  export const combatReflexes = createCombatReflexes();
  ```
  `fight-or-flee.ts`: `LOW_HEALTH` and `FIGHT_LIMIT_MS` become `policy.floor()` and `policy.fightLimitMs()`; the `run` decision `trigger.armed === true && ctx.view.health > LOW_HEALTH` becomes `policy.decide(...)`; the health watch inside `fightHostile` aborts at `policy.floor()`. `retreat.ts`: `RETREAT_HEALTH` becomes `policy.floor()`. `encounter.ts`: one courage decision per accepted encounter: an encounter is `(hostile name)` with no hurt for `ENCOUNTER_GAP_TICKS` (200); within an encounter `decide` is called once and its call is reused, so the band cannot be rerolled each hit and the same floor holds through the fight (integration plan 8 rule "no repeated per-tick reroll"). State is per `BodyView` (a `WeakMap`, as `arrowStates` does), cleared on `respawn`/`forgetOldBody` hooks it does not own (it expires by tick instead, so no create-body edit). Two simultaneous lives hold separate state because each Body has its own view.
- **tests.** Default factories behave as the existing tests assert (the existing `fight-or-flee.test.ts` and `retreat.test.ts` pass unchanged: this is the off proof); with an aggression-1 policy an armed Body at health 9 flees where legacy fights; aggression 5 at health 3 fights; the band decision is made once per encounter and reused on the second hurt (draw count 1); a new encounter after the gap decides again; two Bodies, two policies, no shared state; the fight timer uses `fightLimitMs`; abort and timer cleanup still run (existing cases); creeper hiss and arrow sidestep tests unchanged.
- **checks** `GATE`; `./geldar.ps1 pnpm test golem/src/body/reflexes/fight-or-flee`, `retreat`, `encounter`, `threat-policy`, `combat`.
- **revert-checks** Make `decide` rerun per call: "one courage decision per encounter" fails. Hard-code `LOW_HEALTH = 6` again: "aggression 5 fights at health 3" fails. Make the default factory use a non-legacy policy: the existing unchanged tests fail.
- **worknote** `.../AN-08b.md` **commit** `feat(character): fight-or-flee and retreat take a per-life threat policy` **on-cap** R5; split line: factories and legacy proof first, encounter memory second.

## AN-09a: the XP evidence matrix and normalizer (sink, pure)

- **id** AN-09a **wave** W2 **depends-on** AN-07, AN-02b **size** 45k. **branch** `codex/an-09a-xp-matrix`.
- **may-edit** `eventsink/src/xp/matrix.ts` (new: data), `eventsink/src/xp/awards.ts` (new), `eventsink/src/xp/awards.test.ts` (new), `eventsink/src/xp/fixtures.ts` (new, real-shaped event fixtures captured from the Body's builders).
- **must-not-edit** R6; any database or writer code (AN-10a); Body code (AN-09b).
- **decisions** D-CS-04 (assumed; **every row below is proposed and needs the owner's approval in the P0 ADR**). ADR `<allocate via registry>` for the matrix.
- **deliver.**
  ```ts
  export interface XpAward { lifeId: string; domain: Domain; evidenceKey: string; sourceEventId: string; worldTick: number }
  export function awardsFor(event: WorldEvent): XpAward[];   // pure, never throws, [] for anything else
  ```
  The canonical source is the Body's own typed records. The `action_outcome` and `receipt` views of the same action are **not** award sources, so one accomplishment cannot arrive under two keys. Keys carry the type and the stable id.

  | Source event | Qualifies when | Domain | `evidence_key` |
  |---|---|---|---|
  | `action`, `state` completed, `kind` `attack` | `result.detail.killed === true` and `result.detail.target_kind === 'mob'` (AN-09b adds the field; a player target never awards) | combat | `kill:<action_id>` |
  | `action` completed `mine` | `detail.mined >= 1` and a `detail.collected[].item` is in `MINING_ITEMS` (data; unmeasured defaults the owner approves: names ending `_ore`, plus `cobblestone`, `stone`, `deepslate`, `cobbled_deepslate`, `raw_iron`, `raw_copper`, `raw_gold`, `coal`, `diamond`, `emerald`, `lapis_lazuli`, `redstone`) | mining | `mine:<action_id>` (one award per action, not per block, so a 64-block batch is not 64 XP) |
  | `action` completed `mine` | `collected` holds a crop item in `CROP_ITEMS` (`wheat`, `carrot`, `potato`, `beetroot`, `melon_slice`, `pumpkin`, ...) | farming (harvest) | `harvest:<action_id>` |
  | `action` completed `place` | `detail.block` is in `CROP_BLOCKS` (the values of `SEED_CROPS` in `golem/src/actions/place.ts`: crop blocks placed on farmland) | farming (sow) | `sow:<action_id>` |
  | `action` completed `craft` | `detail.crafted >= 1` | crafting | `craft:<action_id>` (one per craft operation, not per item in the stack) |
  | `intent` event, `state` completed | `program === 'build'` | building | `build:<intent_id>` (one per completed structure) |
  | `action` completed `give` | the Body completes `give` only when the recipient picked every tossed item up (`golem/src/actions/give.ts`), so completed means a committed transfer, not a toss; `detail.to` is not the life itself | social | `give:<action_id>` |
  | `chunk_visited` | always (AN-09b emits) | exploring | `chunk:<dimension>:<cx>:<cz>` |

  Not awarded in W2 (no speculative award; named for W8): kept promises, conversation exchanges, observed combat. `till` (present at `a1c6fb2a`) is preparation, not harvest or sow, so it awards nothing (`(to confirm)` with the owner). Failed, cancelled and `ok: false` records award nothing. An `action` event whose `agent_id` differs from `payload.life_id` awards nothing.
- **tests.** Each row: a positive fixture, a failure fixture, a cancel fixture; the same action seen as `action` completed twice (running then completed) yields one key; `action_outcome` and `receipt` fixtures yield no award; a `mine` of 64 blocks yields one award; a player target yields no combat award; a crop mined yields farming, not mining; `chunk_visited` yields one key per chunk and revisits the same key; unknown `kind` gives `[]`; malformed payload gives `[]` (never throws). Fixtures are captured by running the Body's own builders (`NatsRecordSink` test doubles), not hand-typed.
- **checks** `GATE`; `./geldar.ps1 pnpm test eventsink/src/xp/awards`.
- **revert-checks** Award per mined block instead of per action: "one award per mine action" fails. Count `action_outcome` as a source: "outcome and receipt views award nothing" fails.
- **worknote** `.../AN-09a.md` **commit** `feat(character): XP evidence matrix and pure award normalizer` **on-cap** R5; split line: combat, mining, farming rows first; crafting, building, social, exploring second.

## AN-09b: Body evidence producers (first chunk visit, attack target kind)

- **id** AN-09b **wave** W2 **depends-on** AN-07, AN-02b **size** 45k. **branch** `codex/an-09b-body-evidence`.
- **may-edit** `golem/src/body/evidence/chunk-visits.ts` (new) and `chunk-visits.test.ts` (new); `golem/src/actions/attack.ts` and `attack.test.ts` (add `target_kind` to the completed detail).
- **must-not-edit** R6; `golem/src/body/create-body.ts`, `adam-body.ts` (AN-12 attaches the watcher); the contract.
- **decisions** D-CS-04 (assumed). No number.
- **deliver.**
  ```ts
  export interface ChunkWatchOptions { bot: Bot; shard: string; lifeId: string; tick: () => number;
    publish: (event: WorldEvent) => void; now?: () => Date; log: (l: string) => void; maxKnown?: number /* default 20000 */ }
  export function watchChunkVisits(options: ChunkWatchOptions): () => void;   // returns stop()
  ```
  On the bot's movement it computes `cx = Math.floor(x / 16)`, `cz = Math.floor(z / 16)` and the dimension (`bot.game.dimension`; **to confirm** the mineflayer field), keeps a per-run `Set` of `dimension:cx:cz`, and emits one `chunk_visited` WorldEvent per new key. `source_event_id = eventIdFor('chunk_visited:' + lifeId + ':' + dimension + ':' + cx + ':' + cz)`, stable across restarts, so a restart re-walking a known chunk is the same event (the stream deduplicates inside its window; the `events.source_event_id` unique key and `xp_evidence`'s primary key make it permanent). Envelope validated before publish. Cap `maxKnown`: when exceeded, clear the set (a clear can only re-emit identical events). Emits nothing when the position is unknown. `attack.ts`: add `target_kind: 'player' | 'mob'` to the `completed({...})` detail in `afterKill` from the entity's `type` (`'player'` for a player entity, otherwise `'mob'`; **to confirm** mineflayer's `entity.type` values) and carry it in `KillRecord`.
- **checks** `GATE`; `./geldar.ps1 pnpm test golem/src/body/evidence`, `golem/src/actions/attack`. Cases: first entry emits, second entry into the same chunk emits nothing, a new chunk emits, dimension change counts as new, negative coordinates floor correctly (`-1` is chunk `-1`), a restart (fresh set) re-emits the same `source_event_id`, stop removes the listener, `attack` detail carries `mob` for a zombie fixture and `player` for a player fixture.
- **revert-checks** Use `Math.trunc` instead of `Math.floor`: "negative coordinates" fails. Drop the `Set`: "second entry emits nothing" fails.
- **worknote** `.../AN-09b.md` **commit** `feat(character): Body evidence for first chunk visits and attack target kind` **on-cap** R5; split line: chunk watcher first, attack field second.

## AN-10a: exactly-once XP: the evidence ledger and the increment, in one transaction

- **id** AN-10a **wave** W2 **depends-on** AN-09a, AN-04a **size** 45k. **branch** `codex/an-10a-xp-ledger`.
- **may-edit** `eventsink/src/xp/ledger.ts` (new), `ledger.test.ts` (new), `pg-xp-store.ts` (new), `xp-config.ts` (new); `eventsink/src/writer.ts` (one more branch in the existing transaction); `eventsink/src/writer.projection.test.ts`; `eventsink/test/xp.it.test.ts` (new, real DB, ops).
- **must-not-edit** R6; the AN-09a matrix; `eventsink/src/consumer.ts`; the Body cache.
- **decisions** D-CS-04, D-CS-07 (assumed). No number.
- **deliver.**
  ```ts
  export interface XpStore {
    lifeExists(lifeId: string): Promise<boolean>;
    insertEvidence(a: XpAward): Promise<boolean>;                  // INSERT ... ON CONFLICT (life_id, domain, evidence_key) DO NOTHING RETURNING 1
    bump(lifeId: string, domain: Domain, tick: number): Promise<{ xp: number }>; // INSERT ... ON CONFLICT (life_id, domain) DO UPDATE SET xp = proficiency.xp + 1, updated_tick = GREATEST(...) RETURNING xp
    setLevel(lifeId: string, domain: Domain, level: 1|2|3): Promise<void>;
    totalXp(lifeId: string): Promise<number>;
    enqueueLevel(lifeId: string, domain: Domain, level: 1|2|3, xp: number, version: number): Promise<void>; // INSERT ... ON CONFLICT (life_id, domain, level) DO NOTHING
  }
  export async function applyAward(store: XpStore, award: XpAward, thresholds: readonly [number, number, number]): Promise<{ awarded: boolean; level: number | null }>;
  export function xpEnabled(env: NodeJS.ProcessEnv): boolean;      // GELDAR_XP === '1'; default OFF
  export function xpThresholds(env: NodeJS.ProcessEnv): readonly [number, number, number]; // GELDAR_PROFICIENCY_THRESHOLDS "10,30,70" else DEFAULT_THRESHOLDS from psyche
  ```
  `applyAward` runs inside the writer's transaction, after the `events` insert, for each `awardsFor(event)` result. It inserts the evidence first; only when that insert **returned a row** does it `bump`; a redelivered or second-source accomplishment inserts nothing and bumps nothing (a plain `xp = xp + 1` per delivered event would double on redelivery; the writer invokes projections for every input event, even duplicates). If `levelForXp(xp)` rose, it `setLevel`s and `enqueueLevel`s with `version = totalXp`. An unknown life (`lifeExists` false, for example Adam without an `agents` row) counts `xp_skipped_unknown_life` in a log line and awards nothing, rather than raising an FK error that would dead-letter the event. With `xpEnabled` false (the default) `applyAward` is never called: **XP counting is off until ops sets `GELDAR_XP=1`**, and history is not backfilled. Thresholds come from psyche `DEFAULT_THRESHOLDS` and an env override (the sink has no shard file: see open items).
- **checks** `GATE`; `./geldar.ps1 pnpm test eventsink/src/xp/ledger`, `eventsink/src/writer.projection`; ops `$env:GELDAR_IT = '1'; ./geldar.ps1 pnpm test eventsink/test/xp`: duplicate delivery gives one XP; reordered `running`/`completed` records give one; two sources of one accomplishment give one; two concurrent transactions awarding different keys give two (no lost update); rollback after the evidence insert leaves no evidence and no XP; first, last, and past-threshold levels (9 to 10, 29 to 30, 69 to 70) enqueue exactly one outbox row each; a poison event follows the existing dead-letter path; an unknown life is skipped, not poisoned.
- **revert-checks** Bump `xp` without checking the evidence insert's result: the IT duplicate case and the unit "redelivery adds nothing" fail. Move `enqueueLevel` before `setLevel`'s guard: "one outbox row per level" fails.
- **worknote** `.../AN-10a.md` **commit** `feat(character): exactly-once XP ledger and increment in the sink transaction` **on-cap** R5; split line: ledger and increment first, levels and outbox second.

## AN-10b: level publication and reconciliation

- **id** AN-10b **wave** W2 **depends-on** AN-10a **size** 40k. **branch** `codex/an-10b-xp-outbox`.
- **may-edit** `eventsink/src/xp/outbox.ts` (new), `outbox.test.ts` (new); `eventsink/test/xp-outbox.it.test.ts` (new, ops).
- **must-not-edit** R6; `eventsink/src/main.ts` (AN-12 starts it); `geldar.ps1` (AN-12: the eventsink role needs publish on `geldar.<shard>.state.>`).
- **decisions** D-CS-04 (assumed). No number.
- **deliver.** A level change must reach the Body even if the process dies between the database commit and the publish. The outbox row is the durable record (written in AN-10a's transaction); this card publishes after commit and reconciles.
  ```ts
  export interface LevelPush { publish(subject: string, body: string): void }       // core NATS publish
  export function startOutboxPublisher(o: { pool: Pool; push: LevelPush; intervalMs?: number /* default 2000 */; batch?: number /* default 100 */; log: (l: string) => void }): { stop(): Promise<void>; drainOnce(): Promise<number> };
  ```
  `drainOnce`: in a transaction, `SELECT ... FROM proficiency_outbox o JOIN agents a ON a.agent_id = o.life_id WHERE o.published_at IS NULL ORDER BY o.outbox_id LIMIT $1 FOR UPDATE SKIP LOCKED` (the shard comes from `agents.shard`, so the sink needs no shard setting); for each row `push.publish(proficiencyPushSubject(shard, life_id), JSON.stringify(ProficiencyLevelPayload))` validated with `validateProficiencyLevelPayload`; then `UPDATE ... SET published_at = now()`. A crash after the publish and before the update republishes the row: delivery is at least once, and the receiver is monotonic (AN-11b), so a duplicate is harmless. The same loop is the reconciliation: every unpublished row is retried each interval, so a NATS outage only delays pushes (the request path, AN-11a, is the source of truth). The push is never a WorldEvent, so it cannot feed back into XP (the discriminator is the subject: `state` subjects are not in the stream filter).
- **checks** `GATE`; `./geldar.ps1 pnpm test eventsink/src/xp/outbox`; ops `GELDAR_IT=1`: crash between commit and publish (kill the publisher after `publish` and before the update) republishes once more; transient NATS failure keeps the row unpublished and succeeds later; two publishers do not double-claim a row (`SKIP LOCKED`); a payload failing the contract is logged and left unpublished with a counter, not deleted.
- **revert-checks** Mark `published_at` before publishing: the crash case fails. Drop `SKIP LOCKED`: the two-publisher case fails.
- **worknote** `.../AN-10b.md` **commit** `feat(character): publish and reconcile proficiency level changes` **on-cap** R5; split line: drain first, interval loop second.

## AN-11a: the proficiency state service (sink side)

- **id** AN-11a **wave** W2 **depends-on** AN-10b, AN-02b **size** 45k. **branch** `codex/an-11a-state-service`.
- **may-edit** `eventsink/src/state/service.ts` (new), `service.test.ts` (new), `pg-state-store.ts` (new); `eventsink/test/state.it.test.ts` (new, ops, real NATS roles).
- **must-not-edit** R6; `eventsink/src/main.ts`, `geldar.ps1`, `compose/*` (AN-12); the Body.
- **decisions** D-CS-04, D-CS-03 (assumed: the reply carries the adopted baseline, R-sheet). No number.
- **deliver.**
  ```ts
  export interface StateStore { read(lifeId: string): Promise<ProficiencyState | null> }   // null: no agents row
  export function serveProficiencyState(o: { nc: NatsConnection; store: StateStore; shard: string; log: (l: string) => void; minIntervalMs?: number /* default 1000 per life */ }): { stop(): Promise<void> };
  ```
  Subscribes to `geldar.<shard>.state.*.proficiency` (five tokens; the role's `geldar.<shard>.state.>` allow, added by AN-12). For each request: reject a body over 256 bytes; parse the life id from the subject and validate it with the contract pattern (a bad one gets no reply); apply a per-life minimum interval (an over-rate request gets `{"error":"rate"}`); `store.read` returns the seven levels from `proficiency` (zeros when no rows), `version = sum(xp)`, and the adopted `sheet` and `sheet_hash` when `agents.character_sheet` is set; the reply is validated with `validateProficiencyState` before it is sent; an unknown life answers `{"error":"unknown_life"}`; a database error answers `{"error":"unavailable"}` (the Body then uses its degraded default). The subject carries the life id, and roles are not scoped per life (`Get-NatsUsers` says so), so **any Body role can ask for any life's state**: this is an open item, not solved here.
- **checks** `GATE`; `./geldar.ps1 pnpm test eventsink/src/state/service`; ops with real roles: a `body` credential gets a reply; an `mcp` credential's request is refused by the server (no publish right on `geldar.<shard>.state.>`); a wrong-shard request gets no reply (no subscription).
- **revert-checks** Compute `version` from a row count instead of `sum(xp)`: "version is strictly monotonic with XP" fails. Skip response validation: "reply validates against the contract" fails on a deliberately corrupted store.
- **worknote** `.../AN-11a.md` **commit** `feat(character): sink service for proficiency state requests` **on-cap** R5; split line: read model first, NATS service second.

## AN-11b: the Body's proficiency cache

- **id** AN-11b **wave** W2 **depends-on** AN-07, AN-02b, AN-03b **size** 45k. **branch** `codex/an-11b-body-cache`.
- **may-edit** `golem/src/character/proficiency-cache.ts` (new), `proficiency-cache.test.ts` (new).
- **must-not-edit** R6; the reflexes; `adam-body.ts` (AN-12); no `pg` import in `golem/src` (Golem has no Postgres; a test greps for it).
- **decisions** D-CS-04, D-CS-07 (assumed: zero proficiency until a fresh state arrives, record degraded, keep a previously validated newer cache across reconnects; emergency reflexes never wait on this). No number.
- **deliver.**
  ```ts
  export interface StateTransport {
    request(subject: string, body: string, timeoutMs: number): Promise<string>;     // rejects on timeout or no responders
    subscribe(subject: string, onMessage: (body: string) => void): () => void;      // returns unsubscribe
  }
  export class ProficiencyCache {
    constructor(o: { transport: StateTransport; shard: string; lifeId: string; thresholds?: readonly [number, number, number];
      timeoutMs?: number /* 2000 */; attempts?: number /* 3 */; retryMs?: number /* 15000 */; log: (l: string) => void });
    async start(): Promise<void>;                       // subscribe first, then request; never throws
    level(domain: Domain): 0 | 1 | 2 | 3;               // always answers, from memory
    get version(): number;  get degraded(): boolean;  get baseline(): { sheet: CharacterSheet; hash: string } | null;
    refresh(): Promise<void>;                           // used on reconnect
    stop(): void;                                       // unsubscribes, cancels the retry timer
  }
  ```
  Rules: subscribe to the push subject **before** the first request, so a level change during start is not lost. A state (reply or push) is accepted only if `version >= this.version` and it validates (`validateProficiencyState` or `validateProficiencyLevelPayload`); an older or equal-version message is ignored, never downgrading a reconnected cache. After `attempts` failures it stays `degraded: true` with zeros, logs once, and retries every `retryMs` (bounded, cancelled on `stop`). `level()` never blocks. The cached `baseline` is the adopted sheet from the reply (R-sheet), used by AN-12 in preference to the config sheet.
- **checks** `GATE`; `./geldar.ps1 pnpm test golem/src/character/proficiency-cache`. Cases: cold start, reply sets levels; no responder gives degraded zeros and a retry; a stale reply after a newer push is ignored; a level-up push during a reconnect refresh is kept; equal version is ignored; timeout and cap behave (3 attempts then stop trying until `retryMs`); `stop` unsubscribes and cancels the timer (a spy transport); an invalid reply is ignored and logged; no `pg` import.
- **revert-checks** Accept any version: "a stale reply never downgrades" fails. Subscribe after the first request: "a push during start is not lost" fails.
- **worknote** `.../AN-11b.md` **commit** `feat(character): Body proficiency cache with monotonic versions` **on-cap** R5; split line: cache first, retry and degraded handling second.

## AN-12: Body and learning integration, inactive by default

- **id** AN-12 **wave** W2 **depends-on** AN-08b, AN-09b, AN-10b, AN-11a, AN-11b **size** 50k plus a serial ops run. **branch** `codex/an-12-integration`. **Shared-wiring, shard, ACL and image owner of W2.**
- **may-edit** `golem/src/adam/adam-body.ts` and `adam-body.test.ts`; `golem/src/body/create-body.ts` (`enabledReflexes(config, character?)` and a `CreateBodyOptions.threat?: ThreatPolicy`, handed to `createCombatReflexes`); `golem/src/body/restart.ts` (only to pass the option through `RestartBodyOptions`, which extends `CreateBodyOptions`); `golem/src/adam/main.ts`, `golem/src/players/main.ts` (build the `StateTransport` from the host's NATS connection and a `ProficiencyCache`); `golem/src/character/runtime.ts` (new: builds the `ThreatPolicy` from the sheet, `rolls`, the cache's combat level, `rngFor`, `AuditPublisher`), `runtime.test.ts` (new); `eventsink/src/main.ts` (start the state service and the outbox publisher, and wire `applyAward` when `xpEnabled`); `geldar.ps1` (`Get-NatsUsers`: `eventsink` Pub and Sub gain `geldar.$s.state.>`, `body` Sub gains `geldar.$s.state.>`); `compose/colo.yml` and `compose/phase0.yml` (eventsink env `GELDAR_SHARD`, `GELDAR_XP`, `GELDAR_PROFICIENCY_THRESHOLDS`, all unset by default; to confirm the eventsink service has no shard env today); `shards/phase0.yaml` (a **disposable fixture block** is added only under a new shard file `shards/character-fixture.yaml` (new), never the live ones); `tools/repo-checks/src/nats-auth*.test.ts` (extend); the focused live fixtures under `golem/src/live-*.test.ts` names `(to confirm)`.
- **must-not-edit** R6; `animus/*`; `shards/colo-mind.yaml` (the live Colo; no activation, D-HC-11, D-CS-10); `docs/*`.
- **decisions** D-CS-10 (reviewable activation proposal only: this card ships inactive, **never turns on the Colo**). No number.
- **deliver.** With `character.mode: sheet`: the Body builds `character/runtime` from `LifeCharacter` (sheet from the cache's adopted baseline when present, else the config sheet; `rolls` from config), passes `createCombatReflexes(policy)` to the runtime, attaches `watchChunkVisits` (publish through the stamped publisher), starts the `ProficiencyCache` (request on start, refresh on reconnect), and records every threat roll or deterministic decision through `AuditPublisher` with a `DrawKey` whose `generation` is the Body's generation (so restarts never replay a draw). With `mode: off` or no `character`: none of that is built, the reflex list is `combatReflexes` as today, no chunk watcher, no cache, no events. Eventsink: starts the state service and outbox publisher only when `GELDAR_SHARD` is set; `applyAward` only when `GELDAR_XP=1`. The ACL edit gives the sink publish and subscribe on the shard's `state` subtree and the Body subscribe on it; nothing else widens (`mcp`, `mind`, `kino`, `paper` unchanged; a test asserts each).
  Frozen treatment fixtures (files only, for the W12 cohort and the ranger activation proposal): `shards/character-fixture.yaml` with three Bodies, an all-3 sheet, an aggression-1 sheet and an aggression-5 sheet, and `rolls: true`. A reviewable "ranger activation proposal" is a worknote table of proposed sheets and flags; no value is applied.
- **checks** `GATE`; `./geldar.ps1 pnpm test golem/src/adam`, `golem/src/body`, `golem/src/character`, `golem/src/players`, `eventsink`, `tools/repo-checks`. **Ops, serial, wave close:** full `./geldar.ps1 check` with the integration floor; disposable fixtures on a scratch stack (never `adam up`): a sovereign Body and a second Body earn and reload the same domain level (kill a Body mid-fight and mid-award: no evidence lost, no double XP on restart); the aggression-1 and aggression-5 Bodies show different nerve at the same health; `mode: off` shows the old behaviour and zero new events; `./geldar.ps1 bench` 20 TPS gate; the live lane `./geldar.ps1 pnpm --filter @geldar/golem test:live` (8B only, serial); Adam's `agents` row must exist (see open items). `GELDAR_IT=1 ./geldar.ps1 pnpm test eventsink`.
- **revert-checks** Always build `createCombatReflexes(policy)` even when off: "off builds the legacy reflex list" fails. Drop the cache's version check at the wiring: "stale push after restart" fails. Remove the sink ACL line: the repo-checks role test "eventsink may publish and subscribe on the state subtree" fails.
- **worknote** `.../AN-12.md` **commit** `feat(character): bind threat policy, evidence and proficiency cache to the Body, inactive by default` **on-cap** R5; split lines: `AN-12a` Body wiring, `AN-12b` sink wiring, ACL and fixtures.

---

## Open items

**Not verified (marked in the cards)**
- Kit field names `harness` and `model` (HC-04): working names only. How the kit's per-waking model reaches the world is undefined; until then the model is operator-declared (GX-01c).
- Generator support for `if/then` in a schema (AN-02a), the exact pnpm 12 lockfile flags (AN-03a), mineflayer's `bot.game.dimension` and `entity.type` values (AN-09b), the file that holds the NATS role-table tests and the live-lane file names (AN-07, AN-12), whether the eventsink compose service has a `GELDAR_SHARD` env (AN-12), the eventsink Postgres role (every service connects as the owner today; role denial for the sink cannot be proven), the `export:` format of the C7 own-rows export (AN-04b), the owner's approval of the matrix rows, `MINING_ITEMS` and the unarmed-exception row of the D-CS-05 table.

**Differences between the original plan (`8eac28ba`) and `origin/main` (`907f5b8a`, head `a1c6fb2a`)**
1. `origin/main` moved during this work to `a1c6fb2a` (the `till` action only, `golem/src/actions/till.ts`).
2. `body-api/v7` now exists (till, decision 0167); the original W7 plan took v7. Thought v6 and v7 are still unused on main but reserved. Decisions 0180 and 0181 exist (the context window is 8704, not 8192, which matters to the kit's budgets, not these cards).
3. SQL: 0024 to 0027 and 0032 to 0034 are on main (0028 to 0031 are missing); 0035 and 0036 and decisions 0169 and 0173 are on in-flight branches. The original "0033/0034 free" reading is wrong; 0037 and up is the recommendation.
4. `contract/schemas/shard-config.schema.json` validates only the flat colo budget keys, not the `mind`, `sovereign`, `chat` blocks: the `character:` block has no schema, only loaders (the original plan assumed a schema edit might be enough and said it was not).
5. `parsePlayerConfig` rebuilds `mind.agent` from only the username and name, so a per-player sheet, `harness` or `model` key is dropped unless passed through explicitly (AN-05, GX-01b).
6. Supervisor-created Body containers (`supervisor/src/docker.ts`) set `GELDAR_LOGIN_NAME`, but nothing in `golem/` reads it at `907f5b8a`: the owner-created Body path has no config consumer to wire. The only Body hosts with per-player config are `players/main.ts` (reads `sovereign.players[]` from the shard file) and `adam/main.ts`. Not solved here.
7. `WorldEvent` already has `thinker_id`, and `events` already has the column; the stamp follows that precedent.
8. `fightOrFleeReflex`, `retreatReflex` and `combatReflexes` are module constants: AN-08b converts them to factories while keeping the exports.
9. `attack` can target a player by name (`findTarget`), so combat XP needs a `target_kind` field the Body does not record today (AN-09b).
10. `threshold/mcp` imports `@geldar/animus` source (`mind-event.ts`, `classify.ts`) and the admin image copies `animus/`: the "abandoned" `animus/` package stays in the repo, frozen.
11. Adam's `agents` row is created by the Mind (`animus/src/memory/pg-memory-store.ts` `ensureAgent`). With the Mind off, Adam's Body has no row, so every audit and XP table (all keyed to `agents`) would reject its rows. W2 fixtures use sovereign players, or ops inserts Adam's row; `applyAward` skips an unknown life instead of poisoning.
12. `REFLEX_NAMES` now includes `dark_shelter` and `unstick`; `parseReflexConfig` rejects unknown keys, which is why `character` is a separate top-level block.
13. SQL grants are column-level everywhere: new columns reach no role until granted, and `geldar_mcp` could not read `agents.declared_model` (GX-01a grants it).
14. The campaign folder `docs/analysis/character-sheet/` is not on `origin/main` (untracked in the Codex worktree at `8eac28ba`); the worknote paths need it created (P0).

**Top risks**
- The HC-04 name reconciliation (GX-01a, GX-01b, GX-01c, and the kit's `psyche` mirror depend on it).
- Generated-file merge order: GX-01a, AN-02a and AN-02b must merge strictly serially, or `contract/src/generated/*` conflicts.
- `adam-body.ts` is touched by GX-01b, AN-07, AN-12 (and later waves): the order above is the only safe one.
- Any later edit to `psyche/src/` without `--write`, a version bump and a new tag breaks the kit's mirror test (GX-02 makes CI fail first, by design).
- Sheet truth on the world database: `events.payload` of `sheet_adopted` and the `agents` columns hold true sheets; the leak guards are the Glass column grants, the `MIND_EVENT_TYPES` guard test (AN-07) and the Body-only state subject. The state subject is not scoped per life (open item below).

**Decisions or tasks left to the owner or orchestrator**
- Per-life scoping of the state subject: static NATS roles cannot scope by life, so any Body credential may ask for any life's state and baseline sheet. Acceptable only while all Bodies are ours; flag before bring-your-own-body.
- Where eventsink gets its XP thresholds (env override now; the brief says shard setting). Recommend mounting the shard file read-only into the sink.
- Self-registered creation (`register_create_player`, 0010 to 0012) leaves `agents.character_sheet` NULL; a NULL baseline is "not adopted" and the first Body start adopts its config or standard sheet. Changing the definer functions is a separate migration if the owner wants adoption at birth.
- `pack` of a release tarball is not built; the artifact is the tag plus `psyche/RELEASE.json`.
- Plugin-published events that carry an `agent_id` (the Java `EventExporter`: damage, death and the like) are **not** stamped by GX-01; the cohort report joins them on `agents.harness` and `declared_model`. A sink-side fill from the `agents` row is the follow-up (a GX-01d) if the owner wants every row stamped.

## GX-08: non-advancing wait (`peek`) for the instinct (world)

- **Repo** geldar. **Branch** `phase1/gx-08-wait-peek`. **Depends on** GX-06 (the instinct class is read from the connection). **Contract** serial slot from geldar-3b (regenerates `contract/src/generated`). **Size** about 35k. **Status** Proposed. **Number**: GX-07 is already the BlueMap card in `work-packets-turn-record.md`, so this card takes GX-08.
- **Why.** `threshold/mcp/src/tools/wait.ts` calls `rememberDelivered` on every wait (about line 296), and a new wait replaces an open one (`state.open`, `'wait_replaced'`, about line 189). An instinct wait between model sessions therefore advances the life's shared delivered mark and ends an open model wait, which can hide events from the model's later cursorless wait.
- **Do.**
  - `contract/schemas/mcp-play.schema.json` (`WaitInput`): optional `peek`, boolean, default false, additive. Regenerate.
  - `wait.ts`: when `peek` is true and the connection is the instinct class, the call returns events after the given cursor and has no side effects: no `rememberDelivered`, no `lastWakeMs`, no replace or end of an open wait.
  - `threshold/mcp-mock/src/registry.ts`: the mock honours the same contract.
- **Gate (decided here, owner or geldar-93 to confirm).** `peek` works only for the instinct class from GX-06's keyed header. A model cannot send the key, so it cannot use `peek` to skip delivered accounting. A model connection that sends `peek: true` gets an ordinary wait with no error, so no error text reveals the class (0059, 0068). Recommend no `peek` for the model class at all.
- **Prove.** Tests that fail when the branch is reverted: an instinct peek leaves the delivered mark and an open wait untouched; a non-peek wait still advances the mark and replaces an open wait; a model-class `peek: true` acts as an ordinary wait; the peek returns the events after the cursor. Revert the `wait.ts` peek branch and the first test fails.
- **Kit consequence.** HC-18 `observe.ts` then sends `peek: true` on instinct waits. That is a follow-up kit card for scriptorium-orchestrator, not part of GX-08.
- **Must not.** Change the default of `peek`, the model wait semantics, or the GX-06 header check; edit `docs/spec.md`. **Needs geldar-93's go** (MCP change).
