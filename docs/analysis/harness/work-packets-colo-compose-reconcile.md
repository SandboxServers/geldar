# Harness card COLO-COMPOSE-RECONCILE: the repo compose file expresses the node's live settings

Status: **Proposed, prescriptive, not dispatched.** Written 2026-11-28 from the read-only node investigation and the
2026-11-20 drift finding ([colo-compose-drift](../../runbooks/colo-compose-drift.md)). The node's `colo.yml` was
hand-patched on 2026-11-28; its file sha256 starts `ebca19fc` (the hand-patched copy). This card changes nothing on the node.

## Rules for every step

- **Nothing is applied by this card.** It describes repo edits, a read-only proof, and an operator procedure. The
  operator procedure runs only after the owner gates below are settled.
- **Paper recreate needs owner approval** (requested through geldar-93). No step recreates the `paper` service, or any
  player host, without that approval recorded in the brief of the packet that does it.
- **No secret, address, host name or account name** goes in the repo, a log or a PR. The render proof output stays in a
  private temporary directory and is never printed.
- **Owner gates (BlockedDecision).** The card is not dispatchable until the owner decides these:
  - **D1** Paper limits: the node runs 8 CPUs, 15360m and heap 10G (raised 2026-11-15 for the pregen and render); the
    repo defaults are 3, 8192m and 6G. Drift item 1.
  - **D2** Ledger and OTel agent mounts and env on `paper` (drift item 2). The node runs them; the repo has none.
  - **D3** `golem-body`: the repo keeps `profiles: ["adam"]` (decision [0212](../../decisions/0212-golem-body-is-a-profile-adam.md)); the node runs it with no profile and `restart: unless-stopped`.
    Keeping the repo form changes how the CD and the operator start it (see step S4).
  - **D4** Telemetry and observations pass-through on `players-host` and `golem-body` (drift item 6). Once the repo copy is on the
    node, a player host started from an env that exports `GELDAR_TELEMETRY_URL` sends Body metrics (see the runbook, "Body metrics on the player hosts").
  - **D5** Confirm decision [0430](../../decisions/0430-remove-animus.md): the `animus` service is removed in the repo. The node still defines it under profile `mind`.

## The divergence and the target

The node column is the node's `colo.yml` (sha256 starts `ebca19fc`). The repo column is `compose/colo.yml` at `b3cf6655`.
"Node effect" says what the copy does to running containers. Nothing changes until an operator recreates a service (S4).

