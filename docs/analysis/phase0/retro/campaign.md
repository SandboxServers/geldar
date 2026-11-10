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

