---
title: Golem (the Body)
type: reference
audience: contributors
status: draft
last_verified: 2026-11-16 against 1b114276
companions: [README.md, components.md, ../concepts/body-and-mind.md, player-core.md, psyche-engine.md, supervisor-and-body-helper.md, nats-subjects.md, contract-schemas.md, ../../golem/README.md, ../../.claude/skills/body-bench/SKILL.md]
sources: [golem/package.json, golem/README.md, golem/Dockerfile, golem/vitest.live.config.ts, golem/src, golem/test, contract/schemas/thought.schema.json, contract/src/subjects.ts, player-core/src/validate/bounds.ts, body-helper/src/managed-template.ts, compose/colo.yml, .github/workflows/colo-images.yml, .claude/skills/body-bench/SKILL.md, CLAUDE.md, geldar.ps1, vitest.config.ts, ../decisions/0025-snapshot-revision.md, ../decisions/0040-bot-ingress-registry-in-nats-kv.md, ../decisions/0043-phase0-body-state-in-nats-kv-and-record-rules.md, ../decisions/0083-c1-body-and-mind-image-contents.md, ../decisions/0154-perception-owner-rulings.md, ../decisions/0156-agent-viewport-image.md, ../decisions/0212-golem-body-is-a-profile-adam.md, ../decisions/0261-open-signup-player-host-bodies-and-auto-roster.md]
---

# Golem (the Body)

`golem/` (package `@geldar/golem`) is the Body: the Minecraft bot client that logs into the shard as a player, carries out the Mind's plans, runs reflexes, perceives the world, and records what it did. It also holds the body benchmark and Adam's Body process. This page lists its modules, entry points, interfaces, configuration names, build, tests and benchmark.

For why the Body and the Mind are split, see the [body and mind](../concepts/body-and-mind.md) explanation. For the Mind side of the channel, see [player-core](player-core.md) and [animus-mind](animus-mind.md). For the package's own operating notes (life registry, checkpoints, the `players` command), see [golem/README.md](../../golem/README.md).

## How this page was measured

- Commit `1b114276`, 2026-11-16 (UTC). Read-only: no shard, node or database was touched.
- Module purposes come from each file's header comment. Where a header and the code disagree, the conflict is listed in [Conflicts recorded](#conflicts-recorded).
- Re-derive the counts below from the repo root:

```powershell
(git ls-files golem).Count                                                    # tracked files
(git ls-files golem | Select-String '\.test\.ts$' | Select-String -NotMatch '\.live\.test\.ts$').Count   # unit test files
(git ls-files golem | Select-String '\.live\.test\.ts$').Count                # live test files
git ls-files golem/src | ForEach-Object { ($_ -split '/')[2] } | Group-Object | Select-Object Count, Name  # files per folder
```

| Count (2026-11-16, `1b114276`) | Value |
|---|---|
| Tracked files under `golem/` | 654 |
| Unit test files (`*.test.ts`, not live) | 322 |
| Live test files (`test/live/*.live.test.ts`) | 25 |

## Package

| Field | Value | Evidence |
|---|---|---|
| Name | `@geldar/golem`, private | `golem/package.json` |
| Scripts | `typecheck`, `bench` (`node src/bench/cli.ts`), `test:live` (`vitest run --config vitest.live.config.ts`) | `golem/package.json` |
| Workspace dependencies | `@geldar/contract`, `@geldar/psyche` | `golem/package.json` |
| Runtime libraries | `mineflayer` 4.39.0, `mineflayer-pathfinder` 2.4.5, `minecraft-data` 3.117.0, `vec3` 0.1.10, `@nats-io/jetstream`, `@nats-io/kv` and `@nats-io/transport-node` 3.4.0, `pg` 8.23.1, `yaml` 2.9.1 | `golem/package.json` (exact pins) |
| Only `pg` importer | `golem/src/players/managed-pg.ts` | its header comment |
| README | Yes | `golem/README.md` |

