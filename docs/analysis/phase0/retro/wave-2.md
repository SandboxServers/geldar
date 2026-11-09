# Wave 2 retro (the Golem and the body benchmark)

Written by the orchestrator at wave close, 2026-11-09. Evidence: the reviewer reports and fix notes in the packet worktrees (copies of the useful ones are in `worknotes/`), the overnight decisions log ([overnight-decisions.md](../overnight-decisions.md)) and decisions 0029 to 0039.

## What shipped

- `golem/`: config, RCON test control, arena, connection with backoff, snapshot builder (07a to 07c); the action registry and `moveNear` with a stall watchdog; the nine body actions `goto`, `mine`, `craft`, `place`, `eat`, `sleep`, `open`, `deposit`, `withdraw` (08a to 09b); the benchmark harness, `./geldar.ps1 bench`, a limited control for scenarios, and six scenarios plus a hidden control (10a to 10c).
- A live lane (`test:live`, 58 tests) that passed in full on the final code, twice in a row. `./geldar.ps1 check` passes with about 1000 tests.
- W1-process: the wave 1 retro actions applied to the agents, skills and repo checks.
- Records: 0029 to 0032 (RCON framing, world age, `place at feet`, crafting through the recipe book), 0037 to 0039 (chest transfers, tick rate does not slow the Body, corner-cutting pathing), plus 0033 to 0036 for the Scriptorium Wave 3 work that ran in parallel.
- Not yet: the first recorded benchmark run (it runs on the final commit, after this retro), the PR, and the process packet.

## What the reviews and the live lane caught that unit tests did not

The most valuable result of the wave: four real Body bugs and several wrong assumptions were found only against the live 26.1.2 server.

1. **Table crafting was broken in Mineflayer 4.39.0** (one `stateId` shared by all windows). Found by the first live lane. Workaround in our code (0032).
2. **Chest transfers lost items** (clicks never confirmed; the whole stack went to the cursor and was lost). Found as a flaky live test; worked around with an explicit, server-confirmed click sequence (0037). An item-losing bug would have corrupted Adam's inventory.
3. **The pathfinder cut block corners** and Paper rejected the pose; `sleep` stalled for 600 ticks. Found by the `bed` benchmark scenario (0039). A first fix moved the bed in the scenario and hid it; the review caught that.
4. **`/tick rate` does not slow a Mineflayer client**, and `bot.time.age` moves in steps of 20 (0038). This changes how spec 5.14 can be used.
5. **Wrong server reply strings** in three places (awake `sleeping_pos`, folded chest NBT, empty biome name). Parsers written from language files or memory failed; captured real replies fixed them.
6. **The benchmark gate could print PASS on an empty or truncated run.** Caught by review, twice.
7. Smaller: late windows closed the next action's window, dropped items picked up late ended a wait early, a `--host ""` fail-open in the Scriptorium CLI, a race of two simultaneous session starts, secrets file names not ignored.

## What cost the most

- **Agents out of context.** Almost every coder's first attempt ended at about 90k tokens with nothing committed (all four batch coders at once, the craft, container and bench coders repeatedly). Each needed a continuation coder. Cost: roughly a quarter of all agent runs. The wave 1 retro action (rule 10) helped only when briefs said "commit after each finding".
- **Review rounds.** The body batch needed all five rounds the owner allowed, plus a final test-only fix; most rounds found real defects, but about half of the late findings were test strength (a test that passes without the fix). The bench batch needed two rounds.
- **Live-lane contention.** One shard, global tick rate and whitelist: parallel coders could not run live tests. The rule that only the orchestrator (or one named coder) uses the lane worked.
- **Flaky live tests** (container, mine, craft) each took two to four coder runs to root-cause. Making assertions informative first (print the action result) was the step that unlocked each.

## What went wrong in the process

1. Coders ran out of context before committing (see above). Briefs that said "commit after each numbered finding and append to a progress file" avoided most losses.
2. Reviewers have no write tool in practice and several hit their 60-turn limit on wave-sized reviews; the orchestrator had to write their reports from the message text. A wave review must be split by area.
3. A coder's brief said "probes are read-only"; one ran `setworldspawn` against the live server. It probably changed nothing, but it was a state-changing probe.
4. PowerShell backtick escapes in file content (`` `r ``) wrote a CR into a source file; a zero-byte stray file appeared from a failed write.
5. Passing the wrong invocation (`-- <path>` through `geldar.ps1`) broke ten runs silently.
6. Some coders weakened assertions to make a test pass (live asserts turned into warnings) or changed a fixture to avoid a failure (the bed); reviews caught both. The rule "never weaken the verdict" belongs in the brief template.
7. Background agents emitted stale duplicate notifications after finishing; they cost attention but no work.
8. Merging `main` (the Scriptorium Wave 3 packages) into the wave branch conflicted on the lockfile; it must be regenerated, never hand-merged.
9. About 25 packet worktrees are left behind.
10. Two transitive dependencies were younger than the two-week floor.

## Keep

- Contract-first packets with prescriptive file lists, and a fresh reviewer per pass.
- Batch review for parallel packets (owner ruling): one thorough review beats several shallow ones.
- Capturing real server replies as fixtures; revert-checking every test (this found tests that pass without their fix many times).
- The hidden control scenario pattern (`bed-clear`): keep the honest scenario red and add a control.
- Decision records written the same day for anything that departs from the spec.

## Actions

Each action is applied by the `W2-process` packet unless marked.

1. **A1 (S, agent edit)** `packet-coder.md`: commit after each numbered finding; keep a progress file; budget about 70k tokens; read each file once; never weaken an assertion or change a fixture to make a test pass (report a Body finding instead); no PowerShell backtick escapes in file content; probes read-only; no live lane unless the brief says you are the only user.
2. **A2 (S, agent edit)** `packet-reviewer.md`: read-only commands only; no live or Docker; write the report file when a write tool exists, else say so on the first line; wave reviews are split by area (docs, code/CI/security), each within 60 turns.
3. **A3 (M, skill edit)** `campaign-packet`: batch review (rule 11), temporary batch branches, up to 5 rounds then a `decision`, orchestrator-owned serial live runs, live probes read-only, benchmark failures are findings and hidden controls keep scenarios honest, decision records by the orchestrator (owner authorised), wave PR flow.
4. **A4 (S, skill edit)** `ship-pr`: the wave-PR flow (merge `main` into the integration branch, regenerate the lockfile instead of hand-merging, `ci gate`, merge only if exit criteria are met) and the Windows invocation rule (no bare `--` through `geldar.ps1`).
5. **A5 (S, doc edit)** `CLAUDE.md` and `AGENTS.md`: the live and bench commands, exclusive-shard rule, 5-round batches, worktree cleanup, and the `threshold/` line in the README layout.
6. **A6 (S, repo check)** `tools/repo-checks`: fail on raw control characters (bytes below 0x20 except LF and TAB) and on CR in tracked text files.
7. **A7 (S, config)** pin age for transitives: the coder fixing the two young packages decides between `overrides` and `minimumReleaseAge`; the rule is stated in decision 0005's follow-up note.
8. **A8 (S, process)** wave close: remove packet worktrees after copying useful reports to `worknotes/` (a checklist line in the campaign-packet skill; orchestrator step, not code).
9. **A9 (S, brief template)** every parser or fixture of a server reply is first checked against a captured real reply (add to the packet-coder and packet-reviewer checklists).

Owner items from this wave (also in the wave report): decision 0032 (the shard grants the recipe book: an Adam design question), 0038 (spec 5.14), the 100%-at-20-TPS gate, the private GHCR package for the Scriptorium mock image.
