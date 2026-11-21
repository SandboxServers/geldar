---
title: player-core
type: reference
audience: contributors
status: draft
last_verified: 2026-11-16 against 1b114276
companions: [README.md, components.md, ../concepts/body-and-mind.md, animus-mind.md, golem-body.md, mcp-tools.md, ../../player-core/README.md]
sources: [player-core/README.md, player-core/package.json, player-core/src, animus/src, threshold/mcp/src/json-string-parity.test.ts, contract/schemas/thought.schema.json, golem/src/actions/index.ts, docs/analysis/harness/work-packets-extra.md, docs/analysis/harness/work-packets-geldar-a2.md, ../decisions/0025-snapshot-revision.md]
---

# player-core

`player-core/` (package `@geldar/player-core`) is the neutral home of the live player path: the Mind's end of the Body link and its NATS transport, the Mind event mapping, output validation, the plan builder, the speech classifier and the ids (`player-core/README.md`; `package.json` description). Both `threshold/mcp` and `animus` import it. Nothing in it imports from `animus/`.

It exists because the MCP server for sovereign players imported these pieces from `animus/`, so `animus/` could not be frozen or deleted until they lived somewhere neutral (card GX-04, `docs/analysis/harness/work-packets-extra.md`). Card GX-04a moved them (merge `87d33b51`, 2026-11-14). See [animus-mind](animus-mind.md) for what stayed behind.

## How this page was measured

Commit `1b114276`, 2026-11-16 (UTC), read-only. Re-derive:

```powershell
git ls-files player-core                                                       # 31 files
git grep -l '@geldar/player-core' -- '*.ts' ':!player-core' |
  ForEach-Object { ($_ -split '/')[0..1] -join '/' } | Group-Object | Select-Object Count, Name
git grep -hoE '@geldar/player-core/src/[a-z/-]+\.ts' -- '*.ts' ':!player-core' | Group-Object | Sort-Object Count -Descending
```

| Count (2026-11-16, `1b114276`) | Value |
|---|---|
| Tracked files | 31 |
| Test files | 5 |
| Files importing it, under `threshold/mcp` | 35 |
| Files importing it, under `animus/src` | 22 (the `@deprecated` stubs) |
| Other importers | none (`golem` does not import it) |

## Package

| Field | Value | Evidence |
|---|---|---|
| Name | `@geldar/player-core`, private | `player-core/package.json` |
| Scripts | `typecheck` only; tests run in the root Vitest run | `player-core/package.json` |
| Dependencies | `@geldar/contract`, `@nats-io/jetstream` 3.4.0, `@nats-io/transport-node` 3.4.0 | `player-core/package.json` |
| Exports field | None. Importers name source files: `@geldar/player-core/src/<path>.ts` | `player-core/package.json`; importers |
| Built | Not built alone; bundled into the images that import it | [repo-layout](repo-layout.md) |

## Modules

| File | Purpose (from its header) | Animus stub |
|---|---|---|
| `src/ids.ts` | The id prefixes the Mind mints (thought, intent, action, Thinker job, event) as ULIDs in Crockford base32 (`common.schema.json`) | `animus/src/ids.ts` |
| `src/attention/classify.ts` | Speech classification (spec 5.3.2): addressed, about me, about my commitments, or overheard | `animus/src/attention/classify.ts` |
| `src/link/mind-event.ts` | Turns a `WorldEvent` off the wire into the `MindEvent` the Mind reads; holds `MIND_EVENT_TYPES` | yes |
| `src/link/nats-body-link.ts` | The Mind's end of the Body channel: snapshot requests and plans over core NATS request/reply; a reply that fails the contract is a `BodyLinkError` (decision [0025](../decisions/0025-snapshot-revision.md)) | yes |
| `src/link/nats-event-source.ts` | An ordered JetStream consumer on `GELDAR_EVENTS` for the subscribed lives; events that fail the contract are dropped and counted | yes |
| `src/link/link.fixtures.ts` | Valid wire fixtures for link tests | yes |
| `src/loop/plan.ts` | Builds the `PlanMessage` for a validated thought (spec 5.3.4) | yes |
| `src/ports/` (`admission`, `attention`, `body`, `memory`, `model`, `prompts`, `index`) | The Mind's interfaces (P0-21) | yes, all seven |
| `src/validate/` (`index`, `bounds`, `thought-output`, `reflection-output`, `action-shapes`, `action-focus`, `corrective`, `json-input`) | Strict validation of model output: schema, Phase 0 allow-list, bounds, corrective message | yes, all eight |
| `src/validate/json-string.ts` | Verbatim copy of the JSON-escaping code in `animus/src/prompts/world-text.ts` | no stub; `threshold/mcp/src/json-string-parity.test.ts` pins both copies equal |
| `src/no-animus.test.ts` | Fails if any source file imports from `animus` | n/a |