## Entry points

Each row is a file Node runs directly (Node 22 runs the `.ts` sources; there is no compile step).

| Entry | What it runs | Started by | Evidence |
|---|---|---|---|
| `src/adam/main.ts` | Adam's Body: connects through the connection manager (which registers the life id first), starts the Body, supervises it, and runs the wedge watchdog | Image `ENTRYPOINT`; compose service `golem-body` (profile `adam`); `./geldar.ps1 adam` on a desktop | `golem/Dockerfile`; `compose/colo.yml`; decisions [0050](../decisions/0050-phase0-mind-processes-run-on-the-host.md), [0212](../decisions/0212-golem-body-is-a-profile-adam.md) |
| `src/players/main.ts --player <player-id>` | One sovereign player's Body, driven by that life's presence record | `./geldar.ps1 players`; compose service `players-host` (profile `sovereign`) | `golem/README.md`; `compose/colo.yml` |
| `src/players/managed-main.ts` | One managed agent's Body in its own container; identity from the database | The body helper's `start` verb | `body-helper/src/managed-template.ts` (`MANAGED_ENTRYPOINT`) |
| `src/admit-life.ts` | One-shot: adds or removes one life id on Paper's whitelist (`GELDAR_ADMIT_MODE`) | The body helper, around a managed start and stop | its header; `body-helper/src/managed-template.ts` |
| `src/bench/cli.ts` | The body benchmark | `./geldar.ps1 bench` | `geldar.ps1` (`Invoke-Bench`) |
| `src/bench/sheet/cli.ts`, `src/bench/sheet/life-cli.ts` | Sheet-campaign driver helpers: a guard, and one scripted life over core NATS with no model | `bench/sheet/run.sh` | their headers; `bench/sheet/run.sh` |
| `src/publish-maintenance-notice.ts` | Publishes one maintenance notice on `geldar.<shard>.maintenance` | `deploy/colo-notice.sh` through the admin container | its header |
| `src/whitelist-house-body.ts` | Whitelists the Colo house Body on Paper over RCON before it joins | The admin container | its header |
| `src/ensure-skins-bucket.ts` | Creates the `geldar-skins` KV bucket when missing | The admin container, once per deploy | its header |

The image `golem/Dockerfile` (two stages on a digest-pinned `node:22.23.2-trixie-slim`, `--frozen-lockfile --prod --ignore-scripts`, user `1000:1000`) is the same image for every Body entry above; compose and the helper override the entry point. Decision [0083](../decisions/0083-c1-body-and-mind-image-contents.md) sets its contents.

The word "supervisor" has two meanings near the Body. `BodySupervisor` (`golem/src/adam/main.ts`) is the in-process loop that restarts a Body with backoff. The `supervisor/` package is the shard service that answers owners' body control requests; see [supervisor-and-body-helper](supervisor-and-body-helper.md).

## Source folders

