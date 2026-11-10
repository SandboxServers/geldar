# Phase 0 campaign retro

Written 2026-11-10 from the orchestrator's session record, the wave retros ([wave-1.md](wave-1.md) to [wave-5.md](wave-5.md), [wave-m.md](wave-m.md)), the campaign ledger ([README.md](../README.md)), the resume card ([RESUME.md](../RESUME.md)), the worknotes in [worknotes/](../worknotes/README.md) and decisions [0050](../../../../decisions/0050-phase0-mind-processes-run-on-the-host.md) to [0068](../../../../decisions/0068-prompt-v4-and-agent-visible-text.md). Figures marked "session" come from the orchestrator's session record and were not recounted from the repository.

This retro is blameless. It names what the process did, why, and what Phase 1 changes.

## 1. Outcome

**Phase 0 is closed as proof of life.** The owner closed it by [decision 0066](../../../../decisions/0066-phase0-closed-as-proof-of-life.md) on 2026-11-10. The spec section 10 exit criteria are waived by the owner. They are not met. The long exit runs (the 32B 24-hour run, the 5-day survival, the 8B run) were not performed and are deferred to later phases ([decision 0064](../../../../decisions/0064-exit-run-lives.md) and [0061](../../../../decisions/0061-phase-0-exit-criteria-readings.md) set how they would be read).

**What was demonstrated:**

- The Body (the Paper plugin and the Mineflayer client, golem) joins a real Paper 26.1.2 server through Velocity and acts in the world: movement, mining, crafting, chests, sleeping, eating, placing.
- The Body benchmark passed its gate at 20 TPS, 100% of runs, repeatedly, at several commits (see section 6).
- The Mind (animus) runs on the host with a real local model (Qwen3 8B and 32B through Ollama). Thoughts were produced and acted on in live runs, with latencies from about 0.6 s to 7.7 s on the 8B model in the smokes.
- The event stream (NATS), the event sink (Postgres), receipts and the action record work end to end against the live stack.
- The sovereign MCP front door (wave M) answers a real external agent, and a live smoke against the real Body passed.
- The run harness (`adam-run`, the report generator, the Glass page) runs against the stack and writes a report.

**What was not demonstrated:**

- Survival: no 5-day in-game survival run and no 24-hour run across restarts were performed.
- The spec's durable-intent exit (three intents completed through chatter without a model call) was not run as a recorded exit.
- The restart steps (a planned restart and a Body restart mid-intent) were documented but not exercised as exit runs.
- The model floor and inference calls per useful minute were not recorded as a campaign result.
- The public MCP topology (tunnel) is not running. No MineSkin upload has happened.
- Several contract gaps were known at close (section 9).

**Numbers (session record unless marked):**

- Waves: 1, 2, 3, 4, 5 (Adam on the live stack), M (sovereign MCP) and 6 (the exit harness and the live fixes). Each wave had review rounds and fix rounds (fix-A to fix-F, the R, E, and W5 fix branches, and the live-fix branches `phase0/live-1` to `phase0/live-4`).
- Packets: 83 rows in the [campaign ledger](../README.md) across the P0, WM and W6 series. Wave M alone had 13 packets (WM-01 to WM-13), some in several parts.
- Pull requests: wave 1 packets merged through PR #4 (ledger). The total PR count was not recounted here.
- Decisions: 56 files in `docs/decisions/`, numbered up to 0068. The next free number was 0067 when the resume card was written; 0067 and 0068 were then taken by the NATS and prompt decisions, so the card is out of date (see section 9).
- Tests: about 4000 (session). The repository has 432 tracked test files.
- Commits: 1302 on `phase0/integration`, of which 189 are merges (repository count, 2026-11-10). The public `main` branch is a separate, shorter line.
- Worknotes: 88 markdown files under `worknotes/`, including the reports folder.

## 2. Timeline of waves and live runs

All dates are 2026-11. Each wave ran in packet branches under `.claude/worktrees/`, merged to a wave branch, reviewed, then merged to `phase0/integration`.

