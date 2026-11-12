# 0147. Death is knowable to the player while permadeath is off

Status: accepted (owner direction, C6 body events)

## Context

Play record (jason-run sessions 1-19): 8 confirmed respawns and 15+ probable deaths. The death
event existed on main, but the player could not tell how many lives had been lost, where, what was
dropped, or where the respawn was. `status.days_alive` counted across deaths.

## Decision

- Permadeath stays off (spec 5.9). A death does not write `died_at` and does not end a life.
  Nothing in C6 changes the sink's death handling (0144 still holds).
- Death is knowable: the player hears the fixed death line "You died. <cause>." (existing).
- Planned, not in C6: per-life `lives_lost` / `life_number`, `days_alive` per life, the death
  coordinates and dimension, the dropped items with coordinates, the respawn location, and the same
  fields in `status`. These need plugin data the golem and plugin do not yet send, so they wait for
  a separate packet with its own tests.

## Consequences

- The death line is still the only death news. The player cannot yet see its location or loot.
- When permadeath is later enabled (a separate owner decision), `died_at` and the life end follow
  0144; this record does not pre-decide that.

## Addendum: damage says what hit you (C6)

- A `damage` line now names the cause the plugin exports (Bukkit `DamageCause`, mapped to a fixed
  sentence in `threshold/mcp/src/events/mapper.ts`): "You fell.", "You are drowning.", "You are
  burning.", "You are starving.", "Something hit you.", "Something shot you.", "Something exploded
  next to you.". No amount is printed. An unknown or missing cause says "You were hurt.".
- Gap, not filled: the plugin does not send the attacker. The brief's wording "a creeper exploded",
  "an arrow from a skeleton about 14 blocks north-west" needs the nearest hostile and its bearing,
  which the golem Body knows but does not send with the event, and the plugin cannot see. Until a
  packet adds that data, damage names the cause only, and no source is invented.
- The `sleep` tool's damage line is the same fallback text ("You were hurt.").
