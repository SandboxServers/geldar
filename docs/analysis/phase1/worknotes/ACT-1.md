# ACT-1 worknote: explore, farm and patrol are recorded as live

Base: `d18a2dd4` (origin/main with CI-2 #876 cherry-picked as d18a2dd4).

## What changed

- `contract/schemas/mcp-play.schema.json`: the explore, farm and patrol paragraph (owner text, verbatim) appended to the `ActInput.intent` description.
- `contract/schemas/program-shapes.schema.json`: "Proposed and inert: nothing selects these shapes yet" replaced with the enforced state (PROGRAM_ARGS in player-core, held equal by program-shapes-drift.test.ts).
- `contract/src/generated/mcp-tools.ts`, `contract/src/generated/validators.js`: regenerated (`pnpm --filter @geldar/contract generate`).
- `player-core/src/validate/program-args.test.ts`: one test added, "accepts the bound values for each program through the whole validator". The other bound tests already existed.
- Decisions 0392, 0393, 0394 and their README rows (0392-0394 were free on origin/main on 2026-11-21; latest was 0391).

## Bounds check (PROGRAM_ARGS, player-core/src/validate/bounds.ts)

| Program | Text | Code | Agrees |
|---|---|---|---|
| explore | legs 1-12, leg_blocks 8-48, avoid_water bool | legs 1-12, leg_blocks 8-48, avoid_water bool | yes |
| farm | radius 4-24, max_cells 1-32, replant bool | radius 4-24, max_cells 1-32, replant bool | yes |
| patrol | route 2-8 positions, laps 1-5, loop bool | route 2-8, laps 1-5, loop bool | yes |

## Revert-checks

Each mutation changed one line of `player-core/src/validate/bounds.ts`, was run against `program-args.test.ts`, and was restored from a scratchpad backup (`git diff --stat` empty after each).

| Mutation | Result |
|---|---|
| M1 explore `legs` max 12 to 13 | FAIL `accepts the defaults and every bound for explore` (expected [] to not deeply equal []) |
| M2 farm removed from `PHASE0_PROGRAMS` | FAIL `names them in the allow-list and in PROGRAM_ARGS`, `accepts a valid intent for each program`, `accepts the bound values for each program through the whole validator` |
| M3 patrol `route` max 8 to 9 | FAIL `requires a route of 2 to 8 positions for patrol, and bounds laps` |

The drift test (`golem/src/body/programs/program-shapes-drift.test.ts`) also catches M1, because the schema still says 12.

## Open items

- Scriptorium `docs/release.md` cites "geldar 0008" for the owner-merges rule. 0008 is on the unmerged branch `origin/docs/scriptorium-decisions` (companion servers, its Updates paragraph states the rule). Not on main. Cited in 0394.
- `docs/analysis/phase1/packets/decision-number-registry.md` lists used numbers as of 2026-11-18. Numbers 0392-0394 are added by this packet; the registry itself is not updated here.
- `docs/decisions/README.md` index rows were added directly, not left as an index line in this worknote.
