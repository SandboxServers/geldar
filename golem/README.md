# Golem

The Minecraft bot client and benchmark (`golem/src`). Live tests need the Phase 0 stack: `./geldar.ps1 shard up phase0`, then `./geldar.ps1 pnpm --filter @geldar/golem test:live`.

## Life registry (`GELDAR_NATS_URL`)

The Velocity ingress plugin admits only usernames in the NATS KV bucket `geldar-life-registry`. Golem is the registrar: when `GELDAR_NATS_URL` is set (a `nats://` URL on `127.0.0.1` or `localhost`, for example `nats://127.0.0.1:4222`), it creates the bucket if missing, puts `{life_id, registered_at}` under the lowercase username before the first connect and before every reconnect, and deletes the key on `stop()` (reopening NATS if the connection was dropped; a failed delete is logged). If NATS is unreachable at the first connect, the connection goes fatal with a clear error (host and port only) and makes no connect attempt. If it becomes unreachable later, the failed registration counts as a failed session: the manager backs off and retries instead of giving up.

The life id is the username itself when it already is a LifeId (`ag_kestrel_01`); otherwise `ag_<up to 8 letters or digits of the name><8 hex digits of the SHA-256 of the exact username>_01`, so `Steve_1` and `Steve1` never share an id.

The registry is **opt-in** for library use: with `GELDAR_NATS_URL` unset `loadConfig` leaves it off and Golem never touches NATS, so the unit tests and runs against a stack without the ingress gate work unchanged. The bench CLI and the live-test fixture run against the Phase 0 stack, which enforces the gate, so they default `GELDAR_NATS_URL` to `nats://127.0.0.1:4222` when it is unset (an empty value still turns it off). If the proxy kicks a bot with `This connection is not admitted.` and the registry is off, the connection goes fatal at once with a message naming `GELDAR_NATS_URL`, instead of retrying. With the registry on, the gate can be closed for a few seconds after a NATS blip, so the connection goes fatal only after 5 such kicks in a row. See [decision 0040](../docs/decisions/0040-bot-ingress-registry-in-nats-kv.md). The registry client uses `@nats-io/kv` 3.4.0 with `@nats-io/transport-node` and `@nats-io/jetstream`.
