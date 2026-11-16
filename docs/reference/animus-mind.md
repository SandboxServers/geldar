---
title: Animus (the Mind)
type: reference
audience: contributors
status: draft
last_verified: 2026-11-16 against 1b114276
companions: [README.md, components.md, ../concepts/body-and-mind.md, player-core.md, golem-body.md, lantern-thinker-protocol.md, prompt-templates.md, ../../animus/README.md]
sources: [animus/package.json, animus/README.md, animus/Dockerfile.mind, animus/src, animus/test, player-core/README.md, compose/colo.yml, shards/phase0.yaml, shards/colo-mind.yaml, .github/workflows/colo-images.yml, docs/analysis/harness/work-packets-extra.md, docs/analysis/harness/work-packets-geldar-c.md, CLAUDE.md, ../decisions/0047-thinking-time-comes-from-intents-and-waits-not-dilation.md, ../decisions/0049-thinker-job-gets-response-format-and-reasoning.md, ../decisions/0050-phase0-mind-processes-run-on-the-host.md, ../decisions/0051-adam-identity-and-model-pins.md, ../decisions/0064-exit-run-lives.md, ../decisions/0078-mind-placement-for-phase1.md, ../decisions/0083-c1-body-and-mind-image-contents.md, ../decisions/0134-mind-is-a-profile-until-a-thinker-exists.md, ../decisions/0181-thought-context-8704.md]
---

# Animus (the Mind)

`animus/` (package `@geldar/animus`) is the in-house Mind: it wakes on Body events, builds a prompt, asks a model through the Thinker hub, validates the answer and sends the Body a plan (`animus/README.md`; spec 5.3, 5.4). It is the Mind of Adam-class agents, which are headless and run our Mind. Sovereign players bring their own Mind and do not use it (decision [0078](../decisions/0078-mind-placement-for-phase1.md)).

The live-player pieces it once held (ports, Body link, event mapping, output validation, plan builder, speech classifier, ids) now live in [player-core](player-core.md). This page lists what remains in `animus/src`, how it runs, and the different accounts of its status.

The prompts, the thought journal and the reflection are described here only by file and purpose. Template content and the stored thought records are operator material: see the [prompt-templates](prompt-templates.md) reference (agents-never).

## How this page was measured

Commit `1b114276`, 2026-11-16 (UTC), read-only. Purposes come from each file's header comment. Re-derive:

```powershell
(git ls-files animus).Count                                          # 136
(git ls-files animus | Select-String '\.test\.ts$').Count            # 44, of which 2 are *.it.test.ts
(git grep -l '@deprecated' -- animus/src).Count                       # 22 stub files
git log --format='%h %ad %s' --date=short -- animus/src | Select-Object -First 5
```

## Status: four accounts

The repo gives four accounts of what `animus/` is. They are recorded here, not reconciled.

| Account | What it says | Evidence |
|---|---|---|
| The package README | A P0-21 skeleton: ports, config, ids and fakes, with later packets "to fill in the behaviour"; its layout block says the `thinker/`, `link/`, `attention/`, `memory/`, `prompts/`, `validate/`, `loop/`, `reflection/` folders and `mind.ts`, `main.ts` come later. Its run section then describes a working Mind run through `./geldar.ps1 adam`. | `animus/README.md` |
| player-core | Animus is frozen. Its live-path files are one-line stubs marked `@deprecated` that re-export from `@geldar/player-core`; new code imports from player-core. | `player-core/README.md`; 22 stub files at `1b114276` |
| Compose | `compose/colo.yml` defines an `animus` service (image `geldar-mind:c1` from `animus/Dockerfile.mind`) under profile `mind`, which `shard up colo` and `deploy/colo-up.sh` skip until a Thinker path exists. CI still builds the image (job `mind` in `colo-images.yml`). | `compose/colo.yml` comment; decision [0134](../decisions/0134-mind-is-a-profile-until-a-thinker-exists.md) |
| Campaign packets | `animus/**` is "frozen by D-HC-01"; card GX-04 says "the in-house Mind is abandoned (decision 77)" and leaves open whether `animus/` is later deleted or kept frozen. | `docs/analysis/harness/work-packets-extra.md` (GX-04); `docs/analysis/harness/work-packets-geldar-c.md` |

What the code shows at `1b114276`:

- Every folder the README calls "later" exists and holds code (table below).
- `animus/src` was still edited after the player-core move merged (merge `87d33b51`, 2026-11-14): commits `ea53e3f4`, `c274c1bc`, `c1fe2094` and `319d5be0` (2026-11-14) changed `src/prompts/library.ts`, `src/prompts/decode-schema.ts` and tests to add the `use` verb and make body-api v10 the default. So "frozen" did not stop prompt-default changes. Checked with `git merge-base --is-ancestor 87d33b51 <commit>`.

## Package

