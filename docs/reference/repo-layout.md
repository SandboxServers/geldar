---
title: Repo layout
type: reference
audience: contributors
status: draft
last_verified: 2026-11-16 against cd4499da
companions: [glossary.md, spec-section-map.md, README.md, ../architecture/repo-map-and-dependencies.md, components.md, telemetry-package.md]
sources: [pnpm-workspace.yaml, package.json, telemetry/package.json, telemetry/README.md, vitest.config.ts, geldar.ps1, .github/workflows, plugin/README.md, supervisor/src/main.ts, supervisor/src/service.ts, body-helper/src/main.ts, body-helper/src/service.ts, tools]
---

# Repo layout

Every top-level folder and workspace package in the Geldar repo: what it is for, whether it has a README, its language, how to test it and how it is built. For how the packages depend on each other, see the [repo map and dependencies](../architecture/repo-map-and-dependencies.md). For one row per runtime component, see the [components](components.md) reference.

## How the counts were measured

- Commit `cd4499da`, measured 2026-11-16 07:05 UTC.
- Sources beyond the metadata list: every package's `package.json`, the `Invoke-Check` function and the command switch in `geldar.ps1`, and `git ls-files`.
- "Files" is the number of tracked files: `git ls-files -- <path> | wc -l`. Untracked and ignored files (for example `node_modules` and the ignored secrets folder) are not counted.
- "README" means a `README.md` directly in that folder: `[ -f <path>/README.md ]`.
- Re-derive the table with the commands above from the repo root; counts change with every merge.

## Shared commands

These apply to every TypeScript package unless its row says otherwise.

