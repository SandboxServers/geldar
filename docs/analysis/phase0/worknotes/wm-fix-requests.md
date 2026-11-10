# Wave M fix requests

Requests from a fix packet to a file or packet outside its scope. Each request names the file, the line and the change wanted.

## R3b

### (a) For R3a: `threshold/mcp/src/tools/wait.ts`

A cursor above `head` must be clamped to `head`, and the gap reported in `dropped_events`, instead of refused as `bad_cursor`.

Today `wait.ts:99-103` takes `head` from the life's own events only (`log.head(lifeId)`). After a restart, a player whose newest event is older than the 60-minute replay window has `head` 0, so its stored cursor is refused with `bad_cursor`. The player then cannot resume, although its events exist on the stream.

### (b) For the event log in `threshold/mcp/src/main.ts`

`main.ts:176` builds `new RingEventLog()` (from `threshold/mcp/src/events/player-log.ts`) with no backfill. A cursor older than the 1000 events the ring keeps only counts as dropped; the log cannot replay those events to the player.

### (c) The replay catch-up bound

The replay catch-up bound is the constant `REPLAY_CATCHUP_MS = 30000` in `threshold/mcp/src/cli.ts:206`. It has no config key. A change to it is a code change, not a shard setting.
