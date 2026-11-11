# 0139. The Kino entity feed lists agents and mobs only

Status: accepted (orchestrator, owner delegated, R46). Follows 0075 (Kino access) and 0137 (public spectator proxy). Packet KINO-fix-e2.

## Decision

`entity_positions` in the Kino feed contains only: the bodies of registered agents (the plugin's `isAgent` predicate, the same agent registry the Velocity gate uses), and non-player entities. Every other player (a human spectator, a ghost once Phase 2 exists, an admin) is never included, whatever the game mode. Marker-like entities (`minecraft:marker`, `minecraft:interaction`) are also left out, because they carry plugin data.

## Why

Anonymous viewers of a public agent would otherwise see the exact live position of each human who watches that agent. Principle 1 (humans are invisible to agents, and not exposed by the vivarium) is kept by an allow rule, not a deny rule for spectator mode.

## Also changed

The entity scan reads each loaded chunk once per call, keeps only entities positioned inside the chunk (a border-straddling entity is no longer listed twice), orders them by entity id so paging offsets are stable, and builds views for at most the page.