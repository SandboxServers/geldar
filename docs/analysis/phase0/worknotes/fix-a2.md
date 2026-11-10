# fix-a2: NATS accounts and least-privilege users (WM-10b)

Branch `fix/a2-nats-accounts`, from `wave6-main`. Not pushed.

## Items

1. Decision record `docs/decisions/0066-nats-accounts-and-least-privilege.md`: done.
2. Opt-in overlay (generated `compose/secrets/nats-auth.conf`, `compose/nats-auth.yml`, per-component
   `GELDAR_NATS_USER` and `GELDAR_NATS_PASSWORD` reads): not started.
3. Thinker socket shared secret (`animus/src/thinker/hub.ts`, `lantern-local/src/thinker.ts`): not started.
4. Static no-credentials guard `tools/repo-checks/src/no-credentials.test.ts`: done (3 tests). It
   fails when a tracked `probe-cred.txt` holds a `nats://user:pass@` URL (planted, confirmed, removed
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
