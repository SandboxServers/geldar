# PX-2b worknote: threat reading and sight for reflexes

- **What changed.** `golem/src/perception/hostile-types.ts` holds the always-hostile type list. `entities.ts` adds `hostile`, `state` (`attacking` or `closing`), `closing`, `held_item` and `fuse` to mob records, and keeps a per-bot sample map so `closing` compares distances across observations. Arrows are reported only while closing. `body/view.ts` `nearbyHostiles` skips mobs without line of sight (decision 0154, ruling 6).
- **Closing window.** `CLOSING_WINDOW_TICKS` is 100 world ticks. A sample exactly at the edge still counts.
- **Schema.** `contract/schemas/snapshot.schema.json` already carries these fields (`state`, `closing`, `fuse`), so no contract change was needed in this packet.

## Needs a live probe

- **Hostile list.** `ALWAYS_HOSTILE` is written from the game's 1.20.x mob classification, not from a server dump. Confirm each name against the pinned Paper version before the card is closed.
- **Creeper ignited slot.** `CREEPER_IGNITED_SLOT` (18) is from 1.20.x knowledge. The live case `creeper-behind-wall` (`live: pending`) must read a real creeper's metadata and confirm the slot.
- **Spider.** Not flagged from type. Its attacking state comes from observation only.
