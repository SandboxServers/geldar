# AN-09b: Body evidence producers (first chunk visit, attack target kind)

Branch `phase1/an-09b-body-evidence`, from `origin/main` `203d9af2`. Card: `docs/analysis/harness/work-packets-geldar-a.md`, section AN-09b.

## What changed

- `golem/src/body/evidence/chunk-visits.ts`: the AN-S0 stub body is replaced. `watchChunkVisits` listens for `move`, floors the position to chunk indices (`Math.floor(x / 16)`), keys the known set by `dimension:cx:cz`, and emits one `chunk_visited` WorldEvent per new key. `source_event_id` is `eventIdFor('chunk_visited:<life>:<dimension>:<cx>:<cz>')`, so it is stable across restarts. The envelope is checked with `validateChunkVisitedPayload` and `validateWorldEvent` before publish. A position that is missing or non-finite emits nothing. `maxKnown` (default 20000) clears the set when reached. stop() removes the listener.
- Failure handling (second pass): nothing retries on every move. A publish that throws, or an async publisher that rejects, is logged once per attempt and the chunk is retried on a later move; after `MAX_PUBLISH_ATTEMPTS` (3) failed publishes the chunk is given up on for the run, with one "dropped" log line. An invalid envelope (empty dimension, out-of-range chunk index, bad tick, malformed event), and a `tick()` or `now()` that throws, give up on the chunk at once with one log line. The move handler never throws: `tick()`, `now()` and the logger are inside try/catch. The chunk is marked known before publish and unmarked on a failure, so a publish in flight is not sent twice. The `publish` signature is unchanged (`=> void`); an async publisher's returned Promise is detected at runtime and its rejection is handled. The AN-S0 signatures are not changed.
- `golem/src/body/evidence/chunk-visits.test.ts`: new, 22 cases (the first pass had 12).
- `golem/src/actions/attack.ts`: `afterKill` adds `target_kind` (`'player'` or `'mob'`) to the `completed` detail. `KillRecord` carries `targetKind`. New exports: `TargetKind` type and `targetKindOf(entity)`.
- `golem/src/actions/attack.test.ts`: `FakeEntity` gains `type` (default `'hostile'`, the type Mineflayer gives zombies) and the fake options gain `targetType` and `targetName`. Cases: `mob` for the zombie fixture and `player` for a player fixture; `mob` for `animal`, `passive` and `object` entities (three cases, one per type, so no non-player type can record `player`).

## Scaffold signatures

`ChunkWatchOptions` and `watchChunkVisits` keep the AN-S0 signatures. No change was needed, so nothing is recorded here as a shape change.

## Target kind rule

The card's evidence table (`work-packets-geldar-a.md`, the kill row) says a kill awards only when `target_kind === 'mob'`, and that a player target never awards. So `targetKindOf` returns `'player'` only for mineflayer's `type === 'player'`, and `'mob'` for every other entity type. Mineflayer 4.39.0 sets `entity.type` to `hostile`, `animal`, `passive`, `mob`, `object`, `orb`, `other` or `player`; the non-player types all map to `'mob'`, which is what the card's "otherwise mob" says. No code change was needed for this; the tests now pin it for animal, passive and object.

## Unverified

- `bot.game.dimension` values: mineflayer 4.39.0 `lib/plugins/game.js:41-60` strips the `minecraft:` prefix, so the live values are `overworld`, `the_nether` and `the_end` (the `Dimension` typing in index.d.ts:484 agrees). These match the schema pattern `^[a-z0-9_:.-]{1,64}$`. Not checked against a running server.
- Not handled: a `bot.entity` or `bot.game` getter that throws. Such a throw is caught, but it is logged on every move, since no chunk key exists yet. Not expected in mineflayer; unverified.

## Worktree setup

`node_modules` at the root, and `golem/node_modules` and `contract/node_modules`, are junctions to the main checkout's directories. Nothing was deleted.
