# FX-COMPOSE worknote: per-service limits, no published database or NATS ports, and the colo budget check

Branch `fix/c1-colo-compose-hardening`. A fix packet from the C1 boundary review of the colo stack. Part A (per-service limits) and part B (the published ports) are done here. It touches `compose/colo.yml`, `shards/colo.yaml`, `geldar.ps1` (`Read-ColoConfig` and the `Invoke-Shard` `up` action), `tools/repo-checks/src/colo-config.test.ts`, `tools/repo-checks/src/colo-services.test.ts` and this note.

## Findings and what changed

- **(A) The colo services had no per-service limits, no swap cap and no log rotation.** Every service in `compose/colo.yml` now has a CPU and memory budget read from `${GELDAR_COLO_<SERVICE>_CPUS:-x}` and `${GELDAR_COLO_<SERVICE>_MEM:-y}`. The literal default is the budget. `memswap_limit` equals the memory budget, so no swap is allowed. Each service has `pids_limit`, and `deploy.resources.limits.pids` with the same value. Each service has `logging: *logging`, which is the `x-logging` anchor (json-file, 10m, 3 files).

  | Service | CPUs | Memory | pids | Notes |
  |---|---|---|---|---|
  | paper | 3 | 8192m | 512 | heap `MEMORY: 6G` (a test keeps them equal) |
  | velocity | 0.5 | 1024m | 256 | the only game listener |
  | postgres | 1 | 2048m | 256 | no published port |
  | nats | 0.5 | 512m | 256 | no published port |
  | eventsink | 0.5 | 512m | 256 | |
  | golem-body | 1 | 2048m | 256 | |
  | animus | 1 | 2048m | 256 | |
  | **Total** | **7.5** | **16384m** | | the `cpu_limit` and `memory_limit` in `shards/colo.yaml` |

  The budgets are first guesses, marked as such in the compose file and in `shards/colo.yaml`. They are to be measured in C1-10 on the node.

- **(A) The total is checked against the sum of the budgets.** `Read-ColoConfig` reads every `GELDAR_COLO_<SERVICE>_CPUS` and `_MEM` reference in `compose/colo.yml`. Each service's variable appears twice (`memory` and `memswap_limit` both read `_MEM`), so the count was doubled: 32768m instead of 16384m. The fix counts each service once, at its first reference, with a `$cpuSeen` and `$memSeen` hashtable. The `budgets()` helper in `colo-config.test.ts` had the same double count, and got the same fix. Eight pwsh tests failed on it before the fix. `Read-ColoConfig` also refuses a memory total below Paper's heap (6G) plus 1 GiB (7168m), and a total below the budget sum.

- **(A) The `GELDAR_COLO_CPU_LIMIT` and `GELDAR_COLO_MEMORY_LIMIT` exports were removed from `Invoke-Shard`.** The budgets are now compose literals, so nothing exports the total into the environment. A test asserts that neither name appears in `geldar.ps1`.

- **(A) The pids deviation.** The packet names `pids_limit`. Compose also needs `deploy.resources.limits.pids` next to it (compose does not accept `pids_limit` alone under the deploy limits), so each service sets both to the same number. Paper has 512 and the others 256.

- **(B) Published ports removed.** `compose/colo.yml` on `origin/main` published Postgres on the host (5432) and NATS (4222 and the 8222 monitor). Both publications are removed. Those services are reached on the `colo` network only, and the compose file says so in a comment. Velocity keeps `127.0.0.1:25567:25565` (decision 0082). Paper publishes nothing, as before: the game port and RCON are not published.

- **Revert evidence.** Each mutation was made on one line, `git diff --stat` confirmed one changed line, the two colo test files were run, and the file was restored from a copy in the scratchpad (no `git checkout`).
  - (a) Paper `memory` default raised from 8192m to 9216m, so the memory sum (17408m) exceeds the 16384m total: 8 tests fail (7 in `colo-config.test.ts`, 1 in `colo-services.test.ts`), including the sum tests and the pwsh tests that read the committed file.
  - (b1) `memory_limit` in `shards/colo.yaml` set to 7000m: 2 tests fail (the committed-file tests). `Read-ColoConfig` refuses it.
  - (b2) The Paper-heap refusal in `Read-ColoConfig` disabled (`if ($false)`): 2 tests fail, including `refuses a memory total below Paper heap (6G) plus 1 GiB`.
  - (c) `pids_limit` removed from `golem-body`: 2 tests fail (the Body/Mind caps test and the all-services `golem-body` test).

## Tests

