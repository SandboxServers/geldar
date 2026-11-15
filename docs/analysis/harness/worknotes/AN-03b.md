# AN-03b worknote (first half: rolls, exact chances, parameters, alignment, proficiency levels)

- Base sha (first pass, HEAD at session start): `826a50b0` on `phase1/an-03b-psyche-roll` (from `origin/main`, which has `psyche/` from AN-03a).
- Commit: `AN-03b: psyche rolls, exact chances, parameters and alignment`.
- Split: the card's split line says roll and chances first, parameters and bank second. This pass is the first half plus the parameters, alignment and proficiency-level functions the card lists in its shapes. The temperament bank is not written.

## Deferred: AN-03c (temperament bank)

- `psyche/src/temperament.ts` and `psyche/test/temperament.test.ts` are NOT in this commit.
- Status: deferred. The bank's text now comes from the owner's brief 5.9 (the brief is not in the repository). It is to be built as inactive data after this merges. Earlier, the wording waited on an approval (decisions 0058, 0059, 0068; ADR 0186 "Not decided here"; ADR 0281 item 8, D-HC-13).
- `ledger.md` has no AN-03c row. The orchestrator adds it.
- AN-03c must add: the bank, the `temperament(sheet)` function, the marker-scan test (every sentence through `markedWords` from `@geldar/contract`, with "keep an eye on" in place of "watch for"), and the 245-character longest-sentence budget.
- No prose an agent would read is in this commit. `alignmentLabel` returns labels for operators and Glass only.

## Review fixes (second pass)

- Base for this pass: `c94fa7fb` (the reviewed packet commit). This pass adds one commit on top; it does not amend or squash below `c94fa7fb`.
- Whole-Roll pinning: `roll.test.ts` asserts the full `Roll` with `toEqual` for one rigged roll per mode (dis score 1, flat score 3, adv score 5 with proficiency 1). Every field is pinned: fx, score, proficiency, dc, mode, dice, kept, bonus, total, success.
- Golden test: `roll('novelty', s, 11, rngFor(KEY))` for scores 1, 3 and 5, with KEY = life-a, body, generation 1, tick 100, novelty, decisionSeq 0. The first two d20 values are 17 and 7. Scores 1, 3 and 5 give (dis, kept 7, total 5, fail), (flat, 17, total 17, success), (adv, kept 17, bonus 2, total 19, success). The raw first draw is already pinned as a seed vector in `rng.test.ts`; this pins only the d20 mapping and the rolls.
- `levelForXp` throws `RangeError` unless every threshold is finite and the thresholds are non-decreasing. Equal thresholds are accepted. Tests are in `proficiency.test.ts`.
- Table 4.1 fixture (`roll.test.ts`): the owner's brief table 4.1, as whole percents, is copied into the test. The brief is not in the repository. Every cell is checked against `exactChance` within one percentage point. Exact values: score 1 is 30.25, 16.00, 6.25, 1.00; score 2 is 42.25, 25.00, 12.25, 4.00; score 3 is 65, 50, 35, 20; score 4 is 87.75, 75, 57.75, 36; score 5 is 93.75, 84, 69.75, 51 (DC 8, 11, 14, 17). No cell is off by more than one point, so nothing was stopped and the fixture was not changed.
- `ENGINE_VERSION`: closed as **no bump (adding functions only, per AN-08a precedent)**. This pass adds functions and tests; no seed, sheet or existing roll rule changed.
- Tests after this pass: `pnpm test psyche/test` gives 6 files, 71 tests, all passing. `tsc -p psyche` is clean.

Revert-checks (each mutation changed one line, `git diff --stat` showed that line, the file was restored from a scratchpad backup and `git diff --stat` was empty after):

| # | File and line | Mutation | Result |
|---|---|---|---|
| R1 | `roll.ts` return | `fx` set to `''` | 4 failed (whole-Roll dis, flat, adv and golden) |
| R2 | `roll.ts` return | `dc` set to `0` | 4 failed |
| R3 | `roll.ts` return | `score` set to `3` | 3 failed |
| R4 | `rng.ts` d20 | faces 0 to 19 (no `+ 1`) | 13 failed (rng d20 tests, roll tests, whole-Roll tests) |
| R5 | `proficiency.ts` validation | first threshold not checked for finite | 1 failed ("not finite") |
| R6 | `proficiency.ts` validation | ordering drops the `second <= third` check | 1 failed ("decrease") |

## Files

