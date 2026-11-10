# fix-a2: NATS accounts and least-privilege users (WM-10b)

Branch `fix/a2-nats-accounts`, from `wave6-main`. Not pushed.

## Items

1. Decision record `docs/decisions/0067-nats-accounts-and-least-privilege.md`: done.
2. Opt-in overlay (generated `compose/secrets/nats-auth.conf`, `compose/nats-auth.yml`, per-component
   `GELDAR_NATS_USER` and `GELDAR_NATS_PASSWORD` reads): PARTIAL. Done: `./geldar.ps1 shard nats-auth
   <name>` (writes `compose/secrets/nats-auth.conf` and `nats-<user>.txt`, owner-only ACL, untested
   live) and `compose/nats-auth.yml` (mounts the config into `nats`). NOT done: component credential
   reads (golem, animus, eventsink, MCP, Java publisher and Velocity client), their connect tests,
   and wiring the users' password files into their services. Until those land the overlay is not a
   working stack, and the JetStream permission lists are **untested against a live server**. No
   `geldar.ps1` test harness exists, so the subcommand was checked by running it and reading the file.
3. Thinker socket shared secret (`animus/src/thinker/hub.ts`, `lantern-local/src/thinker.ts`): not started.
4. Static no-credentials guard `tools/repo-checks/src/no-credentials.test.ts`: done (3 tests). It
   fails when a tracked `probe-cred.txt` holds a NATS URL with an embedded user and password (planted, confirmed, removed
   from the index). Connect-path tests for the env reads: not started (no env reads exist yet).
5. `docs/threat-model.md` and overlay docs: not started.

## Facts gathered (for later items)

- Connect sites (non-test): `animus/src/main.ts:274`, `eventsink/src/main.ts:19`,
  `tools/players-cli/src/skin-store.ts:47`, `tools/players-cli/src/rangers-presence.ts:23`,
  `golem/src/registry.ts:73`, `golem/src/adam/main.ts:186`, `golem/src/players/main.ts:112`,
  `golem/src/body/restart.ts:94`, `threshold/mcp/src/cli.ts:164`, Java
  `plugin/core/.../NatsEventPublisher.java:91`, `plugin/velocity-identity/.../RegistryClient.java:81`.
- KV buckets: `geldar-life-registry`, `geldar-checkpoints`, `geldar-body-generation`,
  `geldar-presence`, `geldar-skins`. Stream: `GELDAR_EVENTS`.
- Unverified: the JetStream permission lists in the decision record. No `nats-server` binary is
  available here, so the overlay must be marked untested against a live server.
- The MCP body gateway requests only the book subject (`threshold/mcp/src/body-gateway.ts:58`).
  Its doc comment says "three subjects"; the code does not match it. The decision record follows the code.
- The MCP replay filter is `geldar.*.player.>` per `docs/spec.md:1040`; the call site in
  `threshold/mcp/src/cli.ts` was not re-read, so confirm before the overlay ships.

## Status (second session)

- Step 0: `fix/a1-admission-nats` merged (clean, no conflicts); `check` passed.
- Step 1 (`702ef75`): `connectNats` reads `GELDAR_NATS_USER` and `GELDAR_NATS_PASSWORD_FILE` (or the
  options `user`/`pass`); unset stays unauthenticated. Tests: 11 in `contract/src/nats-connect.test.ts`.
- Step 2 (`889ef37`): `NatsEventPublisher` (user `paper`) and `RegistryClient` (user `velocity`) read
  the same two settings from the environment or a system property. JUnit: 5 cases each.
- Step 3: `compose/nats-auth.yml` passes `GELDAR_NATS_USER` and a mounted password file to `paper`,
  `velocity`, `eventsink` and `geldar-mcp`. The overlay is **untested against a live server**. It
  needs `compose/mcp.yml` as well (the `geldar-mcp` entry has no image of its own). The check now
  validates `phase0.yml + mcp.yml + nats-auth.yml`. Host-run Body (`body`) and Mind (`mind`) take the
  same two variables from their environment; they are not in compose.
