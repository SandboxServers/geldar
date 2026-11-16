---
title: Telemetry package
type: reference
audience: agents-never
status: draft
last_verified: 2026-11-16 against 3f07a4be
companions: [README.md, components.md, repo-layout.md, environment-variables.md, decisions-by-topic.md, ../architecture/telemetry-pipeline.md, ../operations/monitoring-and-vitals.md, ../operations/failure-modes.md, ../security/privacy-and-data-retention.md]
sources: [telemetry, pnpm-workspace.yaml, package.json, vitest.config.ts, .github/workflows/ci.yml, compose/colo.yml, docs/decisions/0088-metrics-exporters-and-replay-window.md, docs/decisions/0350-telemetry-scope-and-full-capture.md, docs/decisions/0351-paper-telemetry-plugin-scope.md, docs/decisions/0352-telemetry-dedicated-clickhouse-database.md]
---

# Telemetry package

The `telemetry/` workspace package, `@geldar/telemetry`: what it exports, the names a caller configures, who imports it, and how it is tested and built. For why telemetry is shaped this way, read the [telemetry pipeline](../architecture/telemetry-pipeline.md) **(a-n)**; for what an operator watches, [monitoring and vitals](../operations/monitoring-and-vitals.md) **(a-n)**.

This page is operator material (`agents-never`, [documentation style](../agents/documentation-style.md#agents-never-learn-they-are-watched)). It stays at the level of the package's own README and the decision titles (plan decision D9; decision [0361](../decisions/0361-agents-never-placement-and-public-detail.md)). Never copy, quote or link it from anything an agent in the world reads.

Measured on 2026-11-16 at `3f07a4be` unless a row says otherwise.

## Identity

| Field | Value | Evidence |
|---|---|---|
| Folder | `telemetry/` (29 tracked files: README, `package.json`, `tsconfig.json`, 8 source files, 18 test files) | `git ls-files telemetry`; `ls telemetry/src telemetry/test` |
| Package name | `@geldar/telemetry`, `private`, ES module | `telemetry/package.json` |
| Entry point | `.` resolves to `./src/index.ts` (TypeScript source, no build step) | `telemetry/package.json`, `exports` |
| Workspace entry | `telemetry` | `pnpm-workspace.yaml` line 11 |
| Purpose | One shared OpenTelemetry setup for Geldar's Node services: traces, logs and metrics | [`telemetry/README.md`](../../telemetry/README.md), first paragraph |
| Built by | Card T-03 of decision 0350, commit `7451e735` (2026-11-15) | `git log --diff-filter=A -- telemetry/package.json` |
| Merged to `main` | PR #551, merge commit `6cf3c957`, 2026-11-16 06:08:48 UTC | `git log -1 --format='%h %ad' --date=iso-strict 6cf3c957` |
| Owner role | The orchestrator decides which telemetry cards change | decision [0352](../decisions/0352-telemetry-dedicated-clickhouse-database.md), "Who decides"; [components](components.md) |
| README | Yes: operator notes, modules, use, tests | [`telemetry/README.md`](../../telemetry/README.md) |

## Public surface

`telemetry/src/index.ts` re-exports a start function (`startTelemetry`), a logger factory (`createLogger`), trace propagation helpers, the attribute filter, content helpers, redaction helpers (`redactContent`, `scrubText`, `errorFields`) and their types. Names, behaviour and module roles are in the package's own [README](../../telemetry/README.md), "Modules" and "Operator notes"; this page does not restate them (decision [0361](../decisions/0361-agents-never-placement-and-public-detail.md)).

## Configuration names

Names only. No value of any of these belongs in the repo or in this library.

| Name | Where | Meaning |
|---|---|---|
| `endpoint` | `TelemetryOptions` | Base URL of the collector. Unset or blank turns the package off completely: no providers, no timers, no network calls (`src/sdk.ts`; README, "Operator notes"). |
| `GELDAR_TELEMETRY_URL` | Environment of the calling service | The variable a calling service reads and passes as `endpoint`. The package never reads the environment itself (README, "Operator notes"). See [environment variables](environment-variables.md). |
| `service`, `version` | `TelemetryOptions` | Become `service.name` and `service.version` on every signal. |
| `environment` | `TelemetryOptions` | Becomes `deployment.environment.name`; a default is set in `src/sdk.ts`. |
| `shard` | `TelemetryOptions` | Becomes `geldar.shard` when given and not blank. |
| `instanceId` | `TelemetryOptions` | Test seam for `service.instance.id`; unset means a fresh random UUID per start. |
| `limits` | `TelemetryOptions` | Partial `QueueLimits`; defaults are in `src/sdk.ts`. |
| `exporters` | `TelemetryOptions` | Test seam (`TelemetryExporters`). |
| `name`, `write`, `extraKeys` | `createLogger` options (`LoggerOptions`, not exported) | Logger name; a replacement line writer; extra field names this service may send to OTLP on top of the allow-list (process-wide). |

Services push metrics only when an endpoint variable is set (decisions [0088](../decisions/0088-metrics-exporters-and-replay-window.md) and [0350](../decisions/0350-telemetry-scope-and-full-capture.md) item 1). Today those services feed their own hand-written pushers, not this package ([telemetry pipeline](../architecture/telemetry-pipeline.md) **(a-n)**).

## Who imports it

Nobody yet.

```powershell
git grep -l "@geldar/telemetry" -- '*.ts' '*.json' '*.mjs' '*.yml' ':!telemetry'
```

On 2026-11-16 at `3f07a4be` this prints nothing (exit 1). Outside `telemetry/`, the name appears only in documents under `docs/` and in the `telemetry` importer entry of `pnpm-lock.yaml`. No image ships it; it will ship inside each image whose package imports it ([components](components.md), deploy row).

## Dependencies

Ten exact pins in `telemetry/package.json`: `@opentelemetry/api` 1.10.0; `context-async-hooks`, `core`, `resources`, `sdk-logs`, `sdk-metrics` and `sdk-trace` 3.0.0; the three OTLP proto exporters (logs, metrics, trace) 0.300.0. They match card T-03 in decision 0350 ("Consequences"). The 14-day release floor of decision 0005 applies; PR #551 added their dates to `tools/repo-checks/src/release-dates.json` (`git show --stat 6cf3c957`).

## Build and test

| Step | Command | Notes |
|---|---|---|
| Typecheck | `pnpm typecheck` at the root runs `tsc -p . --noEmit` here | `package.json` script `typecheck` (root: `pnpm -r --if-present run typecheck`) |
| Tests | `./geldar.ps1 pnpm --filter @geldar/telemetry test` | 18 files in `telemetry/test/`; fake exporters, no network ([README, Tests](../../telemetry/README.md#tests)) |
| Shared run | `pnpm test` at the root, and `./geldar.ps1 check` | Root `vitest.config.ts` includes `**/test/**/*.test.ts`; CI `ci.yml` runs `pnpm typecheck` (line 40) and `pnpm test` (line 42) |
| Build | none | The entry point is TypeScript source; importing packages bundle it into their images |

## Decisions

At policy level only (plan decision D9). Topics and status from each record's header on 2026-11-16; every telemetry record is listed in [decisions by topic](decisions-by-topic.md#telemetry).

| Decision | Status | What it sets for this package |
|---|---|---|
| [0350](../decisions/0350-telemetry-scope-and-full-capture.md) Telemetry scope and full capture | Accepted | The scope of telemetry and the cards, including T-03, which built this package. The README narrows its point 7 to `traceparent` only ([Operator notes](../../telemetry/README.md#operator-notes); `src/nats-trace.ts` header). |
| [0351](../decisions/0351-paper-telemetry-plugin-scope.md) Paper telemetry plugin scope | Proposed | Telemetry for Paper, the JVM side. Not this package, which serves Node services. |
| [0352](../decisions/0352-telemetry-dedicated-clickhouse-database.md) Telemetry on a dedicated ClickHouse database for Geldar | Accepted | Where the collected data is stored and who decides which cards change. The package itself only needs a collector URL. |
| [0088](../decisions/0088-metrics-exporters-and-replay-window.md) Metrics exporters and the MCP replay window | Proposed (wave C1) | The earlier rule that pushing happens only when `GELDAR_TELEMETRY_URL` is set; 0350 amends it. |

## Lifecycle

| Stage | Fact |
|---|---|
| Deploy and rollback | Nothing to deploy alone: no service imports it. It rolls back with the image of whichever service imports it. |
| Operate | Off until a calling service passes a collector URL. When on, it never blocks the caller and drops items when a queue is full (README, "Operator notes"). |
| Failure modes | Setup failure or a foreign global provider leaves telemetry off with one stderr line that carries no URL (`src/sdk.ts`). See [failure modes](../operations/failure-modes.md#telemetry). |
| Security and privacy | The attribute policy runs inside the SDK; metrics refuse identity attributes; no life or player identifier is a resource attribute (README, "Operator notes"). See [privacy and data retention](../security/privacy-and-data-retention.md) **(a-n)**. |
| Retirement | It holds no state. `shutdown()` stops its providers and clears the globals it registered (`src/sdk.ts`). |

## Gaps

- [repo-layout](repo-layout.md) lists the package in a row measured at `3f07a4be`; the rest of that page is pinned at `cd4499da`.
- The [telemetry pipeline](../architecture/telemetry-pipeline.md) **(a-n)** is pinned at `1b114276`. Its "Shared SDK package" row was corrected in W7 (2026-11-16) to say the package exists; the rest of that page is still verified only at its pin, and the [staleness sweep](../agents/doc-verification.md#staleness-sweep) lists it as stale.