| # | Item | Node (live) | Repo now | Target in repo | Node effect on the copy |
|---|---|---|---|---|---|
| 1 | Paper limits | cpus 8, memory 15360m, memswap 15360m, `MEMORY: 10G` | `GELDAR_COLO_PAPER_CPUS` 3, `GELDAR_COLO_PAPER_MEM` 8192m, `MEMORY: 6G` | Keep the two existing variables; defaults 8 and 15360m (D1). Add `GELDAR_COLO_PAPER_HEAP` default `10G`; `MEMORY: ${GELDAR_COLO_PAPER_HEAP:-10G}` | None until `paper` is recreated (owner approval). The defaults equal the live values, so the rendered config is the same. (This claim covers the Paper limits only. It does not cover the RCON startup lines; see row 3 and S3.) |
| 2 | Ledger and OTel agents | `JAVA_AGENTS`, `OTEL_JAVAAGENT_CONFIGURATION_FILE`, `OTEL_SDK_DISABLED: "false"`; four mounts (ledger jar, OTel agent jar, `otel-agent.properties`, `ledger.properties`) | none | Opt-in overlay `compose/opt-in/colo-paper-agents.yml` that adds the env and the four mounts to `paper`. Selected on the node by `GELDAR_COLO_EXTRA_OVERLAY` (the `EXTRA_OVERLAY` that `deploy/common.sh` already passes to `docker compose`). Mounts cannot be gated by a variable, so an overlay is the only form (D2) | None until `paper` is recreated with the overlay selected. Without the overlay the copy drops the agents. |
| 3 | Startup RCON lines (one difference) | The node's `RCON_CMDS_STARTUP` has `worldborder set 19000` (equal to the repo). It has no `gamerule players_sleeping_percentage` line; the live value is 10 (set 2026-11-27, through RCON) | `worldborder set 19000` and `gamerule players_sleeping_percentage 10` (decision 0460) | Keep the repo lines. The only difference is the sleeping gamerule line | Read at Paper start only. Takes effect on the next Paper recreate. A recreate from the node file sets no sleeping gamerule; the value is kept only in the level data of a world that persists. |
| 4 | `golem-body` profile | no profile; `restart: unless-stopped` | `profiles: ["adam"]` (0212); `restart` as in the repo | Keep the repo form (D3) | The running container is not stopped by a file copy. Verify in S0 that the CD path still sees and restarts it (see S0, item 4). |
| 5 | `players-host` restart | `on-failure:5` | `restart: unless-stopped` (decision [0342](../../decisions/0342-body-hosts-unless-stopped.md)) | Keep the repo value | Compose-only. A running host keeps its `docker update` policy until `player-start` runs, which sets `unless-stopped` (0342). |
| 6 | `players-host` and `golem-body` telemetry and observations | no `GELDAR_TELEMETRY_URL` pass-through on `players-host`; no `GELDAR_OBSERVATIONS` on `golem-body` or `players-host` | pass-through lines with blank defaults | Keep the repo lines (D4) | A host started from an env that exports the variable gets telemetry. Check the node env names first (S0, item 2). |
| 7 | Sheet variables on `eventsink` | no `GELDAR_SHEET_SHARD`, `GELDAR_XP`, `GELDAR_PROFICIENCY_THRESHOLDS` | pass-through, blank default (blank = off) | Keep the repo lines | If the node env sets `GELDAR_SHEET_SHARD`, the copy turns the sheet state service on at the next `eventsink` recreate. Check first (S0, item 2). |
| 8 | `REGISTER_REQUIRE_MC_OWNERSHIP` on `register` | absent | pass-through, blank default (only `true` turns it on) | Keep the repo line | Blank is the same as absent. Adding the line changes the container config, so the next recreate picks it up. |
| 9 | `animus` service | defined under profile `mind`; not started by `shard up colo` | removed (0430) | Keep removed | None while no `animus` container runs. If an `animus` container exists and is stopped, remove it with compose after S0, item 3. |
| 10 | Project, network, loopback ports | literal `geldar-colo`, `geldar-colo` network, `127.0.0.1:25567`, `8788`, `18090`, `8787`, `8100` | `${GELDAR_PROJECT:-geldar-colo}`, `${GELDAR_NETWORK:-geldar-colo}`, `${GELDAR_PORT_*:-…}` with the same defaults | Keep the variables | None if the node env does not set `GELDAR_PORT_*` or the project and network names to other values (S0, item 2). |

Not reconciled by this card: `nf-live-human.yml` (the repo has the `velocity-human-init` one-shot, a `depends_on` and
`restart: unless-stopped`; the node has the older revision), `nf-live-probe.yml` (comments only), `nats-auth.yml`,
`neoforge/neoforge-entrypoint.sh`, `opt-in/scratch-neoforge.yml` and `opt-in/sheet-sink.yml`. The node is older on each. Each needs
its own render proof and copy step. They are out of this card's scope and do not block it. The four sibling compose files that
the node lacks (`nf-live-bluemap-web.yml`, `nf-live-mod-bluemap.yml`, `nf-live-mod-chunky.yml`, `signcheck.yml`) are not on the node by choice; no copy is needed.

## S0. Read-only preconditions (operator, on the node; before any edit)

1. Record the node file's sha256 (the file name is `colo.yml` under the node's `compose/` directory). It must start `ebca19fc`. If it does not, stop: the node changed since 2026-11-28, and the render proof in S3 must be redone.
2. Check the node env by name only, never by value: `grep -Eo '^(export )?(GELDAR_SHEET_SHARD|GELDAR_XP|GELDAR_PROFICIENCY_THRESHOLDS|GELDAR_OBSERVATIONS|GELDAR_TELEMETRY_URL|REGISTER_REQUIRE_MC_OWNERSHIP|GELDAR_PORT_[A-Z]+|GELDAR_PROJECT|GELDAR_NETWORK|GELDAR_COLO_EXTRA_OVERLAY)=' <env file> | sort | uniq -c`. A name that is set changes the render (items 6 to 8 and 10). Each set name is decided in the S3 proof, not assumed.
3. Check `animus` read-only: `docker ps -a --filter "name=animus" --format '{{.Names}} {{.Status}}'`. A running container stops the step: that is an owner decision, not part of this card.
4. Check that the CD still starts `golem-body` once the file has the `adam` profile: in the repo, read `svc_compose` in `deploy/colo-cd.sh` and the `golem-body` branch; the test file `deploy/test/` must cover the profile path. If that path is not covered, add the test in S1 before S4.
5. Check the file length: `compose/colo.yml` is 719 lines at `b3cf6655`, over the 700-line hard cap. Step S1a is a precondition for every other repo edit.
6. Check the four folders the node's record covers (`plugin`, `caddy`, `nats`, `compose`): `--record-applied` records all four at once (S4, item 5). Each folder must match `origin/main`, or the record attests a copy that is not there.

