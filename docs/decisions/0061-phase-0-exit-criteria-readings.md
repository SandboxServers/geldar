# 0061. Readings of the Phase 0 exit criteria and the wave 6 owner questions

- Status: Accepted provisionally (orchestrator, owner may revise), 2026-11-10
- Date: 2026-11-10
- Spec: section 10 ("Phase 0 — Adam", the exit criteria); the open questions in [wave6-packets.md](../analysis/phase0/wave6-packets.md) section 4, items 1 to 6, 9, 10 and 11

## Context

Spec section 10 states the Phase 0 exit criteria in words that need a measure before a run can give a verdict: "survives 5 consecutive in-game days", "useful autonomous minute", "inference calls per useful autonomous minute", "thought latency under 15 s", and the 24-hour continuous run. The wave 6 plan asked the owner for each reading. The owner is away and has asked the orchestrator to note each decision and keep working, so the readings below are provisional. The owner may revise any of them; a revision replaces the matching line here and is noted in `overnight-decisions.md`.

## Decision

1. **Survival.** Any death in the 5-day window fails the run. The `death` event is the measure. The bed, food and stone tool checks are taken at each day boundary: a placed and slept-in bed owned by the agent, at least one food eaten that day, and a stone pickaxe in the inventory.
2. **Useful autonomous minute.** A real minute in which an intent was running and the Body issued at least one action with a receipt, with no model call waited on that minute.
3. **Inference calls per useful minute.** Thoughts and reflections are counted and reported separately. The total is the headline.
4. **Thought latency.** Reported as p50, p95 and max from `thoughts.latency_ms`. The criterion is p95 under 15 s. The 25 s deadline stays the hard limit for each thought.
5. **The 24 hours.** One continuous run of at least 24 real hours that contains the 5-day segment, with one planned restart and one Body restart mid-intent.
6. **Model floor.** Nothing below 8B is run. The floor is 8B or 32B: the smaller model that passes its verdict is the floor.
9. **Benchmark count.** Decision D-P0-18 is accepted: `--runs 10` for the recorded benchmark (OPS-0 and OPS-4).
10. **Glass access.** Glass is loopback only, with no authentication and no tunnel in Phase 0. The Observatory edge is deferred to Phase 2 (D-P0-13), so the SSO rule in spec 5.13 and 8.4 does not apply yet. The tunnel design is a Phase 1 item.
11. **Least-privilege roles.** A read-only Postgres role, `geldar_glass`, is created by migration `sql/0005_glass_reader.sql` (owned by wave 6 packet W6-09). It has SELECT on exactly the tables Glass and the report generator read, no sequences, no writes, and it stays NOLOGIN until `db migrate --set-role-password geldar_glass`. This is a stated exception to "no packet adds a SQL migration (D-P0-11)". The read-only NATS consumer is deferred to Phase 1, because Glass reads Postgres only.

Items 7 (the `stuck` signal), 8 (the BC-10 v3 line), 12 (the spec edit), 13 (decision 0060, which exists), 14 to 16 (review and retro scope) are answered in the wave 6 plan and not repeated here.

## Why

The readings follow the spec's own words and the owner's earlier rulings. "Survives" means no death, because a death ends the continuity the 24-hour criterion measures. The intent measures are the thesis (the spec says the intent metrics measure the thesis, and survival alone mostly measures the reflex code). Reporting thoughts and reflections separately keeps the cost of the Mind visible. The p95 is the usual latency measure for a deadline; the 25 s deadline is kept as the hard limit so that p95 cannot hide a timeout.

The Glass is read-only and loopback only because it shows the thoughts to humans and must never feed an agent or let a human act in the world (threat model Principle 1). Phase 0 has no outside access to protect, so a tunnel and SSO wait for Phase 1 and Phase 2.

## Consequences

- W6-14 (the run protocols) and the report generator (W6-12) use these readings; the criteria file carries the numbers.
- W6-03 records the no-stuck-signal decision as a paragraph of this record. The watchdog and the NATS read-only consumer are named as Phase 1 items.
- W6-09 owns migration `sql/0005_glass_reader.sql`, its grants test in `sql/test/check-schema.sql`, and an IT case gated by `GELDAR_IT`.
- If the owner revises a reading, the protocols and the criteria file change before the run they affect, and this record is updated.
