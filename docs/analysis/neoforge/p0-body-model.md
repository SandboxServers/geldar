# P0: Body model for a NeoForge shard (golem plus join test, or in-server bodies)

Date 2026-11-16. Author: packet-coder (NeoForge campaign, branch phase1/nf-p0-note). Status: proposed, for owner decision. No code, node, VM or world changed by this note.

## 1. Question

Which Body runs on the NeoForge scratch (second) shard?

- **(A) golem**: our Node program, mineflayer, vanilla protocol. It joins through Velocity like the Paper shard does.
- **(B) in-server bodies**: Goldar, a NeoForge mod (MIT licence) in which each body is a `ServerPlayer` inside the server process.

## 2. Evidence: Goldar (read from source, 2026-11-16)

What the source does, as read. Files were read in part; see the last paragraph of this section.

| Topic | What Goldar does |
|---|---|
| Body class | `Body` extends `BodyBase`, which extends `ServerPlayer`. Built with `ClientInformation.createDefault()`. |
| Join | `server.getPlayerList().placeNewPlayer(noConnection(), body, CommonListenerCookie.createInitial(profile, false))`. |
| Fake connection | `noConnection` is a `Connection` subclass over a Netty `EmbeddedChannel`, set by reflection. `send` is a no-op, `isConnected` is true. It calls `NetworkRegistry.configureMockConnection`. |
| Login path | Skips `ServerLoginPacketListenerImpl`: no whitelist check, no online-mode authentication, no Velocity forwarding. Nothing in his source mentions login, whitelist or Velocity. |
| UUID | `UUID.nameUUIDFromBytes("Goldar:" + id)`. This is not our `OfflineUuid`. |
| Tick | `Goldar.tick` calls `world.tickAll()` on the server thread. For each awake body it runs `plan.tick`, and it calls `chunkSource.move(this)` every 10 ticks. |
| Pathfinding | On the server thread. `MAX_NODES` 40000, `MAX_PLANS` 6. |
| MCP HTTP | Handlers run in a cached thread pool and reach the world via `server.submit(...).get(15 s)`. |
| Snapshot | Scans up to 33 x 33 x 33 blocks, and up to 32 ray-cast candidates in each of 9 groups per look or wait call. |
| Cost of 19 bodies | Not measured. Any estimate is from code only. |
| Our spec items he lacks | NATS, event export, the Velocity gate and life registry (he has his own bearer-token endpoint, which binds all interfaces by default), block ownership, gravestones. |
| Tests and CI | Three test files. CI actions are pinned by tag, not by commit SHA. |
| Read coverage | Plan, Reflexes, World, Tasks and Skills were only partly read. |

## 3. Perception check against spec 5.2

| Spec 5.2 rule | Goldar | Result |
|---|---|---|
| Notable blocks in line of sight, range 16 | Matches | Match |
| Entities in line of sight, range 24 | Matches | Match |
| Remembered blocks, cap 256 | Matches | Match |
| Speech limited to `chat_radius` | Matches | Match |
| Signs need distance 6 or less and line of sight | Distance and line of sight are checked | Partial: no facing test |
| `blocks_summary` counts (8-block radius) | Counted before the line-of-sight test | Departs: counts blocks behind walls (hidden stone, water, lava, logs) |
| Shrine and Moot Stone | Appear within 64 blocks without line of sight | Departs |
| Remembered blocks expiry | Never expire, except when seen changed | Departs |

## 4. Contract diff

Compared: Goldar's `tools.json` against our `contract/src/generated/mcp-tools.ts`.

| Item | Goldar | Ours |
|---|---|---|
| Tool count | 14 | 16 |
| Extra tools | none | `see`, `view` |
| The other 14 tools | Same name, args, limits and descriptions | Same |
| `act` intent description | No build program text | Adds the build program text |
| `act` actions description | Does not list the verbs | Lists the verbs |
| `act` verbs | No `unstick` | Has `unstick` |

Result schemas and error wording were not diffed.

## 5. Rule check against decisions 0058, 0059 and 0068

These are findings from a read of Goldar's source. They are not a ruling. Each one needs an owner decision on whether it conflicts.

| Rule area | What Goldar sends or does | Conflict noted in the read |
|---|---|---|
| 0068: wake-reason wording | Wake reasons are raw codes: `directly_addressed`, `precondition_failed`, `goal_completed`, `unexpected_damage`, `intent_run_too_long`, `new_agent_nearby`, `proposal`, `day_night`. | Yes: 0068 wants plain wording. |
| 0068: thinking budget | Field `budget_remaining_thoughts`, message "No thoughts left." (credit meta). Ours uses `thinking_left`. | Yes: field name and wording differ. |
| Shard naming | Resource `geldar://shard/rules` names the shard. | Yes, as listed in the read. |
| Prompts and sleep | Prompts `geldar:play`, `geldar:reflect` and `geldar:newborn` say when to sleep and sequence the loop: "Live your day in a loop: look at the world, wait for something to happen, act on it, and sleep when the day ends." | Yes, as listed in the read (0058, 0059). |
| Built-in skills | Opt-in skills plan, bootstrap, chop, strip_mine, smelt, cook, gather_food, shelter and store carry whole progression strategies. | Yes, against 0058 and recipe discovery (0048), unless they respect locked recipes. Not read. |
| Agent is watched | No agent-visible text says the agent is watched. Grep of World, Mcp, Snapshot, Mind, Glass, Voice and Commons found none. | None found. |
| Glass | Shows reasoning to humans after 60 s. Not agent-visible. | None found. |

