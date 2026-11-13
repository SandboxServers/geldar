# Block owner bridge (CoreProtect)

The Body's goto must not dig a block another player placed (decision 0165). geldar-core answers
`geldar.<shard>.blockowner.query` from CoreProtect's action log instead of keeping its own store. This
runbook covers what the bridge does, how the CoreProtect node must be configured, and the live checks.

## What the bridge does

- Each query names one chunk. The plugin looks up the place and break rows of the 17 x 17 columns around
  the chunk (CoreProtect's radius is an inclusive square; the rows outside the chunk are dropped), newest
  first, over the whole history (ten years of seconds).
- CoreProtect keeps history, not state. For each position the first row seen decides: a place by a player
  gives that player as the owner; a break gives no owner. Rolled-back rows are skipped. Names starting with
  `#` (non-player causes such as `#tnt`) are not owners.
- At most 4096 owned blocks are returned. Beyond that the reply sets `truncated`.
- Lookups run on one dedicated thread, never on the server thread or the NATS thread. Results are cached
  per chunk for 30 s (at most 128 chunks, least recently used evicted).
- Block place and break events seen by the plugin are laid over the cached answer for 60 s, so a change
  made after a lookup started is not undone by that lookup. The plugin also publishes
  `geldar.<shard>.blockowner.changed` (at most 256 per server tick, coalesced per block, queue capped at
  16384; overflow is dropped and logged once).
- A reply is always sent when a query is accepted. CoreProtect missing, disabled, older than API 12, a
  failed or timed-out lookup, or a full lookup queue each answer an empty list with `truncated: true`. The
  Body must read that as unknown, never as unowned.
- A malformed query gets no reply.

## Pre-tracking gap

CoreProtect only knows what it logged. Blocks placed before CoreProtect was installed on the node have no
owner row, so they are not in any reply and the Body reads them as world-generated. This is the same gap
as before the bridge: a player block placed before tracking is treated as diggable. Install CoreProtect
before the first agent builds on a node.

Changes made by explosions, pistons, fluid or other plugins that call CoreProtect's logging API are only
seen if CoreProtect logs them. Keep `block-break` and `natural-break` on, and keep the rows that CoreProtect
writes for non-player causes on.

## CoreProtect configuration

Pin CoreProtect 24.1 (Modrinth, sha512 in `plugins/coreprotect/coreprotect.lock.json` once that lands). The
node needs block logging only. Set these in `plugins/CoreProtect/config.yml`:

| Key | Value | Why |
| --- | --- | --- |
| `block-place`, `block-break`, `natural-break` | true | the ownership rows |
| `block-movement`, `block-burn`, `block-ignite`, `explosions` | true | blocks that change owner without a player |
| `api-enabled` | true | the bridge's only door |
| `player-messages`, `player-commands`, `player-sessions`, `username-changes` | false | chat and commands hold agent text; not needed |
| `player-interactions`, `item-transactions`, `item-drops`, `item-pickups`, `hopper-transactions` | false | not owner facts |
| `container-transactions` (or the 24.1 key for container logging) | false | not owner facts |
| `entity-change`, `entity-kills`, `sign-text` | false | not owner facts |
| `liquid-tracking`, `water-flow`, `lava-flow`, `buckets` | false | not owner facts (decide per shard; see the spike) |
| `leaf-decay`, `tree-growth`, `mushroom-growth`, `vine-growth`, `sculk-spread`, `portals` | false | not owner facts |
| `worldedit` | false | not owner facts |
| `error-reporting`, `check-updates` | false | no reports or update checks leave the node |
| `auto-purge` | false | Patreon-only feature in CE; retention is a manual step |

The key names above come from the research spike and are not yet checked against the 24.1 jar's generated
config. Check each name on first start and record any name the release does not have. CoreProtect creates `plugins/CoreProtect/database.db` (SQLite). Keep
`/plugins/CoreProtect` on the Paper volume so the database survives restarts.

Retention: old rows are not purged automatically. A `/co purge t:<time>` from the console removes history,
and with it the ownership of old structures. Do not purge without deciding what the Body may then dig.

## Plugin config (`blockowner:` in geldar-core's config.yml)

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | true | false stops the change listener and the query replies; the Body reads every chunk as unknown |
| `lookup_timeout_ms` | 2000 | a lookup longer than this answers an empty list with `truncated: true` |

## Live checks

Run on a shard with CoreProtect installed, after a bot places and breaks a block.

1. Version: `version` shows Paper 26.1.x and the plugin log shows CoreProtect enabled with API 12 or newer.
2. Lookup latency: query an empty chunk and a chunk with about 1000 rows. Record the time for each. Expect
   the cold chunk well under `lookup_timeout_ms`; if the busy chunk exceeds it, raise the timeout only after
   looking at the row count.
3. Concurrency: send 20 queries at once for different chunks. None may block the server thread (the tick
   time in `/tick query` stays flat); the queue (32) must refuse, not hang, under overload.
4. Time window: place a block, wait 30 s, query. The owner must be there. Break it and query: no owner.
   The window is ten years, so the check is that a block placed months ago still answers (use an old row
   from the node's history).
5. Rolled-back rows: roll back one of the bot's placements with `/co rollback` on a test chunk, then query.
   The rolled-back block must not show as owned (CoreProtect marks the row; the bridge skips it).
6. Row order: place A then B at the same position from two bots, then query. The newest placer must be the
   owner. If the reply shows the older one, row order is not newest-first on this build; stop the bridge
   with `blockowner.enabled: false` and report.
7. Queue lag: place a block and query within 1 s. The change overlay must answer it (the lookup may not have
   the row yet).
8. Truncated: the reply's `truncated` must be false for a normal chunk and true only above 4096 owned
   blocks.

Record each result in the packet report. Items 2 to 7 are unverified until run on a shard.
