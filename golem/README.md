# Golem

The Minecraft bot client and benchmark (`golem/src`). Live tests need the Phase 0 stack: `./geldar.ps1 shard up phase0`, then `./geldar.ps1 pnpm --filter @geldar/golem test:live`.

## Life registry (`GELDAR_NATS_URL`)

The Velocity ingress plugin admits only usernames in the NATS KV bucket `geldar-life-registry`. Golem is the registrar: when `GELDAR_NATS_URL` is set (a `nats://` URL on `127.0.0.1` or `localhost`, for example `nats://127.0.0.1:4222`), it creates the bucket if missing, puts `{life_id, registered_at}` under the lowercase username before the first connect and before every reconnect, and deletes the key on `stop()`. If NATS is unreachable the connection fails with a clear error and makes no connect attempt.

The registry is **opt-in**: with `GELDAR_NATS_URL` unset Golem never touches NATS, so the unit tests and runs against a stack without the ingress gate work unchanged. The Phase 0 stack now enforces the gate, so set `GELDAR_NATS_URL=nats://127.0.0.1:4222` for the live lane and the benchmark against it.
