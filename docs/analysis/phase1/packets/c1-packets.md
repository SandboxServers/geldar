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

---

## Card C1-03: Body-host image (and the Mind-host image)

- **id**: C1-03
- **title**: `golem/Dockerfile` for the Body on the node; `animus/Dockerfile.mind` for the Mind on the Record/Mind host
- **wave**: C1
- **lane**: C
- **status**: B
- **depends-on**: P1-C1-00 (contract merged). The compose wiring waits for C1-02's slot.
- **size**: M
- **decisions**: 0083 (one record: the image contents, base-image pins, and what is never baked in)
- **worknote**: `docs/analysis/phase1/worknotes/C1-03.md`

**Scope rule from decision 0078 (proposed)**: its recommendation puts the Mind for Adam-class agents on the Record/Mind host. This card builds that image as well. If the owner rejects 0078, the Mind image is left unbuilt and the worknote says so; the Body image is built either way.

**may-edit**
- `golem/Dockerfile` and `golem/Dockerfile.dockerignore` (new). Use `eventsink/Dockerfile` and `eventsink/Dockerfile.dockerignore` as the house pattern.
- `animus/Dockerfile.mind` and `animus/Dockerfile.mind.dockerignore` (new).
- `golem/src/image.test.ts` (new; the same kind of test as `threshold/mcp-mock/src/image.test.ts`, which checks the image's pins and ignores).
- `animus/src/image.test.ts` (new, for the Mind image).
- `docs/decisions/0083-*.md` (new record).

**must-not-edit**: `compose/*` and `shards/*` (C1-02 wires the slot), `contract/`, `geldar.ps1`, `package.json`, `pnpm-lock.yaml`, `docs/spec.md`, `docs/decisions/README.md`.

**Steps**
1. Read `eventsink/Dockerfile` and `threshold/mcp/Dockerfile` (21 lines). Copy the layout: a pinned Node base, a non-root user, `node` as the entry command, no shell scripts that read secrets at build time.
2. Pin the base image by digest (`image@sha256:...`). Look up the digest from the registry on the day of writing; record the release date. The release-age check (P1-C1-00) must pass for it.
3. `golem/Dockerfile`: builds the Body (`golem/` package) with its production dependencies only. The entry point is the Body's existing start script. No `GELDAR_NATS_PASSWORD` or any credential is in an `ENV` or `ARG` line; credentials arrive as the file path `GELDAR_NATS_PASSWORD_FILE` at run time (the convention in `compose/nats-auth.yml`).
4. `animus/Dockerfile.mind`: the same shape for the Mind (`animus/`). It needs its model endpoint as configuration, not baked in.
5. Both `.dockerignore` files exclude `node_modules`, `.git`, `compose/secrets`, `*.env`, and test fixtures. The image tests read the Dockerfile and the ignore file as text and check: a digest pin is present; no `ARG` or `ENV` name matches `PASSWORD` or `TOKEN` (the value may be a file path); the user is not root; the ignore file lists `compose/secrets`.
6. Build both images on the desktop (`docker build -f golem/Dockerfile -t geldar-body:c1 .` from the repo root). Record the image ID in the worknote. The build is not pushed anywhere.
7. Run each image's start command with no secrets set and confirm it exits with a clear "missing configuration" message, not a stack trace (a one-off `docker run --rm`; no shard is touched).

**Error behaviour**: an image with no `NATS` password file configured exits non-zero and names the missing variable.

**Acceptance checks**
- `./geldar.ps1 pnpm vitest run golem/src/image.test.ts animus/src/image.test.ts`
- `docker build -f golem/Dockerfile .` and `docker build -f animus/Dockerfile.mind .` both exit 0 (commands recorded with image IDs)
- `./geldar.ps1 pnpm typecheck`, `./geldar.ps1 pnpm format`, `./geldar.ps1 pnpm check:repo`
- Full `pwsh -NoProfile -File ./geldar.ps1 check` before the last commit (it does not build images; the build commands above are the image gate).

**Revert-check (name the test and the line)**
- In `golem/Dockerfile`, replace the digest pin with a plain tag (`node:<tag>`). `golem/src/image.test.ts`, the digest-pin case, must fail. Restore.
- In `golem/Dockerfile`, add `ENV GELDAR_NATS_PASSWORD=x`. The no-credential case in the same test must fail. Restore.

**Commit plan**
1. `C1-03: Body-host image and its ignore file, pinned base`
2. `C1-03: Mind-host image and its ignore file, pinned base`
3. `C1-03: image tests (pins, no baked credentials, non-root)`
4. `C1-03: record 0083 for the image contents`

**index line to add**: `index: | [0083](0083-<slug>.md) | <title> | Proposed |`. For C1-02: "uncomment the `golem-body` slot with the image name `geldar-body`". Also write the image digest so the deploy packet (C1-04) can read it.

**On cap**: the Body image is committed alone if the Mind image is blocked; the report says which.

---

## Card C1-04: non-PowerShell deploy by pull

- **id**: C1-04
- **title**: Deploy tooling for Linux: shell scripts, root-only env files generated on the node, no secret in the repo
- **wave**: C1
- **lane**: D
- **status**: B/O (the build and its tests are B; running on the node needs the deploy account, which is an owner item)
- **depends-on**: P1-C1-00 (for the shard-config keys and the release-age check on pins)
- **size**: M
- **decisions**: 0084 (one record: deploy by pull, env-file location and ownership, what the scripts never print)
- **worknote**: `docs/analysis/phase1/worknotes/C1-04.md`

**may-edit**
- `deploy/` (new directory): `deploy/README.md`, `deploy/bin/` (shell scripts), `deploy/env/` (templates only, no values), `deploy/test/` (tests).
- `deploy/test/` tests are TypeScript (Vitest), so they run on the desktop and in CI. The scripts themselves are POSIX `sh` and are run in CI on Linux.
- `.gitignore`: add the env-file patterns only (for example `/etc/geldar` is never in the repo; add `deploy/env/*.env` so a generated file cannot be committed by accident).
- `docs/decisions/0084-*.md` (new record).

**must-not-edit**: `geldar.ps1` (the Windows path stays as it is), `compose/*` and `shards/*` (C1-02), `.github/workflows/*` (an index line asks the integration owner to add a Linux job), `contract/`, `package.json`, `pnpm-lock.yaml`, `docs/spec.md`.

**Steps**
1. Write `deploy/bin/pull.sh`: records the current image digests from `compose/colo.yml` into `/var/lib/geldar/state/deployed.txt`, runs `docker compose -f compose/colo.yml pull`, then `docker compose ... up -d --wait`. It refuses to run as a user without the `docker` group, and it never runs `down -v`.
2. Write `deploy/bin/env-init.sh`: creates `/etc/geldar/` (mode 0750, owner root, group docker) and one env file per service, mode 0600, owner root. It generates random values with `openssl rand` for internal tokens and writes them only to those files. It never echoes a value, and it refuses to overwrite an existing file (the same rule as `mcp-tokens init`).
3. Write `deploy/bin/rollback.sh`: reads `deployed.txt`'s previous entry and redeploys those digests. It does not pull new images.
4. Write `deploy/README.md` with the steps as commands, and the owner's part: the deploy account, its docker membership, and the place the env files are copied to.
5. Tests in `deploy/test/`: (a) run each script with `sh -n` (syntax); (b) run `env-init.sh` with `GELDAR_ROOT_DIR` pointing at a temp directory (the script takes its root from that variable so the test never writes under `/etc`); check modes and that no value appears in stdout; (c) run `pull.sh` with a fake `docker` on `PATH` that records its arguments; check the order (pull, then up with `--wait`) and that `down -v` never appears.
6. `deploy/test/no-secrets.test.ts`: scan `deploy/` and `compose/colo.yml` for high-entropy strings and for `PASSWORD=`, `TOKEN=` with a value. Fail on any match.

**Error behaviour**: `env-init.sh` exits 1 and names the file when one exists; `pull.sh` exits 1 if `deployed.txt` cannot be written (it does not deploy without a record of what it replaced).

**Acceptance checks**
- `./geldar.ps1 pnpm vitest run deploy/test`
- `sh -n deploy/bin/*.sh` (run in CI, and via `wsl` on the desktop if installed; if not, record "not run: no POSIX shell on the desktop" in the report)
- `./geldar.ps1 pnpm typecheck`, `./geldar.ps1 pnpm format`, `./geldar.ps1 pnpm check:repo`
- Full `pwsh -NoProfile -File ./geldar.ps1 check` before the last commit.

**Revert-check (name the test and the line)**
- In `deploy/bin/env-init.sh`, change the mode from `0600` to `0644`. The mode case in `deploy/test/env-init.test.ts` must fail. Restore.
- In `deploy/bin/pull.sh`, replace `up -d --wait` with `up -d --force-recreate --volumes`. The order-and-flags case must fail (the `--volumes` flag is refused). Restore.

**Commit plan**
1. `C1-04: deploy pull and rollback scripts with tests`
2. `C1-04: env-init writes root-only env files, never echoes values`
3. `C1-04: no-secrets scan over deploy/ and compose/colo.yml`
4. `C1-04: record 0084 for deploy by pull`

**index line to add**: `index: | [0084](0084-<slug>.md) | <title> | Proposed |`. Also for the integration owner: "add a Linux CI job that runs `sh -n` and `deploy/test`" (the CI file is not in this card).

**Live step (O, owner)**: a deploy account in the docker group on the node, and the env files written by `env-init.sh` with `sudo`. The owner runs them; the agent does not. Stop if `docker` on the node is not the expected version or the account can read `/etc/geldar` as a non-owner.

**On cap**: commit the scripts that pass; the rollback script can wait for C1-10.

---

## Card C1-05a: append-only journals, reset creates a new shard, journal spacing

- **id**: C1-05a
- **title**: Journals and receipts append-only (migration); the adam reset creates a new shard instead of deleting rows; the journal spacing bucket
- **wave**: C1
- **lane**: E
- **status**: B
- **depends-on**: P1-C1-00
- **size**: M
- **decisions**: 0085 (one record: append-only tables, the reset rule, the spacing bucket)
- **worknote**: `docs/analysis/phase1/worknotes/C1-05a.md`

**may-edit**
- `sql/0007_journals_append_only.sql` (new migration; each migration inserts its own `schema_migrations` row, as `sql/0006_owner_cap_trigger.sql` does).
- `sql/test/check-schema.sql` (add the assertions for the new triggers).
- `golem/test/live/adam-reset.test.ts` and `golem/test/live/adam-case.ts` (the reset path). Find any `DELETE` in the reset path with `grep -rn "DELETE" golem/test/live`.
- The reset path in `geldar.ps1` (the `adam` verb's reset action) only if the reset is driven there; locate with `grep -n "reset" geldar.ps1`. If it is, this card owns that edit; C1-02 has already merged, so take the current file.
- The spacing bucket: locate with `grep -rn "spacing\|bucket" golem tools threshold --include=*.ts`. Edit the file that implements it.
- `docs/decisions/0085-*.md` (new record).

**must-not-edit**: `sql/0001_*` to `sql/0006_*` (applied migrations are never edited, as 0006 says); `tools/migrate/src/migrate.ts` (the runner stays as it is); `contract/`; `compose/*`; `docs/spec.md`; `docs/decisions/README.md`.

**Steps**
1. Read `sql/0006_owner_cap_trigger.sql` (its header explains the pattern) and `sql/test/check-schema.sql`. Identify the journal and receipt tables (`grep -n "journal\|receipt" sql/0002_sovereign_mcp.sql sql/0003_mcp_sleep_marks.sql`).
2. `sql/0007_journals_append_only.sql`: a trigger function that raises `journal rows are append-only` on `UPDATE` and `DELETE` for each journal and receipt table, and the trigger on each table. The migration inserts its own row in `schema_migrations`.
3. The reset path: where it deletes journal rows, replace the delete with: create a new shard id, copy nothing, and write a reset marker record (a new row in the shard table, if the schema has one; otherwise the marker is the new shard id in the config). The old rows stay.
4. The spacing bucket: journal entries that fall in the same spacing bucket are not written twice. The bucket is a time window read from the config (not a constant in code); its default is recorded in the worknote with the reason.
5. Assertions in `sql/test/check-schema.sql`: an `UPDATE` and a `DELETE` on each table raise the error; an `INSERT` succeeds.
6. Integration test for the reset: `golem/test/live/adam-reset.test.ts` asserts no `DELETE` statement runs and that the reset produces a new shard id. This test is a live-style test; it runs against the local compose stack on the desktop, not the node.

**Error behaviour**: an attempted delete on a journal table fails with the trigger's message; the reset never fails silently (if it cannot create the new shard, it stops and does not fall back to deleting).

**Acceptance checks**
- `psql -h 127.0.0.1 -U postgres -d <db> -v ON_ERROR_STOP=1 -f sql/0007_journals_append_only.sql` on a fresh database, then `sql/test/check-schema.sql` (the same two commands CI runs at `.github/workflows/ci.yml` lines 141 to 147).
- `./geldar.ps1 pnpm vitest run golem/test/live/adam-reset.test.ts` (on the desktop stack).
- `./geldar.ps1 pnpm vitest run <spacing test file>`
- `./geldar.ps1 pnpm typecheck`, `./geldar.ps1 pnpm format`, `./geldar.ps1 pnpm check:repo`
- Full `pwsh -NoProfile -File ./geldar.ps1 check` before the last commit.

**Revert-check (name the test and the line)**
- In `sql/0007_journals_append_only.sql`, comment out the `DELETE` trigger for the journal table. The `check-schema.sql` assertion "DELETE on the journal raises" must fail. Restore.
- In the reset path, put back the `DELETE` statement. The reset test's "no DELETE runs" assertion must fail. Restore.

**Commit plan**
1. `C1-05a: migration 0007, journals and receipts append-only`
2. `C1-05a: schema assertions for append-only tables`
3. `C1-05a: adam reset creates a new shard instead of deleting rows`
4. `C1-05a: journal spacing bucket, read from config`
5. `C1-05a: record 0085 for append-only journals`

**index line to add**: `index: | [0085](0085-<slug>.md) | <title> | Proposed |`. For C1-05b: "the backup manifest depends on the append-only rule; C1-05b runs after this merges."

**On cap**: the migration and its assertions are the first commit to land; the reset rule can follow in the same packet if it fits, otherwise it is written up in the worknote for the next session.

## Card C1-05b: backup v1 (checkpoint), destination pluggable

- **id**: C1-05b
- **title**: Backup v1 per 0076: a coordinated checkpoint (Postgres, NATS KV and JetStream, world directory), manifest with checksums, encryption, restore to a scratch shard
- **wave**: C1
- **lane**: E
- **status**: B/O (built and tested on the desktop; the real destination and key handling are owner steps, C1-10)
- **depends-on**: P1-C1-00 (manifest schema), C1-05a (append-only journals; a replayable backup needs it)
- **size**: L (two sessions; the first ends after commit 2)
- **decisions**: 0086 (one record: backup v1 scope, the flush sequence, manifest, encryption choice, destination config)
- **worknote**: `docs/analysis/phase1/worknotes/C1-05b.md`

**may-edit**
- `tools/backup/` (new package: `package.json`, `tsconfig.json`, `src/`, `test/`). Use only dependencies already in `pnpm-lock.yaml`.
- `pnpm-lock.yaml`: only the importer entry for `tools/backup`, added by `pnpm install` for the new package. This is a second lockfile edit in C1 and departs from the single-owner rule (section 3); the wave gate records it (see "Conflicts" in the wave section).
- `docs/decisions/0086-*.md` (new record; the index line goes in the worknote).

**must-not-edit**: `docs/spec.md`; `docs/decisions/README.md`; `geldar.ps1` and `compose/*` (C1-02; the `backup` verb is an index line); `shards/*`; `contract/` (C1-00's manifest schema is consumed, not changed); `sql/0001_*` to `sql/0007_*`; root `package.json`; `golem/` and `animus/` (read only).

**Steps**
1. Read decision 0076 and its owner status. If the owner has not confirmed 0076, build the code behind a destination of `none`, which refuses to run, and record the stop in the worknote.
2. Locate the inputs: Postgres connection (`grep -rn "DATABASE_URL" compose shards tools --include=*.ts --include=*.yml`), the NATS KV and stream names (`grep -rln "KeyValue\|jetstream" threshold golem --include=*.ts`), the world volume (`tools/adam-run/src/world-volume.ts`), and the RCON client (`grep -rln "rcon" tools golem --include=*.ts`). Write the list in the worknote.
3. `tools/backup/src/checkpoint.ts`, in this order: RCON `save-off`; RCON `save-all flush`, waiting for the server's "Saved the game" line with a timeout; `pg_dump --format=custom --serializable-deferrable` into a staging directory; export the NATS KV buckets and JetStream streams with the nats CLI from the digest already pinned in compose; copy the world directory; `save-on` in a `finally` block, so saving always comes back on.
4. Manifest: the schema from C1-00 (`checkpoint_id`, `image_digest`, `created_at`, `parts` of `{name, sha256, bytes}` with names `postgres`, `nats`, `world`). No manifest is written when any part fails, so no partial checkpoint exists.
5. Encryption behind an adapter: `age` or `gpg` (owner question; the card does not pick silently). The key path comes from an environment variable naming a root-only file. No key material in the repo or logs.
6. Destination: a local-directory adapter first. The destination is read from `tools/backup/backup.config.json` (git-ignored) with `kind: none | local`. Other kinds are later packets.
7. `tools/backup/src/restore.ts`: restore to a scratch compose project (its own project name, database name, NATS volume and world directory). It never writes to the live names. Verify: checksums against the manifest; table row counts from the dump; NATS KV key count; world file count. The scratch project starts and its health check answers.
8. Tests: unit tests for checksum refusal, `none` refusal, live-name refusal, and encryption round trip. One integration test `tools/backup/test/checkpoint.it.test.ts` runs the full cycle against the desktop stack into a temporary destination and restores to scratch. It is an `.it.test.ts`, so the integration floor counts it.

**Error behaviour**: a flush that is not confirmed stops the run and runs `save-on`. A checksum mismatch refuses the restore and names the part. Restore never falls back to live names.

**Acceptance checks**
- `./geldar.ps1 pnpm vitest run tools/backup` (unit, desktop)
- `./geldar.ps1 pnpm vitest run tools/backup/test/checkpoint.it.test.ts` (desktop stack; needs Docker)
- `./geldar.ps1 pnpm typecheck`, `./geldar.ps1 pnpm format`, `./geldar.ps1 pnpm check:repo`
- `pwsh -NoProfile -File ./geldar.ps1 check` before the last commit

**Revert-check**
- In `tools/backup/src/checkpoint.ts`, remove the `save-on` from the `finally` block. The test "saving comes back on when the copy fails" must fail. Restore.
- In `restore.ts`, remove the checksum comparison. The test "a tampered world part is refused" must fail. Restore.
- Remove the `save-all flush` call. The test "flush confirmed before the copy" must fail. Restore.

**Commit plan** (session 1 ends after 2)
1. `C1-05b: tools/backup skeleton, destination config, refusal when none`
2. `C1-05b: save-off, flush, dump, NATS and world copy with save-on in finally`
3. `C1-05b: manifest with checksums and encryption round trip`
4. `C1-05b: restore to a scratch project with verification`
5. `C1-05b: record 0086 for backup v1`

**index line to add**: `index: | [0086](0086-backup-v1-checkpoint.md) | Backup v1: checkpoint scope, flush sequence, manifest, encryption | Proposed |`. For C1-02: the `backup` verb and its help text. For C1-07: the importer entry in `pnpm-lock.yaml`, if the merge order requires it.

**On cap**: commits 1 and 2 are the first useful state. Restore (step 7) is the stop point: if the session ends there, the worknote lists the restore steps as not done and the report marks restore as not run.

## Card C1-06a: NATS auth overlay, live test

- **id**: C1-06a
- **title**: Live nats-server test of the opt-in accounts overlay for every role; revoked user refused; shard isolation; the `*` per-life subjects replaced
- **wave**: C1
- **lane**: F
- **status**: B
- **depends-on**: P1-C1-00
- **size**: S
- **decisions**: 0087 (one record: the overlay's live-test rules and subject scoping; shared with C1-06b, which cites it and adds no record)
- **worknote**: `docs/analysis/phase1/worknotes/C1-06a.md`

**may-edit**
- `compose/nats-auth.yml`. Ownership conflict: C1-02 owns `compose/*`, but the schedule names this card as the owner of this one file. The wave gate decides (see "Conflicts"). Until it is decided, edits to this file are made here and nowhere else in `compose/`.
- `threshold/mcp/test/nats-auth.it.test.ts` (new live test; the MCP package already holds the NATS test setup).
- The subject generator, wherever it lives: `grep -rn "\*" geldar.ps1 tools/mcp-tokens/src threshold/mcp/src --include=*.ts --include=*.ps1 | grep -i "subject\|nats"`. If it lives in `geldar.ps1`, this card writes an index line for C1-02 instead of editing it.
- `docs/decisions/0087-*.md` (new record).

**must-not-edit**: `docs/spec.md`; `docs/decisions/README.md`; `geldar.ps1`; `compose/phase0.yml` and the other compose files; `shards/*`; `contract/`; root `package.json` and `pnpm-lock.yaml`; `golem/src`, `animus/src`, `eventsink/src` (C1-06b owns their connect code).

**Steps**
1. Read decision 0067 and 0080. Read the overlay `compose/nats-auth.yml` (users, server config, password file mounts) and the generator. Record each role's publish and subscribe subjects in the worknote: body, mind, velocity, eventsink, mcp.
2. Start `nats-server` from the digest in the overlay, with the overlay on, under a scratch compose project name, bound to loopback.
3. For each role: connect with its password file; publish and subscribe on its allowed subjects; a publish outside them is refused with a permissions violation.
4. Revoked user: remove that user from the generated config, reload the server (`nats-server --signal reload`), and check that a connect with its old password is refused.
5. Shard isolation: a user of shard A cannot publish or subscribe on shard B's subjects. The shard name is in every subject.
6. Replace the `*` per-life subjects. Lives are not known when the file is written, so scope each role to its shard prefix and its subject class (for example `geldar.<shard>.body.>`), and leave the life part to the application check. Record the exact subject table in 0087.
7. A unit test asserts that the generated server config contains no bare `*` subject token.

**Error behaviour**: a missing password file stops the overlay start with a named error. A reload that fails leaves the old config in place and reports it.

**Acceptance checks**
- `./geldar.ps1 pnpm vitest run threshold/mcp/test/nats-auth.it.test.ts` (desktop, Docker)
- `./geldar.ps1 pnpm typecheck`, `./geldar.ps1 pnpm format`, `./geldar.ps1 pnpm check:repo`
- `pwsh -NoProfile -File ./geldar.ps1 check` before the last commit

**Revert-check**
- In the generated config, put back a `*` per-life subject. The test "no bare wildcard subject" must fail. Restore.
- Remove the reload step in the revocation test path. The test "revoked user refused" must fail, because the old password still connects. Restore.
- Remove the shard prefix from one role's subject. The isolation test must fail. Restore.

**Commit plan**
1. `C1-06a: live harness for the overlay, one role connects`
2. `C1-06a: every role connects and is refused outside its subjects`
3. `C1-06a: revoked user refused after reload; shard isolation test`
4. `C1-06a: per-life subjects scoped without bare wildcards`
5. `C1-06a: record 0087 for the overlay's live rules`

**index line to add**: `index: | [0087](0087-nats-overlay-live-rules.md) | NATS overlay: live test rules and subject scoping | Proposed |`. If the generator is in `geldar.ps1`: an index line for C1-02 with the replacement subject table.

**On cap**: commits 1 and 2 first. The revocation test (step 4) can move to the worknote for the next session.

## Card C1-06b: component credential reads, with connect tests

- **id**: C1-06b
- **title**: Each component reads its own NATS user and password file, and a connect test proves it for golem, animus, eventsink, the MCP, the Java publisher and Velocity
- **wave**: C1
- **lane**: F
- **status**: B
- **depends-on**: C1-06a (the live server and the subject table)
- **size**: M
- **decisions**: 0087 (cited, not added; shared with C1-06a)
- **worknote**: `docs/analysis/phase1/worknotes/C1-06b.md`

**may-edit**
- The NATS connect path in `golem/src/` (new `golem/src/nats-credentials.ts` and its test; the existing connect call is found with `grep -rn "connect(" golem/src --include=*.ts`). `golem/src/view.ts` is integration-owned and is not touched.
- `animus/src/nats-credentials.ts` and `eventsink/src/nats-credentials.ts`, each with its test, and the existing connect call in each.
- `threshold/mcp/src/nats-credentials.ts` and the link at `threshold/mcp/src/cli.ts` (around line 158).
- `plugin/` Java publisher: a new reader class in the existing Paper plugin package (locate with `grep -rln "nats\|NATS" plugin --include=*.java`), and the Velocity identity plugin under `plugin/velocity-identity/`.

**must-not-edit**: `compose/*` (the environment wiring is C1-02's; `compose/velocity/velocity.toml` included); `geldar.ps1`; `contract/`; `shards/*`; root `package.json` and `pnpm-lock.yaml`; `golem/src/view.ts`; `docs/spec.md`; `docs/decisions/README.md`.

**Steps**
1. For each component (golem, animus, eventsink, MCP, Java publisher, Velocity), find the connect call and its environment reads. Write a table in the worknote: component, file, env names read today, auth today (none or other).
2. TypeScript readers: read `GELDAR_NATS_USER` and `GELDAR_NATS_PASSWORD_FILE` (the names the overlay uses). The file is read and trimmed; the value is never logged or put in an error message.
3. Java reader: the same two names, the same rules.
4. Fail closed when auth is on: a set user with a missing or unreadable password file stops the start. When neither variable is set, the component connects as it did before (the overlay is opt-in, 0067).
5. Connect tests against the live server from C1-06a: each component connects with its role; a wrong password is refused; a missing file stops the start; the password string does not appear in any thrown message.
6. Velocity: its plugin reads the same names. The compose wiring that sets them is an index line for C1-02.

**Error behaviour**: an unreadable password file is a start failure with the file name, never the contents.

**Acceptance checks**
- `./geldar.ps1 pnpm vitest run golem/src/nats-credentials.test.ts animus/src/nats-credentials.test.ts eventsink/src/nats-credentials.test.ts threshold/mcp/src/nats-credentials.test.ts`
- Connect tests: `./geldar.ps1 pnpm vitest run nats-credentials.it` (desktop, Docker; the live server from C1-06a)
- Java: `plugin/gradlew -p plugin test`
- `./geldar.ps1 pnpm typecheck`, `./geldar.ps1 pnpm format`, `./geldar.ps1 pnpm check:repo`
- `pwsh -NoProfile -File ./geldar.ps1 check` before the last commit

**Revert-check**
- In `golem/src/nats-credentials.ts`, skip the password file read and pass an empty password. The test "golem connects with its role password" must fail. Restore.
- In the Java reader, return the password as `null` on a missing file instead of failing. The test "missing file stops the start" must fail. Restore.

**Commit plan**
1. `C1-06b: credential table in the worknote, TypeScript readers for golem and animus`
2. `C1-06b: eventsink and MCP readers, connect tests`
3. `C1-06b: Java publisher reader and test`
4. `C1-06b: Velocity identity reader and test`

**index line to add**: for C1-02, the env names each component reads and the Velocity compose wiring. For 0087: a line noting that every component now reads its own role.

**On cap**: the TypeScript components are the first state to land (commits 1 and 2). Velocity can move to the next session with its table row marked open.

## Card C1-07: metrics exporters and the MCP replay bound

- **id**: C1-07
- **title**: Metrics exporters to the node's telemetry endpoint (off until one exists), and a bound on the MCP event replay
- **wave**: C1
- **lane**: C
- **status**: B/O (the bound is B; the endpoint is O, owner question)
- **depends-on**: P1-C1-00
- **size**: M
- **decisions**: 0088 (one record: exporter scope, endpoint config, replay window and its default)
- **worknote**: `docs/analysis/phase1/worknotes/C1-07.md`

**may-edit**
- `threshold/mcp/src/replay-source.ts`, `threshold/mcp/src/cli.ts` (the replay caller, around lines 176 to 230 and 363 to 420) and their tests.
- New `metrics.ts` and `metrics.test.ts` in `golem/src/`, `eventsink/src/` and `threshold/mcp/src/`.
- `package.json` and `pnpm-lock.yaml`: this card only (C1 has one owner for them). Add no dependency unless needed; the exporter writes the Prometheus text format by hand. A new dependency is pinned with `pnpm add -E`, at a release at least 14 days old.
- `docs/decisions/0088-*.md` (new record).

**must-not-edit**: `compose/*`; `geldar.ps1`; `shards/*` (the `replay_minutes` key is an index line for C1-02); `contract/`; `golem/src/view.ts`; `sql/*`; `docs/spec.md`; `docs/decisions/README.md`.

**Steps**
1. Find the replay window. Today `startReplay` receives a `fromIso` from its caller in `threshold/mcp/src/cli.ts`. Write in the worknote how `fromIso` is computed and whether it is bounded. The repo has no `replay_minutes` key; the 60-minute figure is the schedule's, not the code's.
2. Bound the replay: `fromIso = now - replay_minutes`, where `replay_minutes` is read from the shard config when present and defaults to 60. Clamp to 1 to 1440; refuse 0, negatives and non-integers.
3. Exporters: `metrics.ts` in each component, serving the text format on `/metrics` bound to loopback by default. Push to the telemetry endpoint only when `GELDAR_TELEMETRY_URL` is set. That endpoint does not exist yet (owner question 4), so until it does, the push stays off.
4. Labels: no player names, life ids or token material as labels (a privacy rule). A test fails on any label named `player`, `life` or `token`.
5. Metric names are listed in 0088 and the worknote.

**Error behaviour**: an out-of-range `replay_minutes` stops the MCP start with the value named. A push that fails is logged with the status code, and the component keeps running.

**Acceptance checks**
- `./geldar.ps1 pnpm vitest run threshold/mcp/src/replay-source.test.ts threshold/mcp/src/metrics.test.ts golem/src/metrics.test.ts eventsink/src/metrics.test.ts`
- `./geldar.ps1 pnpm typecheck`, `./geldar.ps1 pnpm format`, `./geldar.ps1 pnpm check:repo`
- `pwsh -NoProfile -File ./geldar.ps1 check` before the last commit

**Revert-check**
- In `threshold/mcp/src/cli.ts`, pass the unbounded start for `fromIso`. The test "replay starts no earlier than the window" must fail. Restore.
- Remove the `GELDAR_TELEMETRY_URL` guard in `metrics.ts`. The test "no endpoint, no outbound request" (a fake fetch that counts calls) must fail. Restore.

**Commit plan**
1. `C1-07: replay window bounded, default 60 minutes`
2. `C1-07: MCP metrics exporter on loopback, label rule test`
3. `C1-07: golem and eventsink exporters`
4. `C1-07: record 0088 for exporters and the replay window`

**index line to add**: for C1-02, the `replay_minutes` key in `shards/phase0.yaml` (optional; the code default is 60). For C1-10: the telemetry endpoint, once the owner names it.

**On cap**: the replay bound (commit 1) is the first thing to land, since it is a behaviour fix. Exporters can move to the next session.

## Card C1-08: crash hygiene

- **id**: C1-08
- **title**: `players down` clears the registry and whitelist (re-verified and tested); `owner add` default cap from the shard config; start-precondition refusal; plain-case lease check
- **wave**: C1
- **lane**: D
- **status**: B
- **depends-on**: P1-C1-00
- **size**: S
- **decisions**: 0089 (one record: the crash-window rules)
- **worknote**: `docs/analysis/phase1/worknotes/C1-08.md`

**Finding to check first**: `docs/analysis/phase1/plan.md` line 39 says `players down` does not clear the registry or whitelist. The code on `origin/main` says otherwise: `tools/players-cli/src` has a `down` branch (around line 261) that deletes the registry key and whitelist entry of a stopped life, and keeps them while the Body still runs (line 264). Re-verify with a test before any change. If the test passes, the plan's line is stale; say so in the worknote and in the report.

**may-edit**
- `tools/players-cli/src/` (the `down` verb and its test).
- `tools/mcp-tokens/src/owners.ts` and `owner-add.test.ts` (the default cap). The cap trigger is `sql/0006_owner_cap_trigger.sql`, read only.
- `tools/adam-run/src/preconditions.ts` and its test (the start-precondition refusal).
- The plain-case lease check: locate with `grep -rn "lease" golem/src threshold/mcp/src --include=*.ts`, then edit only the file that holds the check.
- `docs/decisions/0089-*.md` (new record).

**must-not-edit**: `geldar.ps1` (any new verb is an index line for C1-02); `shards/*` (the `owner_cap` key is an index line for C1-02); `compose/*`; `sql/*`; `contract/`; `docs/spec.md`; `docs/decisions/README.md`.

**Steps**
1. Re-verify `players down` as above. Add a test: a stopped life loses its key and whitelist entry; a running Body keeps both.
2. `owner add`: the default cap is read from the shard config key `owner_cap`. If the key is missing, refuse and say so; do not fall back to a constant. An explicit flag still overrides, and a flag above the config value is refused. Test with and without the flag.
3. Start precondition: a Body start for a life name is refused while a crashed Body's lease for that name is still in force. The refusal names the seconds left. Use an injected clock; no sleeps.
4. Plain-case lease check: the case where the name is not normalised (no prefix, no case change) must run the same lease check as the other cases. Find the branch that skips it, record its line in the worknote, and test it.

**Error behaviour**: a missing `owner_cap` refuses `owner add` and names the key. A lease check that cannot read the registry refuses the start. Neither falls back to allowing.

**Acceptance checks**
- `./geldar.ps1 pnpm vitest run tools/players-cli tools/mcp-tokens/src/owner-add.test.ts tools/adam-run/src/preconditions.test.ts`
- `./geldar.ps1 pnpm typecheck`, `./geldar.ps1 pnpm format`, `./geldar.ps1 pnpm check:repo`
- `pwsh -NoProfile -File ./geldar.ps1 check` before the last commit

**Revert-check**
- In the `down` branch of `tools/players-cli/src`, skip the whitelist delete. The test "stopped life loses its whitelist entry" must fail. Restore.
- In the plain-case branch, remove the lease check. The test "plain-case lease refuses a start" must fail. Restore.

**Commit plan**
1. `C1-08: players down test, re-verified against the code`
2. `C1-08: owner add default cap from the shard config`
3. `C1-08: start precondition and plain-case lease check`
4. `C1-08: record 0089 for crash-window rules`

**index line to add**: for C1-02, the `owner_cap` key with its range, and any new `players` help text.

**On cap**: commit 1 (the re-verification) is the cheapest and most useful state. Items 3 and 4 can move to the next session with their worknote steps.

## Card C1-09: BlueMap, pinned and internal only

- **id**: C1-09
- **title**: BlueMap pinned plugin and config, bound to loopback or the internal network; no web exposure; no secrets
- **wave**: C1
- **lane**: B
- **status**: B
- **depends-on**: P1-C1-00 (release-age check and its data file)
- **size**: S
- **decisions**: none reserved. The 0081 to 0089 block is used up. If a record is needed, the worknote asks the owner for a number.
- **worknote**: `docs/analysis/phase1/worknotes/C1-09.md`

**Note**: BlueMap is not in the repo. `plugin/` holds only `core` and `velocity-identity` (Geldar's own plugins). This card creates it.

**may-edit**
- `plugins/bluemap/` (new): `config/` with the BlueMap core config, a short `README.md`, and `test/config.test.ts`.
- `tools/repo-checks/src/release-dates.json`: append one entry for the pinned BlueMap release. This is C1-00's data file, not the registry.

**must-not-edit**: `compose/*` (the mount and the internal address are C1-02's); `geldar.ps1`; `shards/*`; `deploy/` (C1-04); `plugin/`; root `package.json` and `pnpm-lock.yaml`; `docs/spec.md`; `docs/decisions/README.md`. Any Caddy snippet is C2-04's, not this card's.

**Steps**
1. Pick the BlueMap release: the newest one published on or before 2026-10-27 (14 days before the packet date). Record its name, publish date, source URL and the sha256 of its jar in the worknote. Do not commit the jar.
2. Config: the web server binds to `127.0.0.1` by default, or to an internal address that C1-02 supplies through compose. Anonymous access is off. The world is read from the Paper volume, read only.
3. No token, password or key appears in the config. The config holds no secret; a secret would be a finding.
4. `config.test.ts`: parses the config and asserts the bind is loopback or the internal address, no key matches `/token|secret|password/i`, the version pin is exact, and the release age is at least 14 days (reads `release-dates.json`).

**Error behaviour**: a release with no publish date in `release-dates.json` fails the test (fail closed, as C1-00 defines).

**Acceptance checks**
- `./geldar.ps1 pnpm vitest run plugins/bluemap` (if the root vitest config does not include `plugins/`, the test moves into `tools/repo-checks` as an index line for C1-02, and the worknote says so)
- `./geldar.ps1 pnpm check:repo`
- `pwsh -NoProfile -File ./geldar.ps1 check` before the last commit

**Revert-check**
- In `plugins/bluemap/config`, set the bind to `0.0.0.0`. The test "bind is loopback or internal" must fail. Restore.

**Commit plan**
1. `C1-09: BlueMap release pin and its release date`
2. `C1-09: BlueMap config bound internal, anonymous access off`
3. `C1-09: config test for bind, secrets and pin`

**index line to add**: for C1-02, the internal bind address and the mount for the world directory, read only.

**On cap**: commit 1 and 2 are the minimum. The test is the gate, so it cannot be skipped.
