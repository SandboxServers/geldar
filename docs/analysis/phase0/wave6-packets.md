# Wave 6: the Glass, the Adam runs and the campaign review

Draft by a planning agent, 2026-11-10, from `origin/main` at `74857cf` (wave M merged). Part of the Phase 0 campaign ledger ([README.md](README.md)). Plan shape follows [wave5-packets.md](wave5-packets.md). Owner questions are at the end; nothing here is decided until the owner answers. This wave implements nothing by itself: it is the plan the orchestrator dispatches from.

## 1. Context and exit criteria

Wave 6 is the last wave of Phase 0. The spec (section 10, "Phase 0 — Adam") ends the phase with three things: a Thought Stream v0 for humans, two measured Adam runs (Qwen3 32B first, then Qwen3 8B) and the campaign review. Wave 5 built the Mind; wave M built the ranger front door (a separate track, not Phase 0 Adam). Wave 6 does not add behaviour to the Body or the Mind beyond the review fixes that the exit runs depend on.

**Exit criteria, quoted from spec section 10, Phase 0** (the ledger's Exit block copies them; the spec is the source):

1. An agent survives **5 consecutive in-game days** (about 100 real minutes at 20 TPS; the 5 days are 120,000 ticks) with a bed, food and stone tools. The stack also runs **24 real hours** of continuous operation across restarts.
2. At least **three durable intents ran to completion** through chatter and interruptions **without a model call**.
3. **Every action has a receipt.**
4. **A Body restart mid-intent resumed from its checkpoint.**
5. **Recorded:** the **model floor** (smallest model that passed) and **inference calls per useful autonomous minute**. **Thought latency under 15 s.**
6. If no model passes, stop and fix the Body/Mind split.

The spec also says: "Survival alone mostly measures the reflex code; the intent metrics measure the thesis." The report must show both.

Background that the runs rely on: the 20 TPS benchmark gate is a precondition (spec section 10: "The body benchmark runs first, before any model is attached"; decision D-P0-17 pass bar: 100% at 20 TPS, with 10 and 5 TPS recorded as findings only). Decision 0051 fixes the models: `qwen3:32b` (strong) and `qwen3:8b` (fast), Q4_K_M, `num_ctx` 8192, one job at a time per model, the 8B run as a separate life `ag_adam_02` on a fresh world volume. Decision 0058 sets the character knowledge boundary (thought prompt v2). Decision 0059 means humans may watch the shard, and the agents are never told. The Thought Stream is for humans only and must never feed any agent (spec 5.13; threat model Principle 1 and section 4 item 9: nothing lets a human act in the world, so the Glass is read-only).

**Where the spec is vague, the packets do not invent thresholds.** These are Open questions for the owner (section 4 below), each with a recommendation:

- **"Survives"**: whether any death in the window fails the run (recommendation: yes; the `death` event is the measure).
- **"Useful autonomous minute"** is not defined anywhere in the spec. Without a definition, "inference calls per useful autonomous minute" cannot be computed.
- **"Thought latency under 15 s"**: p50, p95 or max (recommendation: p95 under 15 s, with p50 and max reported; the 25 s job deadline in wave 5 stays the hard limit).
- **"A bed, food and stone tools"**: no measurable definition (which item, how many eats, at which day).
- **5 days and 24 hours**: the same run or two runs (recommendation: one continuous run of at least 24 real hours, which contains the 5-day segment, with a planned restart and a Body restart mid-intent).
- **Model floor**: the spec gives no tier below 8B for Phase 0, so "smallest model that passed" can only be 8B or 32B.

The rest of the plan is conditional on these answers. Packets that depend on an owner answer are marked `BlockedDecision`.
