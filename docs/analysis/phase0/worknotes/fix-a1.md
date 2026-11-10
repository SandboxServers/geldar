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

## Step 2b: connectNats everywhere (commit b65f999)

- Every NATS connection goes through `connectNats` from `@geldar/contract/nats`
  (`contract/src/nats-connect.ts`): `maxReconnectAttempts: -1`, and a `closed()` watcher that exits
  with code 1 on a close that carries an error. A clean `close()` does not exit.
- Call sites switched: golem registry, golem players main, golem adam main, golem body restart,
  animus main, eventsink main, threshold/mcp cli, tools/players-cli (skin-store, rangers-presence).
  `tools/players-cli` now depends on `@geldar/contract`.
- Test fixes: the golem registry mocks gained a never-resolving `closed()`; the MCP container test
  resolves workspace subpath exports, so it sees `contract/src/nats-connect.ts` in the image.
- Removal gap, narrowed: players and Adam already register the life id as their username, so
  `removeRegistryKey` finds their key. The gap is bots whose username is not a life id (for example
  GolemBench); their key stays after retire, and the manual command has the same gap.
- Guard: `players/life-removal.ts` reaches RCON for the operator removal path, so it joins the
  test-control guard's allow-list. This loosens the guard for that file; review it with rule 9.
- Not done: original items 3 to 5 (eventsink DLQ, Body crash reconciliation, RCON hardening).

## Step 1: eventsink DLQ (original item 3)

- Commits 26605a6 (consumer) and 9b239d2 (README). A transient error (connection, timeout, Postgres
  down) now always naks with capped backoff. `MAX_DELIVER` is -1 (no cap) and `ensureConsumer`
  lifts the cap on an existing consumer created with 20. Only permanent poison (SQLSTATE 22/23,
  invalid bodies) is dead-lettered, and each DLQ publish logs an `ALERT dead letter published to`
  line with the DLQ subject and reason.
- Tests: a fake consumer runs a 10-minute simulated outage (the old cap would have dead-lettered at
  20 deliveries) and loses no event; the poison message reaches the DLQ. Revert check: an ack on
  the 20th delivery in `retryLater` fails the unit tests.
- Replay: documented steps in `eventsink/README.md` (no command: a DLQ body with `data_truncated`
  true cannot be replayed).
- Not done: step 2 (RCON hardening, original item 5); item 4 is another finisher's.

## Step 1: RCON hardening (original item 5)

- 1a, commit 69f76df (+ 0f37451 sharpened guard): `Initialize-ShardSecrets` in `geldar.ps1` applies
  `Set-OwnerOnlyAcl` (the owner-only step of `restrictToOwner`: inheritance off, current account
  full control) to `postgres.txt`, `rcon.txt` and `velocity-forwarding.txt`. A new file gets it
  before its secret is written; an existing file gets it too. Best effort: a failure warns.
- Guard: `threshold/mcp/src/geldar-script.test.ts` checks the call sits right before the secret
  write, and in the existing-file branch.
- 1b, commit ba01620: `compose/phase0.yml` no longer publishes 25575. `compose/rcon-host.yml`
  publishes `127.0.0.1:25575` for `paper`. `./geldar.ps1 shard up phase0 --rcon-host` adds it.
  `shard up` without the flag prints a one-line hint. `shard logs` and `shard status` accept the
  flag without using it, so `--rcon-host` never reaches `docker logs`.
- Host tools: `RconClient.connect` (golem/src/rcon.ts) is the one RCON connect. Its refused
  error now names `compose/rcon-host.yml` and the flag. Callers: golem players main, golem
  `life-removal.ts` (used by adam-cli, mcp-tokens and players-cli, which only reach RCON through it),
  bench cli and bench tps. Test: `golem/src/rcon.test.ts`.
- Docs: `docs/threat-model.md` RCON row and `.claude/skills/run-shard/SKILL.md`. Historical worknotes
  and reports keep their old text.
- Guards: `geldar-script.test.ts` checks phase0.yml has no 25575 line, the override publishes only
  `127.0.0.1:25575` on paper, and the script adds the override and prints the hint.
- Mutation checks: restoring the new-file ACL call's removal fails the guard (confirmed); putting
  the 25575 port back into phase0.yml fails the guard (confirmed, restored from a scratchpad copy).
  The RCON message change was not mutated: the old text lacks `compose/rcon-host.yml`, so the
  updated `toThrow` fails on it by reading.
- Deviation: the spec asks for the hint only when a host tool needs RCON. The script cannot tell
  which host tools a run will use, so the hint prints on every `shard up` without `--rcon-host`.
- Fix found by check (commit 61a03f2): the compose loop ran `docker compose config` on the override
  alone, which has no image. It is skipped there and checked merged with phase0.yml.

## Step 2: check

- `./geldar.ps1 check`: exit 0 (349 test files passed, 15 skipped; 3828 tests passed, 59 skipped).
  The first run failed only on the override's standalone compose config, fixed in 61a03f2. No
  flaky test failed, so no re-run was needed beyond that one.
