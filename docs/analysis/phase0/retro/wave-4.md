# Wave 4 retro (the Body lives)

Written by the orchestrator after the wave test and review, 2026-11-09. Evidence: [worknotes/wave4-review-1.md](../worknotes/wave4-review-1.md), [wave4-review-2.md](../worknotes/wave4-review-2.md), [wave4-live-pass-1.md](../worknotes/wave4-live-pass-1.md), [wave4-live-pass-2.md](../worknotes/wave4-live-pass-2.md), [wave4-revert-checks.md](../worknotes/wave4-revert-checks.md), overnight decisions 26 to 38, decisions 0042 to 0048.

## What shipped

- `golem/src/body/`: the runtime skeleton (P0-14, with the 20 Hz physics tick fix), seven reflexes (eat, fall stop, hazard escape, retreat, fight or flee, panic burrow, blocked path), the `attack` action, the intent executor (validity, preconditions, limits, wake conditions, one current-action slot), five built-in programs with checkpoints, the record sink to NATS and the projection into Postgres (`intents`, `actions`, `receipts`), and restart with resume from a KV checkpoint (P0-18); `createBody` composes them.
- Live evidence: the full live lane at 73 of 73 on the final code, the recorded benchmark at 20 TPS (gate PASS), both sink integration tests.
- The first fan-out under the owner's rule: one small unblocker (P0-14), then six parallel packets, then restart; plus one integration coder.
- Owner decisions made during the wave: reviews and tests at wave end, `W<N>-process` after the retro, fan out early; recipes are discovered (0048), no time dilation (0047); the spec amended for 0042, 0045, 0047.
- Side track: the Scriptorium malicious-book corpus (SC-61a to SC-61d, PRs #18 to #21) and decisions 0044 to 0046.

## What the reviews and live runs caught that unit tests did not

1. **Real Body bugs, found only live:** `craft stick 4` made 16 sticks and ate all the planks (the craft count trusted a recipe display's yield, then the result slot's stack count, which reads wrong on a real 26.1 server; the fix measures the inventory delta; it took two fix rounds); the panic burrow dug the wrong cells (it dug by block name).
2. **Real bugs found only by review:** the `attacking` test had a sign error on one axis (mobs north or south of the Body never counted; every test and live case used the x axis); reflexes cancelled the running action before deciding whether to act; reflex pre-emption did not reach program-step actions; a graceful stop followed by a resume left the intent `cancelled` in Postgres; terminal intent events and audit records could be dropped by the sink; a blocked walk could spin to the tick limit.
3. **Fix-of-fix defects again:** round 2 findings were mostly caused by round 1 fixes (the sink's retry cap, the first-final-state rule, the cancel wait). Round 3 found only small items.
4. **Environment findings:** `shard up` did not rebuild images (the live stack ran the old sink for hours); live tests depended on the time of day (a zombie burns in daylight) and on persistent bot state (low health survived into the next run); two integration tests collided on a shared subject; a plugin test had a timing race.

## What cost the most

- **Review and fix volume:** three review rounds (33, 16, 6 findings) and six fix rounds. Each fix round also needed a merge, a `check` and a live pass; the live lane takes about 11 minutes.
- **Craft yield:** two fix rounds and two live runs before it was right.
- **Live-test debugging without live access:** coders cannot run live tests, so a test setup was fixed three times (zero evidence per try). The diagnostic-first pattern (print the state in the failure message, then fix) worked.
- **Agent turn limits:** one coder (Body behaviour fixes, 14 items) stopped at the 90-turn limit after finishing all items but before its final check.

## What went wrong in the process

1. **Edits landed in the wrong worktree, again:** a zero-byte stray file in the orchestrator's worktree, a stray file in the main checkout (the coder deleted it), earlier uncommitted copies blocking merges. The wave 3 action (edit only inside your worktree) is not enough on its own.
2. **Control characters, four times in three waves** (0x07, 0x0c, CR): PowerShell backtick escapes in file content. The repo check catches them but reads the staged index; a coder's local check passed while CI failed once, and another coder's check kept failing until the fix was staged.
3. **Large overlapping briefs:** fan-out coders each added fields to `view.ts` and `ReflexContext`; the merge needed a dedicated integration coder, and two fix coders had to edit files outside their area.
4. **Stale builds in the wave test:** the stack runs from the last `shard up`; images built from the repo were not rebuilt.
5. **A flaky test was noticed late:** it failed once in a coder's `check` and passed on rerun; I only queued the fix after the wave PR work had started.
6. The progress files under `.claude/reports/` are gitignored; coders force-add them, which works but is inconsistent.

## Keep

- Fan-out with one small unblocker, then an integration coder: the merge cost was one file of conflicts and one coder run.
- Diagnostics first: put state in the failure message before changing behaviour.
- The orchestrator runs live tests and negative probes serially; coders write the live cases.
- Recording reviewer findings with owners per item in a worknote so each fix coder starts from a file.
- Asking the owner for the open decisions in one batch of four questions.

## Actions

Each is applied by the `W4-process` packet unless marked.

1. **A1 (S, agent edit)** `packet-coder.md`: run `pwd` and check every write path against the worktree path in the brief; prefer the Edit tool and never put backtick escapes (`` `a ``, `` `f ``, `` `t ``, `` `r ``) in PowerShell strings that write file content; before the final commit run `git diff --check` and the control-character check on the working tree; a brief with more than about 12 items is split by the orchestrator, and a coder that reaches 80 turns stops, commits what is done and writes the remaining items to its report.
2. **A2 (S, repo check)** `tools/repo-checks`: the control-character and CR checks scan the working tree as well as the index (so an unstaged file cannot hide a defect and a fix is seen at once); fail on a control character in any tracked or untracked non-ignored text file.
3. **A3 (M, skill edit)** `campaign-packet`: the fan-out section gains the integration step (one coder merges the fan-out branches, owns shared interface files such as `view.ts`, and wires them), the diagnostics-first rule for live failures, and "a test that fails once is recorded and gets a fix item the same day".
4. **A4 (S, skill edit)** `run-shard` and `body-bench`: the wave test procedure: `./geldar.ps1 shard up` rebuilds repo images (done), run the live lane in the background (it takes about 11 minutes, longer than a foreground shell allows), run the sink integration tests with the rebuilt image.
5. **A5 (S, live fixtures)** a standard `resetBot` step in `golem/test/live/fixture.ts` that heals, clears effects, sets the time and weather and restores the gamerules in `finally`, used by every live case that depends on world state; a note in the live-test conventions that cases must not depend on the time of day or on player data from a previous run.
6. **A6 (S, agent edit)** `packet-reviewer.md`: geometry and angle code needs tests on every axis and sign (all four headings); resource-accounting changes need a test for the last allowed attempt (already in the briefs) and for the first one.
7. **A7 (S, process)** progress files: either commit them (remove `.claude/reports/` from the ignore list for `w*.md` reports) or stop force-adding them; the orchestrator copies useful ones to `worknotes/` as now. The W4-process coder proposes one and applies it.
