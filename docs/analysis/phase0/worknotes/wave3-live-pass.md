# Wave 3 live pass (orchestrator, 2026-11-09, on the merged wave branch)

Stack rebuilt from `phase0/wave3` (`./geldar.ps1 shard up phase0`): all services healthy, including the new `eventsink` image build and both plugin jars.

- Geldar-Core loads on Paper, connects to NATS, publishes into `GELDAR_EVENTS`.
- Event flow: `server_tps`, `sleep`, `damage` rows reached Postgres `events` through the sink (after recreating the empty Postgres volume, see finding L1).
- Velocity identity gate: logs `Geldar identity enabled`; with the registry bucket absent it retries every 30 s; after Golem created the bucket it synced; 53 admits and no denies during the live lane; an unregistered username (`NotRegistered`) is kicked at the proxy with `This connection is not admitted.`
- Live lane with `GELDAR_NATS_URL=nats://127.0.0.1:4222`: 58 of 59 pass.

Findings:
- L1: the Postgres volume was initialised with an older password than `compose/secrets/postgres.txt` in the new worktree, so the sink got `password authentication failed`. Tables were empty, so the volume was removed and recreated. Not a code bug. Ops note: a password secret regenerated in another worktree orphans the volume; `shard secrets` never overwrites, but copying secrets between worktrees must copy all of them.
- L2: `golem/test/live/registry.live.test.ts` fails: it expects life id `ag_golemregistrylive_01` but the implementation truncates the derived name to 16 characters (`ag_golemregistryliv_01`). Test expectation bug (the coder could not run the live test).
- L3: the plugin's recipe grant has no live proof yet: fixtures still use RCON `recipe give`. A live case that crafts a `crafting_table` and `stone_pickaxe` with NO `recipe give` is owed.
- L4: velocity-identity logs `Life registry unavailable (IOException)` for both "bucket absent" and a connection failure; it should say which (a missing bucket is expected before Golem starts). Also the gate stays closed up to 30 s after the bucket appears, so a Golem first connect can be denied; Golem's reconnect backoff covers it, but the first live lane connection time should be measured.
- L5: `Dockerfile` build works (image built and healthy).
