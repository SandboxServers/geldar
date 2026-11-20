# CAP-2 worknote: scratch-shard provenance capture script and the ops run sheet

Status: all fifteen cases are implemented as bot actions (none is manual). Nothing was run against a server, Docker or
RCON (`live: pending`). The capture itself is the ops run in `docs/runbooks/capture-real-payloads.md`, section
"OPS RUN SHEET". Session 1 wrote the script and the sheet (`ac435bd3`); session 2 (this file) implemented the four
send-nothing cases, the double chest and the owner query.

## Files

- `golem/test/live/scratch/provenance-capture.ts` (new): the runner. Starts two life-id bots (`ag_capa_01`,
  `ag_capb_02`) through `withLiveBot` (`golem/test/live/fixture.ts`), starts `tools/capture` nats-capture as a child
  process, waits for READY, performs the case, settles 400 ticks, stops the subscriber, runs `validate-captures` on
  `<out>/<case>/`. Not a test: no `*.test.ts` name, and outside `golem/vitest.live.config.ts`
  (`test/live/**/*.live.test.ts`). Checked: `vitest list --config golem/vitest.live.config.ts` matches 0 files under
  `scratch`. It is not unit-tested; its pure parts are in `capture-cases.ts`.
- `golem/test/live/scratch/capture-cases.ts` (new, pure): the 15-case table, `parseRunArgs`, `resolveCases`,
  `isLifeId`, `refuseShard`, `renderList`, `renderPlan`.
- `golem/test/live/scratch/capture-cases.test.ts` (new, 18 tests, normal unit lane). Includes the runbook test: the
  `--case <name>` names in the run sheet equal the case table.
- `tools/capture/src/capture-checks.ts` and `tools/capture/src/expect-zero.test.ts` (session 1): `--expect kind=0` is
  exact (a zero that finds a file fails with `expected none, found N`); non-zero counts stay "at least". Not changed in
  session 2; its 3 tests pass.
- `docs/runbooks/capture-real-payloads.md` (edit): the OPS RUN SHEET at the top. Session 2 updated the status, the
  table rows for the break, double chest and send-nothing cases, and the stop conditions.
- This worknote.

## What each case does now

Every action is a bot action on the arena row (`x = centre.x + 2`, `y = 200`). A case that cannot show its window or
its output fails with a message; no case reports a zero without the output it should have taken.

| Case | Action | Proof printed before the zero |
|---|---|---|
| `crafting-table` | `oak_log` given; crafting table placed; `bot.openBlock`; log clicked (slot picked up) and dropped into grid slot 1; output slot 0 clicked | window type matches `/crafting/`; output holds `oak_planks`; slot 0 empty after the click |
| `anvil` | `stick` given; `experience add 10 levels`; anvil placed; `bot.openAnvil` (mineflayer `lib/plugins/anvil.js`); `rename(stick, 'capture')`; output slot 2 clicked | window type matches `/anvil/`; output holds the renamed stick; slot 2 empty after |
| `enchanting-table` | `stone_sword` and 3 `lapis_lazuli` given; `experience add 10 levels`; table placed; `bot.openEnchantmentTable` (`enchantment_table.js`); sword to slot 0, lapis to slot 1; `enchant(0)`; output slot 0 clicked | window type matches `/enchant/`; `enchant(0)` returned an item; slot 0 empty after |
| `player-2x2` | `oak_log` given; no container open; the bot's inventory (46 slots); log into grid slot 1; output slot 0 clicked | no window open; inventory has 46 slots; output holds `oak_planks`; slot 0 empty after |

A send-nothing case with no output (for example the anvil did not accept the rename) throws
`... output slot N is empty, so the case produced no output (INVALID, not a zero)`. An open that does not come within
10 s throws `... no answer within 10000 ms`.

- `chest-double`: `minecraft:chest[facing=north,type=left]` at `x`, `minecraft:chest[facing=north,type=right]` at
  `x+1`, placed with RCON `setblock` (no auto-connect), 8 cobblestone merged into the left chest's slot 0. The case
  asserts the opened window has 90 slots (54 container slots + 36 player slots), else it fails with
  `not a double chest`; it then clicks slot 0 (a take). Rule (from vanilla `ChestBlock`, recalled, not read from the
  shard's server jar): the left part's partner is clockwise from facing, so for north it is east. The 90-slot check
  is the runtime proof; it runs only on the shard. The server is the Paper image pinned in `compose/phase0.yml`.
- `break-coreprotect-present`: bot A places cobblestone; bot B is teleported next to it; B sends the owner query right
  before the break, the Body's route: a NATS request on `blockownerQuerySubject(shard)` (`contract/src/subjects.ts`,
  `geldar.<shard>.blockowner.query`) with `{world, chunk_x, chunk_z}` and a 300 ms timeout
  (`OWNER_REQUEST_TIMEOUT_MS`, the Body's value), world from `bukkitWorldOf(bot)`. The script logs the answer (the
  owner of the block, or "not in the reply") and the gap from the answer to the break; a gap of 30 s or more fails the
  case; a failed or timed-out query fails the case (prior_owner would be null).