## S1. Repo edits (WIP commits, then one squash)

- **S1a.** Bring `compose/colo.yml` under 700 lines (719 at `b3cf6655`; the hard cap is 700). Shorten comments only, or move a comment-heavy block (for example the admin one-shot notes) to an existing README. Do not change any value. The owner's choice of block is recorded in the packet brief.
- **S1b.** Paper: `GELDAR_COLO_PAPER_CPUS` default `8`, `GELDAR_COLO_PAPER_MEM` default `15360m` (both in `deploy.resources.limits` and `memswap_limit`), new `GELDAR_COLO_PAPER_HEAP` default `10G` in `MEMORY`. Blocked by D1.
- **S1c.** `RCON_CMDS_STARTUP` already has the line in the repo. Confirm, change nothing. The node is the one that lacks it.
- **S1d.** New file `compose/opt-in/colo-paper-agents.yml`: `services.paper.environment` (`JAVA_AGENTS`, `OTEL_JAVAAGENT_CONFIGURATION_FILE`, `OTEL_SDK_DISABLED: "false"`) and `services.paper.volumes` (the four mounts, same sources as the node: `${GELDAR_STATE_DIR:-/var/lib/geldar-colo}/…` for the two jars and the ledger properties; `./paper/otel-agent.properties` for the agent properties). The mount sources are the node's paths. The repo `colo.yml` has none of these lines today, so nothing is removed from it. Blocked by D2.
- **S1e.** Comments only: the port comments in `colo.yml` that say "a compose value must be literal" are stale. The loopback rule (`loopback-ports-params.test.ts`) allows an allowlisted `GELDAR_PORT_*` interpolation whose default is the listed one. Rewrite the comment to say so. No value changes.

## S2. Tests (each fails when its change is reverted)

Golden and parameter tests:
- `deploy/test/fixtures/colo-default-config.yml`: update to the S1b values (`cpus: "8"`, `memory: "15360m"`, `memswap_limit: "15360m"`, `MEMORY: 10G`, the RCON line). `tools/repo-checks/src/colo-params.test.ts` asserts the same defaults. **Revert check:** set the default back to `3` in `colo.yml` and run `colo-params`; it fails on the cpus line.
- New `tools/repo-checks/src/colo-node-parity.test.ts`: with no overlay selected, the rendered `paper` has no `JAVA_AGENTS`, no `opentelemetry-javaagent.jar` mount and no `ledger.jar` mount. With `GELDAR_COLO_EXTRA_OVERLAY` pointing at the opt-in file, all of them are present. **Revert check:** move one mount line back into `colo.yml`; the no-overlay case fails.
- The same file: `players-host` has `restart: unless-stopped` (0342); `golem-body` has `profiles: ["adam"]` (0212); `RCON_CMDS_STARTUP` contains `gamerule players_sleeping_percentage 10` and `worldborder set 19000` (decision 0460); no service named `animus` (0430; `tools/repo-checks/src/no-animus.test.ts` already covers the package). **Revert check:** restore each line one at a time, each fails its own case.
- Error path: with the overlay selected and a missing jar source, the render fails with an error that names the source. It must not render the mount silently. **Revert check:** remove the error line from the check; the case fails.
- Blank selection: `GELDAR_COLO_EXTRA_OVERLAY` set to an empty string renders the same as unset (no overlay added). **Revert check:** make the empty string select a file; the case fails.

## S3. Read-only render proof (before any copy)

Goal: the repo file, rendered with the node env, equals the node's file rendered with the same env. Nothing is copied. Do this in a private directory (a new directory with the user's ACL only, not the repo, not the scratchpad copied into the repo). Delete it afterwards.

1. Source the node env in a subshell (the same env `deploy/common.sh` loads). Do not print it.
2. Render the node file from the node's `src` extract with the overlays `dc()` uses (`-f` nats-auth, `-f` secrets, `-f` public if set, `-f` extra if set): `docker compose -p geldar-colo -f compose/colo.yml <overlays> config > <private>/node.yml`.
3. Render the repo file from the candidate commit's work checkout with the same env and overlays, and the `opt-in` overlay if the node selects it: `… > <private>/repo.yml`.
4. Compare: `cmp -s <private>/node.yml <private>/repo.yml`. Expected result: equal, except for the source paths of `../plugin` if the two trees differ (list them; the list is part of the report). Print only `equal` or `differ` and the number of differing lines; never the lines.
5. Compare profiles: `docker compose … --profile adam --profile mind config --services` on both, and check that the two service lists match. The node lists `animus` only if it is in the file.
6. A difference is a stop: fix the repo file, or make the owner decide the item, then repeat S3.