| When | Wave or run | What happened | Record |
|---|---|---|---|
| 11-08 to 11-09 | Wave 1 | Threat model, contract package and generator, the schemas, `sql/` migrations, the compose stack (P0-00 to P0-06) | [wave-1.md](wave-1.md) |
| 11-08 to 11-09 | Wave 2 | The Golem (Body), the Mineflayer 26.1 path through Velocity, the body benchmark and its first partial 20 TPS run (P0-07 to P0-10) | [wave-2.md](wave-2.md), [bench-first-run-partial-20tps.txt](../worknotes/bench-first-run-partial-20tps.txt) |
| 11-09 | Wave 3 | The Geldar-Core plugin, the event sink, the world to the record (P0-11 to P0-13). Live pass on the merged wave branch | [wave-3.md](wave-3.md), [wave3-live-pass.md](../worknotes/wave3-live-pass.md) |
| 11-09 | Wave 4 | Runtime, reflexes, executor, programs, recipes, chest transfers by explicit clicks. Two live passes | [wave-4.md](wave-4.md), [wave4-live-pass-1.md](../worknotes/wave4-live-pass-1.md), [wave4-live-pass-2.md](../worknotes/wave4-live-pass-2.md) |
| 11-09 | Wave 5 | Adam, a sovereign player, on the live stack with the 8B and 32B models. Review round 1 found 49 findings; fix rounds R2 to R5 followed | [wave-5.md](wave-5.md) |
| 11-10 | Wave M | The sovereign MCP (WM-01 to WM-13), then live runs L1 to L5 on `phase0/live-1` to `phase0/live-4` | [wave-m.md](wave-m.md), [wm-live-findings.md](../worknotes/wm-live-findings.md) |
| 11-10 | Wave 6 | Mind review fixes, thought template v3, Glass, the `adam-run` protocol and its preconditions, smoke runs (`smoke-w6-20-a`, `smoke-w6-25-a`), damage wakes ([0065](../../../../decisions/0065-damage-wakes-the-mind.md)), life-ended handling | worknotes `w6-01` to `w6-26` |
| 11-10 | Campaign review | Adversarial review by nine reviewers across the campaign, then the fix round A to F | [fix-a1.md](../worknotes/fix-a1.md) to [fix-f.md](../worknotes/fix-f.md) |
| 11-10 | Close | Owner decision 0066 closes Phase 0 as proof of life | [RESUME.md](../RESUME.md) |

Live runs, in order (the fuller record is in the worknotes):

- **Wave 3 and wave 4 live passes:** first runs of the Body against the stack, one with the merged wave branch and one after the wave 4 fixes. They caught problems the unit tests did not.
- **Wave 5 smokes (`adam-smoke-1`, `adam-smoke-2`):** the 8B Mind connected and acted. A 32B run of 8 minutes ran with `adam up` (10 thoughts, p50 3728 ms, 0 invalid). The recorded 32B output is only in the session record.
- **Wave M live L1 to L4:** the 401 on the MCP front door, the stream not found at startup, the act intent with no limits, the hibernated start that left no Body. L4 lost the end of the run: fixed in `697f555` (end once, with the wake the outcome names), with `cfbaa0b` (replay of the five live Body events) and `80cc758` (one `tool_call` log line per call).
- **Wave M live L5:** a failed act and eight `none` waits. The cause was a field the live client read that the server never sent (fixed).
- **Wave 6 smokes (`smoke-w6-20-a`, `smoke-w6-25-a`):** `smoke-w6-20-a` stopped thinking and the report exited 1 ([W6-21](../worknotes/w6-21.md)); the Mind stopped waking after 16:25:16Z ([W6-26](../worknotes/w6-26.md)).

## 3. What worked

