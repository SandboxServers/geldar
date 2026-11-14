# C7 extra cards: Body container spec (fix J)

Added by the wave C7-2 review (pass 2, F2). These cards close gaps that no earlier card owned. Read them with [c7c-packets.md](c7c-packets.md) (the supervisor cards) and [c7-wave-plan.md](c7-wave-plan.md).

## C7-03b4: Body container spec mirrors the golem-body service

- **id / wave / lane.** C7-03b4, wave 3 (after C7-03b3 merges). Supervisor lane, not the register lane. **branch.** `phase1/c7-03b4-body-spec`. **migration.** none. **size.** S.
- **Blocks enabling the supervisor service.** The C7-03b2 node steps (enabling the supervisor service in the Colo compose file) must not run before this card merges. Until then a supervisor-created Body starts with no NATS credentials, no Minecraft host and the image default command, runs hardened and does nothing, and is counted against the owner's quota.
- **Why.** `supervisor/src/docker.ts` `containerBody` sets Image, User, one Env (`GELDAR_LOGIN_NAME`), Labels, limits, network, log config, CapDrop and SecurityOpt. The `golem-body` service in `compose/colo.yml` (lines 231-275) also sets the rest. The wave ruling says Body containers mirror the compose service.
- **may-edit.** `supervisor/src/docker.ts` (`containerBody` and its helpers), `supervisor/src/limits.ts` (only if a constant is needed), the supervisor tests for the Body container config (one file, or a new file under 500 lines), `docs/analysis/phase1/worknotes/C7-03b4.md`.
- **Read-only reference.** `compose/colo.yml` `golem-body` (lines 231-275) and the `shards/colo-mind.yaml` usage. Do not edit `compose/colo.yml`; C7-03b2 owns it.

### What the Body container must carry (mirror of `golem-body`)

1. Entrypoint: `node src/adam/main.ts` (the command, not the image default).
2. Env: `GELDAR_SHARD`, `GELDAR_IN_NETWORK_HOSTS`, `GELDAR_MC_HOST`, `GELDAR_MC_PORT`, `GELDAR_NATS_URL`, `GELDAR_NATS_USER`, `GELDAR_NATS_PASSWORD_FILE` (the path where the secret is mounted), and the existing `GELDAR_LOGIN_NAME`.
3. The `nats-body` secret mounted at the same path the compose service uses, read-only.
4. The `colo-mind.yaml` shard-file bind, with the same source and target as the compose service.
5. User: `GELDAR_SERVICE_UID`, default `1000`. Today `docker.ts` hard-codes `'1000:1000'`, and the value must come from the same variable compose reads (`${GELDAR_SERVICE_UID:-1000}`).
6. Read-only root filesystem, tmpfs, labels and restart policy: mirror them if `golem-body` sets them (check the service first; the worknote's "unmirrored flags" list is the starting point).

### Tests

- One config-level test per flag above. Each test must fail when that flag is removed from `containerBody` (revert-check each one that is not already pinned by an existing test).
- The UID test: the default is 1000; setting `GELDAR_SERVICE_UID` changes it; a test fails when the literal drifts from the compose default.
- The secret and shard-file binds: the source and target paths are asserted, not only their presence.

### Live check (orchestrator-run, `live: pending`)

- A supervisor-created Body connects to NATS and to the Minecraft host with the spec above. The coder does not run it; the orchestrator runs it after merge, on a node with the supervisor service enabled.

### Done when

- All config-level tests pass and fail without their flag.
- The worknote `docs/analysis/phase1/worknotes/C7-03b4.md` says that the live check is pending and that C7-03b2's node steps wait for it.