| Folder | Files (non-test) | Purpose | Key decisions |
|---|---|---|---|
| `src/actions/` | 84 | The verb handlers, the action registry and receipts | 0154, 0192, 0218, 0330, 0333 |
| `src/body/` | 80 | The Body runtime: executor, intents, programs, reflexes, wake conditions, records, checkpoints, restart | [0025](../decisions/0025-snapshot-revision.md), [0043](../decisions/0043-phase0-body-state-in-nats-kv-and-record-rules.md), 0148 |
| `src/perception/` | 35 | What the agent may know: surroundings, self, entities, recipes, sounds, the text viewport | [0154](../decisions/0154-perception-owner-rulings.md) |
| `src/mind-link/` | 7 | The Body's end of the Body-Mind channel: snapshot and plan service, revision counter, recent-events digest, senses | 0025 |
| `src/voice/` | 5 | Chat: what the Body hears, speaks and publishes as `speech` | spec 5.8 |
| `src/books/` | 2 | Reads written books the Body carries; serves the book subject | 0044 |
| `src/viewport/` | 6 | Software renderer: a PNG of what the Body can see | [0156](../decisions/0156-agent-viewport-image.md) |
| `src/body-image/` | 10 | Serves view images: size caps, a per-Body image budget, a worker thread | 0156 |
| `src/character/` | 6 | Character sheet use in the Body: threat policy, proficiency cache, audit events | 0186, 0280, [0281](../decisions/0281-psyche-package-boundary.md) |
| `src/players/` | 10 | Player hosts: sovereign (`main.ts`) and managed (`managed-main.ts`), presence, whitelist, life removal | 0052, 0260, [0261](../decisions/0261-open-signup-player-host-bodies-and-auto-roster.md) |
| `src/adam/` | 4 | Adam's Body process, its config and the wedge watchdog | 0050, 0051 |
| `src/bench/` | 24 | The body benchmark and the sheet-campaign helpers | 0038 |
| `src/` (top level) | 21 | Connection manager, config, life registry, RCON, snapshot builder, world clock, backoff, metrics, credentials, test control | 0040 |

Non-test counts: `git ls-files golem/src/<folder> | Select-String -NotMatch '\.test\.ts$'` (fakes and fixtures included), 2026-11-16 at `1b114276`.

## Actions

The Mind names a verb in `do`. `runAction` (`golem/src/actions/registry.ts`) validates the action against the contract (`validateThought`), finds its handler, wakes the bot first unless the verb is `sleep`, `wait` or `note`, runs the handler under a wall-clock timeout multiplied by `timeScale` (`20 / target TPS`), and returns the record state and result. A failed or cancelled action writes one `action_failed` JSON line to the Body log; repeats within 2 s are counted, not logged.

### Registered verbs

`createRegistry()` in `golem/src/actions/index.ts` registers 18 handlers. Re-derive: `Select-String "timeoutMs:" golem/src/actions/*.ts` and the `allActions` array.

| Verb | Handler file | Timeout at 20 TPS | Receipt checked |
|---|---|---|---|
| `goto` | `goto.ts` | 120 s | yes |
| `mine` | `mine.ts` | 600 s | yes |
| `craft` | `craft.ts` | 60 s | yes |
| `place` | `place.ts` | 30 s | yes |
| `eat` | `eat.ts` | 20 s | yes |
| `sleep` | `sleep.ts` | 40 s | yes |
| `open` | `container.ts` | 30 s | yes |
| `deposit` | `container.ts` | 30 s | yes |
| `withdraw` | `container.ts` | 30 s | yes |
| `attack` | `attack.ts` | 30 s | yes |
| `wait` | `wait.ts` | 605 s (`MAX_WAIT_SECONDS` 600 + 5) | no |
| `unstick` | `unstick.ts` | 30 s (`ACTION_LIMIT_S` in `unstick-up.ts`) | yes |
| `give` | `give.ts` | 30 s | yes |
| `note` | `note.ts` | 2 s | no |
| `write_sign` | `write-sign.ts` | 40 s | yes |
| `till` | `till.ts` | 30 s | no |
| `edit_sign` | `edit-sign.ts` | 15 s | no |
| `use` | `use.ts` | 30 s | no |

"Receipt checked" is the `CHECKED` set in `golem/src/actions/effect.ts`: for those verbs, a `completed` outcome is compared with a snapshot taken before and after (position, inventory, target blocks, food, bed, target health), and an action that changed nothing fails with `no_effect`. The runtime turns receipts on by default (`receipts` defaults to `true` in `golem/src/body/runtime.ts`); the benchmark bypasses the executor and does not check them (`golem/src/bench/scenarios/chest.ts`).

The Mind may send exactly these 18 verbs: `PHASE0_VERBS` in `player-core/src/validate/bounds.ts` holds the same list.

### Contract verbs with no handler

