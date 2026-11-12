# PX-0 (C6-DEATH) worknote

Scope: death fields outside the seven owner rulings (0154), following 0144 and 0147. Permadeath stays off: no `died_at`, no life end.

Done:
- Plugin (`EventExporter.onDeath`): the death payload adds `drops` (sum of dropped stack amounts, 0 when none) and `respawn_x/y/z` (bed spawn, else world spawn). Not run locally; Java tests not added (see report).
- Mind mapper (`threshold/mcp/src/events/handlers/death.ts`): carries `where` (x, z only), `drops` (whole count >= 0) and `respawn_point` when the payload has them; out-of-range or malformed values are dropped.
- Presenter (`threshold/mcp/src/events/present-handlers/death.ts`): the death line carries `where` and `respawn_point`; a drop line ("You dropped N items where you died.") follows only when drops > 0.
- Mock mirror: `threshold/mcp-mock/src/sim/events.ts` and `threshold/mcp-mock/src/sim/present-events/death.ts`.

Not done:
- `life` and `days_alive_this_life` in `status`, and `life` on the death line: a per-life counter needs a durable death count (a store column or table) which this packet does not add. Permadeath is off and lifeId does not change on death, so the counter has no source yet.
- Drop item names and coordinates: the plugin sends a count only.
- Respawn point is the bed or world spawn at death time, not the position after the actual respawn.

Player-facing text added: "You dropped N item(s) where you died." (new, only when drops > 0). The existing death line is unchanged.