- **Live runs found what unit tests could not.** Each wave retro has a section on this ([wave-2](wave-2.md), [wave-3](wave-3.md), [wave-4](wave-4.md)). The Body's real behaviour on Paper (craft on 26.1, chest transfers, bed and pathing) and the stream and wake paths only showed up against the stack.
- **The benchmark gate was a clear, early bar.** The owner's ruling ([0038](../../../../decisions/0038-tick-rate-does-not-slow-a-client-driven-body.md), and ledger D-P0-17) set 100% at 20 TPS as the pass bar. It was run repeatedly and passed at several commits, which gave a number nobody argued about.
- **Owner rulings were written down as decisions and kept.** Examples: recipe discovery ([0048](../../../../decisions/0048-recipe-discovery-is-part-of-the-game.md)), identity mode is about human observation, not agent belief ([0059](../../../../decisions/0059-identity-mode-is-about-human-observation-not-agent-belief.md)), persona files not artificially limited ([0060](../../../../decisions/0060-persona-size-limits.md)). Coders could cite a decision instead of guessing.
- **The revert check caught weak tests.** Each packet's tests were run again with the change reverted, and the report says which revert was done. Several coder tests passed under mutation and were rewritten (wave M lesson 2, [wave-m.md](wave-m.md)).
- **Commit per item and a worknote as you go.** Where coders followed this, a coder that stopped at its context limit left finished items committed on its branch. The finisher only had the rest to do.
- **Review by surface.** Wave M ran four read-only reviewers, one per surface (HTTP edge, gateway, Postgres, container). Round 1 of wave M found nine high-severity issues, and the split made each one easy to route.
- **Contract-first schemas.** The contract package and generator (P0-01) gave the Body, the Mind and the plugin one set of types with a drift check. It did not cover everything: the L5 client read a field the server never sent (section 4).
- **Two models ran.** The 8B and 32B Qwen3 models were pinned and both ran against the live stack. The 8B smokes gave real thought latencies.
- **Broad tests.** About 4000 tests across the TypeScript, Java and SQL parts (session figure) kept most regressions out of the packet branches.

## 4. What did not work

Each item gives the cause, the impact and the change for Phase 1.

### 4.1 Packets were too big for one coder context

- **Cause:** a coder has about 90k tokens of context and a working range of 40 to 60 tool uses. Packets bundled several items and read whole large files.
- **Impact:** large packets needed 3 to 9 finisher rounds (session figure). Each finisher re-read the same files and cost a merge and a check. Wave 5 R4c and R4d needed three finishers each; in wave M, eleven packets (WM-02 to WM-06, WM-08 to WM-13) each needed one to three ([wave-5.md](wave-5.md), [wave-m.md](wave-m.md) lesson 3).
- **Change for Phase 1:** size each packet to about two hours of work in one area. Commit each item as it passes. Write the worknote as you go, so a stopped coder leaves a record. Tell coders not to read whole big files; use grep and line ranges.

### 4.2 The orchestrator hand-coded small patches

- **Cause:** a failing check or a merge conflict looked small enough to fix directly. Wave 5 lesson 2 ([wave-5.md](wave-5.md)) records the orchestrator editing the tails of fix branches to get past checks.
- **Impact:** the owner objected. The edits were not reviewed by a coder, and the branch history no longer matched what a coder had reported.
- **Change for Phase 1:** coders write all code. Ops runs merges, checks and live runs. If a check fails, the orchestrator sends the failure back to a coder with the output.

### 4.3 Agent churn and open-ended watches

- **Cause:** too many coders, reviewers and monitors ran at once. Several long watches were left open.
- **Impact:** context and machine load (the resume card records about six agents at once as the practical limit on this machine), duplicated work, and the owner's complaint that the watches were not useful.
- **Change for Phase 1:** batch the ops work into scheduled passes. No open-ended watches: each wait has a bounded check and a stated end. Keep the number of agents in flight to what the machine can run.

### 4.4 The live harness was never run live before the first exit attempt

- **Cause:** the harness (`adam-run`, the report generator, the live cases) was built in wave 6 and tested with unit tests and dry runs. It was first run against the live stack at the exit attempt.
- **Impact:** the live runs failed on harness bugs, not on the system: a missing secrets junction in a new worktree, Windows process-path probes, a report manifest shape mismatch, a report database credential, stderr lost, death handled as a hang, stale PID kills, and a fresh-volume gate that proved nothing. Wave 6 lessons and [W6-21](../worknotes/w6-21.md), [W6-25](../worknotes/w6-25.md) and [W6-26](../worknotes/w6-26.md) record the individual fixes.
- **Change for Phase 1:** smoke the harness against the stack at the end of the wave that builds it. A dry run is not a run; a run is a run against the real stack with a recorded result.