- `colo-config.test.ts`: static wiring (the function and its callers, no exports of the limits, the reserved ports, the loopback rule, Paper heap in step with the floor). `budgets()` (the seven services; the total covers the budgets; the sum is exactly 7.5 CPUs and 16384m). The pwsh behaviour tests (accepts the committed file; refuses each bad value by name).
- `colo-services.test.ts`: the Body and Mind caps now include `deploy.resources.limits.pids`. A new block checks all seven services for their budget, `memswap_limit`, `pids_limit`, deploy `pids` and `logging`, names exactly the seven services, and checks that Postgres and NATS publish no port and Velocity keeps `127.0.0.1:25567:25565`.
- A test-file bug from the WIP commit was fixed: the ordering assertion searched for `'start shard`, but the script uses a double-quoted `"start shard $shard"`.

## Results: B-rcon, C and D

- **B-rcon, `--rcon-host` refused for colo.** `shard up colo --rcon-host` refuses: the colo stack has no RCON on the host loopback. Revert-checked (commit 1586cb0).
- **C, NATS auth on by default for `shard up colo`.** `Invoke-Shard` merges `compose/nats-auth.yml` for `up colo`. `Assert-ColoNatsSecrets` requires six files before `up` (nats-body.txt, nats-mind.txt, nats-paper.txt, nats-velocity.txt, nats-eventsink.txt, nats-auth.conf). It names what is missing and never writes a partial set. animus takes the mind user: `GELDAR_NATS_USER: mind`, `GELDAR_NATS_PASSWORD_FILE: /run/secrets/nats-mind.txt`, from the `nats-mind` secret (`./secrets/nats-mind.txt`). `Invoke-Check` validates colo.yml merged with nats-auth.yml.
- **C tests.** `nats-auth.test.ts` has a static block (every password file in the merged colo config points at a secret the service mounts; animus wiring; the Invoke-Shard merge line). `colo-services.test.ts` expects the Mind's `nats-mind` secret.
- **C revert evidence.** The Invoke-Shard merge line removed: the static merge test fails. The animus password path changed to `/run/secrets/nats-mind-revert.txt`: the password-wiring test fails. Both restored, checked by hash, `git diff --stat` empty.
- **D, colo rules strengthened (`loopback-ports.ts`).** For `compose/colo*.yml`, every service needs `pids_limit`, `memswap_limit` and `logging`. `cpus` and `memory` must be positive, or `${VAR:-default}` with a positive default. Denied keys: `privileged`, `cap_add`, `pid`, `ipc`, `userns_mode`, `devices`, `sysctls`, and any `network_mode`. Volumes: named volumes, or relative sources from the allowlist (`../sql`, `../shards`, `../plugin`, `../plugins`, `../deploy`, `./paper`, `./velocity`, `./secrets`). Absolute host paths, Windows drive paths, `docker.sock`, and `..` after an allowed prefix are refused. `compose/nats-auth.yml` gets the value and security rules, not the presence rules, because it adds no service. `compose/colo.yml` passes unchanged.
- **D revert evidence.** `privileged` removed from the denied keys: its test and the overlay test fail. The `docker.sock` check removed: both docker.sock tests fail. `cpus: "0"` accepted: its test fails. The `pids_limit` requirement removed: its test fails. Each restored, checked by hash.

## Deviations

- The static NATS test reads the two YAML files and merges them by hand, so it runs without docker. The docker-based merge test still runs where docker exists.
- The `colo-services` expectation for the Mind's secret list changed on purpose: the Mind now takes `nats-mind`.
- The "no deploy limits" test uses `arrayContaining`, because its services now also lack the new keys. Its limit messages are still exact.

## Follow-ups

- `geldar.ps1` is about 605 lines (soft cap 500, hard cap 700). Splitting it is a separate packet.
- Non-superuser database roles (C2).
- NATS auth config generation is PowerShell-only, so the node deploy depends on it.
- The TypeScript colo rules read each file alone. The merged view is checked only by `docker compose config` in `Invoke-Check`.
- Final gates (fix/c1-colo-compose-hardening): biome check tools/repo-checks/src exit 0; vitest run tools/repo-checks 265 passed, 3 skipped; check:repo ok; merge-tree with origin/main exit 0; docker compose config (colo.yml, and with nats-auth.yml) exit 0.
- **CI fix, RCON test.** The threshold test pinned the old hint line layout, which the colo refusal changed. It now checks the property (rcon-host.yml added only behind the `\` switch, the colo throw before it, the hint names `--rcon-host` and prints only without it). Revert-checked: an unconditional override and a removed hint each fail it.
- **CI fix, refusal test on Linux.** The Linux pwsh error record is coloured, and colour codes split `decision 0082`, so the squashed check missed it. The test now reads the exception message from a try/catch (same assertions, no secret written). Revert-checked: dropping `(decision 0082)` from the message fails it.
