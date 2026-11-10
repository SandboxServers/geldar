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
