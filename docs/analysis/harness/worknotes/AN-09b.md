# AN-09b: Body evidence producers (first chunk visit, attack target kind)

Branch `phase1/an-09b-body-evidence`, from `origin/main` `203d9af2`. Card: `docs/analysis/harness/work-packets-geldar-a.md`, section AN-09b.

## What changed

- `golem/src/body/evidence/chunk-visits.ts`: the AN-S0 stub body is replaced. `watchChunkVisits` listens for `move`, floors the position to chunk indices (`Math.floor(x / 16)`), keys the known set by `dimension:cx:cz`, and emits one `chunk_visited` WorldEvent per new key. `source_event_id` is `eventIdFor('chunk_visited:<life>:<dimension>:<cx>:<cz>')`, so it is stable across restarts. The envelope is checked with `validateChunkVisitedPayload` and `validateWorldEvent` before publish. A position that is missing or non-finite emits nothing. `maxKnown` (default 20000) clears the set when reached. A publish that throws is logged and the chunk is not marked known, so a re-entry retries it. stop() removes the listener.
- `golem/src/body/evidence/chunk-visits.test.ts`: new, 13 cases.
- `golem/src/actions/attack.ts`: `afterKill` adds `target_kind` (`'player'` or `'mob'`) to the `completed` detail. `KillRecord` carries `targetKind`. New exports: `TargetKind` type and `targetKindOf(entity)`.
- `golem/src/actions/attack.test.ts`: `FakeEntity` gains `type` (default `'hostile'`, the type Mineflayer gives zombies) and the fake options gain `targetType` and `targetName`. One new case checks `mob` for the zombie fixture and `player` for a player fixture. All existing cases are unchanged.

## Scaffold signatures

`ChunkWatchOptions` and `watchChunkVisits` keep the AN-S0 signatures. No change was needed, so nothing is recorded here as a shape change.

## Unverified

- `bot.game.dimension` values: the field exists on the `Bot` type (tsc passes), but the live string values are not checked against a server. Both `overworld` and `minecraft:overworld` match the schema pattern `^[a-z0-9_:.-]{1,64}$`.
- `entity.type`: the existing perception code already compares `'player'`, and mobs are `'hostile'` in the fixtures. The card's rule (`player` else `mob`) is applied as written.

## Worktree setup

`node_modules` at the root, and `golem/node_modules` and `contract/node_modules`, are junctions to the main checkout's directories. Nothing was deleted.
