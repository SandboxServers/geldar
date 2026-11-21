# AN-45a: register explore, farm and patrol with bounded arguments

Branch `phase1/an-45a`, off main 0cda6250. Packet: `docs/analysis/harness/work-packets-sheet-w6-w8.md`, section "AN-45a". Released by decision 0391 point 3 (the `INTENT_WHY` sentences are approved as written). Inert: the programs are registered in the Body and allowed by the validator, but no body-api version lists them and the Thinker decode schema does not name them, so no agent is told they exist. Nothing is activated, and the held-live ruling stands.

## Change

- `golem/src/body/programs/index.ts`: imports and exports `ExploreProgram`, `FarmProgram`, `PatrolProgram`; three `registry.register` lines; the doc comment now counts ten programs. `UNSUPPORTED_PROGRAMS` is unchanged (`trade_wait`).
- `player-core/src/validate/bounds.ts`: `PHASE0_PROGRAMS` gains `explore`, `farm`, `patrol`; `ArgSpec` gains `bool` and `route`; `PROGRAM_ARGS` gains three rows with the AN-44 bounds (explore: `legs` 1-12, `leg_blocks` 8-48, `avoid_water`; farm: `radius` 4-24, `max_cells` 1-32, `replant`; patrol: `route` 2-8 positions, required, `laps` 1-5, `loop`); `checkProgramArguments` handles the two new kinds. A route point is checked with `checkPosition` (integers, y -64 to 320, inside the world border plus the margin), the same check a `travel` target gets.
- Tests: `golem/src/body/programs/index.test.ts` (registry rows), `golem/src/body/programs/program-shapes-drift.test.ts` (new), `player-core/src/validate/program-args.test.ts` (new: there is no `*.test.ts` under `player-core/src/validate/` to add rows to).
- `INTENT_WHY` in `contract/src/outcome-words.ts` already holds the approved explore, farm and patrol sentences (AN-44 wrote them); they are word for word as in 0391 point 3, so no contract change is needed here.

## Reachability by name (for the PR body and the owner)

Registering the programs and adding them to `PHASE0_PROGRAMS` makes them reachable BY NAME on the act path: a thought whose intent names `explore`, `farm` or `patrol` now passes the output validator (with bounded arguments), the Body creates the program, and `restart.ts` resumes a persisted intent of those names. No prompt names them (no body-api version lists them, `DEFAULT_BODY_API_VERSION` is still 10) and the Thinker decode schema's program enum does not include them, so a grammar-constrained Mind cannot emit them. A Mind that is not grammar-constrained, or a thought written by hand or by another tool, could. Whether that is acceptable under the held-live ruling is the owner's call; nothing here changes code for it. Keeping the three off the allow-list would mean leaving `PHASE0_PROGRAMS` alone, and then the packet's `bounds.ts` rows would be reachable only through `PROGRAM_ARGS` (the registry registration alone would not be reached from the validator).

## One change outside the packet's may-edit list

