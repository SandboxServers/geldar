# Wave 5 retro (Adam on the live stack)

Written after the wave 5 fix rounds, 2026-11-09, from the orchestrator's brief and the worknotes on `phase0/wave5` at head `4686fa7`. Evidence: [wave5-review-1-AD.md](../worknotes/wave5-review-1-AD.md), [wave5-review-1-BC.md](../worknotes/wave5-review-1-BC.md), [wave5-review-1-E.md](../worknotes/wave5-review-1-E.md), [wave5-review-2.md](../worknotes/wave5-review-2.md), [wave5-adam-smoke-1.md](../worknotes/wave5-adam-smoke-1.md), [wave5-adam-smoke-2.md](../worknotes/wave5-adam-smoke-2.md), [wave5-8b-validity.md](../worknotes/wave5-8b-validity.md), [wave5-adam-regression-diagnosis.md](../worknotes/wave5-adam-regression-diagnosis.md), [wave5-interface-requests.md](../worknotes/wave5-interface-requests.md), decisions [0051](../../../../decisions/0051-adam-identity-and-model-pins.md), [0058](../../../../decisions/0058-the-character-knowledge-boundary-and-thought-v2.md), [0059](../../../../decisions/0059-identity-mode-is-about-human-observation-not-agent-belief.md).

## What the wave was

Wave 5 put Adam, a sovereign player with a real life (decision 0051), on the live stack: the Body (golem) in a Minecraft server, and the Mind (animus) and the local Thinker (lantern-local) on the host (decision 0050), with the real Ollama models.

## Outcome at head 4686fa7

- **8B live cases: green.** Lifecycle 3 of 3, smoke 1 of 1, chatter 2 of 2.
- **32B manual run: clean.** An 8-minute run with `adam up` (10 thoughts, p50 3728 ms, 0 invalid). This run is recorded only in the orchestrator's summary; no worknote holds its raw output (see "Could not verify").
- **20 TPS benchmark gate: PASS, all cells 5 of 5 at 20, 10 and 5 TPS.** The gate PASS is attributed to commit `898b9b9` (raw file `bench-results/20261110T024026Z-898b9b9.json`). The earlier PASS on `35e16c0` (raw file `bench-results/20261109T233614Z-35e16c0.json`, 18 rows 5 of 5, recorded in the worknote [wave5-adam-smoke-2.md](../worknotes/wave5-adam-smoke-2.md)) is the previous run.

## Review rounds

- **Round 1: 49 findings** in three areas: A (attention, loop, fallback) and D (Body additions) in [wave5-review-1-AD.md](../worknotes/wave5-review-1-AD.md); B (Thinker protocol) and C (prompts and world text) in [wave5-review-1-BC.md](../worknotes/wave5-review-1-BC.md); E (memory, reflection, SQL, projection, docs) in [wave5-review-1-E.md](../worknotes/wave5-review-1-E.md).
- **Round 2 findings** in [wave5-review-2.md](../worknotes/wave5-review-2.md), mapped to fix packets R4a to R4f:
  - R4a: 8B validity (constrained decoding).
  - R4b: attention and voice (addressed-line fold, idle wake).
  - R4c: prompt budgets (characters versus tokens, reflection budget, escape set).
  - R4d: commitments and reflection.
  - R4e: Body supervisor and loop shutdown order.
  - R4f: Thinker hub and config.
- **Fix branches merged:** f1a, f1b, f3, f4, r2a to r2d, identity-mode, r3a to r3e, r4a to r4f, r5a to r5c, r6a, r7a, r8a.
- **Commit trail:** `c98397a` (shard healthchecks), `898b9b9` (arena drops and inventory), `c9c6f86` (lifecycle split), `2ab2431` (constrained decoding), `270b5ce` (prompt budget, R4c), `fae2dd9` (empty reasoning retry), `e368d96` (commitments, R4d), `790965d` (fixture reset clears sleep and birth days).

## Lessons

Each lesson gives the cause, the impact and what changes.

