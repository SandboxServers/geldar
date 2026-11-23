---
title: Repo checks
type: reference
audience: contributors
status: draft
last_verified: 2026-11-16 against 1b114276
companions: [cli-tools.md, ci-workflows.md, compose-stacks.md, ../agents/doc-update-map.md, ../agents/doc-verification.md, ../agents/documentation-style.md, ../runbooks/merge-queue.md]
sources: [tools/repo-checks, package.json, .gitattributes, .github/workflows/ci.yml, geldar.ps1, CLAUDE.md, tools/mcp-tokens/src/persona-lint.ts, contract/src/agent-text.ts, contract/test/agent-visible-text.test.ts, animus/src/prompts/agent-text.test.ts, tools/psyche-release/src/release.test.ts, docs/agents/doc-update-map.md, docs/analysis/docs-library/plan.md, .gitignore, README.md, compose/colo-public.yml, compose/colo.yml, compose/mcp.yml, compose/opt-in/scratch.yml, compose/opt-in/sheet-sink.yml, deploy/README.md, deploy/scratch/scratch.sh, docs/decisions/README.md, docs/runbooks/body-helper-node-steps.md, docs/runbooks/open-signup.md, docs/threat-model.md, envs/environment.schema.json, glass/Dockerfile.dockerignore, plugin/gradle/verification-metadata.xml, pnpm-lock.yaml, psyche/RELEASE.json, shards/character-fixture.yaml, shards/colo.yaml, supervisor/Dockerfile, tools/admin/Dockerfile]
---

# Repo checks

