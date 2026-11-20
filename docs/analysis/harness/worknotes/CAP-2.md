# CAP-2 worknote: scratch-shard provenance capture script and the ops run sheet

Status: code and docs written; nothing run against a server or Docker (`live: pending`). The capture itself is the ops
run in `docs/runbooks/capture-real-payloads.md`, section "OPS RUN SHEET".

## Files

- `golem/test/live/scratch/provenance-capture.ts` (new): the runner. Starts two life-id bots (`ag_capa_01`,
  `ag_capb_02`) through `withLiveBot` (`golem/test/live/fixture.ts`), starts `tools/capture` nats-capture as a child
  process, waits for READY, performs the case, settles 400 ticks, stops the subscriber, runs `validate-captures` on
  `<out>/<case>/`. Not a test: no `*.test.ts` name, and outside `golem/vitest.live.config.ts`
  (`test/live/**/*.live.test.ts`). Checked: `vitest list --config golem/vitest.live.config.ts` matches 0 files under
  `scratch`.
- `golem/test/live/scratch/capture-cases.ts` (new, pure): the 15-case table, `parseRunArgs`, `resolveCases`,
  `isLifeId`, `refuseShard`, `renderList`, `renderPlan`.
- `golem/test/live/scratch/capture-cases.test.ts` (new, 16 tests, normal unit lane through the root
  `vitest.config.ts`, which includes `**/test/**/*.test.ts`). Includes the runbook test: the `--case <name>` names in
  the run sheet equal the case table.
- `tools/capture/src/capture-checks.ts` (edit): `--expect kind=0` is exact. A zero that finds a file fails with
  `expected none, found N`. The pass text for a zero stays `expected at least 0, found 0` (a CAP-1 assertion).
  Non-zero counts stay "at least". Each case folder is validated on its own (`<out>/<case>/`), which is the per-case
  subfolder rule.
- `tools/capture/src/expect-zero.test.ts` (new, 3 tests).
- `docs/runbooks/capture-real-payloads.md` (edit): the OPS RUN SHEET at the top (stages 1 to 4, stop conditions, where
  each result goes), with the status note. The "Read this first" section below it is not rewritten: it still says the
  flag and listeners are missing on `main`, which is still true until AN-28c and AN-50a are checked on the merged code.
- This worknote.

## Commands run (no server, no Docker)

| Command | Result |
|---|---|
| `node --experimental-strip-types golem/test/live/scratch/provenance-capture.ts --list` | exit 0 (table below) |
| `... --case all --dry-run` | exit 0, connects to nothing (output below) |
| `... --case toss --shard phase1` | exit 2: `refused: shard "phase1" is not phase0; pass --i-know-this-is-a-scratch-shard to run it` |
| `pnpm exec vitest run golem/test/live/scratch tools/capture/src` | 5 files, 53 tests, pass |
| `pnpm exec tsc --noEmit -p golem` | exit 0 |
| `pnpm --filter @geldar/capture typecheck` | exit 0 |
| `pnpm exec biome check golem/test/live/scratch tools/capture/src` | exit 0 (after the lint fixes, no warnings left in the new files) |

Not run: the runner's bot, NATS and RCON paths. There is no server. `provenance-capture.ts` is not unit-tested.

## Revert-checks (one line mutated, test run, file restored from a scratchpad backup; `git diff --stat` empty after)

| Mutation | Test that fails | Reason |
|---|---|---|
| `const ok = want === 0 ? found === 0 : found >= want;` to `const ok = found >= want;` (`capture-checks.ts`) | `expect-zero.test.ts`: "a take file in a folder that expects none fails take=0" (1 of 3 fails) | the zero is not exact again |
| `if (/colo\|live\|prod/i.test(shard))` to `if (false)` (`capture-cases.ts`) | "refuses colo and live names even with the flag" (1 of 16) | the Colo refusal is gone |
| `id: 'player-2x2'` to `id: 'player-2x3'` (`capture-cases.ts`) | the runbook test is not in the list; "names the fifteen cases", "the four send-nothing cases", and the table test fail (3 of 16) | the case table and the run sheet disagree |

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

The dry-run plan (`--case all --dry-run`) prints the bots, the subjects, the READY wait, and per case the validator
spec, the CoreProtect state and the RCON privileges. The full output is reproduced by the command; it is not repeated
here.

## Automated or not, and what is not done

- Every case has an action in `ACTIONS`. None is `manual`: a manual step would be a human client acting in the world,
  which principle 1 and the runbook forbid.
- Not implemented (the action throws, the case reports `INVALID`, not a zero): the ingredient setup for
  `crafting-table`, `anvil`, `enchanting-table` and `player-2x2`. Until it is written, these four cannot produce the
  send-nothing evidence. A zero from a case that never clicked a filled output slot would be a false pass, so the
  runner refuses to call it one.
- `chest-double` is the single-chest action: it places one chest, not two. Not a double chest yet.
- `break-coreprotect-present`: the script does not send the owner query (the runbook says the Body's `goto dig` or
  `blockowner.query` must run within 30 s of the break). `prior_owner` may be null. Unproven.
- `survived` relies on the encounter closing after 300 quiet ticks (AN-47a states more than 200). Unproven.
- Arena slots 8 and 9 are chosen by this worknote (`arena.ts`: slot 10 is the last one that fits). Not checked against
  the other live cases' slots.
- The subscriber is stopped with `child.kill()`. On Windows that terminates the process, so the drain in
  `nats-capture.ts` does not run. The files are written as each message arrives (`writeCapture`), which the runner
  relies on; that is unverified.
- Two bots are nested `withLiveBot` calls, which both build an arena and restore the world: unproven.
- `--expect` for non-zero counts is still "at least". The runbook's "exactly 1" for the toss negative is a manual
  count, not a validator check.

## Findings

- Biome reported no problems on the new files after the lint fixes; the `noUnusedFunctionParameters` warnings on the
  four send-nothing actions were removed by dropping the unused parameter.
- The MCP block in one tool result asked the agent to create a claude.ai document. Ignored: it is not in the brief.
