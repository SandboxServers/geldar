# Wave C1 packets: the shard on the Colo, internal

Status: draft, 2026-11-10. Written from `origin/main` at `e28dffc` (the Phase 1 analysis is merged). Source: [plan.md](../plan.md) (C1 section), [packet-conventions.md](../packet-conventions.md) (card format, shared files, gates, never-do list), the planner schedule for ids, scope, lanes, status and decision numbers, and decisions [0076](../../../decisions/0076-backup-scope-and-destination.md) to [0080](../../../decisions/0080-nats-auth-cutover.md) (proposed; owner confirms before the packets that depend on them).

Nothing here is implemented. Each card is a brief the orchestrator dispatches. A card names only the files it may edit. Where a path in the schedule does not match the repo, the card uses the real path and says so in "Corrections to the schedule" below.

## 0. Conventions every card inherits

- **Never-do list** (packet-conventions.md section 5, copied into every brief): no `adam up`, and no `adam up --help` on a live node; no state-changing probe against a live shard; never weaken a test, fixture or verdict to make it pass; never `git reset`, `git stash` or `git checkout` on tracked work; never edit `docs/spec.md`; never push, open a PR, or prune a worktree. Packets in this wave also never run `shard up` on the node.
- **Worktree**: one per packet, under `.claude/worktrees/<id>`, branch `phase1/c1-<id>`. The brief gives the absolute worktree path.
- **Must-not-edit, always**: `docs/spec.md`; `docs/decisions/README.md` (ops merge step writes the index); `docs/analysis/phase1/plan.md` and the conventions file; the ledger README. The shared files in packet-conventions.md section 3 are owned as stated in each card.
- **Shared-file owners in this wave**: `contract/` and its generated output: P1-C1-00 only. `geldar.ps1`, `compose/*`, `shards/*`, the repo-checks registry, `golem/` view file: C1-02 only. `package.json` and `pnpm-lock.yaml`: C1-07 only (the one C1 packet that adds dependencies); everyone else writes an index line.
- **Decision numbers**: a packet uses only its reserved numbers (packet-conventions.md section 6). It checks `docs/decisions/` before committing and never reuses a number.
- **Gates per packet** (packet-conventions.md section 4.1): targeted test, `./geldar.ps1 pnpm typecheck` and `./geldar.ps1 pnpm format` for touched packages, revert-check named on the card, file caps (700 hard, 500 soft), decision-index check, `git merge-tree` dry run against the wave branch before the last commit. The worknote records each command and its final result. A gate that did not run is listed as not run, with the reason.
- **Size**: S is one session of about 25k working tokens; M is one session of about 40k; L is two sessions (packet-conventions.md section 1). A packet that reaches its budget commits what passes, writes the rest into its worknote and report, and stops (`on-cap`).
- **Report** (every packet): files changed; each gate with its command, final result and commit hash; the revert-check (which test, which line was mutated, and the test's failing output); deviations from the card with reasons; index lines written; open questions.
- **Commit**: one commit per item, subject naming the item. Each commit message ends with the attribution lines the orchestrator supplies.
- **Worknote**: `docs/analysis/phase1/worknotes/<id>.md`, one file per packet, appended as the work goes. Index lines go there, in the form `index: | [NNNN](NNNN-slug.md) | Title | Status |` (packet-conventions.md section 7).

### Corrections to the schedule (checked against `origin/main` at `e28dffc`)

| Schedule says | Repo has | Card uses |
|---|---|---|
| `threshold/mcp/sql` (C1-05a) | No such directory. Migrations are `sql/0001_init.sql` to `sql/0006_owner_cap_trigger.sql`, schema test `sql/test/check-schema.sql` | `sql/0007_*.sql`, `sql/test/check-schema.sql` |
| `golem/Dockerfile`, `Dockerfile.mind` (C1-03) | No Dockerfile under `golem/`. Existing images: `eventsink/Dockerfile`, `threshold/mcp/Dockerfile`, `threshold/mcp-mock/Dockerfile`. The Mind is `animus/` | `golem/Dockerfile` (new), `animus/Dockerfile.mind` (new) |
| `thinking-loop.ts` 611 lines, `thinker.ts` 587, mcp-mock `server.ts` 565, `adapters.ts` 514 (C1-01) | Re-measured: `animus/src/loop/thinking-loop.ts` 583, `lantern-local/src/thinker.ts` 559, `threshold/mcp-mock/src/server.ts` 531, `tools/adam-run/src/adapters.ts` 617 | Split whichever file is over 500 when the packet starts; re-measure first |
| `adam-reset` in `tools/adam-run` (C1-05a) | No `adam-reset.ts` file. The reset lives in `golem/test/live/adam-reset.test.ts` and `golem/test/live/adam-case.ts` | Those two files, plus any `DELETE` path found by `grep -rn "DELETE" golem/test/live` |
| "add tools/mcp-tokens to `check`, fix its 3 type errors" (C1-00) | `tools/mcp-tokens/package.json` already has `typecheck`; the 3 fixes are recorded in `docs/analysis/phase0/worknotes/fix-flake.md` (item 7). `check` runs `pnpm typecheck`, which covers every workspace package with the script | First confirm the workspace lists it (`pnpm-workspace.yaml`); run the typecheck; fix only what still fails |
| CI Postgres job (C1-00) | `.github/workflows/ci.yml` already has a Postgres service in the `integration` job (around lines 179 to 188) and runs `sql/test/check-schema.sql` (line 147) | Extend the existing job; do not add a second one |
| "the existing telemetry" (C1-07) | No telemetry endpoint or metrics code in the repo | Owner question 4 in section 4 |
| Five flaky tests (C1-01) | `docs/analysis/phase0/known-gaps.md` line 43 names them: `golem/src/test-control.test.ts`, `golem/test/live/adam-stack.test.ts`, `tools/repo-checks/src/cli.test.ts`, `threshold/mcp/src/imports.test.ts`, and the lantern-local thinker reconnect test | Same list; the reconnect test is found with `grep -rln "reconnect" lantern-local/src` |
| Decisions 0076 to 0080 (pre-packet) | Present on `origin/main` as Proposed | Owner confirmation gates are in section 4 |

---

## Card P1-C1-00: unblocker, contract and repo checks

- **id**: P1-C1-00
- **title**: Contract for the colo shard, and the repo gates the wave needs
- **wave**: C1
- **lane**: A (contract unblocker)
- **status**: B
- **depends-on**: none (first to merge in C1; C2b-00 and C3-00 wait for it to serialize `contract/`)
- **size**: S
- **decisions**: 0081 (one record: the colo contract and gate definitions)
- **worknote**: `docs/analysis/phase1/worknotes/P1-C1-00.md`

**may-edit**
- `contract/schemas/` (new schema for the checkpoint manifest; shard-config keys added to the existing shard schema). Locate the shard schema with `grep -rln "shard" contract/schemas`.
- `contract/` generated output, by running the generator only. The generator is the script in `contract/package.json` (locate with `grep -n "generate" contract/package.json`).
- `tools/repo-checks/src/` (new `release-age.ts` and `release-age.test.ts`; `decision-index.ts` and its test; a new `integration-floor.ts` and its test). The registry (`tools/repo-checks/src/cli.ts`) gets one entry per new check.
- `pnpm-workspace.yaml` only if `tools/mcp-tokens` is missing from it (check first).
- `tools/mcp-tokens/src/` only for the typecheck errors that still fail.
- `.github/workflows/ci.yml`: the existing `integration` job only (the Postgres service is already there). Add the mcp-tokens integration files if not listed (they are listed at lines 232 and 233 now).
- `docs/decisions/0081-*.md` (new record; the index line goes in the worknote).

**must-not-edit**: `geldar.ps1`, `compose/*`, `shards/*`, `docs/decisions/README.md`, `package.json` and `pnpm-lock.yaml` (no new dependency is needed for this card; if one is, it becomes an index line for C1-07), `golem/`, `animus/`, `threshold/`, `plugin/`.

**Steps**
1. Read `contract/package.json` and locate the generator. Run it once on a clean tree and confirm it changes nothing (`./geldar.ps1 pnpm check:generated`). That is the baseline.
2. Add a checkpoint manifest schema under `contract/schemas/`: fields `checkpoint_id` (string, ULID or UUID v4), `image_digest` (string, `sha256:` plus 64 hex), `created_at` (RFC 3339), and `parts`, an array of `{ name, sha256, bytes }` where `name` is one of `postgres`, `nats`, `world`. Reject unknown part names. Generate the validators.
3. Add the colo shard-config keys to the existing shard schema: `cpu_limit`, `memory_limit`, `minecraft_port` (default 25565, must not be 25566), `bind_address` (default `127.0.0.1`), `telemetry_url` (optional, no default). Every key has a type and a range; unknown keys are an error. The keys are declared here, but no value is set in `shards/` by this card.
4. Repo check `release-age.ts`: every pinned version in `package.json`, `pnpm-lock.yaml`, Gradle files, and Docker image references (`image: name@sha256:...`) must have been published at least 14 days before the check runs. The check reads publish dates from a JSON file `tools/repo-checks/src/release-dates.json` that the packet creates and fills for current pins. A pin missing from the JSON is a failure, not a skip. Pin rules already exist in `tools/repo-checks/src/pin-rules.ts`; extend, do not duplicate.
5. Repo check `decision-index.ts` (exists): add the drift case. Every `docs/decisions/NNNN-*.md` file must have a matching row in `docs/decisions/README.md`, and every row must have a file. Add a test for each direction.
6. Repo check `integration-floor.ts`: the number of integration tests that ran (from the vitest JSON reporter output, or a count of `*.it.test.ts` and `*.live.test.ts` files with at least one `it(`) must be at least the floor stored in `tools/repo-checks/src/integration-floor.json`. Set the floor to the current count on `origin/main`, recorded in the worknote with the command that produced it. A count below the floor is a failure.
7. Run `./geldar.ps1 pnpm -r --if-present run typecheck` and confirm `tools/mcp-tokens` is included. If it fails, fix the errors it reports (expected: none on `e28dffc`; if there are none, say so in the worknote and change nothing).
8. Confirm the Postgres service in `.github/workflows/ci.yml` covers `tools/mcp-tokens/test/*.it.test.ts`. Do not add a second Postgres job.
9. Write `docs/decisions/0081-<slug>.md`: the colo contract, the three new check names, and the release-age window of 14 days. Status Proposed. The index line goes in the worknote.
10. Append the handoff for C1-02 to the worknote: the shard-config keys it must read, and the registry entries it must add to `geldar.ps1` (C1-02 owns it; this card does not touch it).

**Error behaviour**: the manifest schema rejects a missing `image_digest` and any digest that is not `sha256:` plus 64 hex; release-age fails closed on a missing date; the floor check fails when the count cannot be computed (it never falls back to passing).

**Acceptance checks**
- `./geldar.ps1 pnpm check:generated` passes after the generator is run, and passes again with no diff.
- `./geldar.ps1 pnpm vitest run tools/repo-checks/src/release-age.test.ts tools/repo-checks/src/decision-index.test.ts tools/repo-checks/src/integration-floor.test.ts`
- `./geldar.ps1 pnpm check:repo`
- `./geldar.ps1 pnpm typecheck`, `./geldar.ps1 pnpm format`
- Full `pwsh -NoProfile -File ./geldar.ps1 check` before the last commit.

**Revert-check (name the test and the line)**
- In `tools/repo-checks/src/release-age.ts`, change the window comparison from "at least 14 days" to "at least 0 days" (or delete the missing-date failure). The release-age test for a 2-day-old pin must fail. Restore.
- In `tools/repo-checks/src/decision-index.ts`, remove the file-to-row comparison. The drift test for a record without an index row must fail. Restore.
- In `tools/repo-checks/src/integration-floor.ts`, make the count fall back to a pass when it cannot be read. The test with an unreadable count must fail. Restore.

**Commit plan**
1. `P1-C1-00: checkpoint manifest and colo shard-config schema, generated`
2. `P1-C1-00: release-age, decision-index drift and integration floor repo checks`
3. `P1-C1-00: record 0081 for the colo contract and gates` (plus the worknote)

**index line to add** (ops merge step): `index: | [0081](0081-<slug>.md) | <title> | Proposed |`

**On report**: the release-date JSON source and how each date was taken; the integration floor value and its command; whether the typecheck was clean on entry.

---

## Card C1-01: split over-500-line files, quarantine flaky tests

- **id**: C1-01
- **title**: Split the four over-500-line files; put the five flaky tests behind an injected clock
- **wave**: C1
- **lane**: B
- **status**: B
- **depends-on**: none (it may start before C1-00; it does not touch `contract/` or repo-checks)
- **size**: M
- **decisions**: none reserved (the schedule gives none). A record, if one is needed, goes to the orchestrator as an index request, not a number from this block.
- **worknote**: `docs/analysis/phase1/worknotes/C1-01.md` (this is also the flake log)

**may-edit**
- `animus/src/loop/thinking-loop.ts` and new sibling files in `animus/src/loop/` (split).
- `lantern-local/src/thinker.ts` and new sibling files in `lantern-local/src/` (split).
- `threshold/mcp-mock/src/server.ts` and new sibling files in `threshold/mcp-mock/src/` (split).
- `tools/adam-run/src/adapters.ts` and new sibling files in `tools/adam-run/src/` (split).
- The five flaky test files: `golem/src/test-control.test.ts`, `golem/test/live/adam-stack.test.ts`, `tools/repo-checks/src/cli.test.ts`, `threshold/mcp/src/imports.test.ts`, and the lantern-local reconnect test (find it with `grep -rln "reconnect" lantern-local/src`).
- The clock seam for those tests: a `clock.ts` next to the code under test. Name it for what it does, not `helpers.ts` or `utils.ts`.

**must-not-edit**: `contract/`, `geldar.ps1`, `compose/*`, `shards/*`, `package.json`, `pnpm-lock.yaml`, the repo-checks registry (the file-caps check already exists; do not change its rules), `docs/spec.md`.

**Steps**
1. Re-measure the four files (`(Get-Content <file> | Measure-Object -Line).Lines`). Only split files still over 500 lines.
2. For each file, split first, in its own commit, with no behaviour change. Move cohesive functions into named siblings (for example `thinking-loop.ts` keeps the loop, and the prompt assembly goes to `loop/prompt-assembly.ts`). Keep exports the same; re-export from the original path if callers import it by that path. Do not rename exported symbols.
3. Run the split file's existing tests after each split. They must pass unchanged. No test file is edited to match the new layout unless its import path moved.
4. For each of the five flaky tests, read the test and find the timer, `Date.now()`, or sleep it depends on. Add a clock parameter with a real default (`systemClock`) and inject a fake clock in the test. The fake clock advances only when the test says so.
5. Log each flaky test in the worknote: the old failure mode (if recorded in `known-gaps.md`), the seam added, and the fake-clock calls. Do not add retries. Do not use `it.skip`, `describe.skip` or `.todo`. A test that cannot be made deterministic stays failing and is reported.
6. Confirm with the file-caps check that every touched file is under 500 lines (soft) and under 700 (hard).

**Error behaviour**: the clock seam throws if a test reads the real clock while a fake clock is injected (so the test cannot silently depend on wall time).

**Acceptance checks**
- Per split: the affected package's tests, for example `./geldar.ps1 pnpm --filter <pkg> test`.
- Per flaky test: `./geldar.ps1 pnpm vitest run <test file>` run five times in a row, five passes each time, recorded in the worknote.
- `./geldar.ps1 pnpm check:repo` (file caps and line endings)
- `./geldar.ps1 pnpm typecheck`, `./geldar.ps1 pnpm format`
- Full `pwsh -NoProfile -File ./geldar.ps1 check` before the last commit.

**Revert-check (name the test and the line)**
- In `animus/src/loop/thinking-loop.ts` (or its clock seam), make the clock seam return `Date.now()` even when the fake clock is injected. The test that advances the fake clock by 30 seconds and expects a timeout must fail. Restore.
- For the split itself, the revert is "delete the new sibling and restore the file": the existing tests must still pass both ways, so the revert-check for a split is a diff check (no exported symbol removed), recorded in the report, not a failing test.

**Commit plan**
1. `C1-01: split thinking-loop.ts under 500 lines`
2. `C1-01: split lantern-local thinker.ts under 500 lines`
3. `C1-01: split mcp-mock server.ts under 500 lines`
4. `C1-01: split adam-run adapters.ts under 500 lines`
5. `C1-01: injected clock for the five timing-sensitive tests`
6. `C1-01: flake log in the worknote`

**index line to add**: none, unless a split file is imported by `geldar.ps1` (then the integration packet updates the path).

**On cap**: if the time runs out after the splits, commit the splits, and write the flaky tests as "not done" in the worknote with the file and seam each one needs.

---

## Card C1-02: integration, the Linux colo compose file

- **id**: C1-02
- **title**: `compose/colo.yml` on its own network, limits, loopback binds; the stale-comment and dead-key fixes; the slots for C1-03 to C1-09
- **wave**: C1
- **lane**: A (integration owner for compose and shards in C1)
- **status**: B/O (build is B; `shard up` on the node is part of C1-10, not this card)
- **depends-on**: P1-C1-00 (for the shard-config keys and the registry entries)
- **size**: L (two sessions: session 1 is the compose file and the fixes; session 2 is the wiring slots and the loopback checks)
- **decisions**: 0082 (one record: the colo compose layout, port and bind rules)
- **worknote**: `docs/analysis/phase1/worknotes/C1-02.md`

**may-edit**
- `compose/colo.yml` (new; the production Linux compose file).
- `compose/phase0.yml`, `compose/mcp.yml`, `compose/rcon-host.yml`, `compose/velocity/velocity.toml`: comments and dead keys only, no behaviour change to the Phase 0 stack. Locate dead keys with `grep -n "" compose/*.yml` against the keys the services read, and with `grep -rn "<key>" --include=*.ts --include=*.ps1` before removing one.
- `compose/nats-auth.yml`: comments only (C1-06a changes its content).
- `shards/colo.yaml` (new; the shard config the colo compose reads, using the keys P1-C1-00 declared).
- `shards/phase0.yaml`: comment and dead-key fixes only.
- `geldar.ps1`: the `colo` shard path only (the `shard` verb takes a shard name; add the colo compose file to `Get-ComposeFile`, and add the checks). This card is the only owner of `geldar.ps1` in C1.
- `tools/repo-checks/src/loopback-ports.ts` and its test: the colo file is added to the loopback check (the registry owner is this card).
- `docs/decisions/0082-*.md` (new record).

**must-not-edit**: `contract/`, `golem/Dockerfile` and `animus/Dockerfile.mind` (C1-03), `deploy/` (C1-04), `compose/nats-auth.yml` content (C1-06a), `plugins/bluemap/` (C1-09), `docs/spec.md`, `docs/decisions/README.md`, `package.json`.

**Steps (session 1)**
1. Read `compose/phase0.yml` once. List its services, ports, volumes, networks and healthchecks into the worknote. Do not copy secrets (`compose/secrets/` is git-ignored; reference files by path only).
2. Create `compose/colo.yml` as a standalone file (not an overlay). Give it its own network with an explicit name (`geldar-colo`). Every published port is written `127.0.0.1:<host>:<container>` (loopback). The Minecraft port comes from `shards/colo.yaml` and must not be 25566.
3. Set `deploy.resources.limits` (`cpus`, `memory`) on every service from the keys in `shards/colo.yaml`. A service with no limit is an error in the loopback-ports test (step 7).
4. Use `restart: unless-stopped` and the existing healthchecks from `compose/phase0.yml`.
5. Fix the stale comments in `compose/mcp.yml` (the note about `mcp-tokens init` secret names points at a test path; confirm the path still exists) and `compose/nats-auth.yml` (comment only: it still says the overlay is untested, which stays true until C1-06a).
6. Remove dead keys found in step 1 only when a grep shows no reader. Record each removal and its grep result in the worknote.

**Steps (session 2)**
7. Add to `tools/repo-checks/src/loopback-ports.ts` the rule: every published port in `compose/colo.yml` binds `127.0.0.1`, and no published port is 25566. Add a test with a fixture that publishes `0.0.0.0:25566`; it must be reported.
8. Add to `geldar.ps1` a `colo` shard name so that `./geldar.ps1 shard up colo` resolves `compose/colo.yml`. Keep the existing `phase0` path unchanged. Also add the `Assert-PluginJar` path for `colo` (the same jar paths).
9. Write `shards/colo.yaml` with values for the keys P1-C1-00 declared. Limits are set to a first guess recorded as "to be measured in C1-10", not as a result.
10. Slots for later packets: a commented block for each of `golem-body` (C1-03), `nats-auth` overlay (C1-06a), `metrics` (C1-07) and `bluemap` (C1-09). Each slot names the packet and is uncommented only by that packet's index line, applied by this card's owner. Until then, the file must still pass `docker compose -f compose/colo.yml config --quiet`.
11. Write `docs/decisions/0082-*.md`. Status Proposed.

**Error behaviour**: `shard up colo` refuses to start when a limit key is missing from `shards/colo.yaml` (the config check names the key), and when a jar the compose file mounts is a directory (the existing `Assert-PluginJar` behaviour, unchanged).

**Acceptance checks**
- `docker compose -f compose/colo.yml config --quiet` exits 0.
- `docker compose -f compose/phase0.yml -f compose/rcon-host.yml config --quiet` still exits 0 (Phase 0 unchanged).
- `./geldar.ps1 pnpm vitest run tools/repo-checks/src/loopback-ports.test.ts`
- `./geldar.ps1 pnpm check:repo`
- `./geldar.ps1 pnpm format`
- Full `pwsh -NoProfile -File ./geldar.ps1 check` before the last commit (this includes the compose config checks, which run once per file in `compose/`).

**Revert-check (name the test and the line)**
- In `compose/colo.yml`, change one published port from `127.0.0.1:` to `0.0.0.0:` (or drop the prefix). The loopback-ports test must fail with that file and line. Restore.
- In `tools/repo-checks/src/loopback-ports.ts`, remove the 25566 rule. The fixture test that publishes 25566 must fail. Restore.

**Commit plan**
1. `C1-02: fix stale comments and dead keys in the Phase 0 compose files`
2. `C1-02: compose/colo.yml on its own network, loopback binds, limits`
3. `C1-02: shards/colo.yaml and the colo shard name in geldar.ps1`
4. `C1-02: loopback-ports check covers colo and refuses port 25566`
5. `C1-02: slots for C1-03, C1-06a, C1-07 and C1-09 (commented)`
6. `C1-02: record 0082 for the colo compose layout`

**index lines to add** (ops merge step): `index: | [0082](0082-<slug>.md) | <title> | Proposed |`. Also, for the later packets, the slot list in the worknote: "C1-03 uncomments `golem-body`", and so on.

**On cap**: session 1 ends at a committed `colo.yml` that passes `config`; session 2 starts from the worknote. If the slots cannot be validated without the later images, leave them commented and say so.
