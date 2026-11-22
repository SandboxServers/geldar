# 0424. A persistent per-agent seen-block map is the only world memory for building

- Status: Proposed (design). The behavior is Accepted: owner ruling 2026-11-22, ruling 8. **Flagged for the owner:** the death rule below.
- Date: 2026-11-22
- Spec: section 5 ("Memory on death"), section 6.9 permadeath text, principle 4; decisions 0154 (the viewport), 0323 (erasure covers life-keyed tables). Project rule: agents are never told they are watched.

## Decision

1. **No wall-hack.** An agent knows only blocks its character has seen. The Body records every block a viewport ray reveals (the rules of `golem/src/perception/view/viewport.ts`: line of sight, loaded chunks, dark range) plus blocks it placed or broke, each with a last-seen time.
2. **Storage.** One map per `life_id`, kept as 16x16x16 sections in a NATS KV bucket, written in coalesced batches (dirty sections flushed on an interval) like the checkpoint store. The recorder is bounded in work per tick.
3. **Kept across death (owner choice).** On death the map is not erased. Whether the next life of the same agent reads its predecessor's map is **open question Q1** for the owner; the default coded is: kept and not read until the owner answers. With permadeath off (spec 6.9: "memory intact") a successor reading it matches the spec; with permadeath on, the spec moves a dead agent's memory to the read-only archive, so a successor reading it would conflict. Erasure requests (0323) must delete the maps of the erased agent: a packet adds the bucket to the erase coverage test.
4. **Read verb.** A free `survey` tool returns a layered region read, run-length encoded, with last-seen age per run. The existing `see` and `view` stay. `survey` never returns owner data and never an unseen block; an unseen cell reads `unknown`.
5. **Never to telemetry-to-agent paths.** The map and the survey are not published on any subject an observer, eventsink or telemetry consumer reads on behalf of an agent, and no Mind text says more than the tool description does.

## Why

Without a read of the world, a long plan is written blind; a wall-hack would let agents see everywhere. Seeing by sight keeps the world the agent's own.

## Consequences

- A leak test: a block behind a wall, or in an unloaded or unseen chunk, is absent from the map and from `survey`.
- A size and write-rate figure is measured on the test shard before go-live, not assumed (BLD-18).
