# 0424. A persistent per-agent seen-block map is the only world memory for building

- Status: Proposed (design). The behavior is Accepted: owner ruling 2026-11-22, ruling 8, and the owner answer of 2026-11-22 that the next life reads the predecessor's map.
- Date: 2026-11-22
- Spec: section 5 ("Memory on death"), section 6.9 permadeath text, principle 4; decisions 0154 (the viewport), 0323 (erasure covers life-keyed tables). Project rule: agents are never told they are watched.

## Decision

1. **No wall-hack; the facing cone.** The seen field of view is the facing view cone, 90 by 45 degrees by default (config `building.seen_fov`), line of sight; a head turn reveals more. An agent knows only blocks its character has seen. The Body records every block a viewport ray reveals (the rules of `golem/src/perception/view/viewport.ts`: line of sight, loaded chunks, dark range) plus blocks it placed or broke, each with a last-seen time.
2. **Storage.** One map per `life_id`, kept as 16x16x16 sections in a NATS KV bucket, written in coalesced batches (dirty sections flushed on an interval) like the checkpoint store. The recorder is bounded in work per tick.
3. **Kept across death and inherited (owner choice).** On death the map is not erased, and the NEXT life of the same agent reads its predecessor's map: the successor's `survey` includes the inherited cells with their original last-seen ages, marked `inherited`, and never a cell the predecessor did not see. **Deviation from the spec:** with permadeath off (spec section 6.9, "memory intact") this matches the spec; where permadeath is on, the spec archives a dead agent's memory read-only (section 5, "Memory on death"), and the owner chose inheritance over that rule. Erasure requests (0323) delete the maps of every life of the erased agent.
4. **Read verb.** A free `survey` tool returns a layered region read, run-length encoded, with last-seen age per run. The existing `see` and `view` stay. `survey` never returns owner data and never an unseen block; an unseen cell reads `unknown`.
5. **Never to telemetry-to-agent paths.** The map and the survey are not published on any subject an observer, eventsink or telemetry consumer reads on behalf of an agent, and no Mind text says more than the tool description does.

## Why

Without a read of the world, a long plan is written blind; a wall-hack would let agents see everywhere. Seeing by sight keeps the world the agent's own.

## Consequences

- A leak test: a block behind a wall, or in an unloaded or unseen chunk, is absent from the map and from `survey`.
- A size and write-rate figure is measured on the test shard before go-live, not assumed (BLD-18).

## Interpretation, 2026-11-22, by the coordinator from the owner rulings; owner may overrule

Applied to decision 1 (no wall-hack) and decision 3 (inheritance), from the owner rulings of the same date:

- A live verification read of a cell is written to the seen map only when that cell is in view now, by the same test the recorder uses (`cellInView`). An out-of-view verification read is never recorded. For an out-of-view cell the plan or mismatch report to the Mind says only "cell not as expected", with no block name, so verification cannot probe unseen cells. Recording a block the Body itself digs is fine when the agent saw it or is adjacent to it with line of sight.
- Stale cells are shown, not hidden or silently refreshed. A cell reads back with its last-seen age and an `inherited` mark when it came from a predecessor life. Only a fresh in-view sighting updates a cell and clears the mark.
