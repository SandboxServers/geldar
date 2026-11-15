# AN-09a worknote: XP evidence matrix and pure award normalizer

Status: implemented on `phase1/an-09a-xp-matrix` from `origin/main` 203d9af2. Sink only; no writer, no database (AN-10a), no Body code (AN-09b).

## Files

- `eventsink/src/xp/matrix.ts`: `MINING_ITEMS`, `CROP_ITEMS`, `CROP_BLOCKS` (data), plus `isMiningItem` (new export: a listed name, or any name ending `_ore`). Scaffold types kept as `ReadonlySet<string>`.
- `eventsink/src/xp/awards.ts`: `XpAward` and `awardsFor` (signatures unchanged from AN-S0). Adds `BUILDING_XP_SOURCE_AVAILABLE` and `EVIDENCE_KEY_MAX`.
- `eventsink/src/xp/awards.test.ts`: one describe per matrix row, plus source, guard, bounds, malformed-payload cases, and a check that every fixture validates against the contract.
- `eventsink/src/xp/fixtures.ts`: 38 real-shaped events (see Fixtures).

## Decisions and deviations

1. `collected` is a map of item name to count (`{ cobblestone: 2 }`), as `golem/src/actions/mine.ts` emits it: an inventory delta over the whole action. Any pickup during a mine counts, so a stray `pumpkin` pickup while mining stone makes the action a harvest (harvest is checked first). The card's `collected[].item` wording does not match the Body. The card wording should read: "a key of `detail.collected`" (a map of item name to count gained). Owner to confirm.
2. OWNER DECISION: the crop list. `CROP_ITEMS` lists the six names the card gives; the card's `...` is not filled. No further crop item is added without the owner's approval.
3. OWNER DECISION: torchflower and pitcher harvest gap. `CROP_BLOCKS` includes `torchflower_crop` and `pitcher_crop` (sowable), but `CROP_ITEMS` has no `torchflower`, `pitcher_plant`, `sweet_berries`, `cocoa_beans` or `nether_wart`. Those can be sown for XP but never harvested for XP. Owner to add or refuse.
4. The `_ore` rule is a function (`isMiningItem`), because a set cannot express a suffix.
5. Matrix rows are proposed under D-CS-04 and need the owner's approval in the P0 ADR before XP is enabled (AN-10a keeps it off by default).
6. A crop mined awards `harvest`, not `mining`.
7. `give` awards when `detail.to` is a non-empty string. `to` is an in-game username; the event does not carry the agent's own name, so a give to the life itself cannot be detected from the event alone. The self-give test pins that it awards. An empty `to` awards nothing.
8. Building row: OFF. `BUILDING_XP_SOURCE_AVAILABLE = false`. The Body's completed intent event carries no `program` (golem/src/body/executor.ts `setState` passes `intent` only when the state is `accepted`), so the row cannot fire against the real Body. D-CS-04's building row stays off until follow-up card AN-09c (carry `program` on the completed intent event: golem executor and contract intent payload, serial contract slot). Flipping the flag makes the pinned test "no building award today" fail, and the gated rule test then expects one key per completed build intent.
9. Key bounds: every key must be 1 to `EVIDENCE_KEY_MAX` (200) characters, the `xp_evidence` CHECK in `sql/0050`. Chunk indexes must be safe integers within the schema bound (plus or minus 2000000), and the dimension must match the schema pattern.
10. No award is read by any agent path. The module does no logging, so no sheet score reaches a log.

## Fixtures

`fixtures.ts` holds the JSON that `NatsRecordSink` (golem/src/body/records-nats.ts) publishes for each record, captured by running the sink with a fake publisher. Records were built to the shapes the action modules return.

- Intent events follow the Body: `accepted` carries the intent fields (`goal`, `program`, `arguments`, ...); `running`, `completed`, `failed`, `cancelled` carry no intent fields (`failed` carries `detail`).
- Action `args` are `{ do: <kind> }`. The Body sets `args: { ...action }` (golem/src/body/executor-action.ts); only `do` is written here, the other action parameters are not captured.
- Completed mine details carry `hint`, as `golem/src/actions/mine.ts` emits it.
- `chunk_visited` has no builder until AN-09b. Its fixtures are the WorldEvent envelope built with `eventIdFor` and checked with `validateWorldEvent`. They must be recaptured once AN-09b lands.
- `attack` fixtures carry `target_kind` as AN-09b adds it. A kill without it awards nothing (`kill_unlabelled_completed`).
- The awards test validates every fixture against `validateWorldEvent` and the per-type payload validator, so schema drift fails the test.

## Checks

- `node node_modules/vitest/vitest.mjs run eventsink/src/xp`: all pass.
- `node node_modules/typescript/bin/tsc -p eventsink --noEmit`: exit 0.
- Mutations (each fails by name, see the report): building gate removed; `action_outcome` with a `life_id` awarded; chunk `cx`/`cz` swapped; a `CROP_ITEMS`, `MINING_ITEMS` or `CROP_BLOCKS` member removed; key bound removed.

## Open

- OWNER: the `...` crop items, the `collected` wording, and the torchflower/pitcher gap (decisions 1 to 3).
- AN-09c: carry `program` on the completed intent event; then flip `BUILDING_XP_SOURCE_AVAILABLE`.
- AN-10a must reuse `awardsFor` as is and keep `action_outcome` and `receipt` out of the award path.