`animus/src/validate/output.test.ts` (outside the packet's may-edit list, noted so a reviewer sees it). Two existing tests, "lists exactly the allow-list of programs" (the v8 body-api table) and "matches the decode schema", compare `PHASE0_PROGRAMS` with the body-api table and the hard-coded decode-schema enum, so the packet's own `PHASE0_PROGRAMS` change broke them. The packet did not list this. The fix is test-only and follows the precedent of `use` for v8 (decision 0218): compare less `explore`, `farm`, `patrol`, and add one test that they appear in no table (v8 or the decode schema) until a body-api version selects them (AN-45b). No `animus/` source, no `prompts/`, no decode schema changed.

## Not in this card (the packet's scope)

The body-api v11 file and its sha pins are AN-45b ("OWNER APPROVAL REQUIRED": wording of the program summaries and examples). It was not written here. `DEFAULT_BODY_API_VERSION` is untouched.

## Revert-checks (mutation applied, tests run, file restored)

| Mutation | Failing tests |
|---|---|
| `farm` left out of `PHASE0_PROGRAMS` | `names them in the allow-list and in PROGRAM_ARGS`, `keeps explore, farm and patrol out of every table until a body-api version selects them` |
| farm `radius` max 24 changed to 25 in `PROGRAM_ARGS` | `farm: the same bounds, kinds and required flags` (drift test), `accepts the defaults and every bound for farm` |
| `patrol` not registered | `registers the ten programs and the unsupported names` |
| `bool` check disabled | `accepts only true or false for a bool` |

## Checks

`tsc --noEmit` 0 for golem, player-core, animus. Tests: `golem/src/body/programs`, `player-core/src/validate`, `animus/src/validate` 283 passed. Whole-repo `biome ci --diagnostic-level=error`: "Checked 2381 files", no errors, exit 0. `pnpm check:repo`: exit 0, no `error:` lines. `git diff --check`: clean. After review 1 the same three runs were repeated on the final tip, and the three test directories now pass 287 tests.

## Packet-silent decisions (for the reviewer)

1. **Route points use `checkPosition`.** The packet says a `route` accepts "an array of `min` to `max` objects `{x, y, z}` with integer values". It does not say which range each coordinate may have. `checkPosition` (the check a `travel` target gets) adds: y from -64 to 320, x and z inside the world border plus the 16-block margin, and no unknown keys. The contract schema allows x and z up to 30,000,000, so the validator is deliberately stricter than the schema for a route: a point outside the shard border is refused as `out_of_bounds`. The drift test compares counts, kinds and required flags only, not the coordinate range.
2. **The animus test change** (above) is scoped, not loosened: the two tests still assert exact equality of the table and the allow-list, less the three named programs, and a new test pins that the three are in no table.

## Review 1 fixes

- Route points: `player-core/src/validate/program-args.test.ts` now fails if `checkPosition` is swapped for an integer-only check (height 321 and -65, x or z one past the border plus 16, an extra key). The choice stays `checkPosition` (consistent with a `travel` target); see "Packet-silent decisions".
- Whole-validator test: a valid explore, farm and patrol intent goes through `createOutputValidator().parseThought`, bad arguments fail, and `trade_wait` and an unknown name still fail. Revert-checks: `farm` out of `PHASE0_PROGRAMS` fails "names them in the allow-list" and "accepts a valid intent for each program"; an integer-only check in place of `checkPosition` fails the new range test `checks each route point as a position` (one test; the reviewer reproduced this), and dropping the per-point check altogether fails that test and also `requires a route of 2 to 8 positions for patrol` (two tests); the `patrol` row of `PROGRAM_ARGS` renamed away fails six tests.
- Docs: `docs/reference/player-core.md` (the `PHASE0_PROGRAMS` row) and `docs/reference/golem-body.md` (the programs row, and conflict 1, which quoted the old "six built-in programs" comment that AN-45a replaced).

## AN-45a-fix (#865): the three names come off the act allow-list

- Telemetry (read-only, from the repo, docs and CI): no evidence in the repo, its reports or its CI artifacts that any ranger ran explore, farm or patrol since deploy 2aa29c3a. No live server or log was read (no ssh). Absence of evidence here is not proof of no use.
- `player-core/src/validate/bounds.ts`: `PHASE0_PROGRAMS` drops `explore`, `farm` and `patrol`. The act path (`threshold/mcp/src/tools/act.ts` through `thought-output.ts`) refuses a name off this list with `not_allowed` at `/intent/program`. Unknown names were already refused by the same list; the schema gap is only in `mcp-play.schema.json` (any lowercase name), so no schema change.
- Kept: the `PROGRAM_ARGS` rows (the drift test `golem/src/body/programs/program-shapes-drift.test.ts` reads them) and the Body registrations in `golem/src/body/programs/index.ts`. The Body is not the gate for the Mind, but it still registers the three names; removing the registrations is a follow-up for the owner.
- Tests: `player-core/src/validate/program-args.test.ts` now asserts the three are refused on the whole validator path and not on the allow-list.