| Task | Command | Evidence |
|---|---|---|
| Install | `./geldar.ps1 setup` (pnpm install with the pinned pnpm, `--frozen-lockfile`) | `geldar.ps1` command switch |
| Test one package | `./geldar.ps1 pnpm test <path>`, for example `./geldar.ps1 pnpm test eventsink`. One Vitest run covers the whole workspace; the path filters it. | `vitest.config.ts` (includes `**/src/**/*.test.ts` and `**/test/**/*.test.ts`, excludes `*.live.test.ts`); `CLAUDE.md` |
| Typecheck | `./geldar.ps1 pnpm typecheck` (each package's `tsc -p . --noEmit`) | root `package.json` |
| Everything CI runs | `./geldar.ps1 check`: Biome, typecheck, Vitest, repo checks, contract drift, `docker compose config` on each stack, Gradle build | `Invoke-Check` in `geldar.ps1` |

The TypeScript packages have no compile step of their own: Node 22 runs the `.ts` sources directly (`"start": "node src/main.ts"` in `glass`, `eventsink`, `lantern-local`). A package that ships as a container is built into an image by a GitHub workflow, named in the "Built" column.

## Top-level folders

| Path | Purpose | README | Language | Files | Test | Built | Planned reference |
|---|---|---|---|---|---|---|---|
| `.claude/` | Development-agent skills (4), agent definitions (4), committed session memory (4 files) and packet reports (32 files). Read by development sessions only. | No | Markdown | 44 | n/a | n/a | [skills-and-agents](skills-and-agents.md) |
| `.github/` | CI workflows (6), Dependabot config, issue and PR templates. | No | YAML | 12 | Runs on every push | n/a | [ci-workflows](ci-workflows.md) |
| `bench/` | The sheet campaign's driver scripts for a scratch shard (`bench/sheet/`). Not the body benchmark, which is `golem/src/bench/`. | **No** | Shell, YAML | 3 | None found | Not built | none planned |
| `body-helper/` | Root-owned host service that serves four Body verbs over NATS and starts and stops Body containers on the node, under a global cap; starts and stops run one at a time. Confirmed from `body-helper/src/main.ts` and `service.ts`. | **No** | TypeScript | 33 | `./geldar.ps1 pnpm --filter @geldar/body-helper test`, or shared | `pnpm --filter @geldar/body-helper build` (`scripts/bundle.mjs`); workflow `body-helper-bundle.yml` | [supervisor-and-body-helper](supervisor-and-body-helper.md) |
| `compose/` | Docker Compose stacks and overlays: `phase0.yml`, `colo.yml`, `mcp.yml`, the NATS auth, Kino, notice and public overlays, `signcheck.yml`, `rcon-host.yml`, `opt-in/`; also the Paper entrypoint, the Velocity config and examples. | **No** | YAML | 19 | `docker compose config` steps in `./geldar.ps1 check` and the CI `compose` job | Not built (mounts jars and images built elsewhere) | [compose-stacks](compose-stacks.md) |
| `contract/` | JSON Schemas (`contract/schemas/`, 52 files), the code generated from them, NATS subject builders and connection helpers. | **No** | TypeScript, JSON Schema | 111 | Shared; drift: `./geldar.ps1 pnpm check:generated` | `pnpm --filter @geldar/contract generate` (`scripts/generate.ts`); never hand-edit the output | [contract-schemas](contract-schemas.md), [nats-subjects](nats-subjects.md) |
| `deploy/` | Colo deploy, rollback, status and admin scripts, Caddy site files, the genesis config bundle, the scratch stack. | Yes | Bash, Caddyfile, TypeScript tests | 67 | Shared (`deploy/test/*.test.ts`) | Not built; runs on the node | [deploy-scripts](deploy-scripts.md) |
| `docs/` | Spec, decisions (188 files: 187 records and the index), runbooks (30: 29 and the index), analysis (336), the library sections (agents, concepts, architecture, reference, guides, operations, security, history, siblings), legal (3), players (1), and loose docs (5). Counts are tracked files at 02e9ee34 (`git ls-files docs`, 2026-11-16). | Yes | Markdown | 646 | Doc gates in `tools/repo-checks` | n/a | [docs index](../README.md) |
| `envs/` | Genesis environment definitions: `environment.schema.json` and `test.example.yaml` (decision 0188). | **No** | JSON Schema, YAML | 2 | Through `tools/genesis-env` tests | n/a | [shard-config](shard-config.md) |
| `eventsink/` | Copies the NATS event stream `GELDAR_EVENTS` into Postgres. | Yes | TypeScript | 52 | Shared; integration test with `$env:GELDAR_IT = '1'` and a running shard | Image `eventsink/Dockerfile`, job `eventsink` in `colo-images.yml` | [eventsink](eventsink.md) |
| `glass/` | The Glass: the Thought Stream server and Kino pages for human viewers. | Yes | TypeScript | 170 | Shared | Image `glass/Dockerfile`, job `glass` in `colo-images.yml` | [glass-and-kino](glass-and-kino.md) (agents-never) |
| `golem/` | The Body (product name Golem): bot client, actions, perception, reflexes, body benchmark, Adam. | Yes | TypeScript | 654 | Shared; live: `./geldar.ps1 pnpm --filter @geldar/golem test:live` (needs the shard); benchmark: `./geldar.ps1 bench` | Image `golem/Dockerfile`, job `body` in `colo-images.yml` | [golem-body](golem-body.md) |
| `lantern-local/` | The local Thinker: connects to the Mind's Thinker socket and runs model jobs on Ollama. | Yes | TypeScript | 15 | Shared | Not an image; started by `./geldar.ps1 adam up` (`lantern-local/README.md`) | [lantern-thinker-protocol](lantern-thinker-protocol.md) |
| `player-core/` | Neutral home of the live player path: Body and Mind links, validation, plan builder, speech classifier, ids. Imported by `threshold/mcp` and `animus`. | Yes | TypeScript | 31 | Shared | Library; bundled into the images that import it | [player-core](player-core.md) |
| `plugin/` | Gradle multi-project with two plugins: `core` (Geldar-Core, for Paper) and `velocity-identity` (for Velocity). Java 25 per `plugin/README.md`. | Yes | Java (178 files), Gradle Kotlin DSL | 196 | `cd plugin; ./gradlew build` (CI `plugin` job) | Same command; workflow `plugin-jars.yml`. Required before `./geldar.ps1 shard up` | [geldar-core-plugin](geldar-core-plugin.md), [velocity-identity-plugin](velocity-identity-plugin.md) |
| `plugins/` | Pinned third-party plugins and their config: `bluemap/` (with an alias proxy and web additions), `chunky/`, `coreprotect/`. | **No** (at the root; `bluemap/` and `chunky/` have one) | YAML-like conf, JSON, JavaScript, TypeScript tests | 33 | Shared (`plugins/*/test/*.test.ts`) | Not built; jars fetched by their lock files | [third-party-plugins](third-party-plugins.md) |
| `prompts/` | Versioned prompt templates: `thought/` v1 to v5, `reflection/` v1 to v2, `body-api/` v1 to v10. A released version is never edited. | Yes | Markdown, JSON | 18 | Read by tests in `animus/src/prompts/` and `golem/src/mind-link/` | n/a | [prompt-templates](prompt-templates.md) (agents-never) |
| `psyche/` | The character engine (sheet, proficiency, temperament), with zero imports outside the package so the kit can copy it byte for byte (decision 0281). | Yes | TypeScript | 23 | Shared | Library; release record by `tools/psyche-release` | [psyche-engine](psyche-engine.md) |
| `shards/` | Shard configuration: `phase0.yaml`, `colo.yaml` (flat Colo budget keys), `colo-mind.yaml` (what the Colo containers read), `character-fixture.yaml` (disposable fixtures). | **No** | YAML | 4 | Read by config tests in several packages; `./geldar.ps1 check` validates `shards/colo.yaml` first | n/a | [shard-config](shard-config.md) |
| `sql/` | Postgres migrations (44 files, `NNNN_slug.sql`), schema checks (`sql/test/`, 27 files) and a README. | Yes | SQL | 68 | CI `sql` job applies every migration in name order, then runs `sql/test/check-schema.sql` | Applied by `./geldar.ps1 db migrate` (`tools/migrate`) or by Postgres init on a fresh volume | [database-schema](database-schema.md) |
| `supervisor/` | See [supervisor](#supervisor). | **No** | TypeScript | 27 | `./geldar.ps1 pnpm --filter @geldar/supervisor test`, or shared | Image `supervisor/Dockerfile`, job `supervisor` in `colo-images.yml` | [supervisor-and-body-helper](supervisor-and-body-helper.md) |
| `telemetry/` | Shared OpenTelemetry setup for the Node services (`@geldar/telemetry`), off unless a caller passes a collector URL; no package imports it yet. Added by PR #551 after this page's pin; row measured 2026-11-16 at `3f07a4be`. | Yes | TypeScript | 29 | `./geldar.ps1 pnpm --filter @geldar/telemetry test`, or shared | Not built; TypeScript source bundled into the images that import it | [telemetry-package](telemetry-package.md) (agents-never) |
| `threshold/` | Container folder for three packages (below). No files of its own. | **No** | n/a | 451 | per package | per package | [mcp-tools](mcp-tools.md), [register-service](register-service.md) |
| `tools/` | Fourteen CLI and check packages (below). No files of its own. | **No** | TypeScript, Bash | 317 | per package | per package | [cli-tools](cli-tools.md) |

### Supervisor

`supervisor/` has no README. Its purpose is confirmed from the entry point, not only from file names: `supervisor/src/main.ts` loads its config, connects to Postgres (as `geldar_supervisor`) and NATS, and hands both to `runSupervisor`, "which serves the control subjects of its shard and runs the policy in service.ts. Bodies are reached only through the host body helper over NATS. It holds no Docker socket (decision 0260)". The policy imports start quotas per agent per hour and per owner per day (`supervisor/src/service.ts`, from `quotas.ts`). See decisions [0152](../decisions/0152-programmatic-body-management-for-owners.md) and [0260](../decisions/0260-body-container-control-by-host-helper.md).

## Threshold packages

| Path | Package | Purpose | README | Files | Test | Built |
|---|---|---|---|---|---|---|
| `threshold/mcp/` | `@geldar/mcp` | The Geldar MCP server for sovereign players, served from the Body channel. | Yes | 252 | Shared | Image `threshold/mcp/Dockerfile`, job `mcp` in `colo-images.yml` |
| `threshold/mcp-mock/` | `@geldar/mcp-mock` | A stand-in for the Threshold MCP server with the real tool contract and a deterministic fake world (`threshold/mcp-mock/README.md` line 3; the package has no `description`). The production server imports its prompts, clock and event types (`threshold/mcp/src/resources.ts`, `cli.ts`). | Yes | 93 | Shared | Image `threshold/mcp-mock/Dockerfile`, workflow `mcp-mock-image.yml` |
| `threshold/register/` | `@geldar/register` | The self-registration service (sign-in, owners, players, tokens). Its `package.json` description still says GitHub and Discord; see [glossary conflict 6](glossary.md#conflicts-recorded). | Yes | 106 | Shared | Image `threshold/register/Dockerfile`, job `register` in `colo-images.yml` |

## Tool packages

All are workspace packages (`tools/*` in `pnpm-workspace.yaml`). Purposes are each `package.json` description unless noted.

| Path | Purpose | README | Files | Own `test` script | How it runs |
|---|---|---|---|---|---|
| `tools/adam-cli` | Logic behind `./geldar.ps1 adam`: model pin checks, digest recording, life selection, host process control. | No | 19 | No (shared) | `./geldar.ps1 adam` |
| `tools/adam-report` | Adam run report generator: reads one life from Postgres read-only, writes `run-report.json` and `.md`. | No | 37 | No (shared) | Node CLI |
| `tools/adam-run` | Adam run protocol: manifest, per-minute sampling, abort rules, safe stop. | No | 37 | No (shared) | `./geldar.ps1 adam-run` |
| `tools/admin` | One-shot admin container (no `package.json`; purpose from `tools/admin/admin.sh` usage text and decision 0133). | No | 3 | n/a | Image `tools/admin/Dockerfile`, job `admin` in `colo-images.yml` |
| `tools/genesis-env` | Validates `envs/<name>.yaml` against the schema and refuses secret-shaped values, account names and addresses. | No | 7 | Yes | `pnpm --filter @geldar/genesis-env validate` |
| `tools/glass-ctl` | Logic behind `./geldar.ps1 glass`: one detached Glass server on `127.0.0.1`. | No | 9 | No (shared) | `./geldar.ps1 glass` |
| `tools/kino-shot` | Developer tool: opens a Kino page in headless Chromium and saves screenshots. | No | 6 | Yes | `pnpm --filter @geldar/kino-shot shot` |
| `tools/mcp-tokens` | Owners, sovereign players and their hashed per-player Bearer tokens. | No | 36 | No (shared) | `./geldar.ps1 mcp-tokens` |
| `tools/migrate` | Migration runner: applies `sql/[0-9]*.sql` in order and records them in `schema_migrations`. | No | 10 | No (shared) | `./geldar.ps1 db migrate` |
| `tools/players-cli` | Logic behind `./geldar.ps1 players`: one supervised Body process per sovereign ranger. | No | 31 | No (shared) | `./geldar.ps1 players` |
| `tools/portscan` | External TCP port scan: the open set must match the expected list exactly. | Yes | 14 | Yes | `pnpm --filter @geldar/portscan scan` |
| `tools/progress-metrics` | Operator-only progress metrics per agent and window, from files only. | No | 22 | Yes | `pnpm --filter @geldar/progress-metrics report` |
| `tools/psyche-release` | The psyche release record: tree hash of `psyche/src` and `psyche/RELEASE.json`. | No | 9 | No (shared) | Node CLI |
| `tools/repo-checks` | Repo hygiene gates run by CI and `check`. Its description names line caps, LF endings and control characters; the folder also holds doc and decision gates (77 files). | No | 77 | No (shared) | `./geldar.ps1 pnpm check:repo` |

## Root files

| File | Purpose |
|---|---|
| `README.md` | Public project introduction. |
| `AGENTS.md`, `CLAUDE.md` | Repo rules and commands for development sessions (every harness, and Claude Code). |
| `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `LICENSE`, `THIRD_PARTY_NOTICES.md` | Governance and legal. |
| `geldar.ps1` | The task runner: `setup`, `pnpm`, `check`, `shard`, `bench`, `adam`, `adam-run`, `glass`, `players`, `mcp`, `mcp-tokens`, `db migrate` (command switch at the end of the file). |
| `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` | Workspace root: scripts, the package list, exact pins, the 14-day minimum release age (decision 0005). |
| `tsconfig.base.json`, `biome.json`, `vitest.config.ts` | Shared TypeScript, lint and test config. |
| `.nvmrc`, `.editorconfig`, `.gitattributes`, `.gitignore`, `.env.example` | Node version pin, editor settings, LF rule, ignores, example environment (names only). |

## Folders with no README

Ten source and config folders have no `README.md` of their own (checked 2026-11-16): `bench/`, `body-helper/`, `supervisor/`, `threshold/` (root), `tools/` (root), `compose/`, `plugins/` (root), `contract/`, `shards/`, `envs/`. `.claude/` and `.github/` have none either (12 in all); they hold development and CI configuration, not source. The planned reference docs above cover each. A one-line in-tree README for each is a code-side change and is left to a coder packet. Of the tool packages, only `tools/portscan` has a README.

## Differences from the plan data

The documentation plan's inventory (scratch data, 2026-11-16) differs from this measurement in three places. This page uses the measurement.

- `sql/` holds 44 migrations, 0001 to 0065, not "0001-0027 and 0032". The numbers absent from this checkout are 0028 to 0031, 0041 to 0049, 0053 to 0059 and 0064.
- `threshold/register/` has a README.
- `golem/` has 654 tracked files and `plugin/` 196 (plan: 653 and 192).
