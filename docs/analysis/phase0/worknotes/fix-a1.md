# Fix A1: admission and data-loss modes

Branch `fix/a1-admission-nats` from `wave6-main`. One commit per item, in priority order.

## 1. Admission (life registry TTL)

- Cause: the `geldar-life-registry` bucket had no TTL and only a graceful stop deleted a key, so a
  hard-killed or crashed Body left its life name admissible at the Velocity LoginGate.
- Change: the bucket is created with a 60 s TTL (`REGISTRY_TTL_MS`); `LifeRegistration.register`
  re-puts the key every 20 s (`HEARTBEAT_MS`) until `unregister` or `close`. A failed heartbeat is
  logged and the next beat reopens NATS.
- Deploy note: a bucket created before this change has no TTL and creation fails with a message
  naming the stream. Remove `KV_geldar-life-registry` once so golem recreates it.
- Tests: `golem/test/registry.test.ts` (heartbeat cadence, failed-beat recovery, stop on close),
  `golem/test/registry-bucket.test.ts` (TTL passed to create, recreate hint).
- Open (item 1 is partial):
  - Velocity cache: a NATS TTL expiry removes the message without a delete for watchers, so
    `LifeRegistry` keeps an expired entry until the watch is rebuilt. Fix: record the local receipt
    time per put in `LifeRegistry` and make `find` treat entries older than 60 s as absent. Not done:
    the Java build cannot run here (no Gradle wrapper or Gradle on this machine), so no Java change
    was made without its tests.
  - Not done: deleting the key and the Paper whitelist entry from `players down` and `adam stop`,
    and whitelist removal in `tools/mcp-tokens retire`.
- Items 2 to 5 are not started.

## Step 1: mcp-tokens retire (commit 60c0d57)

- `player retire` now takes the life id from the status update and runs the golem removal
  (`removeLifeFromShard`): the registry key over NATS, then the Paper whitelist entry over RCON.
  Each step prints its outcome; a failed or unreachable step prints the exact manual command. The
  command exits 0 even when the removal throws.
- Tests: `tools/mcp-tokens/src/cli.test.ts` (reachable, unreachable with manual commands, throwing
  removal) and `players.test.ts` (retire returns the life id). `golem/test/registry-remove.test.ts`
  covers `removeRegistryKey` (lowercase key, NATS closed on success and on both failures).
- Mutation check: `tools/mcp-tokens/src/cli.ts` with the removal's rejection rethrown; the
  throwing-removal test failed; the file was restored from a scratchpad backup and matched it.
- Open: `removeRegistryKey` deletes `registryKey(lifeId)`. The key is the lowercase username, which
  equals the life id only for bots whose username is already a life id. Other usernames keep their
  key after retire, and the manual command has the same gap.

## Step 2: nats connect() watcher (not started)

- Not started in this session: the stop came from the context budget. Planned: a `nats-link`
  workspace package with `connectNats(url, name, hooks)` that sets `maxReconnectAttempts: -1`, drops
  `reconnect: false`, and exits non-zero on an unplanned `closed()`. Call sites to replace:
  golem registry (2), golem players main, golem adam main, golem body restart, animus main,
  eventsink main, threshold/mcp cli, tools/players-cli (skin-store, rangers-presence).
