# AN-03c worknote (temperament bank as inactive psyche data)

- Base sha (first pass, HEAD at session start): `f68cb051` on `phase1/an-03c-temperament` (from `origin/main`, which has `psyche/` from AN-03a and AN-03b).
- Commit: `AN-03c: temperament bank as inactive psyche data`.
- Source of the wording: the owner's brief section 5.9 table (fields curiosity, common_sense, cleverness, aggression, law, good; scores 1, 2, 4, 5). The 24 sentences are copied verbatim. Score 3 has no sentence. The brief is not in the repository.
- Route: inactive. Nothing reads the bank. Decision 0281 item 8 and D-HC-13 keep the wording inactive until the owner approves the delivery route (decisions 0058, 0059, 0068).

## What the commit adds

- `psyche/src/temperament.ts`: `TEMPERAMENT_BANK` (typed by field and score 1|2|4|5) and `temperamentFor(sheet): string[]`. Output order is fixed: curiosity, common_sense, cleverness, aggression, law, good. A standard sheet gives `[]`. Imports: `./types.ts` (type only).
- `psyche/src/index.ts`: one export line (`TEMPERAMENT_BANK`, `temperamentFor`).
- `psyche/test/temperament.test.ts`: the brief's table is copied again as a literal in the test, so a changed bank sentence fails on its own.
- The name is `temperamentFor`, as the packet brief says. The card (AN-03b) names it `temperament(sheet)`. The card name was not used, on the orchestrator's instruction.
- `psyche/package.json` already has `@geldar/contract` as a dev dependency, so `markedWords` is imported in the test. No package file changed.

## Measured budget

- Longest sentence per field, summed: see the test `keeps the longest sentence of each field, summed, within the 245-character budget`. The assertion is `<= 245`, as the packet says.

## Test results (this pass)

- `psyche` vitest: 7 files, 81 tests, all pass.
- `psyche` typecheck: clean.
- Biome format: applied; the two files it changed are in the commit.

## Revert-checks (mutation of `psyche/src/temperament.ts`, one line each, then restored from a scratchpad backup)

1. One sentence changed (`You keep mostly to what you know.` to `You keep often to what you know.`): 3 tests fail (the exact-sentence test for curiosity 2, the fixed-order test, and the key-order test).
2. Order changed (`curiosity` and `common_sense` swapped in the order list): 2 tests fail (fixed order, and key-order).
3. Field dropped (`good` removed from the order list): 2 tests fail (exact sentence for good 1, and fixed order).
4. The word `watch` inserted (`You stand your ground and watch.`): 5 tests fail (exact sentence, fixed order, bank exact, shared `markedWords` scan, and local whole-word scan).

Mutation 4 first ran against a test whose marker and digit scans read the test's own copy of the brief, not the bank. Only 3 tests failed, so the marker scan did not catch it. The scans were changed to read `TEMPERAMENT_BANK` (WIP commit `71b30861`), and mutation 4 was re-run: the marker scans then fail. The figures above are from the re-run.

## Deviations

- Function name: `temperamentFor` (the packet brief), not `temperament` (the card). Reason: the orchestrator's brief names it.
- Scope: the card's AN-03b split line also named `roll`, `params`, `alignment` and `proficiency`. Those are AN-03b's and are not touched here.
- Not changed: `prompts/`, `golem`, `eventsink`, `tools`, `contract`, `RELEASE.json`, `ENGINE_VERSION`, `ledger.md`.
