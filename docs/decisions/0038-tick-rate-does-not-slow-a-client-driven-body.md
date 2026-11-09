# 0038. `/tick rate` does not slow a Mineflayer-driven Body, and the world clock has a 20-tick resolution

- Status: Accepted (measured; made autonomously overnight, owner review requested)
- Date: 2026-11-09
- Spec: section 5.14 (time dilation, `/tick rate`); section 10 Phase 0 (body benchmark); decision 0030 (`world_time.ticks` is the world age); packet P0-10a

## Decision

1. Phase 0 treats server time dilation (`/tick rate N`) as **not slowing the Body**. A Mineflayer bot runs its physics on its own 50 ms client timer and sends movement packets at about 20 Hz whatever the server's tick rate. The benchmark's 10 and 5 TPS rows therefore measure "an unslowed client against a slowed server", and the results file, the retro and the wave report say so in plain words. Spec 5.14's "time dilation" remains an untested hypothesis for any component that is driven by wall time; it is not adopted for the Body.
2. `bot.time.age` (and so `world_time.ticks` and `world_ticks` in action results) is quantised to 20 ticks, because the server sends a time update only every 20 ticks. The harness and the benchmark results state this resolution (`worldAgeResolutionTicks: 20`) and never present sub-20-tick world-tick numbers as measurements. Wall-clock latency in milliseconds is the primary latency number; world ticks are context.
3. The harness keeps `timeScale` for timeouts only: at a lower TPS, timeouts are stretched; actions are not expected to take longer.

## Why

Measured on the live 26.1.2 shard (P0-10a): a 12-block `goto` took about 2.0 s at 5 TPS and about 2.0 s at 20 TPS; `bot.time.age` advanced in steps of 20 at a correct rate (about 20 ticks/s at 20 TPS and about 4 ticks/s at 5 TPS). The server processes incoming movement packets as they arrive, not once per tick, and Mineflayer's physics clock is independent of the server.

## Consequences

- The benchmark gate is the 20 TPS result (owner ruling): 10 and 5 TPS are findings only.
- Anything that depends on slowing the Body (an Adam run at reduced TPS to give a slow model time to think) cannot rely on `/tick rate`. A slower model needs wait-and-plan behaviour (the Body keeps its own timers and intents) or a different mechanism; that is a design question for wave 4 and 5, flagged to the owner.
- Server-side behaviour at 10 and 5 TPS (rubber-banding, "moved too quickly", keep-alive) is recorded per scenario when it appears.
