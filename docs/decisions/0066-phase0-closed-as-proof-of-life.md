# 0066. Phase 0 is closed as proof of life; the spec's exit runs are waived by the owner and deferred

- Status: Accepted (owner)
- Date: 2026-11-10
- Spec: 10 (Phase 0 — Adam, the exit paragraph; the exit is the system acceptance for Phase 0), 5.3.1, 5.9
- Packet: CLOSE-1
- Decisions: 0061 (exit readings), 0064 (exit-run lives), 0065 (damage wakes the Mind)
- Resume card: [docs/analysis/phase0/RESUME.md](../analysis/phase0/RESUME.md)

## Context

Phase 0 was meant to end with an Adam run that met spec section 10: five in-game days alive, a 24-hour
continuous run with a planned restart and a Body restart mid-intent, three durable intents completed without
a model call, every action with a receipt, and a thought latency under 15 s on the 32B model. Wave 6 built the
harness for those runs (the 32B and 8B protocols, the ops checklist, the report generator, the Glass page). The
long runs were not performed.

The owner has decided to stop Phase 0 at what is shown below, and to move on to scaling: more agents per player
(up to 20 per player) and the sovereign players and rangers. The owner will work out the remaining testing in
later phases.

## Decision

1. Phase 0 is closed as **proof of life**: the mechanisms run against the real Paper server, the real Body and a
   real local model. It is not a survival or endurance result.
2. The spec section 10 exit criteria are **waived by the owner, not met**. This is the owner's waiver, recorded
   here. Each criterion is listed as not demonstrated in the section below.
3. The long exit runs are not performed. The 32B protocol ([adam-run-32b.md](../analysis/phase0/adam-run-32b.md)),
   the 8B protocol ([adam-run-8b.md](../analysis/phase0/adam-run-8b.md)) and the ops checklist stay in the repo. Their
   harness paths (the planned restart, the Body restart, the 32B protocol, the 5-day report) exist and are
   documented, but **none of them has been exercised end to end**.
4. Decision 0061's readings stay provisional. Nothing in this decision sets the model floor.

## What was demonstrated (evidence)

- **Body benchmark at 20 TPS, 100% in every scenario, at three commits.** Wood to stone tools, food, shelter,
  bed, chest and blocked path, 10 runs each, at `5aa8a83` (wave 2), `93d6640` (wave 4 gate) and `251ff8d` (wave 4
  final commit). Pointer: [bench-results.md](../analysis/phase0/bench-results.md) (the table). The raw files are in
  `docs/analysis/phase0/bench-runs/`. The 10 and 5 TPS rows are findings only. The `chest` scenario does not
  check receipts, and the TPS floor in the abort criteria is not enforced (worknotes `w6-13.md`).
- **Live sovereign MCP against the real Body.** The MCP tools ran against the live Paper server and the Body in
  the wave M live runs (L1 to L5, [wm-live-findings.md](../analysis/phase0/worknotes/wm-live-findings.md)). The
  findings show the MCP reaches the Body and reports its outcomes. They also show failures that were fixed:
  a 401 from the token reader, an act intent with no limits, a stream-not-found at startup, and a live client that
  read a field the server never sends. Two outcomes were not fixed in code: one run's `gather` made no action at
  spawn (the L4 open question), and a path-blocked act was reported as `action_failed` to the Mind.
  The run labelled "Smoke 6" is the last one numbered in that file; no "smoke 7" is recorded in the repo.
- **Live Adam smokes on the local model, where the Mind connected.** The Mind connected to the Thinker and
  thought on the 8B fast tier (`qwen3:8b`). Recorded thought latency: 0.8 to 2.4 s in the wave 5 smoke
  ([wave5-adam-smoke-2.md](../analysis/phase0/worknotes/wave5-adam-smoke-2.md)). A wider range of 0.6 to 7.7 s
  was reported for the wave 6 runs; the figures are not in the repo's worknotes, so treat that range as
  unverified here. The Body joined Paper (`body_started`, generation 6, in smoke `smoke-w6-25-a`,
  [w6-26.md](../analysis/phase0/worknotes/w6-26.md)). The harness wrote a run report.
- **The harness found its own faults, and they are fixed.** A run whose Mind stopped thinking after 14:12:42Z
  (`smoke-w6-20-a`, [w6-21.md](../analysis/phase0/worknotes/w6-21.md)). A Mind that did not wake on damage
  with no intent running; fixed by decision 0065 (`2b2a79a`). The 8B smoke life died at 16:26:14Z, six minutes
  after the Body started, and the harness then mis-handled the death (its no-thought rule aborted the run at
  16:35:25). That is fixed by the life-ended rule: a dead life ends `ended (life_ended)` with a safe stop and a
  report (`d7288cb`, and `6a223ef` for the survival check). Diagnosis: [w6-26.md](../analysis/phase0/worknotes/w6-26.md).

## What was not demonstrated

Each line is a spec section 10 exit criterion. Each is **waived for Phase 0 by the owner, deferred**.

- An agent survives 5 consecutive in-game days with a bed, food and stone tools: waived for Phase 0 by the owner, deferred.
- 24 real hours of continuous operation across a planned restart: waived for Phase 0 by the owner, deferred.
- At least three durable intents run to completion through chatter and interruptions without a model call: waived for Phase 0 by the owner, deferred.
- A Body restart mid-intent resumes from its checkpoint: waived for Phase 0 by the owner, deferred.
- Every action has a receipt: waived for Phase 0 by the owner, deferred.
- Thought latency under 15 s on the 32B model (p95): waived for Phase 0 by the owner, deferred.
- The model floor is recorded (the smallest model that passed): waived for Phase 0 by the owner, deferred.
- Inference calls per useful autonomous minute are recorded: waived for Phase 0 by the owner, deferred.

Also not shown: a 32B run of any length; a full 8B exit run (`ag_adam_04`); any Adam run that completes an intent
without a model call. The 8B death within six minutes is one data point, not a verdict on the 32B run. The Wave 6
retro folder has no retro file; the wave 5 retro is the last one recorded.

## Consequences

- No run is started under the exit protocols. The lives `ag_adam_03`, `ag_adam_04` and `ag_smoke_01` (0064) stay
  as they are; no run reuses a life or a volume.
- The owner items that the protocols still hold open stay open. They are listed in
  [adam-run-owner-decisions.md](../analysis/phase0/adam-run-owner-decisions.md) and in RESUME.md. Closing Phase 0
  does not settle them.
- Phase 1 and the scaling work start from the proof-of-life state above, not from a passed exit.