## Interfaces

### Mind event types

`MIND_EVENT_TYPES` in `src/link/mind-event.ts`: `wake`, `intent`, `action`, `plan_result`, `action_outcome`, `reflex_fired`, `speech`, `damage`, `death`, `sleep`, `heard_sound`. Each maps to the subject `geldar.<shard>.<type>`. The MCP server's event stream consumes this explicit list (harness packet notes, `docs/analysis/harness/work-packets-geldar-a2.md`), so other event types do not reach a player through it.

### Allow-lists

From `src/validate/bounds.ts`:

| List | Values |
|---|---|
| `PHASE0_VERBS` (may appear in `actions`) | `goto`, `mine`, `craft`, `place`, `eat`, `sleep`, `open`, `deposit`, `withdraw`, `attack`, `wait`, `unstick`, `give`, `note`, `write_sign`, `till`, `edit_sign`, `use` |
| `PHASE0_PROGRAMS` (may be named by an intent) | `travel`, `gather`, `craft`, `rest`, `flee`, `follow`, `build`, `explore`, `farm`, `patrol` (the last three added by AN-45a: registered and allowed by the validator, but listed by no body-api version and absent from the decode schema) |
| `MAX_OUTPUT_BYTES` | 32 KiB (the Thinker's `text` cap) |
| `MAX_CHECKPOINT_BYTES` | 4096 |

`PHASE0_VERBS` equals the 18 handlers the Body registers (`golem/src/actions/index.ts`; see [golem-body](golem-body.md#registered-verbs)). The contract names 26 verbs (`contract/schemas/thought.schema.json`); the other eight are refused here before they reach the Body.

## Build and test

| Task | Command |
|---|---|
| Tests | `./geldar.ps1 pnpm test player-core` (ids, the two link files, plan, no-animus) |
| Parity | `./geldar.ps1 pnpm test threshold/mcp/src/json-string-parity` |
| Typecheck | `./geldar.ps1 pnpm --filter @geldar/player-core typecheck` |

## Change rules

- New code imports from `@geldar/player-core`, never from the `animus/src` stubs (`player-core/README.md`).
- player-core must not import `animus` (`src/no-animus.test.ts`).
- A change to `src/validate/json-string.ts` must be made in `animus/src/prompts/world-text.ts` too, or the parity test fails.
- A change here reaches sovereign players through `threshold/mcp`. Validation and refusal text the MCP server returns is agent-read; follow the [agents-never rule](../agents/documentation-style.md#agents-never-learn-they-are-watched).

## Conflicts recorded

1. **`build` in the program allow-list.** The comment above `PHASE0_PROGRAMS` in `src/validate/bounds.ts` says "Everything else (skills, `build`, `trade_wait`) is refused"; the list itself includes `build`. The Body registers a `build` program (`golem/src/body/programs/index.ts`). Code allows `build`; the comment says it does not.

## See also

- [animus-mind](animus-mind.md): the in-house Mind and its stubs.
- [golem-body](golem-body.md): the Body end of the link.
- [mcp-tools](mcp-tools.md): the MCP server that imports most of this package.