### 4.5 Real issues were found late, in one campaign-wide review

- **Cause:** the security and boundary review was scheduled once, at the end of the campaign. Wave-end reviews were narrower.
- **Impact:** the adversarial review by nine reviewers found issues that had been in the code for several waves. They are listed in section 5. The fix round A to F was needed to close them.
- **Change for Phase 1:** adversarial review of security and boundary code in every wave, not once at the end. Brief reviewers narrowly (one surface, a named list of files). A reviewer has a 60-turn limit; expect a resume for a larger review and say so in the brief.

### 4.6 Decision numbers collided across parallel branches

- **Cause:** parallel packet branches each took the next free decision number.
- **Impact:** two decisions used number 0066 on different branches (session record). The resume card's "next free number" is also out of date: it says 0067, but 0067 and 0068 now exist.
- **Change for Phase 1:** assign decision numbers up front in the packet brief, and check the number against `docs/decisions/` before a commit.

### 4.7 Pin and release-age rules had no mechanical check until the fix round

- **Cause:** the rule (two weeks minimum age, exact pins) was written in [decision 0005](../../../../decisions/0005-pinning-and-security-updates.md) and the coders' briefs. Nothing checked it.
- **Impact:** the review found npm packages 4 to 8 days old in the tree, which broke the rule.
- **Change for Phase 1:** a CI check on exact pins and on the release age of each added package, with the age recorded in the report.

### 4.8 Flaky timing tests accumulated

- **Cause:** timing-dependent tests (reconnect, presence touch, wake waits) were not quarantined when they first flaked.
- **Impact:** repeated reruns; the wave M lesson 7 and the W6-16 reconnect flake ([w6-16](../worknotes/w6-16.md)) both record this.
- **Change for Phase 1:** a flake log. A test that flakes twice goes to a fixed owner with a deadline, and tests use injected clocks instead of wall-clock waits.

### 4.9 Tests that pass with the fix reverted

- **Cause:** a test asserted the outcome without exercising the changed path.
- **Impact:** the claims review found tests that would still pass if the behaviour were reverted. Each one was rewritten.
- **Change for Phase 1:** the revert check is mandatory before a commit. The report states which change was reverted and the test that failed.

### 4.10 CI skipped integration tests

- **Cause:** the CI job's test selection did not include the integration cases in every job.
- **Impact:** the campaign review found 43 integration tests that CI never ran. They were addressed in the CI part of the fix round (see [fix-f.md](../worknotes/fix-f.md)).
- **Change for Phase 1:** CI reports how many integration cases ran and fails if the count drops.

### 4.11 Shared worknote files caused add/add conflicts

- **Cause:** several branches appended to the same worknote file (wave M lesson 4).
- **Impact:** conflicts resolved by hand.
- **Change for Phase 1:** one worknote per packet, in a `worknotes/` directory. Wave 6 did this.

### 4.12 SQL and secrets were reasoned about, not run, until ops ran them

- **Cause:** coders had no database in their lane, and the integration secrets (`compose/secrets/`, gitignored) existed only where the stack was started (wave M lessons 5 and 6).
- **Impact:** grants and the CTE and `SET ROLE` paths were not exercised until ops ran them. A new worktree lacked the secrets, which was one of the harness bugs in 4.4.
- **Change for Phase 1:** give coders a database and a secrets path in their worktree by a documented setup step, and test the setup step itself.

### 4.13 The orchestrator made design calls without the owner

- **Cause:** the orchestrator decided questions that were the owner's (wave M lesson 10).
- **Impact:** rework when the owner ruled differently.
- **Change for Phase 1:** a short owner-decision list at the start of each wave, with each design question on it and a default that the owner can change.