`contract/schemas/thought.schema.json` names 26 verbs. The eight with no handler are `build`, `define_skill`, `offer`, `propose`, `read_book`, `use_skill`, `vote` and `write_book`. `runAction` answers them `unsupported` (`no handler for <verb>`). Re-derive: `Select-String '"const": "[a-z_]+"' contract/schemas/thought.schema.json` near each `"do"`.

### Outcome and failure reasons

`golem/src/actions/outcome.ts` defines the stored result (`status`, `reason`, `message`, `latency_ms`, `world_ticks`, `detail`) and these failure reasons: `invalid_args`, `timeout`, `blocked`, `not_found`, `out_of_reach`, `missing_materials`, `missing_station`, `needs_rescue`, `not_possible`, `interrupted`, `unsupported`, `busy`, `no_effect`, `internal`. The raw library error stays in the Body log and never enters the result.

Failure text is read by agents. `golem/src/actions/failure-texts.test.ts` scans it (see the [agent-read paths](../agents/documentation-style.md#paths-an-agent-reads)). Never link an operator document from it.

## The Body runtime (`src/body`)

`createBody` (`golem/src/body/create-body.ts`) wires one Body for one life. `restartBody` (`golem/src/body/restart.ts`) is the entry after a start or crash. The behaviour is described in [golem/README.md](../../golem/README.md#the-body-srcbody); this table lists the parts.

| Part | File | What it holds |
|---|---|---|
| Executor | `executor.ts`, `executor-*.ts` | Checks plan validity, runs at most 6 immediate actions in order (`MAX_ACTIONS`, `executor-types.ts`), the first failure stops the list, then installs one durable intent |
| Validity | `validity.ts` | Why a plan is refused (other life, stale `body_generation`, stale snapshot revision, expiry) |
| Runtime | `runtime.ts` | The world-tick loop (20 Hz client physics), reflexes, receipts switch |
| Programs | `programs/` | Durable intents: `travel`, `gather`, `craft`, `build`, `rest`, `flee`, `follow`, `explore`, `farm`, `patrol` (the last three registered by AN-45a, named by no body-api version yet); `trade_wait` is registered and refuses with `unsupported` (`programs/index.ts`) |
| Reflexes | `reflexes/`, `reflex-config.ts` | See the next table |
| Wake | `wake.ts`, `wake-conditions.ts` | Why the Body asks the Mind for a thought: the contract's `wake_on` set plus four reasons the Body raises itself |
| Records | `records.ts`, `records-nats.ts` | The record sink; `intent`, `action`, `receipt` go to JetStream with a de-duplication id |
| Checkpoint | `checkpoint.ts` | KV bucket `geldar-checkpoints`, keyed by life id |
| Generation | `generation.ts` | KV bucket `geldar-body-generation`, compare-and-swap |
| Block owners | `block-owners.ts`, `ownership-counters.ts` | Cache over `geldar.<shard>.blockowner.query` and `.changed` (decision 0165) |
| Event stamp | `stamped-publisher.ts` | Stamps each published event with the run's harness and model |

### Reflexes

`REFLEX_NAMES` in `golem/src/body/reflex-config.ts`, in spec 5.2 table order. Each has one boolean flag under `reflexes:` in `shards/*.yaml`; `enabled: false` turns all off; an omitted flag is `true`; an unknown key or a non-boolean value throws. Every firing is recorded as `reflex_fired` (decision 0148).

| Name | File |
|---|---|
| `eat` | `reflexes/eat.ts` |
| `retreat` | `reflexes/retreat.ts` |
| `hazard_escape` | `reflexes/hazard-escape.ts` |
| `fall_stop` | `reflexes/fall-stop.ts` |
| `fight_or_flee` | `reflexes/fight-or-flee.ts` (uses the psyche threat policy through `src/character/runtime.ts`) |
| `blocked_path` | `reflexes/blocked-path.ts` |
| `panic_burrow` | `reflexes/panic-burrow.ts` |
| `dark_shelter` | `reflexes/shelter.ts` |
| `unstick` | `reflexes/unstick.ts` |
| `idle_stuck` | `reflexes/idle-stuck.ts` (decisions 0330, 0333) |

## Perception (`src/perception`)

`createPerception(bot)` (`golem/src/perception/index.ts`) builds the surroundings the agent is allowed to know from what its eyes reach; nothing the Body has not seen is reported, and counts include only cells in line of sight (decision 0154, ruling 5). Probes are composed in order from `self/index.ts` and `surroundings/index.ts`, one file per feature.

| Group | Files |
|---|---|
| Self | `self/light-regen.ts`, `self/self-flags.ts`, `self/sky-ground.ts`, `footing.ts`, `health-trend.ts`, `item-wear.ts` |
| Surroundings | `surroundings/food-known.ts`, `surroundings/hazards.ts`, `nearby-counts.ts`, `notable-blocks.ts`, `blocks-summary.ts` |
| Placeholders | `surroundings/containers.ts`, `surroundings/reach.ts`, `surroundings/threat-sight.ts`: each returns `{}` at `1b114276` (7 lines each; headers say "Empty until that card fills it") |
| Entities | `entities.ts`, `hostile-types.ts` (decision 0154 ruling 1), `visible-agent.ts` |
| Memory | `remembered.ts`, `remembered-containers.ts`, `food-memory.ts` |
| Recipes | `recipes.ts` (the unlocked recipes, capped per snapshot) |
| Events | `hurt.ts`, `hurt-trigger.ts`, `hurt-log.ts` (`hurt`), `sounds.ts`, `heard-sound-event.ts` (`heard_sound`) |
| Text viewport | `view/viewport.ts`, `view/viewport-text.ts`, `view/view-from-bot.ts` (the `view` request) |

The snapshot itself is built in `golem/src/snapshot.ts` and served through `src/mind-link/`.

## Interfaces

### NATS subjects the Body serves

Builders live in `contract/src/subjects.ts`; the full list is the [nats-subjects](nats-subjects.md) reference. Re-derive the Body's use: `git grep -lE 'snapshotSubject|planSubject|bookSubject|viewImageSubject|viewSubject' -- golem/src`.

| Subject | Pattern | Served by | Reply |
|---|---|---|---|
| Snapshot | `geldar.<shard>.body.<life_id>.snapshot` | `src/mind-link/server.ts` | `Snapshot` |
| Plan | `geldar.<shard>.body.<life_id>.plan` | `src/mind-link/server.ts` | `PlanAck` |
| View | `geldar.<shard>.body.<life_id>.view` | `src/mind-link/server.ts` | `ViewResult` or `{"error":"unavailable"}` |
| Image | `geldar.<shard>.body.<life_id>.image` | `src/body-image/image-serve.ts` | base64 PNG and caption, or `view_unavailable` |
| Book | `geldar.<shard>.body.<life_id>.book` | `src/books/book-server.ts` | `BookReply` |

These five-token subjects are outside the event stream's `geldar.*.*` filter (`contract/src/subjects.ts` header).

### Other subjects

| Subject | Body's role | Evidence |
|---|---|---|
| `geldar.<shard>.state.<life_id>.proficiency` | Requests the life's proficiency state from the event sink (request and reply). Started only for a `config` character sheet. | `stateSubject` in `src/character/proficiency-cache.ts` (decision 0280; builds the name itself rather than calling `proficiencyRequestSubject` in `contract/src/subjects.ts`); `startProficiency` in `src/adam/main.ts` |
| `geldar.<shard>.state.<life_id>.level` | Subscribes to level pushes from the event sink, same condition. | same; `proficiencyPushSubject` in `contract/src/subjects.ts` |
| `geldar.<shard>.body.<life_id>.hearing` | None found: Geldar-Core publishes muffled-hearing notices here, and no code in `golem/src` subscribes (`git grep -n -i "hearing\|heard_muffled" -- golem/src`, 2026-11-16, finds only the sound-band constant). | `hearingSubject` in `contract/src/subjects.ts`; [Geldar-Core](geldar-core-plugin.md#nats-subjects) |

### Events the Body publishes

Events go to JetStream as `geldar.<shard>.<type>`. Re-derive: `git grep -n "type: '<type>'" -- golem/src`.

| Type | Emitted in |
|---|---|
| `intent`, `action`, `receipt` | `src/body/records-nats.ts` (audit records; retried, see [golem/README.md](../../golem/README.md#the-body-srcbody)) |
| `reflex_fired`, `wake` | `src/body/records-nats.ts`; digest in `src/mind-link/recent-events.ts` |
| `plan_result` | `src/mind-link/server.ts` |
| `speech` | `src/voice/speech-event.ts` |
| `heard_sound` | `src/perception/heard-sound-event.ts` |
| `hurt` | `src/perception/hurt.ts` |
| `chunk_visited` | `src/body/evidence/chunk-visits.ts` |
| Character audit events | `src/character/audit-events.ts`, `audit-publisher.ts` |

### KV buckets

| Bucket | Constant | Role |
|---|---|---|
| `geldar-life-registry` | `REGISTRY_BUCKET`, `src/registry.ts` | Usernames the Velocity gate admits; Golem is the registrar (decision [0040](../decisions/0040-bot-ingress-registry-in-nats-kv.md)) |
| `geldar-checkpoints` | `CHECKPOINT_BUCKET`, `src/body/checkpoint.ts` | Running intent per life (decision [0043](../decisions/0043-phase0-body-state-in-nats-kv-and-record-rules.md)) |
| `geldar-body-generation` | `GENERATION_BUCKET`, `src/body/generation.ts` | `body_generation` per life |
| `geldar-skins` | `SKINS_BUCKET`, `src/ensure-skins-bucket.ts` | Created by Golem; read by the Velocity plugin |
| `geldar-presence` | `PRESENCE_BUCKET`, `contract/src/subjects.ts` | Read by the player hosts (`src/players/presence.ts`); written by the MCP server |

## Configuration

The Body reads its shard file (`shards/<shard>.yaml`) and environment names. The values and the full schema are in the [shard-config](shard-config.md) and [environment-variables](environment-variables.md) references. Names only here; re-derive with `git grep -ohE '\bGELDAR_[A-Z_]+' -- golem/src ':!*.test.ts' | Sort-Object -Unique`.

| Name | Read in |
|---|---|
| `GELDAR_MC_HOST`, `GELDAR_MC_PORT` | `src/config.ts` (Golem talks to the Velocity ingress, never to Paper) |
| `GELDAR_NATS_URL` | `src/config.ts`, `connection.ts`, `registry.ts`, `ensure-skins-bucket.ts`, `publish-maintenance-notice.ts` |
| `GELDAR_NATS_USER`, `GELDAR_NATS_PASSWORD_FILE` | `src/nats-credentials.ts` (user `body` by default: the `GOLEM_NATS_ROLE` constant, line 11, not an environment name) |
| `GELDAR_RCON_HOST`, `GELDAR_RCON_PORT`, `GELDAR_RCON_PASSWORD_FILE` | `src/config.ts`, `admit-life.ts` |
| `GELDAR_IN_NETWORK_HOSTS` | `src/config.ts`, `body/restart.ts` (allows compose service names; decision 0131) |
| `GELDAR_SHARD`, `GELDAR_SHARD_FILE` | `src/adam/adam-config.ts`, `players/main.ts`, `players/managed-main.ts`, `whitelist-house-body.ts` |
| `GELDAR_LIFE_ID`, `GELDAR_LOGIN_NAME`, `GELDAR_PG_HOST`, `GELDAR_PG_PORT`, `GELDAR_PG_DATABASE`, `GELDAR_PG_USER`, `GELDAR_PG_PASSWORD_FILE` | `src/players/managed-main.ts` |
| `GELDAR_ADMIT_LIFE_ID`, `GELDAR_ADMIT_MODE` | `src/admit-life.ts` |
| `GELDAR_BODY_WATCHDOG_MS` | `src/adam/main.ts`, `players/main.ts`, `players/managed-main.ts` |
| `GELDAR_NOTICE_SHARD` | `src/publish-maintenance-notice.ts` |
| `GELDAR_TELEMETRY_URL` | `src/adam/main.ts`, `metrics.ts` (see the operations docs) |

Secrets reach the Body only as file paths (`*_FILE` names); the image sets none (`golem/Dockerfile` comment).

## Build and test

| Task | Command | Evidence |
|---|---|---|
| Typecheck | `./geldar.ps1 pnpm --filter @geldar/golem typecheck` | `golem/package.json` |
| Unit tests | `./geldar.ps1 pnpm test golem` (the root Vitest run; live files excluded) | `vitest.config.ts`; `golem/src/live-lane.test.ts` keeps the exclusion |
| Live tests | `./geldar.ps1 pnpm --filter @geldar/golem test:live` | `golem/vitest.live.config.ts`; `CLAUDE.md` |
| Image | `docker build -f golem/Dockerfile .` from the repo root; CI job `body` in `.github/workflows/colo-images.yml` | `golem/Dockerfile` header |

### Live-test lane

The rules the live lane runs under, from `CLAUDE.md`, `golem/README.md` and `golem/vitest.live.config.ts`. The steps to run it are in `CLAUDE.md` ("Commands") and `golem/README.md`.

| Rule | Detail | Evidence |
|---|---|---|
| Needs | A running Phase 0 shard with both plugin jars built. Excluded from `./geldar.ps1 check` and CI. | `CLAUDE.md` |
| Exclusive | It mutates the shard (tick rate, whitelist, world): no benchmark, Adam run or second live run at the same time. | `CLAUDE.md` |
| Ordering and timeouts | `fileParallelism: false`; test timeout 180 s, hook timeout 120 s. | `golem/vitest.live.config.ts` |
| Own stack | Live cases start their own Mind and Body; `./geldar.ps1 adam up` holds port 7410 (the Thinker socket), so it must not be running. | `CLAUDE.md` |
| Model | The Mind live cases (`test/live/adam-*.live.test.ts`) run the 8B life only and fail at once unless the shard file selects it (`adam select --model fast`). | `animus/README.md` |
| World state | A case that depends on world state starts with `resetBot` from `golem/test/live/fixture.ts` and calls its restore function in `finally`. | `fixture.ts` |
| NATS default | The live fixture and the bench default `GELDAR_NATS_URL` to `nats://127.0.0.1:4222` when it is unset, because the Phase 0 stack enforces the ingress gate. | `CLAUDE.md` |
| Arenas | Slot n is a 31 by 31 platform at y 199 centred on x = 800 + 64n, z = 800. | `golem/src/arena.ts` |

## Body benchmark

The harness is `golem/src/bench/`; the procedure is the [`body-bench` skill](../../.claude/skills/body-bench/SKILL.md).

| Item | Value | Evidence |
|---|---|---|
| Command | `./geldar.ps1 bench [args]` (runs `pnpm --dir golem run bench`) | `geldar.ps1` |
| Flags | `--scenario <name\|all>`, `--tps <1-20>` (repeatable), `--runs <1-100>`, `--max-minutes <n>`, `--record`, `--allow-dirty`, `--note <text>`, `--dry-run`, `--list`, `--restore` | usage line in `golem/src/bench/cli.ts` |
| Default rates | 20, 10 and 5 TPS (`DEFAULT_TPS`) | `golem/src/bench/cli.ts` |
| Scenarios in `all` | `wood-to-stone-tools`, `food`, `shelter`, `bed`, `chest`, `blocked-path` | `golem/src/bench/scenarios/index.ts` |
| Hidden scenarios | `goto-smoke`, and the `bedClear` variant | `scenarios/goto-smoke.ts`, `scenarios/bed.ts` |
| Output | `bench-results/<name>.json` under the repo root (gitignored); `--record` also copies it to `docs/analysis/phase0/bench-runs/` and appends rows to `docs/analysis/phase0/bench-results.md` | `golem/src/bench/results.ts` |

The benchmark sets the tick rate over RCON and restores 20 TPS when it ends (skill). Recorded results live in `docs/analysis/phase0/bench-results.md`; this page copies no figures from it.

## Deploy, operate and retire

| Stage | Where |
|---|---|
| Colo services | `golem-body` (profile `adam`, never started by the CD, decision [0212](../decisions/0212-golem-body-is-a-profile-adam.md)) and `players-host` (profile `sovereign`) in `compose/colo.yml`; budget 1 CPU, 2048m, 256 pids per the compose comments. See [compose-stacks](compose-stacks.md). |
| Managed Bodies | Containers built by the body helper; see [supervisor-and-body-helper](supervisor-and-body-helper.md). |
| Restart | `restartBody` resumes a saved intent or idles with a reason (`no_checkpoint`, `checkpoint_unreadable`, `other_life`, `expired`, `unknown_program`, `resume_failed`, `tick_unknown`) and raises a `no_plan` wake after 45 s ([golem/README.md](../../golem/README.md#checkpoints-and-restarts-restartbody)). |
| Retirement | `src/players/life-removal.ts` removes the life registry key over NATS, then the whitelist entry over RCON; called by `players down`, `adam stop` and `mcp-tokens retire`. |
| Failure modes | The [failure-modes](../operations/failure-modes.md) table. |

## Conflicts recorded

Recorded, not resolved (persona rule 8). Each needs a code-side comment fix or a decision; this page does not choose.

1. **`build` program.** `golem/src/body/programs/index.ts` said the registry had "the six built-in programs, plus `build` and `trade_wait` which refuse with `unsupported`" (AN-45a rewrote it to count the ten registered programs, with `trade_wait` the only refusal). The function registers `BuildProgram` for `build`, and `UNSUPPORTED_PROGRAMS` holds only `trade_wait`. In `player-core/src/validate/bounds.ts` the comment says `build` is refused while `PHASE0_PROGRAMS` includes `build`.
2. **`till` contract.** `golem/src/actions/index.ts` marks the till block "contract PR pending: see till.ts". `contract/schemas/thought.schema.json` at `1b114276` already names `till`.
3. **Viewport wiring.** `golem/src/viewport/index.ts` says the renderer is "Not wired into any tool yet". `golem/src/body-image/image-serve.ts` serves it on `geldar.<shard>.body.<life_id>.image` (VP-2).
4. **Managed Body entry point.** Decision [0261](../decisions/0261-open-signup-player-host-bodies-and-auto-roster.md) point 2 says a managed Body runs `golem/src/players/main.ts` with `player-config.ts`. The code runs `golem/src/players/managed-main.ts` (`MANAGED_ENTRYPOINT` in `body-helper/src/managed-template.ts`), whose header cites decisions 0260 and 0261.

## See also

- [player-core](player-core.md): the Mind's end of the same channel and the verb allow-list.
- [psyche-engine](psyche-engine.md): the threat policy and rolls the Body uses.
- [supervisor-and-body-helper](supervisor-and-body-helper.md): who starts managed Bodies.
- [contract-schemas](contract-schemas.md): `thought`, `plan`, `snapshot`, `receipt` schemas.
- [prompt-templates](prompt-templates.md) (agents-never): the body-api template that describes these verbs to the model.
