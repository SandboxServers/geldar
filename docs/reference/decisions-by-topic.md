---
title: Decisions by topic
type: reference
audience: contributors
status: draft
last_verified: 2026-11-16 against dc07e3fa
companions: [README.md, components.md, ../decisions/README.md, ../agents/documentation-style.md, ../analysis/docs-library/plan.md]
sources: [docs/decisions, docs/decisions/README.md, docs/reference/components.md, docs/analysis/docs-library/plan.md]
---

# Decisions by topic

Every decision record under `docs/decisions/`, one row each, grouped by the component it mostly governs. Use it to find the decisions behind a component before you change it. The [decisions index](../decisions/README.md) lists the same records in number order; this page regroups them and adds no facts of its own beyond the component and topic assignment.

The 27 components and their names come from [components](components.md#component-list). Plan row H06 ([plan.md](../analysis/docs-library/plan.md)) scopes this page.

Some rows name decisions about observation and telemetry. They are listed by title only (plan decision D9; decision [0361](../decisions/0361-agents-never-placement-and-public-detail.md), point 3). Never copy or link this page into anything an agent in the world reads ([documentation style](../agents/documentation-style.md#agents-never-learn-they-are-watched)).

## Contents

- [How this page was built](#how-this-page-was-built)
- [Completeness check](#completeness-check)
- [Assignments that were a judgment call](#assignments-that-were-a-judgment-call)
- [Decisions by primary component](#decisions-by-primary-component): [Contract](#contract), [Golem (Body)](#golem-body), [Body benchmark](#body-benchmark), [Animus (Mind)](#animus-mind), [player-core](#player-core), [Psyche](#psyche), [Threshold MCP](#threshold-mcp), [MCP mock](#mcp-mock), [Register](#register), [Glass and Kino](#glass-and-kino), [Eventsink](#eventsink), [lantern-local](#lantern-local), [Supervisor](#supervisor), [Body helper](#body-helper), [Geldar-Core plugin](#geldar-core-plugin), [Velocity identity plugin](#velocity-identity-plugin), [Third-party plugins](#third-party-plugins), [Compose, shards and envs](#compose-shards-and-envs), [Deploy](#deploy), [Admin service](#admin-service), [Database](#database), [Prompts](#prompts), [Tools](#tools), [CI and repo checks](#ci-and-repo-checks), [Telemetry](#telemetry), [Sheet driver](#sheet-driver), [Docs library](#docs-library)
- [Decisions that fit no component](#decisions-that-fit-no-component)
- [Component to decisions](#component-to-decisions)
- [Gaps this page records](#gaps-this-page-records)

## How this page was built

Measured on 2026-11-16 at 09:37 UTC at commit `db33805c`, and re-checked at `dc07e3fa` (which changes only `docs/security/`). `git ls-files docs/decisions` lists 187 records (numbers 0001 to 0352, with gaps, plus 0360 to 0366) and the index `README.md`.

| Column | What it holds | Source |
|---|---|---|
| # | Record number, linked to the record | File name |
| Short title | The record's own first heading, without the number. The index row often says more; this page uses the heading because it is the shortest form the record gives | Record, line 1 |
| Status (record) | The record's `Status:` line, not the index's. See the rule below | Record |
| Primary | The one component the record mostly governs, from [components](components.md#component-list), or "none" | Judgment; see below |
| Secondary | Other components the record changes or constrains, or "-" | Judgment |
| Topics | Short tags. A row marked "(title only, D9)" is an observation or telemetry decision and gets one generic tag only | Judgment |

**Status rule.** Apply the first row that matches.

| Record status starts with | The Status cell shows |
|---|---|
| `Accepted in principle` (only 0135) | The line verbatim, because it also says the design is Proposed |
| `Accepted` (any case) | The leading words as written (`Accepted`, `accepted`, `Accepted provisionally`, `accepted in part`), plus any qualifier that limits the record: `accepted, temporary` (0149), `Accepted, chosen option B` (0352), `Accepted (one-time, not a routine)` (0339). Provenance (who ruled, when) is dropped; open the record for it |
| `Superseded by NNNN` | Those words only |
| Anything else (`Proposed`, `Decided`, `Open`) | The line verbatim |

In every row, three coordinator session labels are replaced by `[coordinator session]`, `[ops session]` and `[registration session]`, and an agent's account or character name by a role (style rule: no session labels or account names).

On 2026-11-16 the first word of every record status matched the first word of its index status (script in [re-derive](#re-derive-the-list)); no category conflict was found.

**How components were assigned.** Each record's heading and Status line were read. For 13 records whose heading did not settle it, the files the record names were checked with `Select-String` on 2026-11-16: 0024 (`compose/phase0.yml` sets the gamerules), 0029 (`golem/src/rcon.ts`), 0036, 0042 and 0046 (all three implemented in the Scriptorium sibling repo), 0083 (`golem/Dockerfile`, `animus/Dockerfile.mind`), 0089 (`owner add` and `shards/phase0.yaml`), 0101 (`plugin/core/.../lakitu/`), 0146, 0157, 0169 (`deploy/colo-admin.sh`, `compose/colo.yml`), 0185 (a new database table) and 0334 (`golem/src/perception/visible-agent.ts`). Where [components](components.md#lifecycle-design-to-build) already lists a record under a component's "Design and decisions", this page agrees with it unless the judgment-call list says otherwise.

### Re-derive the list

PowerShell 7, from the repo root, read-only. It prints one line per record: file, heading and Status line.

```powershell
foreach ($f in git ls-files docs/decisions | Where-Object { $_ -match '/\d{4}-' }) {
  $t = Get-Content $f -Raw
  $h = ([regex]::Match($t, '(?m)^# (.*)$').Groups[1].Value -split '- Status:')[0].Trim()
  $s = [regex]::Match($t, '(?m)^\s*(?:-\s*)?\**Status:?\**\s*(.*)$').Groups[1].Value
  if (-not $s) { $s = [regex]::Match($t, 'Status:\s*(.*?)- Date:').Groups[1].Value }
  "$(Split-Path $f -Leaf) | $h | $($s.Trim())"
}
```

The fallback on the fourth line is for record 0135, whose heading, status and date sit on one physical line ([gaps](#gaps-this-page-records), item 1). The status lines come in three shapes (`- Status:`, a bare `Status:`, and lowercase `accepted`); the pattern covers all three.

Status categories, record against index:

```powershell
$idx = @{}
Get-Content docs/decisions/README.md | ForEach-Object { if ($_ -match '^\|\s*\[(\d{4})\]') { $idx[$Matches[1]] = ($_ -split '\|')[-2].Trim() } }
$idx.Count   # index rows; 187 on 2026-11-16
```

Compare the first word of each index status with the record's line from the first block.

## Completeness check

Every record must have exactly one row in the component sections and the no-component section. Rows are the table lines that start `| [NNNN]`; the [component to decisions](#component-to-decisions) table lists numbers without links, so it is not counted.

```powershell
$records = git ls-files docs/decisions | ForEach-Object { if ($_ -match '/(\d{4})-') { $Matches[1] } }
$rows = Select-String -Path docs/reference/decisions-by-topic.md -Pattern '^\| \[(\d{4})\]' | ForEach-Object { $_.Matches[0].Groups[1].Value }
"records=$($records.Count) rows=$($rows.Count) unique=$(@($rows | Sort-Object -Unique).Count)"
Compare-Object $records @($rows | Sort-Object -Unique)
```

Result on 2026-11-16 at 09:37 UTC, `db33805c`, and again after the W5 review fixes at `dc07e3fa`: `records=187 rows=187 unique=187`, and `Compare-Object` printed nothing (every record has exactly one row, and every row is a record).

## Assignments that were a judgment call

Each is a fair reading; the other choice is named so a reader can find the record either way. Secondary columns carry the alternative.

| # | Primary chosen | Alternative | Why this one |
|---|---|---|---|
| 0002, 0028 | lantern-local | Animus (Mind) | Model tags and the Ollama host are the Thinker's side |
| 0006 | CI and repo checks | Tools | The toolchain is what CI runs; `geldar.ps1` alone is Tools (0003) |
| 0059 | Glass and Kino | Compose, shards and envs; no component | `identity_mode` is a shard setting, but it decides human observation; repo-checks has an `identity-mode` gate (components.md, Neighbours) |
| 0061 | Body benchmark | Animus (Mind); no component | Exit-criteria readings, and components.md ties the Phase 0 exit to the benchmark through 0066 |
| 0066 | Body benchmark | no component | components.md lists it under Body benchmark |
| 0083 | Golem (Body) | Animus (Mind); CI and repo checks | The record covers both images; the Body is named first and its test is in `golem/` |
| 0101 | Geldar-Core plugin | Glass and Kino | The code it governs is in `plugin/core` |
| 0130 | Deploy | Telemetry; CI and repo checks | Four rulings on four subjects; deploy is the first |
| 0146 | Geldar-Core plugin | Golem (Body) | Open questions on books, governance and plugin item consumption |
| 0157 | Golem (Body) | Geldar-Core plugin; Threshold MCP | Five rulings on five subjects |
| 0169 | Deploy | Admin service; Compose, shards and envs | It amends `deploy/colo-admin.sh` and `compose/colo.yml` |
| 0180 | Compose, shards and envs | Threshold MCP | The change is the shard key `sovereign.harnesses` |
| 0185 | Database | Telemetry | A new operator-only table; the Minds it serves live in a sibling repo |
| 0212 | Golem (Body) | Compose, shards and envs | components.md lists it under Golem |
| 0282 | Database | Psyche; Sheet driver | The erasure is a database function; components.md lists it under Sheet driver |
| 0364 | Velocity identity plugin | Compose, shards and envs | It records a gap against 0137, a Velocity decision |

## Decisions by primary component

### Contract

6 records.

| # | Short title (record heading) | Status (record) | Primary | Secondary | Topics |
|---|---|---|---|---|---|
| [0001](../decisions/0001-contract-json-schema.md) | The contract is JSON Schema with code generation | Accepted | Contract | Tools, CI and repo checks | contract, code generation |
| [0025](../decisions/0025-snapshot-revision.md) | Snapshots and action records carry a revision | Accepted | Contract | Golem (Body) | snapshots, records |
| [0035](../decisions/0035-mcp-tool-schema-shapes.md) | MCP tool schemas: a top-level `oneOf` in `write_book`, and results without a root `type` are not published as `outputSchema` | Accepted | Contract | Threshold MCP, MCP mock | MCP tools, schemas |
| [0143](../decisions/0143-outcome-events-extend-the-provisional-vocabulary.md) | Per-action outcome events extend the provisional event vocabulary | Proposed (owner confirmation pending) | Contract | Golem (Body) | events, actions |
| [0144](../decisions/0144-death-is-an-event-and-a-dated-fact-and-there-is-no-revive.md) | Death is a distinct event with a recorded time and cause, and there is no revive | Proposed (owner confirmation pending) | Contract | Golem (Body), Database | death, events |
| [0280](../decisions/0280-proficiency-contract-and-state-subjects.md) | Proficiency contract and state subjects | Accepted | Contract | Psyche, Golem (Body), Eventsink | proficiency, NATS |

### Golem (Body)

55 records.

| # | Short title (record heading) | Status (record) | Primary | Secondary | Topics |
|---|---|---|---|---|---|
| [0022](../decisions/0022-minecraft-26-1.md) | Minecraft 26.1 and the pinned body stack | Accepted | Golem (Body) | Compose, shards and envs | versions, Minecraft |
| [0029](../decisions/0029-rcon-reply-framing.md) | RCON replies end on a quiet period, not an empty packet | Accepted | Golem (Body) | - | RCON, tooling |
| [0030](../decisions/0030-world-time-ticks.md) | `world_time.ticks` is the world age; a biome the server does not name is omitted | Accepted | Golem (Body) | Contract | perception, world time |
| [0031](../decisions/0031-place-at-feet.md) | `place ... at: "feet"` means the cell the bot's feet are in | Accepted | Golem (Body) | - | actions |
| [0032](../decisions/0032-table-crafting-and-recipe-book.md) | Crafting on 26.1 goes through the recipe book, and the shard unlocks recipes | Accepted | Golem (Body) | Geldar-Core plugin | actions, crafting |
| [0037](../decisions/0037-chest-transfers-by-explicit-clicks.md) | Chest deposits and withdrawals are an explicit, server-confirmed click sequence | Accepted | Golem (Body) | - | actions, containers |
| [0038](../decisions/0038-tick-rate-does-not-slow-a-client-driven-body.md) | `/tick rate` does not slow a Mineflayer-driven Body, and the world clock has a 20-tick resolution | Accepted | Golem (Body) | Body benchmark | tick rate, world time |
| [0039](../decisions/0039-pathing-forbids-corner-cutting.md) | The Body's pathing forbids diagonal moves that cut a block corner | Accepted | Golem (Body) | Body benchmark | pathing |
| [0043](../decisions/0043-phase0-body-state-in-nats-kv-and-record-rules.md) | Phase 0 keeps Body checkpoints and generations in NATS KV; record rules for intents, audit records and receipts | Accepted | Golem (Body) | Contract, Database | NATS, records |
| [0083](../decisions/0083-c1-body-and-mind-image-contents.md) | Body and Mind image contents, base pins, and what is never baked in | Proposed | Golem (Body) | Animus (Mind), CI and repo checks | images, pins |
| [0141](../decisions/0141-soft-dig-pathing-for-natural-soft-blocks.md) | The Body's pathing may dig natural soft blocks, and nothing else | Superseded by 0164 | Golem (Body) | - | pathing |
| [0142](../decisions/0142-stall-and-replan-numbers.md) | A stalled move replans after about 60 ticks, up to 6 times, and follows partial paths | Proposed (owner confirmation pending) | Golem (Body) | - | pathing |
| [0145](../decisions/0145-agent-names-need-line-of-sight-and-proximity.md) | A target agent can be named only when seen and near | Accepted | Golem (Body) | Threshold MCP | perception, names |
| [0147](../decisions/0147-death-is-knowable-while-permadeath-is-off.md) | Death is knowable to the player while permadeath is off | accepted | Golem (Body) | Threshold MCP | death |
| [0148](../decisions/0148-reflexes-are-never-silent.md) | Reflexes are never silent | accepted in part | Golem (Body) | - | reflexes |
| [0151](../decisions/0151-bodies-run-only-in-the-colo.md) | Bodies run only in the Colo; there is no bring-your-own-body | Decided (owner ruling, 2026-11-11) | Golem (Body) | Threshold MCP | body hosting |
| [0154](../decisions/0154-perception-owner-rulings.md) | Perception rules: what the Mind and the Body may see and hear | Decided (owner rulings, 2026-11-11) | Golem (Body) | Animus (Mind), Threshold MCP | perception |
| [0156](../decisions/0156-agent-viewport-image.md) | Agent viewport image: the Body renders its own first-person view to a PNG | Proposed (spike result; owner decides) | Golem (Body) | Threshold MCP | perception, images |
| [0157](../decisions/0157-gray-item-rulings-2026-11-12.md) | Gray-item rulings, 2026-11-12 | Decided (owner) | Golem (Body) | Geldar-Core plugin, Threshold MCP | rulings, gravestones |
| [0160](../decisions/0160-place-at-feet-pillar-step.md) | `place <solid block> at: "feet"` is a pillar step | Accepted | Golem (Body) | - | actions |
| [0162](../decisions/0162-perception-vertical-reach-edible.md) | Perception gains vertical, in_reach, edible and crop ripeness | Accepted | Golem (Body) | Contract | perception |
| [0163](../decisions/0163-shelter-enclosed-counts-closed-doors.md) | A shelter is enclosed by blocks or a closed door | Accepted | Golem (Body) | - | shelter |
| [0164](../decisions/0164-goto-digs-and-builds-its-way.md) | goto digs and builds its own way, and never digs through someone else's work | Accepted | Golem (Body) | Geldar-Core plugin | pathing, ownership |
| [0167](../decisions/0167-till-action.md) | the `till` action turns dirt into farmland, open to agents | Accepted | Golem (Body) | Contract, Prompts | actions, farming |
| [0168](../decisions/0168-rotten-flesh-only-when-starving.md) | Rotten flesh may be eaten only when it is the only food and hunger is 6 or below | Accepted | Golem (Body) | - | food |
| [0182](../decisions/0182-eat-reflex-only-when-starving.md) | The eat reflex fires only when the Body is starving or badly hurt | Accepted | Golem (Body) | - | reflexes, food |
| [0183](../decisions/0183-unstick-safe-drops-and-hand-dig.md) | unstick takes safe drops at any health, and hand-digs any breakable block | Accepted | Golem (Body) | - | reflexes, unstick |
| [0184](../decisions/0184-drowning-reflex-and-water-goto.md) | The drowning reflex, the water exit and goto on water | Accepted | Golem (Body) | - | reflexes, water |
| [0190](../decisions/0190-body-batch2-give-reflex-backoff-sleep-budget.md) | Body batch 2: give steps back further, reflex backoff holds, sleep has a budget | Accepted | Golem (Body) | - | actions, reflexes, sleep |
| [0191](../decisions/0191-body-cancel-on-death-and-trace.md) | Cancel everything from the previous life on death; position and oxygen log lines (part 1) | Accepted | Golem (Body) | - | death, logs |
| [0192](../decisions/0192-edit-sign-action.md) | the `edit_sign` action edits the text of an existing sign | Proposed (implementer; the owner flips it to Accepted) | Golem (Body) | Contract | actions, signs |
| [0194](../decisions/0194-swimming.md) | swimming is a Body movement with an air budget; goto stops swimming at air 10 | Decided (owner approval via [coordinator session], 2026-11-14) | Golem (Body) | - | water, movement |
| [0196](../decisions/0196-idle-stuck-reflex.md) | idle_stuck reflex runs unstick for a ranger that cannot leave | Accepted | Golem (Body) | - | reflexes, unstick |
| [0210](../decisions/0210-unstick-call-budget-and-goto-escalation.md) | unstick spends one time budget per call; goto escalates to the escape ladder after identical replans | Accepted | Golem (Body) | - | unstick, pathing |
| [0212](../decisions/0212-golem-body-is-a-profile-adam.md) | golem-body (the idle Colo Adam) is a compose profile, and Paper sets players_sleeping_percentage 50 | Accepted | Golem (Body) | Compose, shards and envs | compose, Adam |
| [0213](../decisions/0213-night-reflexes-need-a-threat.md) | night reflexes need a threat; dark shelter ignores unknown light | Accepted | Golem (Body) | - | reflexes, night |
| [0214](../decisions/0214-rest-in-bed.md) | Rest in bed: reflexes are suspended while the Body sleeps | Accepted | Golem (Body) | - | sleep, reflexes |
| [0215](../decisions/0215-sleep-facts.md) | the sleep refusal names the hostile and its distance | Proposed | Golem (Body) | - | sleep |
| [0216](../decisions/0216-eat-choice.md) | The Body eats the food that fits the missing hunger | Proposed (implementer; owner to accept) | Golem (Body) | - | food |
| [0217](../decisions/0217-ownership-lookup-counters.md) | The Body counts its ownership lookups and logs the counts once a minute | Proposed (implementer; owner to accept) | Golem (Body) | Telemetry | diagnostics (title only, D9) |
| [0218](../decisions/0218-use-mount-dismount-verbs.md) | the `use`, `mount` and `dismount` actions let every agent click with an item and ride | Accepted | Golem (Body) | Contract | actions |
| [0219](../decisions/0219-decayed-farmland-is-not-ownership.md) | Decayed farmland is not ownership | Decided (owner ruling, 2026-11-14, [coordinator session]) | Golem (Body) | - | ownership, farming |
| [0224](../decisions/0224-sleep-failure-detail.md) | Sleep failures state the final position and the beds tried; the monsters refusal names the dwell | Proposed (implementer; owner to accept) | Golem (Body) | - | sleep |
| [0225](../decisions/0225-rest-stat-and-bed-refusals.md) | The Body logs the time since rest; the server's bed refusal lines become facts | Proposed (implementer; owner to accept) | Golem (Body) | - | sleep, logs |
| [0226](../decisions/0226-bed-census-in-sleep-failure.md) | The sleep failure states the beds in range and how many are occupied | Proposed (implementer; owner to accept) | Golem (Body) | - | sleep |
| [0330](../decisions/0330-boxed-in-on-own-blocks-unsticks-after-120s.md) | A Body boxed in on its own placed block unsticks after 120 s | Decided (owner ruling relayed by [coordinator session]) | Golem (Body) | - | unstick |
| [0331](../decisions/0331-phantoms-are-fought-in-place.md) | Phantoms are fought in place | Decided | Golem (Body) | - | combat |
| [0332](../decisions/0332-pillar-top-and-no-path-count-as-stuck.md) | A Body on its own pillar top that its walks cannot leave counts as stuck | Decided (owner direction via [coordinator session], Body survival fixes) | Golem (Body) | - | unstick |
| [0333](../decisions/0333-high-ledge-descend.md) | A Body on a high ledge with no safe exit is stuck, and unstick may dig down through natural blocks | Decided (owner-side rulings via [coordinator session]) | Golem (Body) | - | unstick |
| [0334](../decisions/0334-name-tolerance-among-visible-agents.md) | A loose name resolves only among the agents already in sight | Decided (owner-side ruling via [coordinator session]) | Golem (Body) | - | perception, names |
| [0335](../decisions/0335-phantom-diagnostics.md) | Phantom diagnostics (operator log only) | Decided (owner-side ruling via [coordinator session], diagnostics only) | Golem (Body) | Telemetry | diagnostics (title only, D9) |
| [0336](../decisions/0336-boxed-in-by-reachability.md) | A Body boxed in by reachability unsticks after 120 s | Decided (owner-side ruling via [coordinator session], with the conditions below) | Golem (Body) | - | unstick |
| [0337](../decisions/0337-drowning-mover-steers-sideways-when-pinned.md) | the drowning mover steers sideways when it is pinned | Decided (Body survival fix after a Body drowning). Part two (the earlier start, `DROWNING_START_AIR` 12) is decided by the owner ([coordinator session], "B in a measured form") and amends 0194; part one of [coordinator session] (the deep-water travel cost) is not in this record's commit and stays open. | Golem (Body) | - | water, reflexes |
| [0338](../decisions/0338-sleep-prefers-free-beds.md) | sleep tries the free beds first, and a time-limit stop is a timeout | Decided (owner-side ruling via [coordinator session], 2026-11-15; items 1 and 2 only) | Golem (Body) | - | sleep |
| [0341](../decisions/0341-sleep-skips-obstructed-beds.md) | sleep skips obstructed beds, remembers refusals, and caps each walk | Decided | Golem (Body) | - | sleep |

### Body benchmark

2 records.

| # | Short title (record heading) | Status (record) | Primary | Secondary | Topics |
|---|---|---|---|---|---|
| [0061](../decisions/0061-phase-0-exit-criteria-readings.md) | Readings of the Phase 0 exit criteria and the wave 6 owner questions | Accepted provisionally | Body benchmark | Animus (Mind), Tools, Glass and Kino | phases, exit criteria |
| [0066](../decisions/0066-phase0-closed-as-proof-of-life.md) | Phase 0 is closed as proof of life; the spec's exit runs are waived by the owner and deferred | Accepted | Body benchmark | Animus (Mind), lantern-local | phases |

### Animus (Mind)

10 records.

| # | Short title (record heading) | Status (record) | Primary | Secondary | Topics |
|---|---|---|---|---|---|
| [0047](../decisions/0047-thinking-time-comes-from-intents-and-waits-not-dilation.md) | Adam's thinking time comes from intents, waits and reflexes; time dilation is not a Phase 0 mechanism | Accepted | Animus (Mind) | Golem (Body) | Mind, time |
| [0050](../decisions/0050-phase0-mind-processes-run-on-the-host.md) | In Phase 0 the Mind, the local Thinker and Adam's Body run as host processes | Accepted | Animus (Mind) | lantern-local, Golem (Body) | phases, host |
| [0051](../decisions/0051-adam-identity-and-model-pins.md) | Adam's identity and the Phase 0 model pins | Accepted | Animus (Mind) | lantern-local | Adam, models |
| [0062](../decisions/0062-no-settled-credits-in-phase-0.md) | No settled-credits value reaches the reflection in Phase 0; E-8 is deferred | Accepted provisionally | Animus (Mind) | - | budgets, credits |
| [0063](../decisions/0063-phase-0-has-no-stuck-signal.md) | Phase 0 has no `stuck` signal; the exit runs measure whether intents complete | Accepted provisionally | Animus (Mind) | Golem (Body) | Mind, stuck |
| [0064](../decisions/0064-exit-run-lives.md) | The exit runs use fresh lives and fresh volumes; the smoke run has its own life | Accepted provisionally | Animus (Mind) | Tools | phases, exit runs |
| [0065](../decisions/0065-damage-wakes-the-mind.md) | Damage wakes the Mind when no intent is running; death still ends the life | Accepted provisionally | Animus (Mind) | Golem (Body) | wakes, damage |
| [0069](../decisions/0069-no-plan-wake-is-not-a-failure.md) | A no_plan wake with no intent is not a failed intent | Accepted | Animus (Mind) | Contract | wakes, events |
| [0078](../decisions/0078-mind-placement-for-phase1.md) | Mind placement for Phase 1 | Accepted | Animus (Mind) | lantern-local, Deploy | Mind placement |
| [0134](../decisions/0134-mind-is-a-profile-until-a-thinker-exists.md) | The Mind is a compose profile until a Thinker path exists | Accepted | Animus (Mind) | Compose, shards and envs | compose, Mind |

### player-core

No record has this component as primary. It is secondary in none.

### Psyche

2 records.

| # | Short title (record heading) | Status (record) | Primary | Secondary | Topics |
|---|---|---|---|---|---|
| [0186](../decisions/0186-character-sheet-assumed-answers.md) | Character sheet: the assumed answers to the geldar behavioural questions | Proposed. The answers are ASSUMED at their recommended values under the owner's delegation (scriptorium decision 78). Geldar accepts them for packet planning only. Nothing is switched on, and no sheet reaches a live player. | Psyche | Sheet driver | character sheet |
| [0281](../decisions/0281-psyche-package-boundary.md) | Psyche package boundary | Accepted | Psyche | - | package boundary |

### Threshold MCP

12 records.

| # | Short title (record heading) | Status (record) | Primary | Secondary | Topics |
|---|---|---|---|---|---|
| [0052](../decisions/0052-per-owner-sovereign-player-cap-raised-to-20.md) | The per-owner cap on sovereign players is raised to 20 for the owner; the real Geldar MCP is built alongside wave 6 | Accepted | Threshold MCP | - | sovereign players, caps |
| [0053](../decisions/0053-public-mcp-through-an-outbound-tunnel-deferred.md) | The sovereign MCP is loopback-only now; a public name through an outbound tunnel waits for the colo move | Superseded by 0071 | Threshold MCP | Deploy | public endpoints |
| [0054](../decisions/0054-static-hashed-per-player-bearer-tokens.md) | Sovereign MCP clients use static, hashed, per-player Bearer tokens, not OAuth 2.1 | Accepted | Threshold MCP | Tools, Database | auth, tokens |
| [0055](../decisions/0055-phase0-sovereign-tool-subset-and-mappings.md) | The Phase 0 sovereign MCP serves the frozen 14-tool vocabulary; six tools are not available and the action list is atomic | Accepted | Threshold MCP | MCP mock | MCP tools |
| [0057](../decisions/0057-sovereign-budget-numbers-and-wake-spacing.md) | Sovereign budget numbers, rate limits, wake spacing and presence timings for Phase 0 | Accepted | Threshold MCP | - | budgets, rate limits |
| [0079](../decisions/0079-credit-numbers-and-charge-rules.md) | Credit numbers and charge rules | Proposed (owner confirms the numbers and the charge rules) | Threshold MCP | Animus (Mind), Database | budgets, credits |
| [0090](../decisions/0090-public-mcp-contract.md) | Public MCP contract: client-address header, refusal shapes and the public config keys | Proposed (orchestrator, 2026-11-11; owner to confirm) | Threshold MCP | Contract | public endpoints, errors |
| [0091](../decisions/0091-public-mcp-behind-caddy.md) | Public MCP behind Caddy: trusted peer, the public block, kill switch, rate limit, negative cache, invitees | Proposed (orchestrator, 2026-11-11; owner to confirm) | Threshold MCP | Deploy | public endpoints, rate limits |
| [0095](../decisions/0095-look-projection-and-mcp-image.md) | look carries no internal ids and has in-world time; the MCP image holds only what it reads | Proposed (orchestrator, 2026-11-11; owner to confirm) | Threshold MCP | CI and repo checks | MCP tools, images |
| [0108](../decisions/0108-mcp-roster-source-of-truth.md) | The roster of sovereign player names lives in the database, and each name allows one agent by default | Proposed (for owner review; the code follows the proposal and is reversible by a later migration) | Threshold MCP | Database, Compose, shards and envs | sovereign players, roster |
| [0149](../decisions/0149-act-budget-suspended-and-metered.md) | The act budget is suspended and every act is metered | accepted, temporary | Threshold MCP | - | budgets |
| [0221](../decisions/0221-wait-result-deduplicates-static-sections.md) | wait returns unchanged recipe and notable-block lists once per session | Proposed (implementer; owner to accept) | Threshold MCP | - | MCP tools, wait |

### MCP mock

4 records.

| # | Short title (record heading) | Status (record) | Primary | Secondary | Topics |
|---|---|---|---|---|---|
| [0033](../decisions/0033-mock-wake-and-interest-vocabulary.md) | The mock's wake and interest vocabulary is provisional, and the character is woken only by wake_on conditions and long-poll events | Accepted | MCP mock | - | mock, wakes |
| [0034](../decisions/0034-mock-result-shapes-and-untrusted-text.md) | Mock result shapes: snapshots in results, the untrusted-text wrapper, and the waking event is never trimmed | Accepted | MCP mock | Threshold MCP | mock, untrusted text |
| [0044](../decisions/0044-malicious-book-corpus-world-side.md) | The malicious-book corpus: world side in the mock, hostile text stays untrusted, the model half is local | Accepted | MCP mock | - | untrusted text, books |
| [0045](../decisions/0045-live-malicious-book-check-is-local-only.md) | The live malicious-book check is local only; CI proves the deterministic half (D-SC-01) | Accepted | MCP mock | CI and repo checks | untrusted text, tests |

### Register

9 records.

| # | Short title (record heading) | Status (record) | Primary | Secondary | Topics |
|---|---|---|---|---|---|
| [0135](../decisions/0135-self-registration-with-github-and-discord.md) | Self-registration with GitHub and Discord sign-in, no manual approval | Accepted in principle (owner ruling, 2026-11-11: "GitHub and Discord, both; as long as their accounts are verified by the IdP I don't want to approve again"). The design details below are Proposed (orchestrator, 2026-11-11) for owner review. | Register | - | sign-up, auth |
| [0136](../decisions/0136-register-ban-procedure.md) | Banning a registered identity | accepted | Register | Tools | bans |
| [0150](../decisions/0150-register-loopback-port-18090.md) | The register service publishes on loopback port 18090 | Accepted | Register | Compose, shards and envs | ports |
| [0153](../decisions/0153-terms-consent-and-deletion-before-sign-up.md) | Terms, privacy, consent, account deletion and export are required before sign-up opens to outsiders | Decided (owner ruling, 2026-11-11); legal text drafted for owner review, not approved | Register | Docs library | legal, consent, erasure |
| [0170](../decisions/0170-owner-management-values-and-admin-flag.md) | Owner management values (token and key lifetimes, body quotas, log tail) and the admin flag | Decided (owner rulings, 2026-11-13) | Register | Supervisor | tokens, quotas, admin |
| [0172](../decisions/0172-human-skin-upload-held-for-approval.md) | Owners upload skins; every upload is held for operator approval before MineSkin signs it | Decided (owner ruling, 2026-11-13; replaces Q7 "deferred") | Register | Tools | skins |
| [0173](../decisions/0173-owner-keys-by-session-and-bearer-scope.md) | Owner keys are managed by cookie session, and the Bearer scope rule for API v1 | Decided (ruling recorded for C7-04b-3, 2026-11-13) | Register | - | owner API, keys |
| [0261](../decisions/0261-open-signup-player-host-bodies-and-auto-roster.md) | Open sign-up, player-host Bodies for sign-up agents, and auto-roster on registration | Decided (owner ruling, 2026-11-14) | Register | Golem (Body), Supervisor, Body helper | sign-up, body hosting, caps |
| [0262](../decisions/0262-account-deletion-erases-dead-lives-too.md) | Account deletion erases every life of the owner, dead or alive | Decided (owner ruling, 2026-11-15) | Register | Database | erasure |

### Glass and Kino

9 records.

| # | Short title (record heading) | Status (record) | Primary | Secondary | Topics |
|---|---|---|---|---|---|
| [0059](../decisions/0059-identity-mode-is-about-human-observation-not-agent-belief.md) | `identity_mode` governs whether humans may observe a shard; the agents are never told | Accepted | Glass and Kino | CI and repo checks, Compose, shards and envs | observation (title only, D9) |
| [0072](../decisions/0072-glass-and-bluemap-are-public.md) | Glass and BlueMap are public, read-only, and hardened before exposure | Accepted | Glass and Kino | Third-party plugins | observation (title only, D9) |
| [0075](../decisions/0075-glass-is-a-lakitu-camera.md) | The Glass gets Lakitu cameras: free-fly, collision-bound, invisible in the world, targeted by login | Accepted | Glass and Kino | - | observation (title only, D9) |
| [0077](../decisions/0077-invitee-auth-and-the-0072-0075-login-rule.md) | Invitee auth, and the login rule for Lakitu cameras | Accepted | Glass and Kino | Register | observation (title only, D9) |
| [0093](../decisions/0093-glass-hardening.md) | Glass hardening: defaults and the test for each 0072 item | Proposed (orchestrator, 2026-11-11; owner rulings on delay, sovereign and board recorded) | Glass and Kino | - | observation (title only, D9) |
| [0100](../decisions/0100-lakitu-feed-contract.md) | Lakitu feed contract | Proposed (orchestrator, 2026-11-11; owner to confirm) | Glass and Kino | Contract | observation (title only, D9) |
| [0138](../decisions/0138-thought-visibility.md) | Who reads a sovereign player's thoughts | accepted | Glass and Kino | Register | observation (title only, D9) |
| [0139](../decisions/0139-kino-feed-agents-only.md) | The Kino entity feed lists agents and mobs only | accepted | Glass and Kino | - | observation (title only, D9) |
| [0166](../decisions/0166-kino-monitor-wall-and-lakitu-camera.md) | Kino redesign: a monitor wall of Lakitu chase cameras | Proposed (implementer; owner rules A4, A9, A10) | Glass and Kino | - | observation (title only, D9) |

### Eventsink

1 record.

| # | Short title (record heading) | Status (record) | Primary | Secondary | Topics |
|---|---|---|---|---|---|
| [0041](../decisions/0041-event-export-stream-and-sink.md) | Events go to one JetStream stream with dedup headers, and the sink dead-letters what it cannot store | Accepted | Eventsink | Geldar-Core plugin, Contract | events, NATS |

### lantern-local

3 records.

| # | Short title (record heading) | Status (record) | Primary | Secondary | Topics |
|---|---|---|---|---|---|
| [0002](../decisions/0002-phase0-host-and-models.md) | Phase 0 runs on the owner's Windows PC with Ollama, Qwen3 32B and 8B | Accepted | lantern-local | Animus (Mind) | phases, models, host |
| [0028](../decisions/0028-model-names.md) | Phase 0 names models by their Ollama tag | Accepted | lantern-local | Animus (Mind) | models |
| [0049](../decisions/0049-thinker-job-gets-response-format-and-reasoning.md) | The Thinker job frame gains `response_format` and `reasoning` (Appendix H) | Accepted | lantern-local | Contract, Animus (Mind) | Thinker protocol |

### Supervisor

1 record.

| # | Short title (record heading) | Status (record) | Primary | Secondary | Topics |
|---|---|---|---|---|---|
| [0152](../decisions/0152-programmatic-body-management-for-owners.md) | Every registered owner manages their agents' bodies by API | Decided (owner ruling, 2026-11-11) | Supervisor | Register | body hosting, owner API |

### Body helper

1 record.

| # | Short title (record heading) | Status (record) | Primary | Secondary | Topics |
|---|---|---|---|---|---|
| [0260](../decisions/0260-body-container-control-by-host-helper.md) | Body containers are controlled by a root-owned host helper, not by the supervisor | Decided (owner ruling, 2026-11-14) | Body helper | Supervisor | body hosting |

### Geldar-Core plugin

10 records.

| # | Short title (record heading) | Status (record) | Primary | Secondary | Topics |
|---|---|---|---|---|---|
| [0048](../decisions/0048-recipe-discovery-is-part-of-the-game.md) | Recipe discovery is part of the game; the plugin stops granting the recipe book | Accepted | Geldar-Core plugin | Golem (Body) | crafting, world rules |
| [0101](../decisions/0101-lakitu-feed-plugin.md) | Lakitu feed plugin | Proposed (orchestrator, 2026-11-11; owner to confirm) | Geldar-Core plugin | Glass and Kino | observation (title only, D9) |
| [0146](../decisions/0146-c5-open-questions-for-the-owner.md) | Wave C5 open questions | Open (owner answers needed; each has a default the orchestrator will use if the packet is dispatched without an answer, except item 3, which is never defaulted) | Geldar-Core plugin | Golem (Body) | books, governance, items |
| [0165](../decisions/0165-block-owner-subjects.md) | Block ownership subjects | Accepted | Geldar-Core plugin | Golem (Body), Contract | ownership, NATS |
| [0187](../decisions/0187-bluemap-skin-provider-in-geldar-core.md) | A BlueMap skin provider in geldar-core | Proposed (owner to accept) | Geldar-Core plugin | Third-party plugins, Glass and Kino | skins, map |
| [0195](../decisions/0195-gravestones-owned-by-system.md) | Gravestones are owned by the system | Proposed (owner to accept) | Geldar-Core plugin | - | gravestones, ownership |
| [0197](../decisions/0197-speech-bubbles-on-the-map.md) | Speech bubbles on the BlueMap | Proposed | Geldar-Core plugin | Third-party plugins | map, chat |
| [0198](../decisions/0198-proximity-chat-and-deaths.md) | Proximity chat and death messages reach only the players within 32 blocks | Accepted | Geldar-Core plugin | - | chat, death |
| [0199](../decisions/0199-muffled-hearing.md) | Muffled hearing: walls absorb speech, and a muffled notice replaces the words | Proposed | Geldar-Core plugin | Golem (Body) | chat, hearing |
| [0310](../decisions/0310-live-chat-panel-on-the-map.md) | Live chat panel on the map | Decided (owner ruling, 2026-11-14) | Geldar-Core plugin | Third-party plugins | map, chat |

### Velocity identity plugin

6 records.

| # | Short title (record heading) | Status (record) | Primary | Secondary | Topics |
|---|---|---|---|---|---|
| [0021](../decisions/0021-velocity-from-phase0.md) | Velocity bot ingress from Phase 0, matching production | Accepted | Velocity identity plugin | Compose, shards and envs | ingress |
| [0040](../decisions/0040-bot-ingress-registry-in-nats-kv.md) | The bot-ingress gate reads a NATS KV registry, fails closed, and Golem registers before it connects | Accepted | Velocity identity plugin | Golem (Body) | ingress, NATS |
| [0092](../decisions/0092-velocity-spectator-whitelist.md) | Velocity spectator whitelist and the ghost rule | Proposed (orchestrator, 2026-11-11; owner to confirm) | Velocity identity plugin | Geldar-Core plugin | ingress, spectators |
| [0137](../decisions/0137-public-spectator-proxy-is-separate-and-online.md) | The public Minecraft port is a separate online-mode spectator proxy; Paper fails closed | Accepted | Velocity identity plugin | Compose, shards and envs, Geldar-Core plugin | ingress, spectators |
| [0140](../decisions/0140-agent-skins.md) | Agent skins: MineSkin-signed textures in geldar-skins, applied by the Velocity identity plugin | accepted | Velocity identity plugin | Tools, Golem (Body) | skins |
| [0364](../decisions/0364-known-gap-public-overlay-against-0137.md) | Known gap: the public overlay against decision 0137, recorded and not fixed | Proposed (owner to accept) | Velocity identity plugin | Compose, shards and envs | ingress (title only, D9) |

### Third-party plugins

No record has this component as primary. It is secondary in 0072, 0094, 0187, 0197, 0310; see [component to decisions](#component-to-decisions).

### Compose, shards and envs

8 records.

| # | Short title (record heading) | Status (record) | Primary | Secondary | Topics |
|---|---|---|---|---|---|
| [0024](../decisions/0024-gamerules-26-1.md) | Gamerule names on Minecraft 26.1 are snake_case | Accepted | Compose, shards and envs | Geldar-Core plugin | world rules, versions |
| [0067](../decisions/0067-nats-accounts-and-least-privilege.md) | NATS accounts and least-privilege users, opt-in until the stack is cut over | Accepted provisionally | Compose, shards and envs | Deploy | NATS, auth |
| [0080](../decisions/0080-nats-auth-cutover.md) | NATS auth cutover | Accepted | Compose, shards and envs | Deploy | NATS, auth |
| [0082](../decisions/0082-colo-compose-network-and-limits.md) | Colo compose layout: network, limits, loopback binds and ports | Proposed (the orchestrator may accept at the ops merge) | Compose, shards and envs | - | compose, limits, ports |
| [0087](../decisions/0087-nats-overlay-live-test-and-scoped-subjects.md) | NATS overlay live test and scoped subjects | Proposed | Compose, shards and envs | Contract | NATS, subjects, tests |
| [0131](../decisions/0131-colo-in-container-hosts-and-mind-shard-file.md) | Colo containers reach their compose peers by name, and the Mind's shard file is separate from the budget file | Accepted | Compose, shards and envs | Animus (Mind) | compose, shard files |
| [0180](../decisions/0180-chatgpt-harness-enabled-on-colo.md) | The chatgpt harness is enabled on the colo shard | Proposed (implementer; the owner asked for a named agent's provider, the compliance question below is the owner's) | Compose, shards and envs | Threshold MCP | harnesses, shard files |
| [0188](../decisions/0188-genesis-environment-stamp.md) | Genesis: a whole environment is stamped from a workflow, from a definition in the repo | Proposed (owner answers recorded 2026-11-14 in the genesis campaign README; the architecture awaits review by [coordinator session], [ops session], [registration session] and scriptorium) | Compose, shards and envs | Deploy, Tools | genesis, environments |

### Deploy

7 records.

| # | Short title (record heading) | Status (record) | Primary | Secondary | Topics |
|---|---|---|---|---|---|
| [0071](../decisions/0071-public-endpoints-and-ports.md) | The public Minecraft endpoint is a new TCP port with an SRV record; HTTPS ingress is the shared Caddy, reloaded and never restarted | Accepted | Deploy | Compose, shards and envs | public endpoints |
| [0076](../decisions/0076-backup-scope-and-destination.md) | Backup scope and destination | Accepted | Deploy | Database | backups |
| [0084](../decisions/0084-colo-deploy-by-pull-with-a-project-scoped-script.md) | Colo deploy by pull, with a project-scoped script | Proposed | Deploy | CI and repo checks | deploy |
| [0094](../decisions/0094-public-sites-read-only-through-caddy.md) | BlueMap, Glass and the public MCP are read-only Caddy sites with kill switches, and core Caddy has no rate limit | Proposed (orchestrator, 2026-11-11; owner to confirm) | Deploy | Glass and Kino, Third-party plugins, Threshold MCP | public endpoints |
| [0096](../decisions/0096-public-topology-as-built.md) | Public topology as built on the Colo node | Proposed (orchestrator, 2026-11-11) | Deploy | Compose, shards and envs | public endpoints |
| [0130](../decisions/0130-phase1-owner-rulings-for-c1.md) | Phase 1 owner rulings for C1 and the test schedule | Accepted | Deploy | Telemetry, CI and repo checks | deploy, backups, tests |
| [0169](../decisions/0169-players-host-restart-policy.md) | A player host restarts itself on failure, up to five times, and keeps its logs | Accepted | Deploy | Admin service, Compose, shards and envs | body hosting, restarts |

### Admin service

1 record.

| # | Short title (record heading) | Status (record) | Primary | Secondary | Topics |
|---|---|---|---|---|---|
| [0133](../decisions/0133-colo-admin-by-one-shot-container.md) | Colo administration runs in a one-shot container | Accepted | Admin service | Deploy | admin |

### Database

10 records.

| # | Short title (record heading) | Status (record) | Primary | Secondary | Topics |
|---|---|---|---|---|---|
| [0020](../decisions/0020-receipts.md) | Every action gets a receipt; economic actions get two | Accepted | Database | Golem (Body), Threshold MCP | receipts, actions |
| [0023](../decisions/0023-skill-foreign-keys.md) | Books and the skill library point at one edition of a skill | Accepted | Database | - | skills, books |
| [0026](../decisions/0026-one-database-per-shard.md) | Phase 0 is one database per shard | Accepted | Database | - | database layout |
| [0027](../decisions/0027-final-receipt-constraints.md) | The database enforces one final receipt per action | Accepted | Database | - | receipts |
| [0056](../decisions/0056-first-migration-runner-and-least-privilege-grants.md) | The first migration runner, the migration ledger rule, and the least-privilege grants for the MCP role | Accepted | Database | Tools | migrations, grants |
| [0085](../decisions/0085-append-only-audit-tables.md) | Append-only audit tables | Accepted | Database | - | audit tables |
| [0171](../decisions/0171-account-erasure-rule.md) | Account erasure: what is removed and what stays as world history | Decided (owner ruling, 2026-11-13); legal review stays with the owner and is not done by this record | Database | Register | erasure, privacy |
| [0185](../decisions/0185-per-turn-record-for-kit-minds.md) | A per-turn record for kit Minds: the full Appendix D record, operator-only | Proposed (owner confirmed the scope to [coordinator session] on 2026-11-14; nothing is built or switched on) | Database | Telemetry | observation (title only, D9) |
| [0282](../decisions/0282-sheet-erasure-covers-dead-lives.md) | Sheet erasure covers the dead lives of a deleted owner | Accepted | Database | Psyche, Sheet driver | erasure, character sheet |
| [0339](../decisions/0339-journal-reset-one-time-exception.md) | One-time journal and sleep-mark reset (0085 exception) | Accepted (one-time, not a routine) | Database | - | journals, one-time exception |

### Prompts

4 records.

| # | Short title (record heading) | Status (record) | Primary | Secondary | Topics |
|---|---|---|---|---|---|
| [0058](../decisions/0058-the-character-knowledge-boundary-and-thought-v2.md) | The character knowledge boundary, and thought prompt v2 | Accepted | Prompts | Animus (Mind) | prompts, character knowledge |
| [0068](../decisions/0068-prompt-v4-and-agent-visible-text.md) | Prompt v4 and the agent-visible text: no observer, harness or credit meta | Proposed (the owner amends the spec line below) | Prompts | Tools, Contract | observation (title only, D9) |
| [0074](../decisions/0074-shelter-means-an-enclosed-safe-space.md) | Shelter means an enclosed safe space | Accepted | Prompts | Golem (Body) | shelter, prompts |
| [0181](../decisions/0181-thought-context-8704.md) | the context window is raised from 8192 to 8704 so the till thought prompt fits | Accepted | Prompts | Animus (Mind), lantern-local | prompts, models |

### Tools

4 records.

| # | Short title (record heading) | Status (record) | Primary | Secondary | Topics |
|---|---|---|---|---|---|
| [0003](../decisions/0003-task-runner.md) | `geldar.ps1` is the task runner, not `make` | Accepted | Tools | - | tooling |
| [0060](../decisions/0060-persona-size-limits.md) | Persona files are not artificially size-limited | Accepted | Tools | Animus (Mind) | persona files |
| [0089](../decisions/0089-crash-hygiene-defaults-and-refusals.md) | Crash hygiene: the owner cap default, the start refusal while a name lease is held, and `players down` | Accepted | Tools | Compose, shards and envs | caps, crash hygiene |
| [0250](../decisions/0250-skin-upload-visibility-and-export.md) | Skin uploads are unlisted by default, and a signed skin can be exported as JSON | Accepted | Tools | Velocity identity plugin | skins |

### CI and repo checks

5 records.

| # | Short title (record heading) | Status (record) | Primary | Secondary | Topics |
|---|---|---|---|---|---|
| [0005](../decisions/0005-pinning-and-security-updates.md) | Exact pins, two-week minimum age, Dependabot security updates only | Accepted | CI and repo checks | - | pins, supply chain |
| [0006](../decisions/0006-typescript-toolchain.md) | pnpm, TypeScript 7, Biome and Vitest | Accepted | CI and repo checks | Tools | tooling, build |
| [0081](../decisions/0081-c1-unblocker-checks-and-first-party-pin-exemption.md) | C1 unblocker checks and the first-party pin exemption | Accepted | CI and repo checks | - | repo checks, pins |
| [0132](../decisions/0132-ipv4-literal-policy.md) | IPv4 literal policy: loopback and documentation addresses anywhere, private addresses only in an allowlist, public addresses never | Accepted | CI and repo checks | - | repo checks, addresses |
| [0220](../decisions/0220-merge-queue-for-main.md) | Merge queue for main | Proposed | CI and repo checks | - | merge queue |

### Telemetry

4 records.

| # | Short title (record heading) | Status (record) | Primary | Secondary | Topics |
|---|---|---|---|---|---|
| [0088](../decisions/0088-metrics-exporters-and-replay-window.md) | Metrics exporters and the MCP replay window | Proposed (wave C1, packet P1-C1-07) | Telemetry | Threshold MCP | telemetry (title only, D9) |
| [0350](../decisions/0350-telemetry-scope-and-full-capture.md) | Telemetry scope and full capture | Accepted | Telemetry | - | telemetry (title only, D9) |
| [0351](../decisions/0351-paper-telemetry-plugin-scope.md) | Paper telemetry plugin scope | Proposed | Telemetry | Compose, shards and envs | telemetry (title only, D9) |
| [0352](../decisions/0352-telemetry-dedicated-clickhouse-database.md) | Telemetry on a dedicated ClickHouse database for Geldar | Accepted, chosen option B | Telemetry | - | telemetry (title only, D9) |

### Sheet driver

No record has this component as primary. It is secondary in 0186, 0282; see [component to decisions](#component-to-decisions).

### Docs library

7 records.

| # | Short title (record heading) | Status (record) | Primary | Secondary | Topics |
|---|---|---|---|---|---|
| [0073](../decisions/0073-spec-is-never-edited.md) | docs/spec.md is never edited by agents; decision records amend it | Accepted | Docs library | - | spec, decisions |
| [0155](../decisions/0155-legal-text-v1-approved-and-contact-published.md) | Terms of Use, Privacy Notice and Acceptable Use version 1 are approved by the owner; the abuse contact is published | Decided (owner approval, 2026-11-11) | Docs library | Register | legal |
| [0360](../decisions/0360-documentation-metadata-block-and-sources-field.md) | The documentation metadata block and the optional `sources:` field | Proposed (owner to accept) | Docs library | - | docs, metadata |
| [0361](../decisions/0361-agents-never-placement-and-public-detail.md) | Agents-never documents: where they may live, and how much a public repo may say | Proposed (owner to accept) | Docs library | - | observation (title only, D9) |
| [0362](../decisions/0362-glossary-lives-in-reference.md) | The glossary lives at `docs/reference/glossary.md`; `docs/glossary.md` is a pointer | Proposed (owner to accept) | Docs library | - | docs, glossary |
| [0363](../decisions/0363-doc-update-map-is-a-review-duty.md) | The doc-update map is a review duty, and the documentation-writer agent keeps it | Proposed (owner to accept) | Docs library | - | docs, review |
| [0365](../decisions/0365-docs-gates-after-the-freeze.md) | Documentation gates to build after the freeze | Proposed (owner to accept) | Docs library | CI and repo checks | docs, gates |

## Decisions that fit no component

These six records govern no Geldar component. Three are implemented in the Scriptorium sibling repo (0036, 0042, 0046; each record names the Scriptorium repo or its launcher). Two set project-wide scope (0004, the repo layout; 0070, Phase 1). 0366 records an open conflict between the spec and decision 0059.

| # | Short title (record heading) | Status (record) | Primary | Secondary | Topics |
|---|---|---|---|---|---|
| [0004](../decisions/0004-phase0-repo-layout.md) | Phase 0 code lives in this one repo | Accepted | none | - | repo layout, phases |
| [0036](../decisions/0036-launcher-workspace-named-volume.md) | The launcher keeps the player workspace in a named Docker volume on every OS | Accepted | none | - | sibling repo (launcher) |
| [0042](../decisions/0042-path-rule-case-folded-identity-prefix.md) | The session path rule never allows `memory/identity.md/` as a prefix, case-folded | Accepted | none | - | sibling repo (session path rule) |
| [0046](../decisions/0046-scripted-stub-cli-stands-in-for-the-vendor-cli-in-ci.md) | A scripted stub CLI stands in for the vendor CLI in CI (D-SC-10) | Accepted | none | - | sibling repo (stub CLI), tests |
| [0070](../decisions/0070-phase1-is-the-colo-first-shard.md) | Phase 1 is the colo-first shard: final environment, invite-only, not announced | Accepted | none | - | phases, scope |
| [0366](../decisions/0366-open-spec-5-14-watched-wording-versus-0059.md) | Open: spec 5.14 Watched wording versus decision 0059 | Open (owner decision) | none | - | observation (title only, D9) |

## Component to decisions

For each of the 27 components, every record that names it as primary or secondary. Numbers only; the sections above link them.

| Component | Primary in | Secondary in | Primary count | Secondary count |
|---|---|---|---|---|
| [Contract](#contract) | 0001, 0025, 0035, 0143, 0144, 0280 | 0030, 0041, 0043, 0049, 0068, 0069, 0087, 0090, 0100, 0162, 0165, 0167, 0192, 0218 | 6 | 14 |
| [Golem (Body)](#golem-body) | 0022, 0029, 0030, 0031, 0032, 0037, 0038, 0039, 0043, 0083, 0141, 0142, 0145, 0147, 0148, 0151, 0154, 0156, 0157, 0160, 0162, 0163, 0164, 0167, 0168, 0182, 0183, 0184, 0190, 0191, 0192, 0194, 0196, 0210, 0212, 0213, 0214, 0215, 0216, 0217, 0218, 0219, 0224, 0225, 0226, 0330, 0331, 0332, 0333, 0334, 0335, 0336, 0337, 0338, 0341 | 0020, 0025, 0040, 0047, 0048, 0050, 0063, 0065, 0074, 0140, 0143, 0144, 0146, 0165, 0199, 0261, 0280 | 55 | 17 |
| [Body benchmark](#body-benchmark) | 0061, 0066 | 0038, 0039 | 2 | 2 |
| [Animus (Mind)](#animus-mind) | 0047, 0050, 0051, 0062, 0063, 0064, 0065, 0069, 0078, 0134 | 0002, 0028, 0049, 0058, 0060, 0061, 0066, 0079, 0083, 0131, 0154, 0181 | 10 | 12 |
| [player-core](#player-core) | none | none | 0 | 0 |
| [Psyche](#psyche) | 0186, 0281 | 0280, 0282 | 2 | 2 |
| [Threshold MCP](#threshold-mcp) | 0052, 0053, 0054, 0055, 0057, 0079, 0090, 0091, 0095, 0108, 0149, 0221 | 0020, 0034, 0035, 0088, 0094, 0145, 0147, 0151, 0154, 0156, 0157, 0180 | 12 | 12 |
| [MCP mock](#mcp-mock) | 0033, 0034, 0044, 0045 | 0035, 0055 | 4 | 2 |
| [Register](#register) | 0135, 0136, 0150, 0153, 0170, 0172, 0173, 0261, 0262 | 0077, 0138, 0152, 0155, 0171 | 9 | 5 |
| [Glass and Kino](#glass-and-kino) | 0059, 0072, 0075, 0077, 0093, 0100, 0138, 0139, 0166 | 0061, 0094, 0101, 0187 | 9 | 4 |
| [Eventsink](#eventsink) | 0041 | 0280 | 1 | 1 |
| [lantern-local](#lantern-local) | 0002, 0028, 0049 | 0050, 0051, 0066, 0078, 0181 | 3 | 5 |
| [Supervisor](#supervisor) | 0152 | 0170, 0260, 0261 | 1 | 3 |
| [Body helper](#body-helper) | 0260 | 0261 | 1 | 1 |
| [Geldar-Core plugin](#geldar-core-plugin) | 0048, 0101, 0146, 0165, 0187, 0195, 0197, 0198, 0199, 0310 | 0024, 0032, 0041, 0092, 0137, 0157, 0164 | 10 | 7 |
| [Velocity identity plugin](#velocity-identity-plugin) | 0021, 0040, 0092, 0137, 0140, 0364 | 0250 | 6 | 1 |
| [Third-party plugins](#third-party-plugins) | none | 0072, 0094, 0187, 0197, 0310 | 0 | 5 |
| [Compose, shards and envs](#compose-shards-and-envs) | 0024, 0067, 0080, 0082, 0087, 0131, 0180, 0188 | 0021, 0022, 0059, 0071, 0089, 0096, 0108, 0134, 0137, 0150, 0169, 0212, 0351, 0364 | 8 | 14 |
| [Deploy](#deploy) | 0071, 0076, 0084, 0094, 0096, 0130, 0169 | 0053, 0067, 0078, 0080, 0091, 0133, 0188 | 7 | 7 |
| [Admin service](#admin-service) | 0133 | 0169 | 1 | 1 |
| [Database](#database) | 0020, 0023, 0026, 0027, 0056, 0085, 0171, 0185, 0282, 0339 | 0043, 0054, 0076, 0079, 0108, 0144, 0262 | 10 | 7 |
| [Prompts](#prompts) | 0058, 0068, 0074, 0181 | 0167 | 4 | 1 |
| [Tools](#tools) | 0003, 0060, 0089, 0250 | 0001, 0006, 0054, 0056, 0061, 0064, 0068, 0136, 0140, 0172, 0188 | 4 | 11 |
| [CI and repo checks](#ci-and-repo-checks) | 0005, 0006, 0081, 0132, 0220 | 0001, 0045, 0059, 0083, 0084, 0095, 0130, 0365 | 5 | 8 |
| [Telemetry](#telemetry) | 0088, 0350, 0351, 0352 | 0130, 0185, 0217, 0335 | 4 | 4 |
| [Sheet driver](#sheet-driver) | none | 0186, 0282 | 0 | 2 |
| [Docs library](#docs-library) | 0073, 0155, 0360, 0361, 0362, 0363, 0365 | 0153 | 7 | 1 |
| [No component](#decisions-that-fit-no-component) | 0004, 0036, 0042, 0046, 0070, 0366 | - | 6 | - |

## Gaps this page records

1. **Record 0135 has lost its line breaks.** Its first 7,419 bytes are one physical line: the heading, Status, Date, Spec, Packets and the body up to the end of "What this changes" (`[IO.File]::ReadAllText` split on LF, 2026-11-16). It renders as one long heading. A record is never rewritten to say something else ([decisions README](../decisions/README.md)); whether a whitespace-only repair counts as a rewrite is the owner's call.
2. **Status lines have three shapes.** `- Status:` (most), a bare `Status:` line (for example 0088, 0136, 0149) and lowercase `accepted` (0136, 0138, 0139, 0140, 0147, 0148, 0149). A record-to-index status gate, as proposed in decision [0365](../decisions/0365-docs-gates-after-the-freeze.md), must accept all three.
3. **Session labels in records.** Seventeen records name a coordinator session by label in their Status line: 0168, 0182, 0185, 0188, 0194, 0218, 0219, 0282, 0330, 0332 to 0338 and 0352 (the first re-derive block, read by hand, 2026-11-16; a repository or bucket name is not a session label). This page drops the label with the provenance on `Accepted` rows and replaces it on the others (see the status rule). The records themselves are not changed.
4. **No decision governs player-core** as primary or secondary, and none has Third-party plugins or the Sheet driver as primary.
5. **Closed 2026-11-16 (W7).** The style guide's record count was stale; [documentation style](../agents/documentation-style.md#metadata-block) now says 187 records (line 47).
6. **Closed 2026-11-16 (W7).** This page is linked: the [reference index](README.md) row H06 carries no "planned", each [components](components.md#lifecycle-design-to-build) row links its section here, and the [doc-update map](../agents/doc-update-map.md) row "A new decision record" names this page (line 84).
