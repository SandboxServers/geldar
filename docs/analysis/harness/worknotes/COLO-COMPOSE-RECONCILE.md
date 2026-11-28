# COLO-COMPOSE-RECONCILE (card S2): the repo compose expresses the node's live settings

Base: 971b789c7. Branch: sheet/compose-reconcile.

## What changed

- **S1b (paper limits and heap).** `compose/colo.yml`: paper budget 8 CPUs and 15360m (env overrides `GELDAR_COLO_PAPER_CPUS` and `GELDAR_COLO_PAPER_MEM`), memswap equal to the memory limit, heap `MEMORY: ${GELDAR_COLO_PAPER_HEAP:-10G}` (was `6G`). Decision D1, 2026-11-15. `deploy/test/fixtures/colo-default-config.yml` (golden) updated to 8 CPUs, `16106127360` bytes and `MEMORY: 10G`.
- **S1d (opt-in Paper agent overlay).** New `compose/opt-in/colo-paper-agents.yml` adds the Ledger jar, the OTel agent jar and both properties files to paper, with `JAVA_AGENTS`, `OTEL_JAVAAGENT_CONFIGURATION_FILE` and `OTEL_SDK_DISABLED: "false"`. Selected with `GELDAR_COLO_EXTRA_OVERLAY=compose/opt-in/colo-paper-agents.yml` (`deploy/common.sh` already passes it). `colo.yml` has no agent lines (decision D2).
  - Mount sources (confirmed from the node, read-only `docker inspect`, 2026-11-28, per the coordinator):
    - ledger jar: `../plugin/ledger/build/libs/ledger.jar` (repo-relative, as `geldar-core.jar` is in `colo.yml`) -> `/plugins/ledger.jar`
    - OTel agent jar: `${GELDAR_STATE_DIR:-/var/lib/geldar-colo}/otel/opentelemetry-javaagent.jar` -> `/opt/otel/opentelemetry-javaagent.jar`
    - OTel properties: `./paper/otel-agent.properties` (exists in the repo) -> `/opt/otel/otel-agent.properties`
    - ledger properties: `${GELDAR_STATE_DIR:-/var/lib/geldar-colo}/ledger/ledger.properties` -> `/data/plugins/Ledger/ledger.properties`
  - Every mount is read-only and sets `create_host_path: false`, so a missing source fails the start and compose never creates an empty file or directory.
- **S1e (comment).** The loopback-ports comment in `colo.yml` now says an allowlisted `GELDAR_PORT_*` interpolation is allowed when its default is the port listed. The shard file must still match (geldar.ps1 checks it).
- **Parity test.** New `tools/repo-checks/src/colo-node-parity.test.ts`:
  - `docker compose config` without the overlay: no agent env and no agent mounts.
  - With the overlay: agent env and the four mounts.
  - Overlay selection in `deploy/common.sh` (skipped without `sh`).
  - Source checks on `colo.yml` (players-host restart, golem-body adam profile, the sleep gamerule, no `animus` service).
  - `create_host_path: false` on each overlay mount.
  - The four mount sources (added in this pass).

## Revert checks RC1-RC8

Status: **run.** Each row was run on the committed files: one line mutated, the named file run singly, the failing assertion recorded, the file copied back from a scratchpad backup, and `git diff --stat` checked empty for that file. Runs used `./geldar.ps1 pnpm exec vitest run <file>` (with `-t '<name>'` for the parity file).

| RC | File | Mutation (one line, back to the previous code) | File run | Failing test (real name) |
|----|------|------------------------------------------------|----------|--------------------------|
| RC1 | compose/colo.yml | `MEMORY: ${GELDAR_COLO_PAPER_HEAP:-10G}` -> `MEMORY: 6G` | tools/repo-checks/src/colo-params.test.ts | `colo compose parameters (docker compose config) > the default environment renders byte for byte the golden` |
| RC2 | compose/colo.yml | `cpus: "${GELDAR_COLO_PAPER_CPUS:-8}"` -> `:-3` | tools/repo-checks/src/colo-params.test.ts | same golden test |
| RC3 | compose/colo.yml | `memory: "${GELDAR_COLO_PAPER_MEM:-15360m}"` -> `:-8192m` | tools/repo-checks/src/colo-params.test.ts | same golden test |
| RC4 | compose/colo.yml | carry `gamerule players_sleeping_percentage 10\n` in `RCON_CMDS_STARTUP` (the live value since 2026-11-27; decision 0460 supersedes 0212 item 4; was 50) | tools/repo-checks/src/colo-node-parity.test.ts | `the live settings in compose/colo.yml > paper starts with the players_sleeping_percentage gamerule` |
| RC5 | compose/colo.yml | `profiles: ["adam"]` -> `profiles: []` | tools/repo-checks/src/colo-node-parity.test.ts | `the live settings in compose/colo.yml > golem-body keeps its adam profile and unless-stopped restart (decisions 0212, D3)` |
| RC6 | compose/colo.yml | players-host `restart: unless-stopped` -> `restart: always` | tools/repo-checks/src/colo-node-parity.test.ts | `the live settings in compose/colo.yml > players-host restarts unless-stopped (decision 0342)` |
| RC7 | compose/colo.yml | insert `  animus: {}` under `services:` | tools/repo-checks/src/colo-node-parity.test.ts | `the live settings in compose/colo.yml > no service is named animus (decision 0430)` |
| RC8 | compose/opt-in/colo-paper-agents.yml | ledger mount `create_host_path: false` -> `true` | tools/repo-checks/src/colo-node-parity.test.ts | `the opt-in agent overlay file > each agent mount refuses to create a missing host source (create_host_path false)` |