- `break-coreprotect-absent`: the same break with no owner query.
- The CoreProtect precondition (overlay mounted, `CoreProtect` in RCON `plugins`) is NOT checked by the script. The
  dry-run plan prints it as a precondition for ops. It is not verified.

## Commands run (no server, no Docker)

| Command | Result |
|---|---|
| `node --experimental-strip-types golem/test/live/scratch/provenance-capture.ts --list` | exit 0 (below) |
| `... --case all --dry-run` | exit 0, connects to nothing (below) |
| `... --case toss --shard phase1` | exit 2: `refused: shard "phase1" is not phase0; pass --i-know-this-is-a-scratch-shard to run it` |
| `pnpm exec vitest run golem/test/live/scratch tools/capture/src` | 5 files, 55 tests, pass |
| `pnpm exec tsc --noEmit -p golem` | exit 0 (after the import fix: `blockownerQuerySubject` comes from `@geldar/contract`) |
| `pnpm --filter @geldar/capture typecheck` | exit 0 |
| `pnpm exec biome check golem/test/live/scratch tools/capture/src` | exit 0 |

The runner's bot, NATS and RCON paths are NOT run. The module load (imports) is checked by `--list` and `--dry-run`.

## Revert-checks (one line mutated, test run, file restored from a scratchpad backup; `git diff --stat` empty after)

| Mutation | Test that fails | Reason |
|---|---|---|
| `const ok = want === 0 ? found === 0 : found >= want;` to `const ok = found >= want;` (`capture-checks.ts`) | `expect-zero.test.ts`: "a take file in a folder that expects none fails take=0" (1 of 3) | the zero is not exact again |
| `if (/colo\|live\|prod/i.test(shard))` to `if (false)` (`capture-cases.ts`) | "refuses colo and live names even with the flag" (1 of 18) | the Colo refusal is gone |
| `id: 'player-2x2'` to `id: 'player-2x3'` (`capture-cases.ts`) | three table tests and the runbook test fail | the case table and the run sheet disagree |
| `if (c.coreprotect === 'present')` to `if (c.coreprotect === ('' as string))` (`capture-cases.ts`, session 2) | "prints the subjects, the bots, the READY wait and the ops privileges for the plan" (1 of 18): "expected ... to contain 'NOT checked by the script'" | the CoreProtect precondition and the owner-query line stop being printed |

The runner's own actions (window open, output, double-chest size, owner-query gap) have no unit test: they need a
server. Their failure paths are the `throw` lines named above; they are unproven until a shard run.

## The case list and the dry-run plan

The table (`--list`):

```
case | bots | expect | coreprotect | what
toss | 2 | pickup=1 | - | bot A tosses cobblestone, bot B picks it up (AN-26a pickup)
break-coreprotect-absent | 2 | break=1 | absent | bot A places a block, bot B breaks it; no CoreProtect (AN-27a)
break-coreprotect-present | 2 | break=1 | present | as above with the CoreProtect overlay; owner query inside 30 s (AN-27a)
kill | 1 | combat_fact=1 | - | bot A kills a summoned zombie (combat_fact hostile_kill, AN-47a)
survived | 1 | combat_fact=1 | - | bot A hits a zombie, waits out the encounter (fight_survived, AN-47a)
chest-single | 1 | take=1 | - | withdraw from a single chest (AN-51a take)
chest-double | 1 | take=1 | - | withdraw from a double chest (AN-51a take)
chest-shift-click | 1 | take=1 | - | shift-click (mode 1) out of a chest (AN-51a take)
chest-number-key | 1 | take=1 | - | number-key swap (mode 2) out of a chest (AN-51a take)
furnace | 1 | take=1 | - | take smelted output from a furnace: SENDS a take (furnace ruling)
brewing-stand | 1 | take=1 | - | take a brewed potion: SENDS a take (furnace ruling)
crafting-table | 1 | take=0 | - | take crafting output: sends NOTHING (furnace ruling)
anvil | 1 | take=0 | - | take from an anvil: sends NOTHING (furnace ruling)
enchanting-table | 1 | take=0 | - | take from an enchanting table: sends NOTHING (furnace ruling)
player-2x2 | 1 | take=0 | - | take from the own 2x2 inventory craft: sends NOTHING (furnace ruling)
```