**Expected RCON differences (read 2026-11-28, not a stop).** The `RCON_CMDS_STARTUP` line that is expected to differ is the sleeping gamerule: the node has no `players_sleeping_percentage` line, and the repo has `gamerule players_sleeping_percentage 10` (decision 0460; the live value is 10). The border line is the same on both sides (`worldborder set 19000`, the live border since the 2026-11-15 cutover). An earlier note said the node border was 3000; that came from a stale desktop copy in a relayed report, not from the node, and is wrong. A render that shows the sleeping gamerule line as the only RCON difference is the expected result; any other RCON difference is still a stop.

**Run 1 render proof findings (2026-11-28).**
- (a) `players-host` (profile `sovereign`) and `register` (profile `register`) are profile-gated, so they are absent from the default render on both sides. The default-render proof cannot check them. Render with `--profile sovereign` and `--profile register` to check their lines (items 5, 6 and 8).
- (b) The agents overlay (`compose/opt-in/colo-paper-agents.yml`) sets `bind: {create_host_path: false}` on its four Paper mounts. The node's live mounts lack it. Accepted as an explicit exception, because all four sources exist on the node.

## S4. Apply (operator, owner gates D1 to D5 settled; Paper only with owner approval)

1. Confirm S3 is `equal` on the candidate commit, and the owner decisions are recorded.
2. Back up the node file: copy `colo.yml` to `colo.yml.bak-<YYYYMMDD>-<first 12 hex of the repo commit>` in the same directory. The `.bak-` name keeps it out of the folder hash (`folder_hashes` in `deploy/colo-cd-plan.sh` skips `*.bak-*`). Record the backup's sha256 in the operator log.
3. Copy the repo file to a temporary name in the same directory, then `mv` it over `colo.yml`, so the file appears whole. Then `sha256sum` the node file and the repo file: the two must be equal. A mismatch: restore the backup (S5) and stop.
4. Preview the record: `DEPLOY_DRY_RUN=1 sh deploy/colo-cd.sh --record-applied` from the `src` extract. It prints what it would record and writes nothing.
5. Record: `sh deploy/colo-cd.sh --record-applied`. Run it only when the `plugin`, `caddy` and `nats` folders in the `src` extract match `origin/main` (S0, item 6). The record is the operator's statement; it prints `recorded applied: <folder> <12 hex>` for each folder.
6. Recreate only the services whose settings changed and that the owner approved, one at a time: `dc() up -d --no-deps --wait <service>`, then check the health. The candidates:
   - `eventsink` (item 7), only if the node env sets the sheet variables and the owner approves the sheet state service;
   - `register` (item 8): no recreate needed for a blank value; recreate only when the owner wants the ownership gate on;
   - `golem-body` (item 4), only if D3 is decided as the repo form, and only with `--profile adam`;
   - `paper` (items 1 and 2, and item 3 at its next start): **owner approval (geldar-93) first**, one recreate, health check.
   Do not run a bare `up -d` for the whole stack: the copy changes config hashes for several services, and a bare `up` recreates all of them.
7. `players-host` is not recreated by compose. Its policy and its telemetry take effect at `player-start` (in an owner window), or at the CD refresh (the CD refresh does not set the policy; see decision 0342).
8. Post-check, read-only: the render proof again (S3) on the node, `docker ps` for the services recreated, the `player-list` output. Write the result to the operator log, without values.

## S5. Rollback

- Restore the backup: `cp -p colo.yml.bak-<…> colo.yml` (the name from S4, item 2), then `sha256sum` it and check that it equals the hash recorded in S4 before the copy.
- Record again with the restored file, under the same condition as S4, item 5: `sh deploy/colo-cd.sh --record-applied`. Otherwise the record keeps saying the repo file is in place.
- Recreate what was recreated in S4, item 6, with the restored file, one service at a time. `paper` needs owner approval again. Compose recreates from the file on disk, so a restored file alone does not revert a container that is already running the new config.
- Nothing in this rollback reaches the `players-host` containers. Their policy is reset only by `player-start` (0342, consequence 4 of the failure message).

## Ledger

Row added to [ledger.md](ledger.md) (not regenerated; regenerate after any card edit):
`COLO-COMPOSE-RECONCILE | colo compose: repo compose reconciled to the node's live settings, then the operator copy | colo compose (new) | none | 40-50k | BlockedDecision (D1 to D5)`