Every gate in `tools/repo-checks/src`: the checks behind `pnpm check:repo`, the data files they read, what each failure line looks like and how to fix it, and the 51 test files that run in `pnpm test`. A short section lists related gates that live in other packages. For which documents a gate reads, see the [doc-update map](../agents/doc-update-map.md#gates-that-read-documents). For the runner commands, see [cli-tools](cli-tools.md).

## How this page was measured

- Commit `1b114276`, read 2026-11-16 (UTC). Every fact comes from reading source. The gate was not run for this page: the worktree has no `node_modules`.
- Counts, from the repo root:

```powershell
# Modules (non-test .ts), test files, JSON data files, all tracked files
(git ls-files tools/repo-checks/src | Where-Object { $_ -match '\.ts$' -and $_ -notmatch '\.test\.ts$' }).Count   # 19
(git ls-files tools/repo-checks/src | Where-Object { $_ -match '\.test\.ts$' }).Count                               # 51
(git ls-files tools/repo-checks/src | Where-Object { $_ -match '\.json$' }).Count                                   # 5
(git ls-files tools/repo-checks).Count                                                                              # 77
# The gates the CLI runs: the imports of run-checks.ts, plus line-endings in cli.ts
Select-String -Path tools/repo-checks/src/run-checks.ts, tools/repo-checks/src/cli.ts -Pattern "from '\./"
```

Of the 19 modules, 15 are gate modules. The other four are the runner (`cli.ts`, `run-checks.ts`) and two test helpers (`compose-port-defaults.ts`, `nats-auth-fixtures.ts`).

## The two runners

| Runner | Command | What runs | Where |
|---|---|---|---|
| Repo gate | `./geldar.ps1 pnpm check:repo` (`node tools/repo-checks/src/cli.ts`) | The 15 gates (from 16 modules) over every tracked file and every untracked, not-ignored file | `./geldar.ps1 check` step 5; CI `typescript` job (`.github/workflows/ci.yml` line 44) |
| Gate tests | `./geldar.ps1 pnpm test` (`vitest run`) | The 51 test files below, with every other package's tests | `./geldar.ps1 check` step 4; CI `typescript` job (line 42) |

Run one test file: `./geldar.ps1 pnpm --filter @geldar/repo-checks exec vitest run src/<file>.test.ts`. CI runs `src/caddy-adapt.test.ts` a second time this way with `GELDAR_REQUIRE_DOCKER=1`, so a missing Docker fails it instead of skipping (`ci.yml` lines 131 to 134).

### How the repo gate reads the repo

`cli.ts` builds a git-backed port and calls `runRepoChecks` in `run-checks.ts` (`cli.ts` lines 14 to 71):

- **Tracked files:** `git ls-files -s -z`. The control-character check reads the committed (index) bytes through `git cat-file --batch`, so a local `core.autocrlf` cannot change the verdict. The other checks read the working-tree text.
- **Untracked files:** `git ls-files --others --exclude-standard`. A new file fails before it is staged.
- **CRLF:** `git ls-files --eol`.
- **Paths** are relative to the repo root, wherever the command runs (`git rev-parse --show-toplevel`).

### Output

One line per finding, then `repo checks: ok` or `repo checks: failed`; the exit code is 1 on failure (`run-checks.ts` lines 243 to 244, `cli.ts` lines 69 to 71).

| Prefix | Meaning | Fails |
|---|---|---|
| `error:` | A gate failed | Yes |
| `warning:` | A file is over the soft line cap | No |
| `info:` | A file on the exemption list is within its own cap; the line prints its reason | No |

No gate prints a secret, token or address: findings name the path, the line and the class (`mcp-token.ts` header, `ip-literals.ts` header, `loopback-ports.ts` line 282).

## Gates in pnpm check:repo

In the order `runRepoChecks` runs them (`run-checks.ts` lines 65 to 241).

| # | Gate | Module | Files it reads | Data file |
|---|---|---|---|---|
| 1 | [Line caps](#1-line-caps) | `file-caps.ts`, `line-cap-exemptions.ts` | Code and config by extension | `line-cap-exemptions.json` |
| 2 | [Line endings](#2-line-endings) | `line-endings.ts` | Every tracked file | none |
| 3 | [Control characters](#3-control-characters) | `control-chars.ts` | Every tracked file (index and working tree), every untracked file | none |
| 4 | [Loopback ports and colo service rules](#4-loopback-ports-and-colo-service-rules) | `loopback-ports.ts` | `compose/*.yml`, `compose/*.yaml` | none |
| 5 | [MCP token](#5-mcp-token) | `mcp-token.ts` | Every file | none |
| 6 | [Workflow YAML](#6-workflow-yaml) | `workflow-yaml.ts` | `.github/workflows/*.yml` | none |
| 7 | [Pin rules](#7-pin-rules) | `pin-rules.ts` | `package.json`, Dockerfiles, compose files, `pnpm-lock.yaml`, workflows | none |
| 8 | [Release age](#8-release-age) | `release-age.ts` | The same files plus Gradle files | `release-dates.json`, `first-party-images.json` |
| 9 | [Integration floor](#9-integration-floor) | `integration-floor.ts` | `*.it.test.ts`, `*.live.test.ts` | `integration-floor.json` |
| 10 | [Sovereign identity mode](#10-sovereign-identity-mode) | `identity-mode.ts` | `shards/*.yaml`, `shards/*.yml` | none |
| 11 | [Decision index](#11-decision-index) | `decision-index.ts` | `docs/decisions/` | none |
| 12 | [Decision rows](#12-decision-rows) | `decision-rows.ts` | `docs/decisions/README.md` | none |
| 13 | [Environment definitions](#13-environment-definitions) | `env-definitions.ts` | `envs/*.yaml` | `envs/environment.schema.json` |
| 14 | [IPv4 literals](#14-ipv4-literals) | `ip-literals.ts` | Every non-binary file, minus exclusions | `ip-literal-allowlist.json` |

Fourteen gates come from 15 modules: the line caps use two (`file-caps.ts` and `line-cap-exemptions.ts`). The control-character gate scans twice, the index and then the working tree.

Every data file fails closed: a missing or malformed file is an `error:` line, never a silent pass (`line-cap-exemptions.ts` lines 24 to 39, `release-age.ts` lines 160 to 204, `integration-floor.ts` lines 20 to 34, `ip-literals.ts` lines 96 to 131, `env-definitions.ts` lines 17 to 25).

### 1. Line caps

- **Rule:** a capped file over 500 lines is a `warning:`; over 700 is an `error:` (`file-caps.ts` lines 3 to 5, 75 to 79). A trailing newline does not count as a line.
- **Capped:** extensions `.ts .tsx .js .mjs .cjs .java .kt .kts .go .sql .ps1 .sh .py .yml .yaml .json .toml .xml` (lines 8 to 27).
- **Never capped:** Markdown and any other extension; lock files by name (`pnpm-lock.yaml`, `package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `Cargo.lock`, `gradle.lockfile`); anything under a `generated/` folder; `plugin/gradle/verification-metadata.xml`; bench-run JSON under `docs/` (lines 29 to 47).
- **Exemptions:** `line-cap-exemptions.json`, an object with an `exemptions` array. Each entry has exactly `path` (exact, or a glob where `*` stays in one segment and `**` crosses them), `hardCap` (an integer above 700) and a non-empty `reason`. Duplicates, unknown keys and bad values are errors. The first matching entry wins. An exempt file gets no soft warning; it prints an `info:` line with its reason, or an `error:` above its own cap (`line-cap-exemptions.ts`, `file-caps.ts` lines 83 to 110).
- **Exemptions at `1b114276`:** five entries. Re-derive: `(Get-Content tools/repo-checks/src/line-cap-exemptions.json | ConvertFrom-Json).exemptions | Select-Object path, hardCap`.
- **Failure:** `error: <path> has <n> lines (cap 700)`.
- **Fix:** split the file along a natural seam (`CLAUDE.md`). An exemption is added only in a reviewed change, with its own cap and reason.

### 2. Line endings

- **Rule:** no tracked file is committed with CRLF or mixed endings, except `*.bat` and `*.cmd` (`line-endings.ts`; `.gitattributes` sets `* text=auto eol=lf`).
- **Failure:** `error: <path> is committed with CRLF line endings; .gitattributes requires LF`.
- **Fix:** convert the file to LF and re-add it. Untracked CRLF is not checked here: `.gitattributes` converts it when the file is added (`cli.ts` lines 10 to 12).

### 3. Control characters

- **Rule:** no byte below 0x20 other than LF and TAB, CR included, in a text file. Binary files (any NUL byte) and `*.bat`/`*.cmd` are skipped (`control-chars.ts` lines 13 to 38).
- **Index scan:** the committed bytes. A CRLF file already reported by gate 2 is not reported again (`run-checks.ts` lines 101 to 119).
- **Working-tree scan:** tracked and untracked files. A CR directly before an LF is allowed there (git converts it on add); a lone CR is not. A finding already reported from the index is not repeated (lines 121 to 148).
- **Failure:** `error: <path>:<line> has a control character (0x<hex>); use LF and no raw control bytes`, with `in the working tree` for the second scan. A git read failure is one `error:` line, not a stack trace.
- **Fix:** remove the byte; save the file with LF endings.

### 4. Loopback ports and colo service rules

`loopback-ports.ts` parses each `compose/*.yml` (one folder level; `compose/opt-in/` is not read) as YAML, with anchors and merge keys resolved. Anything it cannot read exactly fails closed (header, lines 1 to 7). See the [compose-stacks](compose-stacks.md) for the files themselves.

Rules for every compose file:

| Rule | Evidence |
|---|---|
| The file is one YAML document and a mapping; `include:` and `extends:` are rejected because the check cannot follow them. | lines 337 to 380 |
| Each `ports:` entry binds loopback: short form starts with `127.0.0.1:`, long form sets `host_ip: 127.0.0.1`. | lines 87 to 108 |
| Interpolation in a port is rejected, except `127.0.0.1:${GELDAR_PORT_<NAME>:-<default>}:<container>` with NAME and default on an allowlist (BOT, MCP, REGISTER, GLASS, BLUEMAP). | lines 54 to 85 |
| `network_mode: host`, a non-string mode, or an interpolated mode is rejected. | lines 41 to 52 |
| One exception: in `compose/colo-public.yml`, the `velocity` service may publish the Minecraft port with the bind address and port taken from `GELDAR_MC_BIND` and `GELDAR_MC_PORT` (decision 0096). | lines 18 to 24, 394 to 401 |

Extra rules for colo files (`coloRole`, lines 134 to 145): `compose/colo.yml` and any other `compose/colo*.yml` is a base file; `colo-public.yml`, `colo-notice.yml` and `nats-auth.yml` are overlays.

| Rule | Base | Overlay | Evidence |
|---|---|---|---|
| No `privileged`, `pid`, `ipc`, `userns_mode`, `devices`, `sysctls` | yes | yes | lines 148, 289 to 291 |
| `cap_add` only as exactly `[NET_BIND_SERVICE]` (Caddy) | yes | yes | lines 292 to 298 |
| No `network_mode` at all | yes | yes | lines 299 to 303 |
| The Watchtower opt-out label set to `"false"` | required | checked where set | lines 240 to 279 |
| `pids_limit`, `memswap_limit`, `logging` present | required | no | lines 304 to 308 |
| `deploy.resources.limits` with positive `cpus` and `memory` (a `${VAR:-default}` needs a positive default) | required | checked where set | lines 169 to 195, 309 to 322 |
| Volumes: named volumes, the allowlisted relative paths, or the four allowlisted state-directory sources; never `docker.sock`, an absolute host path, other interpolation, or a `..` that climbs out | yes | yes | lines 149 to 239, 323 to 333 |
| No host port 25565 or 25566, including inside a range | yes | yes | lines 12 to 16, 110 to 125 |

- **Failure:** `error: <path> service <name>: <reason> (docs/threat-model.md section 1)`.
- **Fix:** bind the port to `127.0.0.1`, or meet the colo rule the reason names. A new parameterised port name or a new volume source is a change to `loopback-ports.ts` itself, reviewed like code.

### 5. MCP token

- **Rule:** no line in any text file holds a string shaped like a sovereign player's MCP bearer token (the shape is defined in `mcp-token.ts`, after `threshold/mcp` `token-hash.ts`).
- **Failure:** `error: <path>:<line>: an MCP bearer token is committed; revoke it and remove it (docs/threat-model.md section 3)`. The token is never printed.
- **Fix:** revoke the token (`./geldar.ps1 mcp-tokens token revoke`, [mcp-tokens runbook](../runbooks/mcp-tokens.md)), then remove it from the file and from history as the threat model says.

### 6. Workflow YAML

- **Rule:** each `.github/workflows/*.yml` parses as a single YAML document with no syntax error and no duplicate mapping key (`workflow-yaml.ts`).
- **Failure:** `error: <path>: <parser message>` or `error: <path>: a workflow must be a single YAML document`.
- **Fix:** correct the YAML; remove the repeated key.

### 7. Pin rules

`pin-rules.ts` (decision 0005, `docs/threat-model.md`). One rule per file kind (lines 42 to 53):

| File | Rule | Failure line |
|---|---|---|
| Any `package.json` | Every `dependencies`, `devDependencies`, `optionalDependencies` value is an exact version or `workspace:` | `<path>: <field>.<name> is "<range>"; pin an exact version (saveExact)` |
| Root `package.json` | `packageManager` is `pnpm@<x.y.z>+sha512.<128 hex>` | `<path>: packageManager is ...; pin pnpm with a +sha512 hash` |
| Dockerfiles | Every `FROM` names a `@sha256:` digest, `scratch`, or an earlier stage | `<path>:<line>: FROM <image> is not pinned by digest` |
| Compose files | Every service with `image:` and no `build:` pins a digest | `<path> service <name>: image "<image>" is not pinned by digest` |
| `pnpm-lock.yaml` | Registry sources only: no `tarball:`, git, directory or `file:` source | `<path>:<line>: a non-registry source: <line>` |
| Workflows | Every `uses:` is a local `./` path, a `docker://` image with a digest, or a repository at a full 40-character commit SHA | `<path>:<line>: <target> is not pinned by full commit SHA` |

- **Fix:** pin the exact version, digest or SHA. `CLAUDE.md` adds that only versions at least two weeks old are allowed; gate 8 enforces that.

### 8. Release age

- **Rule:** every third-party pin was published at least 14 days before the check runs (`release-age.ts`, `MIN_AGE_DAYS`; decision 0005). Pins are read from manifests, the lockfile, Dockerfiles, compose files, `gradle-wrapper.properties`, `libs.versions.toml` and Gradle build files, keyed as `npm:<name>@<version>`, `maven:<group>:<artifact>:<version>`, `gradle-dist:<version>` or `docker:<image reference>` (lines 1 to 9, 43 to 150).
- **Dates:** `release-dates.json`, a JSON object of pin key to ISO UTC time; 390 keys at `1b114276`. A pin with no date fails; it is never skipped. Re-derive: `((Get-Content tools/repo-checks/src/release-dates.json -Raw | ConvertFrom-Json).PSObject.Properties | Measure-Object).Count` (390 on 2026-11-16; without `Measure-Object`, PowerShell 7 enumerates the members and prints a column of `1`).
- **First-party images:** `first-party-images.json`, a JSON array of repository prefixes for images this repo builds and publishes. Those need a digest but no date (lines 205 to 235).
- **Failure:** `error: <path>:<line>: <key> has no release date in release-dates.json (...)`, or `... was published <time>, <n> days before the check; the floor is 14 (...)`, or `... is a first-party image not pinned by digest (...)`. Each ends with `(docs/threat-model.md, decision 0005: 14-day release floor)`.
- **Fix:** add the pin's publish time from its registry to `release-dates.json` in the same change, or pick an older version. The gate reads only the committed file; it makes no network call.
- **Time-dependent:** the check uses the current time (`cli.ts` line 69), so a pin added on day 13 passes the next day without a change.

### 9. Integration floor

- **Rule:** the repo keeps at least `floor` integration test files: files named `*.it.test.ts` or `*.live.test.ts` that contain an `it(` call (`integration-floor.ts`). A suite that stops being collected fails the gate instead of passing with fewer tests.
- **Floor at `1b114276`:** 45 (`integration-floor.json`). Measured count the same day: 52 matching files, all with an `it(` call. Re-derive: `git ls-files | Select-String '\.(it|live)\.test\.ts$'`, then check each for `it(`.
- **Failure:** `error: <n> integration test files (*.it.test.ts, *.live.test.ts with an it() call); the floor in tools/repo-checks/src/integration-floor.json is <floor>`.
- **Fix:** restore the lost test file. Lower the floor only in a reviewed change that says why.

### 10. Sovereign identity mode

- **Rule:** a shard file that allows sovereign players (`sovereign: allowed`, or `sovereign: { allowed: true }`) must set `identity_mode: watched` (spec section 5.15.8; `identity-mode.ts`). A file that does not parse yields nothing here.
- **Failure:** `error: <path>: sovereign allowed requires identity_mode: watched (spec 5.15.8), found <what>`.
- **Fix:** set `identity_mode: watched`, or stop allowing sovereign players on that shard. See the [shard-config](shard-config.md).

### 11. Decision index

- **Rule:** every `docs/decisions/NNNN-*.md` has a row in `docs/decisions/README.md` whose first cell links it; every such link points at an existing record; any other `.md` in the folder except `README.md` fails (`decision-index.ts`).
- **Failures:** `... does not list <file> (add its row to the table)`, `... links <file>, which is not a record in docs/decisions/`, `docs/decisions/<file> is not named NNNN-slug.md (rename it or move it out)`.
- **Fix:** add the row, fix the link, or rename the file.

### 12. Decision rows

- **Rule:** the record numbers in the README table go up row by row, and none repeats (`decision-rows.ts`). `.gitattributes` gives the README `merge=union`, so two branches that each append a row keep both; this gate catches a row that lands out of order or twice.
- **Failures:** `docs/decisions/README.md lists <NNNN> more than once`, `... row <NNNN> comes after <NNNN> (keep the rows in number order)`.
- **Fix:** move or remove the row.

### 13. Environment definitions

- **Rule:** every `envs/*.yaml` validates against `envs/environment.schema.json` with the rules of `tools/genesis-env`: schema shape, and no secret-shaped values, account names or addresses (`env-definitions.ts`). A missing or invalid schema fails when any environment file exists.
- **Failure:** `error: <problem from validateEnvironment>`.
- **Fix:** correct the file; run `pnpm --filter @geldar/genesis-env validate` for the same verdict ([cli-tools](cli-tools.md#genesis-env)). See the [shard-config](shard-config.md) for the schema.

### 14. IPv4 literals

- **Rule** (decision 0132, `ip-literals.ts` header): every dotted quad falls into one of three classes.

| Class | Ranges (in words) | Allowed |
|---|---|---|
| Anywhere | Loopback, the all-zeros address, and the three RFC 5737 documentation ranges | In every file |
| Private | The RFC 1918 private ranges, link-local, and the carrier-grade NAT range | Only in a file on `ip-literal-allowlist.json` (files that implement or test IP and CIDR handling) |
| Public | Everything else | Nowhere |

- **Skipped:** binary files; lock files, `release-dates.json`, changelogs, `verification-metadata.xml`, `contract/src/generated/`, `node_modules/` (lines 18 to 27); any line with a `version` key or attribute (line 16).
- **Allowlist:** a JSON array of `{ path, reason }`; 14 entries at `1b114276`. Re-derive: `(Get-Content tools/repo-checks/src/ip-literal-allowlist.json | ConvertFrom-Json).Count`.
- **Failure:** `error: <path>:<line>: <class message>`. The address is never printed.
- **Fix:** use `127.0.0.1` or a documentation-range address, or describe the host by role. Add a file to the allowlist only when it implements or tests address handling, with a reason.

### 15. One-way door

- **Rule** (`one-way-door.ts`): a migration in `sql/*.sql` that creates a trigger whose name contains `immutable`, `append_only`, `monotonic`, `no_update` or `no_delete` (any case) is a one-way door. Each decision its header comment cites must be Accepted. The header is the `--` lines before the first code line; a cited line must also contain the word "decision". The migration's own number is skipped.
- **Status test:** the first line of the record matching `Status:` (with or without a leading `- `) must contain `Accepted` or start with `Decided`. A record with no Status line fails.
- **Warning, not failure:** a cited number with no `docs/decisions/NNNN-*.md` record (`warning: ... has no record ... (not checked)`).
- **Failure:** `error: <sql path> (trigger <names>): NNNN <title> -- status: <status text>`, one line per failing decision.
- **Allow-list:** `one-way-door-allowlist.json` (`{ "exemptions": [{ path, decision, note }] }`). An allow-listed file is skipped and printed as `info:`. An entry whose file no longer exists, or no longer fails the rule, is an `error` that prints the entry, so the list cannot outlive its reason. At `1b114276` it lists `sql/0050_character_sheet_xp.sql` and `sql/0051_character_audit.sql`, both for decision 0186 (`D-CS-03`).
- **Clear an entry:** make the cited decision Accepted (or cite an Accepted one in the migration header), then delete the entry. The gate fails until you do, so the entry is removed in the same change.

## Data files

| File | Shape | Read by |
|---|---|---|
| `line-cap-exemptions.json` | `{ "exemptions": [{ path, hardCap, reason }] }` | Gate 1 |
| `release-dates.json` | `{ "<pin key>": "<ISO UTC time>" }` | Gate 8 |
| `first-party-images.json` | `["<repository prefix>"]` | Gate 8 |
| `integration-floor.json` | `{ "floor": <integer> }` | Gate 9 |
| `ip-literal-allowlist.json` | `[{ path, reason }]` | Gate 14 |
| `one-way-door-allowlist.json` | `{ "exemptions": [{ path, decision, note }] }` | Gate 15 |

All six sit in `tools/repo-checks/src/` (`run-checks.ts` lines 26 to 30). A change to any of them is reviewed like code (`CLAUDE.md`).

## Tests in pnpm test

52 test files, each run by the shared Vitest run. Re-derive the list: `git ls-files tools/repo-checks/src | Select-String '\.test\.ts$'`. "Needs" names a tool the test calls; without it the test skips (`describe.skipIf` or `it.skipIf` in the file), except where CI sets `GELDAR_REQUIRE_DOCKER=1`.

When one fails, read its `it(...)` title: it states the rule. Fix the file the rule names, or, when the rule itself changed on purpose, change the test in the same reviewed change.

### Unit tests of the gate modules

These test the 15 modules above; they read no live repo file except where noted.

| Test file | Tests |
|---|---|
| `cli.test.ts` | The whole gate on fixture repos: compose port, line cap, decision index and control-character wiring |
| `file-caps.test.ts`, `line-cap-exemptions.test.ts` | Gate 1 |
| `line-endings.test.ts` | Gate 2 |
| `control-chars.test.ts` | Gate 3 and the index parsers |
| `loopback-ports.test.ts`, `loopback-ports-params.test.ts` | Gate 4, including bypass cases and the parameterised ports |
| `compose-port-defaults.test.ts` | The helper that resolves parameterised ports to their defaults |
| `mcp-token.test.ts` | Gate 5 |
| `workflow-yaml.test.ts` | Gate 6 |
| `pin-rules.test.ts` | Gate 7 |
| `release-age.test.ts` | Gate 8 |
| `integration-floor.test.ts` | Gate 9 |
| `identity-mode.test.ts` | Gate 10 |
| `decision-index.test.ts`, `decision-rows.test.ts` | Gates 11 and 12 |
| `env-definitions.test.ts` | Gate 13 |
| `ip-literals.test.ts` | Gate 14; builds its addresses from octets so the file holds no literal |

### Tests that read documents

| Test file | What it checks | Evidence |
|---|---|---|
| `legal-drafts.test.ts` | `docs/legal/` holds the three texts (terms, privacy, acceptable use); each has a version stamp and the abuse contact address, and no placeholder (decision 0155) | file header, lines 30 to 63 |
| `open-signup-runbook.test.ts` | `docs/runbooks/open-signup.md` names exactly the `REGISTER_*` variables the register service sets in `compose/colo.yml`, filed under the right list; no UUID or long token-like string; `deploy/README.md` has no "Keep it off until C2-08d" sentence | file header |
| `nats-auth-runbook.test.ts` | Despite its name, `docs/runbooks/body-helper-node-steps.md`: the `helper` and `supervisor` subjects and the `helper.body.>` deny of `body` and `paper` match the generator in `geldar.ps1`. It never runs the generator. | file header |
| `no-credentials.test.ts` | No tracked file in the shard secrets folder or with a credentials file extension; no tracked file with a private-key header, a NATS URL with a password, or a long password assignment; `.gitignore` keeps the secrets folder out | lines 7 to 55 |

The document gates in other packages are listed in the [doc-update map](../agents/doc-update-map.md#in-pnpm-test).

### Tests that check the NATS auth generator

All read `geldar.ps1`; the ones that run the generator do so in a temporary copy of its inputs, so the repo's secrets folder is never written. Shared fixtures: `nats-auth-fixtures.ts`.

| Test file | What it checks | Needs |
|---|---|---|
| `nats-auth.test.ts` | The NATS auth overlays merge offline; each service that sets a NATS password file mounts it as a secret; the generator's static wiring | Docker for the merge part |
| `nats-auth-generator.test.ts` | The rendered config and secret files (decisions 0067, 0080, 0087); owner-only modes off Windows | pwsh |
| `nats-auth-colo.test.ts` | The colo NATS auth wiring in compose and `geldar.ps1`, without Docker | none |
| `nats-auth-ctl.test.ts` | The `ctl.body` subject rules (decision 0152 item 3) | pwsh |
| `nats-auth-hearing.test.ts` | Only `paper` may publish the hearing subject (decision 0199) | pwsh |
| `nats-auth-state.test.ts` | The state subtree: only the eventsink and the body gain state subjects | pwsh |
| `shard-secrets.test.ts` | `shard secrets` writes the three files owner-only and never overwrites; `shard up colo` checks the NATS secrets first and refuses `--rcon-host` | pwsh |

The subject lists themselves belong in the [nats-subjects](nats-subjects.md).

### Tests that check compose, colo and the shard files

| Test file | What it checks | Needs |
|---|---|---|
| `colo-config.test.ts` | `shards/colo.yaml` and `Read-ColoConfig` in `geldar.ps1`: wiring, and the totals cover the per-service budgets | pwsh for the behaviour part |
| `colo-services.test.ts` | The Body, Mind, MCP and player-host services in `compose/colo.yml`, and every service's caps (decisions 0078, 0082, 0083) | none |
| `colo-params.test.ts` | With no `GELDAR_*` set, the parameterised `compose/colo.yml` renders the same as before; a second environment shares no port, network, volume, secret or container name | Docker |
| `colo-runtime-identity.test.ts` | Services that mount a file secret read it as the service user; Caddy services add back `NET_BIND_SERVICE` | none |
| `colo-spark.test.ts` | The profiler bundled in Paper is configured and operator-only | none |
| `healthcheck.test.ts` | Shard healthchecks never read the rolling server log, and prove each plugin enabled through its marker file | none |
| `mcp-overlay.test.ts` | `compose/mcp.yml` passes gate 4 and declares and mounts exactly the secrets `mcp-tokens init` writes | none |
| `scratch-overlay.test.ts` | `compose/opt-in/scratch.yml` ports, caps and secrets, and `deploy/scratch/scratch.sh` gates and order with stubbed tools; starts no container | sh |
| `character-fixture.test.ts` | `shards/character-fixture.yaml` has the shape its card names | none |
| `shard-selects.test.ts` | No test asserts the shard-file keys `adam select` rewrites, except reviewed exceptions | none |

### Tests that check images, Caddy and workflows

| Test file | What it checks | Needs |
|---|---|---|
| `admin-image.test.ts` | `tools/admin/Dockerfile` copies the golem files the `mcp-tokens` CLI imports (decision 0133) | none |
| `supervisor-image.test.ts` | `supervisor/Dockerfile` has no Docker client, is digest-pinned and non-root; its build job matches the body job's pins (decision 0260) | none |
| `supervisor-no-docker.test.ts` | No production file under `supervisor/src` names the Docker socket or imports a Docker client (decision 0260) | none |
| `glass-dockerignore.test.ts` | `glass/Dockerfile.dockerignore` keeps every path Glass reads at runtime | none |
| `caddy-snippets.test.ts` | The public Caddy site files: methods and route paths per site, header stripping, and the register site sharing a host (decision 0135) | none |
| `caddy-adapt.test.ts` | Each public site file adapted by the pinned Caddy image, route order as Caddy sees it | Docker (required in CI) |
| `bluemap-web.test.ts` | The BlueMap web Caddyfile serves the compressed files and answers a missing tile with 204 | Docker |
| `colo-images.test.ts` | `colo-images.yml`: triggers, pins and permissions, the seven images, the release manifest (decision 0084) | none |
| `colo-deploy-workflow.test.ts` | `colo-deploy.yml` runs only after `colo-images` succeeds on `main`, never from a pull request or a branch push | none |
| `workflow-jobs.test.ts` | `ci.yml`'s gate job needs every other job and names none that does not exist; `mcp-mock-image.yml` grants package write only on `main`, after the test job | none |
| `ci-schema-wiring.test.ts` | Every `sql/test/check-schema*.sql` file is named in a live line of `ci.yml` | none |
| `token-lifetime.test.ts` | The `mcp-tokens` mint and the register renewal give tokens the same lifetime (decision 0170) | none |

Workflow behaviour is the subject of the [ci-workflows](ci-workflows.md).

## Related gates outside tools/repo-checks

| Gate | Where | What it checks | Runs in |
|---|---|---|---|
| Agent-text scan, contract | `contract/test/agent-visible-text.test.ts`, word list in `contract/src/agent-text.ts` | The MCP schemas an agent reads carry no marker word (decisions 0058, 0059, 0068) | `pnpm test` |
| Agent-text scan, prompts | `animus/src/prompts/agent-text.test.ts` | Every agent-facing template in `prompts/` carries no marker word | `pnpm test` |
| Persona lint | `tools/mcp-tokens/src/persona-lint.ts`, tested by `persona-lint.test.ts` | A sovereign player's persona does not say the character is watched or is software, and names no meta term; it uses the same word list | At run time in `mcp-tokens player add` and `persona export` ([cli-tools](cli-tools.md#mcp-tokens)); its test in `pnpm test` |
| Psyche release record | `tools/psyche-release/src/release.test.ts` | `psyche/RELEASE.json` matches `psyche/src` (the `--check` gate) | `pnpm test` |
| Document gates | See the [doc-update map](../agents/doc-update-map.md#in-pnpm-test) | Legal pages, Kino and BlueMap runbooks, player guide, body-helper runbook | `pnpm test` |

The marker-word lists are not reproduced here; read them in `contract/src/agent-text.ts` and `tools/mcp-tokens/src/persona-lint.ts` ([documentation style](../agents/documentation-style.md#agents-never-learn-they-are-watched), rule 5).

## Not gated

No check in this package reads document metadata, relative links, section indexes or audience labels ([doc verification](../agents/doc-verification.md#mechanical-scans); plan decision D7). Compose files under `compose/opt-in/` are outside gate 4 (`isComposeFile`, `loopback-ports.ts` line 28); `scratch-overlay.test.ts` covers `scratch.yml`. No test in this package names `compose/opt-in/sheet-sink.yml` (`git grep -l sheet-sink -- tools/repo-checks` at `1b114276` returns nothing).

## Conflicts recorded

Recorded, not resolved (persona rule 8).

1. **Package description and step name.** `tools/repo-checks/package.json` describes the package as line caps, LF endings and control characters; `geldar.ps1` line 151 and `ci.yml` line 43 name the step the same way. `run-checks.ts` runs 14 gates from 15 modules.
2. **CLI header.** The header comment of `cli.ts` (lines 1 to 15) lists line caps, CRLF, control characters, loopback ports, workflow YAML, MCP tokens, IPv4 literals and the decision index. It omits pin rules, release age, integration floor, identity mode, decision rows and environment definitions, which `run-checks.ts` runs.
3. **Release age "manual".** The header of `pin-rules.ts` (lines 7 to 8) says the 14-day release age "needs the network, so it stays a manual step". `release-age.ts` checks it in `pnpm check:repo` from the committed `release-dates.json`, with no network call; adding the dates for a new pin is the manual part.
4. **Loopback header.** `loopback-ports.ts` lines 1 to 3 say every compose service publishes on `127.0.0.1` "and nowhere else"; lines 18 to 24 allow one public publish in `compose/colo-public.yml` (decision 0096). The exception is documented in code; the header sentence is not.
5. **Overlay lists.** `nats-auth-fixtures.ts` (`OVERLAYS`) names four overlay files "never validated alone (geldar.ps1 Invoke-Check and ci.yml)"; `Invoke-Check` in `geldar.ps1` (line 154) excludes seven, and so does the `compose` job in `ci.yml` (line 96, checked 2026-11-16). `nats-auth.test.ts` asserts only the four; see [ci-workflows](ci-workflows.md#ciyml).
6. **Counts.** The plan ([plan.md](../analysis/docs-library/plan.md) rows R24 and the inventory table) gives 19 modules and 51 test files. Measured at `1b114276`: 19 and 51, the same. Of the 19, 15 are gate modules that make 14 gates; the plan does not say so. The [doc-update map](../agents/doc-update-map.md#gates-that-read-documents) names seven of them as gates that read no document; this page agrees.
7. **Test name.** `nats-auth-runbook.test.ts` checks `body-helper-node-steps.md`, not a NATS auth runbook (also plan finding F-13).

## Related

- [cli-tools](cli-tools.md): `geldar.ps1 check` and the tools.
- [Doc-update map](../agents/doc-update-map.md): which gates read documents; what to update when a gate changes.
- [Doc verification](../agents/doc-verification.md): running the gates on a document.
- Other references: [ci-workflows](ci-workflows.md), [compose-stacks](compose-stacks.md), [shard-config](shard-config.md), [nats-subjects](nats-subjects.md).
- How-to: [merge queue](../runbooks/merge-queue.md).
