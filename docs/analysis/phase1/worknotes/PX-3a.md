# PX-3a worknote: sun phase, ground distance, trapped state

- Ruling 2 (0154): `sun` is a coarse phase only, no tick countdown.
- `self.ground_below`: air cells between the feet and the first solid block below, leaves not ground, cap 32. Read from the feet column (y only).
- `self.trapped`: `pit` when walls (solid, at feet and head level, four sides) stand around the bot and ground was found; `perched` when `ground_below` > 0; else `none`.
- `self.sun`: `morning` [0, 3000), `midday` [3000, 9000), `afternoon` [9000, 11000), `low` [11000, 12000), `set` [12000, 24000). Omitted when there is no sky above (any non-air, non-leaves block up to y 319) or when a cell is not loaded.
- A field is omitted, not null, when a cell it needs is not loaded. Nothing throws.
- The projector (`threshold/mcp/src/play-view/self.ts`) passes the three fields through only when the Body sent them.
- Schema fields came from PX-S0 (`contract/schemas/snapshot.schema.json`); no contract edit.
- Known limit: leaves let the sky through, so a bot under a canopy still gets `sun`.