- New: `psyche/src/roll.ts`, `psyche/src/params.ts`, `psyche/src/alignment.ts`, `psyche/src/proficiency.ts`, `psyche/test/roll.test.ts`, `psyche/test/params.test.ts`, `psyche/test/alignment.test.ts`, `psyche/test/proficiency.test.ts`, this worknote.
- Changed: `psyche/src/index.ts` (exports only).
- Not touched: `psyche/RELEASE.json`, `pnpm-lock.yaml`, `contract/`, `psyche/src/version.ts` (`ENGINE_VERSION` stays 1; see ambiguities).

## Behaviour and checks

- `modeFor`: score 1 dis -2, 2 dis 0, 3 flat 0, 4 adv 0, 5 adv +2.
- `roll`: dis and adv draw two d20 and keep the min or max; flat draws one. `bonus` is the mode bonus plus the proficiency level. `success` is `total >= dc`.
- `exactChance`: enumerates every outcome (20 for flat, 400 for dis and adv). Hand-checked values: score 1 at DC 8 is 121/400; score 4 at DC 8 is 351/400; score 3 at DC 11 is 10/20; score 3 at DC 11 with level 1 is 11/20 and with level 3 is 13/20.
- An independent oracle in `roll.test.ts` re-enumerates all five scores, DC 2 to 30 and levels 0 to 3 and must agree with `exactChance`.
- `step` and `factor` follow the card's formulas. `step(a, 6, -2, 2, 14)` gives 10, 8, 6, 4, 2 for scores 1 to 5.
- `alignmentLabel`: all nine cells, boundary scores, and the label set.
- `levelForXp`: thresholds 10, 30, 70 at 9, 10, 29, 30, 69, 70; custom thresholds.
- `pnpm format` (biome) applied; `tsc -p psyche` clean; `pnpm test psyche/test`: 6 files, 62 tests passed.

## Mutation results (revert-checks, on the committed WIP `a97d7a7c`)

Each mutation changed one line; `git diff --stat` showed that one line; `pnpm test psyche/test` was run; the file was restored from a scratchpad backup and checked by SHA-256.

| # | File and line | Mutation | Result |
|---|---|---|---|
| M1 | `roll.ts` dis rule | keep higher (card) | 5 failed. "disadvantage keeps the lower die" (expected 20 to be 5) |
| M2 | `roll.ts` success | `>=` to `>` (card) | 9 failed, including "success at exactly the DC" |
| M3 | `roll.ts` mode table | score 2 `dis` to `flat` | 3 failed, "gives the mode table" |
| M4 | `roll.ts` bonus | bonus omits proficiency | 2 failed, "adds the proficiency level to the bonus" |
| M5 | `roll.ts` exactChance | counts omit proficiency | 2 failed, "matches the independent enumeration" (289 vs 324) |
| M6 | `params.ts` step | no upper clamp | 1 failed, "clamps to the maximum" (26 to be 14) |
| M7 | `alignment.ts` | law 4 boundary `>=` to `>` | 1 failed, "boundary scores" ('CG' to be 'LG') |
| M8 | `proficiency.ts` | second threshold `>=` to `>` | 2 failed, "switches level at each threshold" |

- Marker-scan mutation (card's third revert-check): not run. No temperament bank exists in this commit (AN-03c).
- `factor` has no mutation of its own. Its tests cover base at score 3 and four values on both sides of 3.

## Ambiguities and deviations

- Test-first: tests and code were written in the same pass, so no red run preceded the code. The eight mutations are the evidence that the tests bite.
- `bonus` includes the proficiency level (card: "every proficiency level shifts the bonus by the level"). `Roll.bonus` is the total bonus; the mode bonus alone is not stored.
- `ENGINE_VERSION` stays at 1. Closed in the review fixes: **no bump (adding functions only, per AN-08a precedent)**. No existing seed, sheet or roll rule changed.
- `DEFAULT_DCS` lives in `roll.ts` (the card lists it in the shapes without a file). `Level` type lives in `proficiency.ts`.
- `roll` takes `proficiency` as an optional fifth argument, default 0, as the card's signature gives.
- Table 4.1 is the owner's brief and is not in the repository. The review fixes record it as a fixture in `roll.test.ts` (see Review fixes above); all 20 cells are within one percentage point.
- The card's "floors" wording for `step` is taken to mean the computed values 10, 8, 6, 4, 2.
- No `geldar.ps1 check` run; the narrower checks in the brief were used.