| Field | Value | Evidence |
|---|---|---|
| Name | `@geldar/animus`, private | `animus/package.json` |
| Scripts | `typecheck` only; tests run in the root Vitest run | `animus/package.json` |
| Workspace dependencies | `@geldar/contract`, `@geldar/player-core` | `animus/package.json` |
| Libraries | `@nats-io/jetstream` and `@nats-io/transport-node` 3.4.0, `pg` 8.23.1, `ws` 8.22.0, `yaml` 2.9.1 | `animus/package.json` |
| Entry point | `node src/main.ts` | `animus/Dockerfile.mind`; `compose/colo.yml` |

## Source folders

| Folder or file | Holds | Stub? |
|---|---|---|
| `src/main.ts` | The process: reads config, opens Postgres, checks the embedder, starts the Thinker hub and the NATS link, wakes the life with `mind_start`; stops in reverse order on SIGINT or SIGTERM | no |
| `src/mind.ts` | One life's Mind composed from its ports: event source to attention controller to thinking loop | no |
| `src/config.ts` | Reads the shard file's `mind`, `model_pins` and `embedding` blocks and the environment; refuses non-loopback addresses and placeholder digests or seeds | no |
| `src/ports/` | The interfaces (model, body, memory, attention, prompts, admission) | yes: all re-export `player-core/src/ports/` |
| `src/ids.ts` | ULID minting | yes: re-exports `player-core/src/ids.ts` |
| `src/thinker/` | The local Thinker hub (spec Appendix H server for Phase 0): `hub.ts`, `session.ts`, `jobs.ts`, `local-client.ts` (the Mind's `ModelClient`) | no |
| `src/link/` | `nats-publisher.ts`: publishes the Mind's own `thought` and `reflection` events to `geldar.<shard>.<type>` | `mind-event.ts`, `nats-body-link.ts`, `nats-event-source.ts`, `link.fixtures.ts` are stubs |
| `src/attention/` | `controller.ts`, `policy.ts`, `coalesce.ts`, `timing.ts`: when the life wakes (spec 5.3.2, decision [0047](../decisions/0047-thinking-time-comes-from-intents-and-waits-not-dilation.md)) | `classify.ts` is a stub |
| `src/loop/` | The thinking loop (spec 5.3.4): snapshot with retry, admission, the model call, effort, fallback, plan submit, intent link, journal row | `plan.ts` is a stub |
| `src/memory/` | Postgres and pgvector memory store, journal, retrieval, Ollama embedder (`nomic-embed-text`, 768 dimensions per `vector.ts`) | no |
| `src/prompts/` | Template loader and renderer for `prompts/`, decode schemas (decision [0049](../decisions/0049-thinker-job-gets-response-format-and-reasoning.md)), quoted-world-text section, wake wording | no |
| `src/validate/` | Model-output validation | yes: every non-test file re-exports `player-core/src/validate/` |
| `src/reflection/` | Sleep reflection (spec 5.4): trigger, digest, model call, apply to memory | no |
| `src/fakes/` | In-memory implementations for unit tests | no |

## Ports and processes

| Item | Value | Evidence |
|---|---|---|
| Listening socket | The Thinker hub on `mind.thinker.host`:`mind.thinker.port`, `127.0.0.1:7410` in both shard files; `lantern-local` connects to it | `shards/phase0.yaml`; `shards/colo-mind.yaml`; `animus/README.md` |
| Colo Thinker | Placeholder: `shards/colo-mind.yaml` names the Thinker `unreachable-placeholder` and says no Thinker can reach it yet | `shards/colo-mind.yaml` |
| Outbound | NATS, Postgres, Ollama (embedder) | `animus/README.md`; `src/main.ts` |
| Port held during live runs | `./geldar.ps1 adam up` holds 7410; never run it before the live cases | `CLAUDE.md` |

The image comment says "The image has no listening port" (`animus/Dockerfile.mind`): the Dockerfile exposes nothing, while the process binds the hub inside the container on loopback.

## Data

The Mind reads and writes these tables (statement targets in `src/memory/`, `src/loop/`, `src/reflection/`; re-derive with `git grep -ohE '(FROM|INTO|UPDATE|JOIN) [a-z_]+' -- animus/src ':!*.test.ts'`). Column detail is in the [database-schema](database-schema.md) reference.

`agents`, `goals`, `intents` (update), `memories`, `relationships`, `runs` (update), `suppressed_wakeups`, `thoughts`.

Each thought records the template version it used, `<kind>@<n>+sha256:<12 hex>` (`src/prompts/template.ts`; spec Appendix D).

## Prompt use

| Template | Default a new Mind renders | Older versions | Evidence |
|---|---|---|---|
| `prompts/thought/` | v5 (`mind.thought_version: 5` in both shard files) | v1 to v4 stay loadable | `src/prompts/library.ts`; `src/config.ts` |
| `prompts/body-api/` | v10 | v1 to v9 stay loadable | `src/prompts/library.ts` |
| `prompts/reflection/` | v2 | v1 stays loadable | `src/prompts/library.ts` |

The thought prompt is budgeted in estimated tokens (`mind.prompt_budget_tokens`, default 2500), fitted to `num_ctx` 8704 with a 2048 output reserve (decision [0181](../decisions/0181-thought-context-8704.md); `animus/README.md`). In-world text reaches a prompt only as a JSON-escaped string in the quoted-world-text section (`src/prompts/world-text.ts`). `animus/src/prompts/agent-text.test.ts` scans the templates for agent-visible text. Template changes follow the [prompt rule in CLAUDE.md](../../CLAUDE.md): a new version, never an edit.

## Limits

| Limit | Value | Evidence |
|---|---|---|
| Admission | Rolling-hour counter against `mind.admission.max_thoughts_per_real_hour`; a thought costs 1, a reflection 2 | `src/loop/admission.ts` |
| Reflection | At most one per in-game day (`agents.last_sleep_day`), only when admission grants 2 | `src/reflection/trigger.ts` |
| Output size | 32 KiB read by the validators (`MAX_OUTPUT_BYTES`) | `player-core/src/validate/bounds.ts` |

## Configuration

Shard file blocks: `mind` (agent, lives, thinker, admission, prompt budget, versions), `model_pins`, `embedding` (`src/config.ts`). Lives and tiers: `--model strong` picks `ag_adam_03` on `qwen3:32b`, `--model fast` picks `ag_adam_04` on `qwen3:8b`, `--model smoke` picks `ag_smoke_01` (`animus/README.md`; decisions [0051](../decisions/0051-adam-identity-and-model-pins.md), [0064](../decisions/0064-exit-run-lives.md)). The [shard-config](shard-config.md) reference lists every key.

Environment names (values never here; re-derive with `git grep -ohE '\b(GELDAR|POSTGRES|OLLAMA|ANIMUS)_[A-Z_]+' -- animus/src ':!*.test.ts'`):

`GELDAR_SHARD`, `GELDAR_IN_NETWORK_HOSTS`, `GELDAR_NATS_URL`, `GELDAR_NATS_USER` (default `mind`), `GELDAR_NATS_PASSWORD_FILE`, `ANIMUS_NATS_ROLE`, `GELDAR_THINKER_TOKEN_FILE`, `OLLAMA_URL`, `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD_FILE`, `GELDAR_IT_ALLOW_SHARED_DB` (integration tests only).

Secrets (the Postgres password, the NATS password, the Thinker token) arrive as files named by these variables; the image bakes none in (`animus/Dockerfile.mind` comment).

## Build, test and run

| Task | Command | Evidence |
|---|---|---|
| Unit tests | `./geldar.ps1 pnpm test animus` (fakes only: no Ollama, NATS, Postgres or Minecraft) | `animus/README.md` |
| Integration tests | `src/link/link.it.test.ts`, `src/memory/memory.it.test.ts`; skipped unless `GELDAR_IT=1` | `animus/README.md` |
| Typecheck | `./geldar.ps1 pnpm --filter @geldar/animus typecheck` | `animus/package.json` |
| Image | `docker build -f animus/Dockerfile.mind .`; CI job `mind` in `.github/workflows/colo-images.yml` | `animus/Dockerfile.mind`; decision [0083](../decisions/0083-c1-body-and-mind-image-contents.md) |
| Desktop run | `./geldar.ps1 adam up [--model strong\|fast]`, `adam status`, `adam logs animus`, `adam down` (Thinker, then Mind, then Body) | `animus/README.md`; decision [0050](../decisions/0050-phase0-mind-processes-run-on-the-host.md) |
| Colo run | `docker compose --profile mind ...`; not started by default | `compose/colo.yml`; decision 0134 |

Logs: one JSON object per line with `life_id`, `thought_id` and `intent_id` where they apply; prompt and completion text never reach the log (`src/main.ts` header).

## Conflicts recorded

1. **README versus code.** `animus/README.md` describes a skeleton whose folders come later; every folder exists with code at `1b114276`. The README is stale; it is a package README, so fixing it is a code-side change for a coder packet.
2. **Frozen versus edited.** player-core and the harness packets say frozen; `animus/src/prompts/` was changed after the freeze (commits listed above). Whether prompt defaults are an allowed exception is not recorded in a decision.
3. **"Decision 77".** Card GX-04 cites "decision 77" for abandoning the in-house Mind. `docs/decisions/0077-invitee-auth-and-the-0072-0075-login-rule.md` is about invitee auth and camera logins. The reference is unverified; it may be a campaign-local number.
4. **Colo Mind.** Decision [0078](../decisions/0078-mind-placement-for-phase1.md) places the Mind on the Colo for Adam-class agents; decision 0134 keeps it a profile until a Thinker path exists, and `shards/colo-mind.yaml` holds Thinker placeholders. Both stand; the Colo Mind is defined, not run.

## See also

- [player-core](player-core.md): the live-path pieces animus re-exports.
- [golem-body](golem-body.md): the Body end of the snapshot and plan subjects.
- [lantern-thinker-protocol](lantern-thinker-protocol.md): the Thinker wire protocol (spec Appendix H).
- [body and mind](../concepts/body-and-mind.md): why the split.