## 6. Evidence: golem (repo at accb08f4)

| Item | Value |
|---|---|
| Stack | TypeScript, Node 22, mineflayer 4.39.0 |
| Auth | Offline auth through the Velocity gate, with the NATS life registry. Golem writes the key before every connect. After a hard kill there is a 60 s lease gap. |
| Size | About 26.5k source lines and 29.4k test lines in nine areas |
| Tests | 242 test files, about 2,181 test cases |
| Bench, 2026-11-09 at commit 251ff8d, 20 TPS | 10 of 10 runs for six scenarios; p50 and p95 in ms (below) |
| Bench, 5 of 5 at 10 and 5 TPS | Same date |
| Newest bench | 2026-11-09. None newer. |
| Resources, 2026-11-15 | 79 to 177 MiB per Body, against a 2 GiB limit. Colo about 94 to 97 percent CPU idle. |

Bench p50 and p95 (ms), 20 TPS, 2026-11-09:

| Scenario | p50 | p95 |
|---|---|---|
| wood-to-stone-tools | 499 | 23162 |
| food | 1646 | 2668 |
| shelter | 563 | 1063 |
| bed | 312 | 1103 |
| chest | 9 | 437 |
| blocked-path | 6200 | 6445 |

Known gaps:

- No aborted receipt for abandoned actions.
- Partial crash reconciliation.
- The build action has no handler.
- The 32B, 24 h and 5-day exit runs are not done.
- Block-owner queries go over NATS with a 300 ms timeout. An unknown owner means protected.

## 7. What is NOT yet known (the reason a join test is needed)

- Whether a vanilla-protocol golem Body can join a NeoForge 26.1.2 server behind Velocity, with Proxy Compatible Forge 1.3.1 and no registered payloads.
- Which UUID and which name the server sees for the golem Body.
- The NeoForge 26.1 handshake for non-NeoForge clients. Sources available: the NeoForge docs, and third-party javadoc mirrors for 1.20.4 to 1.21.5. From those mirrors: `NetworkRegistry.initializeOtherConnection` handles non-NeoForge connections; payloads marked `optional()` do not block a join; any missing non-optional payload denies the connection. These are 1.20.4 to 1.21.5 facts, not 26.1 facts. Confirm them on 26.1.2.

## 8. Recommendation

Option A, golem, gated by the P0 join test on the scratch stack variant with suffix `nf` (see `compose/opt-in/scratch-neoforge.yml` in branch phase1/nf-scratch-overlay).

Pass criteria for P0:

1. A golem Body registered in the scratch NATS registry joins through the scratch Velocity and appears in the server's player list.
2. It completes one `goto` action and one `mine` action.
3. The UUID and name seen by Velocity and by the server are recorded, and they equal what the Paper stack shows for the same Body id.
4. A human vanilla client joins the same port.
5. Server tick time and memory with the Body connected are recorded against the 1.5 CPU and 3 GB cap.

Fail criteria and fallback:

- If criterion 1 fails, record the disconnect reason.
- The fallback is a small NeoForge adapter that gives golem a server-side player, while the brain stays in golem. It is not Goldar wholesale.
- Revisit option B only if the fallback also fails.

What to borrow from Goldar regardless:

- Server-driven movement inputs.
- The `configureMockConnection` pointer.
- The per-version source layout.
- The shrine and governance ideas, as progression input.

## 9. Owner decisions needed

- (a) Approve P0 on the Colo scratch stack. The node steps are run by the main orchestrator or ops.
- (b) Approve a human connection route (tunnel or proxy) for the human client in criterion 4. This is a separate approval.
- (c) Confirm golem is the Body for the second shard. This note recommends yes.
- (d) Assign a decision number block when a decision record is warranted.

## 10. Gaps to flag

- The scratch stack (`compose/phase0.yml` plus the overlay) has no golem-body, geldar-mcp or players-host service. Those exist only in `compose/colo.yml`. The Claude-mind test therefore needs a follow-up packet, P0b, that adds them to a scratch NeoForge stack.
- The scriptorium dev seam `GELDAR_DEV_MCP_URL` needs these settings: the MCP listen address and port, an id shape of `^[a-z][a-z0-9-]{0,30}$`, and a separate dev token file. It takes an http URL, host `host.docker.internal`, a port from 1024 to 65535, and only one player while it is set.
- How the Mind host reaches the node is not settled.

Result: the join test results are in [p0-findings.md](p0-findings.md).
