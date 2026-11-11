# 0101: Lakitu feed plugin

Status: Proposed (orchestrator, 2026-11-11; owner to confirm)

## Context

Decision 0100 fixes the feed contract. Card P1-C2b-01 implements the Java side in `plugin/core/src/main/java/dev/geldar/core/lakitu/`. This record states what that package promises and the numbers it enforces.

## Decision

1. **Invisible by construction (I1).** The package creates no entity, tab-list or player-list entry, join or leave message, scoreboard, team, bossbar or particle, and changes nothing agents perceive. It reads only chunks that `World.isChunkLoaded` reports as loaded; it never loads, generates or ticket-holds a chunk. The `LoadedWorld` view has no method that could. `LakituReadOnlyTest` scans every source file in the package for the names that would break this, and for any chunk accessor.
2. **Read-only, one way (I2).** No command, chat line, input packet or write. The package registers `MONITOR` listeners only, which never cancel or modify an event. A cancelled event is read (`isCancelled`) and skipped, because it changed nothing. Positions come from `AgentRegistry`, whose Bukkit implementation calls getters only.
3. **Config caps as set in code** (`lakitu.*` in `config.yml`, read once at enable; a value above its maximum is clamped and logged once; below 1 is raised to 1):

   | Key | Default | Maximum |
   |---|---|---|
   | `lakitu.enabled` | `false` | n/a |
   | `lakitu.radius_chunks` | 4 | 4 |
   | `lakitu.max_sections_per_frame` | 256 | 256 |
   | `lakitu.max_updates_per_frame` | 512 | 512 |
   | `lakitu.max_panes_per_session` | 4 | 4 |
   | `lakitu.frame_hz` | 5 | 10 |

4. **Load behaviour.** The update queue is bounded at `max_updates_per_frame`; when full the oldest entries are dropped and counted as `dropped_updates`. A chunk read that would exceed `max_sections_per_frame` is refused whole (`feed_overloaded`), never truncated silently. A section that is all air is not sent. The pane cap is enforced in `PaneRegistry`: the fifth pane returns `pane_cap_reached` and allocates nothing.
5. **Tick budget: to be measured.** The proposed budget is an added tick time under 1 ms at the 95th percentile with four panes at 5 Hz. The load test on a Paper server has not run (session 2, live lane). The owner confirms the budget once the figure exists.

## Consequences

- The feature flag stays false until the owner confirms 0075 point 5 and 0077 (I8).
- The agent registry maps an agent id to an online player by exact name. If agent ids and player names differ, the registry adapter changes; the interface does not.
- Frame assembly and transport to the relay are not part of this card.

## Open for the owner

- Confirm the tick budget once measured.
