# Golem

The Minecraft bot client and benchmark (`golem/src`). Live tests need the Phase 0 stack: `./geldar.ps1 shard up phase0`, then `./geldar.ps1 pnpm --filter @geldar/golem test:live`.

Live-test conventions: a case must not depend on the time of day or on player data a previous run left behind (low health, effects, inventory). A case that depends on world state starts with `resetBot` from `golem/test/live/fixture.ts` (heal, clear effects, set time and weather, set gamerules) and calls the returned restore function in `finally`. Put the state a case depends on in its failure message.

## Life registry (`GELDAR_NATS_URL`)

The Velocity ingress plugin admits only usernames in the NATS KV bucket `geldar-life-registry`. Golem is the registrar: when `GELDAR_NATS_URL` is set (a `nats://` URL on `127.0.0.1` or `localhost`, for example `nats://127.0.0.1:4222`), it creates the bucket if missing, puts `{life_id, registered_at}` under the lowercase username before the first connect and before every reconnect, and deletes the key on `stop()` (reopening NATS if the connection was dropped; a failed delete is logged). If NATS is unreachable at the first connect, the connection goes fatal with a clear error (host and port only) and makes no connect attempt. If it becomes unreachable later, the failed registration counts as a failed session: the manager backs off and retries instead of giving up.

The life id is the username itself when it already is a LifeId (`ag_kestrel_01`); otherwise `ag_<up to 8 letters or digits of the name><8 hex digits of the SHA-256 of the exact username>_01`, so `Steve_1` and `Steve1` never share an id.

The registry is **opt-in** for library use (so is every other NATS use below; each needs its own URL or buckets handed in): with `GELDAR_NATS_URL` unset `loadConfig` leaves it off and Golem never touches NATS, so the unit tests and runs against a stack without the ingress gate work unchanged. The bench CLI and the live-test fixture run against the Phase 0 stack, which enforces the gate, so they default `GELDAR_NATS_URL` to `nats://127.0.0.1:4222` when it is unset (an empty value still turns it off). If the proxy kicks a bot with `This connection is not admitted.` and the registry is off, the connection goes fatal at once with a message naming `GELDAR_NATS_URL`, instead of retrying. With the registry on, the gate can be closed for a few seconds after a NATS blip, so the connection goes fatal only after 5 such kicks in a row. See [decision 0040](../docs/decisions/0040-bot-ingress-registry-in-nats-kv.md). The registry client uses `@nats-io/kv` 3.4.0 with `@nats-io/transport-node` and `@nats-io/jetstream`.

## The Body (`src/body`)

The Body is the part of Golem that carries out the Mind's plans (spec 5.3, section 7). `createBody` wires one for a life: a runtime that owns the world-tick loop and the reflexes, an executor that validates a plan (life, `body_generation`, snapshot revision, expiry) and runs its immediate actions and its one durable intent through a program, wake conditions that raise a wake for the Mind, and a record sink. Reflexes (eat, flee, hazard escape, shelter, panic burrow and so on) run first and pre-empt the intent; each firing is recorded.

Records go to a `RecordSink`. By default a `MemorySink` keeps them. With `nats` options `createBody` publishes them to JetStream as `intent`, `action`, `receipt`, `reflex_fired` and `wake` events on `geldar.<shard>.<type>` (the `eventsink` service projects `intent`, `action` and `receipt` into Postgres, see `eventsink/README.md`). The sink returns at once and never throws. `action` and `receipt` records (the audit record) and the `accepted` and final `intent` events are retried without end with capped backoff, logging the first failure and then one in N; they are lost only when the queue is full of them (the oldest goes, logged as an error and counted as `auditDropped`) or when one record can never be sent (invalid, or over the NATS payload limit even after an action's `result` is cut): that record alone is dropped and counted, so it never blocks the queue. Reflex and wake records and `running` or `paused` intent heartbeats are shed first when the queue is full. A receipt id is derived from the action id and the phase, so a plan replayed after a restart cannot write a second receipt (and the old `body_generation` is refused anyway). See [decision 0043](../docs/decisions/0043-phase0-body-state-in-nats-kv-and-record-rules.md).

### Checkpoints and restarts (`restartBody`)

Two NATS KV buckets hold the Body's working memory, both keyed by `life_id` (decision 0043: the spec puts durable state in Postgres, Phase 0 keeps these two small records in KV):

| Bucket | Holds |
| --- | --- |
| `geldar-body-generation` | the life's `body_generation`, taken with compare-and-swap so two starts never share a number |
| `geldar-checkpoints` | the running intent and its program state, written when the intent is installed and after each step (an unchanged entry is not rewritten), deleted (with retries) when the intent ends |

`restartBody` is the entry point after a start or a crash: it takes the next generation, builds the Body with checkpointing on, then resumes the saved intent when the checkpoint belongs to this life, is not expired, and its program is registered. The resumed intent keeps its original expiry (never more than its own tick limit). Otherwise the Body idles and returns the reason (`no_checkpoint`, `checkpoint_unreadable`, `other_life`, `expired`, `unknown_program`, `resume_failed`, `tick_unknown`) and, if no plan arrives within 45 s, raises a `no_plan` wake. `tick_unknown` (the view's world tick never arrived within `tickWaitMs`) leaves the checkpoint in place and is not retried: that Body idles, with the checkpoint still in the bucket, until the Mind starts a new intent (which replaces the checkpoint) or the next restart finds a tick. `stop()` keeps the checkpoint, waits for the last checkpoint write and, for a bounded time, for the record sink to send what it holds. `openRestartKv(url)` opens the buckets on a loopback `nats://` URL and reconnects with backoff. The restart live test (`test/live/restart.live.test.ts`) tears a Body down inside one process and starts a second one on the same buckets; it uses ids unique to the run and deletes its keys.

## Players (sovereign rangers, ./geldar.ps1 players)

One detached Body process per sovereign player named in `shards/phase0.yaml`, each with a 320 MB heap cap
(`--max-old-space-size=320`). The entry point is `src/players/main.ts` with `--player <player-id>`; the Body reads the
shard config itself and uses the life id it names.

```
./geldar.ps1 players up                 # all configured players; a running one is left alone
./geldar.ps1 players up --player ag-jason-01
./geldar.ps1 players status             # online, PID and RSS per player; prints "down" when none runs
./geldar.ps1 players logs --player ag-jason-01
./geldar.ps1 players down
```

PID files and logs live under `.geldar/players/` (git-ignored). `logs` prints the last 200 lines; it does not follow.
The player hosts need NATS (`GELDAR_NATS_URL`) and the shard's RCON secret, and the whitelist entries are written
by the host, not by this command.

A sovereign player's skin is set with the players CLI, which is not in the `players` block above. It checks
`GELDAR_NATS_URL` and opens the skin bucket before it spends a MineSkin generation. The skin PNG goes under the
repo's gitignored `skins/` directory, or outside the repo; pass an absolute path, because the command runs in the
package directory:

```
./geldar.ps1 pnpm --filter @geldar/players-cli exec node src/cli.ts skin set ag-jason-01 "<absolute path to skins/jason.png>" --model slim
./geldar.ps1 pnpm --filter @geldar/players-cli exec node src/cli.ts skin set ag-jason-01 "<absolute path to skins/jason.png>" --check-only
```