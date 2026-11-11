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

## Remaining (not in this packet)

- **B, rcon-host refusal.** `shard up colo --rcon-host` should refuse, because the colo stack has no RCON on the host loopback. Not done here.
- **C, NATS overlay for colo.** `shard up colo` does not merge the NATS overlay, so the colo NATS auth path is not covered by the overlay. Not done here.
- **D, validator values.** The validator's limits and values are for finisher 2 to set. Not done here.