RC1-RC3 fail the golden test in `colo-params.test.ts` (the only file that reads `deploy/test/fixtures/colo-default-config.yml`; `genesis-config-bundle.test.ts` also reads that golden, but it was not part of the run). The parity file lives in `tools/repo-checks/src`, not `deploy/test`.

## Deviations and open items

- **S1a not done.** The packet item was not in this pass's brief; nothing was changed for it.
- **create_host_path false** is tested by a source check on the overlay file, not by a render. `compose config` drops a `false` bind option and renders `bind: {}`.
- **Blank-selection tests skip without `sh`.** The overlay selection tests in `deploy/common.sh` need `sh` on PATH. On Windows, Git `sh` (`C:\Program Files\Git\bin`) must be first on PATH for them to run.
- **Docker-dependent tests skip without `docker compose`.** The render tests use `describe.skipIf(!dockerOk)`.
- **Fixed: `a set GELDAR_COLO_EXTRA_OVERLAY selects that file`.** Cause: common.sh sets `DEPLOY_DIR` from `$0`. With `sh -c '. ./deploy/common.sh; ...'`, `$0` is the shell (`/usr/bin/sh`), so `DEPLOY_DIR` was `/usr/bin` and the `. space-floor.sh` line failed (three "No such file" errors per run; the printf still gave the right value, so the test passed by luck on this machine and could fail where a failed source aborts the shell). The test now passes `deploy/common.sh` as `$0` with `cwd` at the repo root. Run with Git `sh` first on PATH: 10 passed, no stderr. Without Git `sh` on PATH the two overlay tests skip (`sh` is not found).
- **No error-path test for the overlay selection.** The tests cover the success path (one `-f` per entry, blank adds none). Nothing tests a missing or misspelt overlay path through `compose_call`.
- **A missing bind source is not checked.** `compose config` does not check that a bind source exists on the host, so a missing `create_host_path: false` source is only caught at Colo start (RC8 is a source check, not a render).
- **S1a skipped.** Not done in this pass. `compose/colo.yml` is 719 lines, over the 500 soft cap and under its 900-line exemption; the split is left open.
- **adm and sov in colo-admin.sh.** Tested in `tools/repo-checks/src/colo-admin-overlays.test.ts`: the two functions are extracted from the script and run under sh with a fake docker. `adm` adds the token overlay and one `-f` per colon entry; `sov` adds one `-f` per entry and never the token overlay. Revert-check: the quoted `for _entry in "$EXTRA_OVERLAY"` in `deploy/common.sh` fails the first test (5 files, not 6). The script's main body is not run, so the subcommand dispatch is not tested.
- **Colon-separated `GELDAR_COLO_EXTRA_OVERLAY`.** The variable takes several overlays as `a.yml:b.yml`; `deploy/common.sh` splits on `:` and adds one `-f` per non-blank entry, after PUBLIC_OVERLAY. A blank value adds none. Overlay paths must not contain `:`.
- **Node deploy scripts lack `compose_call` (2026-11-28).** The node's `src` deploy scripts predate `compose_call`, so the colon form of `GELDAR_COLO_EXTRA_OVERLAY` is not read there until the next colo-images CD run copies the new scripts. Do not set the colon form (`a.yml:b.yml`) on the node before that run. A single overlay path with no colon is safe.
- **RCON startup lines, node against repo (2026-11-28).** One difference: the node has no `players_sleeping_percentage` line (the repo carries 10, the live value). The node border is `worldborder set 19000`, equal to the repo. An earlier note said the node had `worldborder set 3000`; that came from the desktop's pre-PR file in a relayed report, not from the node, and is wrong. The earlier note "defaults equal live" covers the Paper limits only. Decision 0460.
- **Run 1 render proof findings (2026-11-28).**
  - (a) `players-host` (profile `sovereign`) and `register` (profile `register`) are profile-gated: absent from the default render on both sides, so the default-render proof cannot check them. Render with `--profile sovereign` and `--profile register` to check them.
  - (b) The agents overlay sets `bind: {create_host_path: false}` on the four Paper mounts; the node's live mounts lack it. Accepted as an explicit exception, because all four sources exist on the node.
- **S0 env-name list.** The S0 list of environment names must include `GELDAR_COLO_PAPER_CPUS`, `GELDAR_COLO_PAPER_MEM` and `GELDAR_COLO_PAPER_HEAP`, and the value of `GELDAR_COLO_EXTRA_OVERLAY` as set in the node env. The S0 list is kept on the card, not in this worktree, so it is not edited here.
- **Scratch-telemetry stub guard on Windows.** Three `scratch.sh` file-list tests in `tools/repo-checks/src/scratch-telemetry.test.ts` fail on this Windows host in `assertStubsFirst` (the guard runs before the script): msys `sh` resolves `id` to `/usr/bin/id`, not the stub. The failure is in the harness, not in `scratch.sh` or `common.sh`; CI passes on the same head. Not reproduced on a57aa3dd9 separately, because the guard fires before any script logic.
- **Full run not completed.** The full `tools/repo-checks deploy/test` run did not finish in this session (it stalled for over 13 minutes, and a second vitest process from the same worktree was running). It was stopped. The `deploy/test` suite still needs a clean run with no other vitest process in the worktree.