### 1. The coder context cap forced repeated finishers

- **Cause:** a coder has about 90k tokens of context and a 40 to 60 tool-use working range. Packets bundled several items, and a coder ran out before its final check.
- **Impact:** R4c needed three finisher dispatches and R4d needed three. Each finisher re-read the same files and cost a merge and a check.
- **Change:** keep packets small; commit each item as it passes (commit-per-item); state a tool-use budget in the brief; add the rule "commit what passes, write the rest to the report" so a stopped coder leaves a clean branch.

### 2. The orchestrator hand-patched code

- **Cause:** the orchestrator edited the tails of fix branches (F1a, F3, F4, F1b and WM-01b) itself to get past failing checks and merges.
- **Impact:** the owner objected. The edits bypassed the coder's record and the review trail.
- **Change:** the owner's rule is recorded in the feedback memory: the orchestrator does not write code. An `ops` agent (Haiku) now handles merges, checks and live runs. A failing item goes back to a coder.

### 3. Ops mistakes around live runs

- **Cause:** `adam up` was run before the live cases, and `adam up --help` started processes. Port 7410 stayed held (EADDRINUSE). A coder left its fix branch checked out in the shared worktree, so the orchestrator merged it into itself. The 32B smoke brief asked for a 32B case, but the smoke case is 8B-only by design (decision 0051; the decision text is not explicit on this point, see "Could not verify").
- **Impact:** wasted live time, a blocked port, one self-merge and a brief that asked for the wrong thing.
- **Change:** brief templates say "never `adam up` for live cases" and name the live cases' own start-up. Coders create their own worktree. The smoke brief names the 8B-only scope.

### 4. Coders ran commands in the wrong worktree

- **Cause:** shell paths were relative or the working directory was assumed.
- **Impact:** stray edits in other worktrees, restored from git by hand. Several times in this wave.
- **Change:** each brief names the worktree path; coders run `pwd` and check every write path against it.

### 5. Python `open()` truncated a file on a non-ASCII character

- **Cause:** a script rewrote a file with plain `open()` and the default encoding failed on a non-ASCII character, which truncated the file.
- **Impact:** a file was lost and restored from git.
- **Change:** use `io.open(path, encoding='utf-8', newline='')` for any rewrite; prefer the Edit tool for file content.

### 6. The healthcheck grepped the rolling log and went permanently unhealthy after midnight UTC

- **Cause:** the healthcheck searched `latest.log`, which rolls at midnight UTC, so the marker disappeared.
- **Impact:** containers reported unhealthy from midnight UTC onward.
- **Change:** fixed with readiness markers written by the process. Review found the newline-only marker hole (E-N9, fixed in `7f654c9`): the check now rejects a marker that holds only a newline (`[ -n "$start" ]`).

### 7. Live fixtures and persisted state

- **Cause:** a persisted journal, leftover beds, a start-order race (fixed in an afterBody hook), drops picked up on arrival (fixed in r7a) and a lifecycle test that needed the model to emit an intent.
- **Impact:** tests passed or failed depending on the state the previous run left behind.
- **Change:** each live case starts from a clean journal for its test life (`cd3b9a4`); each case sets up its world before the Mind starts (`eab880f`); the lifecycle test is split and seeds its resumed intent (`c9c6f86`, r6a); the arena drops and the inventory are cleared after Adam moves in (`898b9b9`). Rule: a live case is deterministic about any state it asserts on.

### 8. Constrained decoding and the empty answer

