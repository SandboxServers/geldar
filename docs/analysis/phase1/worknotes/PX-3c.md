# PX-3c: armour, status flags, air, tool wear

- Base for this pass: `429186e` (origin/main at start).
- `armor` is computed from the equipped slots 5 to 8 (helmet, chestplate, leggings, boots) by a
  fixed points table; the old stub `self/gear-flags.ts` (hard-coded `armor: 0`) is removed.
- `status_flags` (burning, underwater, falling, in_water, on_ground) list only true flags, in
  schema order; the key is omitted when empty. `air` (mineflayer `oxygenLevel`) is shown only below 20.
- `wear` on inventory entries comes from `maxDurability` and `durabilityUsed`: worn from 50 percent
  used, nearly_broken from 90, low below. Absent for stacks without durability data.
- Assumption to confirm live: `bot.oxygenLevel` is the 0 to 20 breath-bubble count, and entity
  flags metadata index 0 bit 0 is on fire (the Body's `onFire` uses the same bit).
- The agent view (`threshold/mcp/src/play-view/self.ts`) passes `status_flags` and `air` through
  only when present.
- Player-facing text: none changed.