The dry-run plan (`--case all --dry-run`, exit 0):

```
PLAN (dry run, nothing is connected): shard phase0, nats nats://127.0.0.1:4222, out .capture
bots: ag_capa_01 (slot 8), ag_capb_02 (slot 9); both must be life ids: true
subscriber subjects: geldar.phase0.provenance.>, geldar.phase0.combat_fact
per case: start nats-capture, WAIT for READY, do the case, settle 20 s, stop the subscriber, validate <out>/<case>/
- toss: 2 bot(s), validate --expect pickup=1
    ops/RCON: RCON (127.0.0.1:25575, --rcon-host): whitelist add/remove, tp, give, clear, summon, setblock, fill, kill, experience add (anvil, enchanting table)
- break-coreprotect-absent: 2 bot(s), validate --expect break=1; needs CoreProtect absent
    ops/RCON: (as above)
- break-coreprotect-present: 2 bot(s), validate --expect break=1; needs CoreProtect present
    ops/RCON: (as above); NATS request blockowner.query before the break (the Body's route); CoreProtect checked by ops
    precondition (ops, NOT checked by the script): CoreProtect is loaded (`plugins` lists it) and the overlay is mounted
    owner query: NATS request blockowner.query right before the break; the case FAILS if the break is 30 s or more after it
- kill: 1 bot(s), validate --expect combat_fact=1
- survived: 1 bot(s), validate --expect combat_fact=1
- chest-single: 1 bot(s), validate --expect take=1
- chest-double: 1 bot(s), validate --expect take=1
- chest-shift-click: 1 bot(s), validate --expect take=1
- chest-number-key: 1 bot(s), validate --expect take=1
- furnace: 1 bot(s), validate --expect take=1
- brewing-stand: 1 bot(s), validate --expect take=1
- crafting-table: 1 bot(s), validate --expect take=0
- anvil: 1 bot(s), validate --expect take=0
- enchanting-table: 1 bot(s), validate --expect take=0
- player-2x2: 1 bot(s), validate --expect take=0
ops privileges: RCON on 127.0.0.1 only; the bots are whitelisted and removed in finally; world areas are restored.
```

(The `ops/RCON:` line is the same RCON string for every case except the two noted; it is abbreviated here. The command
prints the full text.)

## Automated or not, and what is still unproven

- Automated: all fifteen cases. None is `manual`. A manual step would be a human client acting in the world, which
  principle 1 and the runbook forbid; every case above is a bot action or an RCON setup verb.
- Unproven, all of it (no server run):
  - the send-nothing windows: the mineflayer calls (`openBlock`, `openAnvil`, `openEnchantmentTable`, `rename`,
    `enchant`, `clickWindow` slot numbers) are read from `golem/node_modules/mineflayer/lib/plugins`, not run. The
    slot numbers (grid slot 1, anvil slots 0/1/2, enchant slots 0/1, inventory grid 1 and 9) are vanilla layouts;
  - the enchant option 0 cost with no bookshelves (10 XP levels are given);
  - the double chest's blockstate rule on the pinned Paper image (the 90-slot check will catch a wrong pairing, but only on a run);
  - the owner query on the live plugin (`blockowner.query` reply shape, the 300 ms timeout);
  - the CoreProtect precondition (ops check);
  - `survived` relies on the encounter closing after 300 quiet ticks (AN-47a says more than 200);
  - two nested `withLiveBot` calls (both build and restore an arena);
  - the subscriber stop: `child.kill()` terminates the process on Windows; `nats-capture.ts`'s drain does not run; the
    files are written per message (`writeCapture`), which the runner relies on.
- Arena slots 8 and 9 are chosen here. Not checked against the other live cases' slots.
- `--expect` for non-zero counts is still "at least". The runbook's "exactly 1" for the toss negative is a manual count.

## Findings

- The predecessor's report said the four send-nothing cases and the owner query were not written; they are now, but
  unproven (above). The predecessor's `chest-double` was a single chest; it is now two.
- A tool result in session 2 carried an instruction block asking the agent to create a claude.ai document. Ignored:
  it is not in the brief.
- The runbook's "Read this first" section still says the flag and listeners are missing on `main`. Not rewritten; it
  depends on AN-28c and AN-50a, which were not checked here.