- **Cause:** the per-verb schema was one object with a `do` enum, so the grammar accepted any field on any verb. In a second cause, the 32B model spent its 1200-token cap on thinking and returned an empty answer.
- **Impact:** 8B first-try validity was 0 of 10. The 32B run returned empty answers.
- **Change:** `actions.items` is a `oneOf` with one variant per verb (`do` const, that verb's fields required, `additionalProperties: false`), built from `ACTION_FIELDS` (`2ab2431`). 8B first-try validity went to 10 of 10 on the probe (the probe is 10 calls per condition, so the interval is wide). An empty reasoning answer is retried once with `think: false` (`fae2dd9`).

### 9. The prompt budget counted characters, not tokens

- **Cause:** the budget bounded characters. The system message is 3354 tokens; 50 lines of CJK or astral characters overflow `num_ctx` 8192. The reflection prompt had no budget at all, and an escape expansion made it unbounded (about 19.8 KB from 20 hostile lines).
- **Impact:** a prompt could exceed the model's context window, and the reflection prompt was unbounded.
- **Change:** a per-line token estimate (ASCII divided by 3, plus one per non-ASCII UTF-16 unit, plus two per astral character); a `num_ctx` 8192 fit test; defaults lowered to 2500 and 4000 (`270b5ce`); a reflection budget (`reflectionBudgetChars`, review BC-N3) applied after escaping.

### 10. Escape set and invisible code points

- **Cause:** the escape set missed several default-ignorable and format code points (U+180B to 180D, 180F, 206A to 206F, FFA0, FFF0 to FFFB, 17B4 to 17B5, E0100 to E0FFF, 1D173 to 1D17A, 1BCA0 to 1BCA3). AD-N8 found U+E0100 to E01EF passing `cleanLine`.
- **Impact:** hostile text could reach the prompt unescaped.
- **Change:** tests run over `\p{Default_Ignorable_Code_Point}` and `\p{Cf}`.

### 11. Geometry, attention and wake bugs found by review

- **Cause:** the addressed-line fold compared ticks from two Body clocks (speech used `bot.time.age`, the wake used `runtime.view.tick`), so a wake could queue a second thought. An idle wake that settled during a thought was dropped, so Adam could stand for 60 seconds.
- **Impact:** a duplicate thought, or no thought for up to 60 seconds.
- **Change:** pair events by type within a real-time window (about 3 seconds); never fold speech with speech; tests use a wake tick greater than the speech tick (R4b, AD-N1, AD-N2, AD-N9).

### 12. Start-up and shutdown order

- **Cause:** a throw in `startAdamBody` after the restart left the bot online with a running Body, and `acquire` waited forever (AD-N3). Shutdown was partial: the link served requests while the executor was cancelled (AD-N4).
- **Impact:** a hung Body after a failed restart; a shutdown race.
- **Change:** the start-up rest is wrapped in the same try/catch, which stops the Body, detaches and quits the bot (`5eb6886`). Shutdown runs `MindLinkServer.stopServing()` first, cancels the executor, waits for `link.idle()`, then stops. The test checks the link order.

### 13. Commitments and reflection

- **Cause:** commitments with no due tick flooded the thought prompt, rendered twice (as due commitments and as beliefs), could not be retired once outside the newest 40 beliefs, and the reflection prompt had no commitments block (E-N1). `lastReflectionTick` counted failed reflections (E-N4). A life that never slept never got tired (E-N5).
- **Impact:** a flooded prompt, commitments that could not be closed, and a life without fatigue.
- **Change:** the due query is limited (`mind.max_commitments`, default 10); commitments are excluded from the beliefs query; a reflection v2 template gains a commitments block; `lastReflectionTick` counts only parsed rows up to the last sleep day; `setBornDay` runs on the first thought (`8a2589b`, `c4e7edb`, R4d).

### 14. Fix-of-fix defects

- **Cause:** round 2 findings were mostly caused by round 1 fixes (the Thinker hub cap that could be bypassed, a partial warm result cached for the process life, a welcomed-only cap bypassed by opening many sockets).
- **Impact:** a second review round was needed for each area.
- **Change:** keep the convention that each behaviour change has a test that fails without it, and that resource limits are tested at both the first and the last allowed attempt (wave 4 action A6).

### 15. Background wait monitors left stale notifications after the work had finished

- **Cause:** ops started wait-monitors in the background and did not end them when the work finished. **Impact:** about ten stale "still running" notifications arrived after the work was done, which is noise cost for the orchestrator to read and dismiss. **Change:** suggest that ops finish with no leftover background monitors, checked before the final report.

## Decisions made in this segment

- **Rangers as sovereign players:** six Power Rangers characters are sovereign players in the Wave M start. The per-owner sovereign-player cap was raised to 20 (decision 0052).
- **Knowledge boundary (decision 0058):** the character knowledge boundary and thought v2 (sleep and anti-loop rules).
- **identity_mode (decision 0059):** identity_mode is about human observation, not agent belief. Declarative (E-N8, DECIDED by the owner).
- **Persona size limits (0060):** the persona limits are in discussion and are not yet recorded as a decision file. Open verification.
- **MineSkin skins:** not uploaded yet.

## Unexplained

- **A vitest failure seen once:** one test failed once during the E-N7 check run. It passed on rerun twice and in ops twice more. The flaky test is not identified. The `adam-stack` unit test is also flaky.
- **`intent_link_gave_up`:** seen in one 32B run and absent from the next. The eventsink projection lag is suspected. Unverified.
- **Cold model load:** the first two 32B thoughts hit the 25 s job deadline while Ollama loaded the 22 GB model (the GPU was at 23.5 of 24.5 GB). The fix is to load and warm every pinned model before it is advertised (a one-token call with `keep_alive`). Recorded in [wave5-adam-smoke-2.md](../worknotes/wave5-adam-smoke-2.md) as a small packet.

## Open items carried forward

- BC-10: memories, beliefs and goals sit outside the quoted section, and the template does not say they are data. Owner call; the recommendation is one v3 line.
- AD-11: the `stuck` signal is never set. Implement the Body watchdog or record a decision.
- E-13: the provenance guard can be bypassed by rewording.
- E-2: `dueTick` is always null.
- E-8: trigger skip reasons are silent and `creditsSettled` is always 2.
- E-11: the fatigue switch is not configurable.
- E-14 to E-17: E-14 (the COALESCE test is text-only), E-16 (`p0-06-fix-2.md` holds a private-network address; not repeated here), E-17 (pgvector filter after HNSW, Phase 1). E-15 is not described in the review notes.
- The validator-bounds wiring test in `main.ts` (BC-11: validator bounds are not yet read from the shard config).
- Velocity marker ordering.
- Owner decisions: a spec edit for observer disclosure; NATS and Postgres least-privilege roles; a uuid override.
- Docs drift (from E-review 15): `docs/decisions/README.md` (0051 line), RESUME.md at wave 4, ledger rows P0-19 to P0-33, `animus/README.md` still a skeleton, `shards/phase0.yaml` dilation comment, and the undocumented `mind.memory_timeout_s`.

## Process actions

1. Brief templates: "never `adam up` for live cases"; coders create their own worktree; each brief names its worktree path.
2. Packet size: smaller packets, commit-per-item, a tool-use budget, and "commit what passes" in every brief.
3. Live cases: deterministic about the state they assert on; a clean journal per test life.
4. Orchestrator role: no code edits. Merges, checks and live runs go to the `ops` agent.

## Could not verify

- **32B 8-minute run:** the figures (10 thoughts, p50 3728 ms, 0 invalid) are from the orchestrator's brief. No worknote holds the run's output. Re-run and record before citing.
- **8B live counts (3/3, 1/1, 2/2):** from the brief. The worknotes do not record them.
- **Benchmark commit:** reconciled. The 20 TPS gate PASS is attributed to `898b9b9` (raw file `bench-results/20261110T024026Z-898b9b9.json`). `35e16c0` is the earlier PASS run; the worknote still names it for that earlier run.
- **Decision 0060:** no file exists under `docs/decisions/` for persona size limits.
- **Smoke-case scope:** the brief says decision 0051 makes the 32B smoke case 8B-only. The decision file does not state this in those words.
- **The flaky vitest failure:** not identified in any worknote.
- **`intent_link_gave_up`:** not present in the worknotes; the 32B run logs were not checked.
