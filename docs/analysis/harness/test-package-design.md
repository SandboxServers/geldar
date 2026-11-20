---
title: "Test package design: scenarios as data, controls matrix, seed session"
type: explanation
audience: agents-never
status: draft
last_verified: 2026-11-19 against 7efad8ca
companions: [../../runbooks/capture-real-payloads.md, work-packets-sheet-w3-w5.md, work-packets-sheet-w9-w12.md, sheet-next-wave-order.md, ../genesis/plan.md]
---

# Test package design

Type: explanation (a design, not a procedure). Audience: the orchestrator, the owner and whoever writes the first
cards. Operator-side only: scenario text, captured payloads and reports describe raw plugin messages and Body
behaviour. Nothing here goes into a prompt, skill, kit file, tool text, `identity.md`, player repo or sign.

Status: **design only**. Nothing in this document is built. The diff that adds it adds no `.github/` file; a workflow
would be a later card. Facts are from `origin/main` at `7efad8ca` on 2026-11-19 unless a line says otherwise.

The operator's ask: stop running one feature at a time on a hand-started scratch shard. Instantiate a **test package**
together with the scratch shard, and run test plans through workflows. This document proposes the package, fits it to
what the repo already has, and names the first session that seeds it. The seed session is the
[capture runbook](../../runbooks/capture-real-payloads.md).

## 1. The package

### 1.1 What it is

A versioned directory of data plus one runner. Proposed home: `tools/test-package/` (code) and
`test-package/scenarios/` (data). Not created here.

| Part | Content |
|---|---|
| Manifest | package version, the contract schema versions it expects, the list of waves it covers, the minimum plugin and Golem commit |
| Scenarios | one file each, data only (YAML or JSON), validated by a schema in the package |
| Fixtures | raw payloads captured from real runs, one file per message, each naming the scenario, commit and date |
| Controls | the matrix in 1.4, generated from the scenarios' `variants` |
| Runner | brings a shard up from pinned images, installs the package, runs the selected scenarios, saves artifacts, tears down |
| Report | one document naming the commit, the package version, each scenario and variant with pass, fail or blocked |

### 1.2 A scenario, as data

A scenario states what exists, what happens and what must be seen. It holds no code. Proposed fields:

```yaml
id: S-PROV-01-toss
version: 1
wave: W5
cards: [AN-26a, AN-26b]
needs:                     # the runner refuses to start when a need is unmet, and reports `blocked: <need>`
  plugin_listeners: [pickup]
  coreprotect: any         # any | present | absent
variants:
  - name: off              # the control: flag unset, today's bot
    plugin: { provenance.enabled: false }
    sheet: off
    expect: { messages: [], receipts: same-as-baseline }
  - name: on
    plugin: { provenance.enabled: true }
    sheet: off
    expect:
      messages:
        - { subject: provenance.pickup, count: 1, schema: provenance, capture: fixture }
bots:
  - { id: ag_capa_01, slot: 1, sheet: off }
  - { id: ag_capb_01, slot: 2, sheet: off }
setup:                     # test control only (RCON), from an allow-list of verbs
  - { rcon: give, bot: ag_capa_01, item: cobblestone, count: 3 }
steps:
  - { bot: ag_capa_01, action: { do: give, to: ag_capb_01, item: cobblestone, count: 3 } }
  - { wait: pickup-or-timeout, ms: 5000 }
subscribe: [provenance.>, combat_fact]    # opened before the first step, subjects relative to geldar.<shard>.
```

Rules for scenarios:

- **Data only, with a closed vocabulary.** Setup verbs come from the allow-list of `TestControl`
  (`golem/src/test-control.ts`); steps are Body actions from the contract's action union
  (`contract/schemas/thought.schema.json`, `give` at line 210, for example). A step the vocabulary cannot say is a
  new vocabulary entry, reviewed, not a script in the data.
- **Test lives only.** Bot ids match the life-id pattern (`EventEnvelope.java:27`), because the combat and take
  listeners ignore any other name. Principle 1 holds in the package: bots are scripted test lives, RCON is test
  control (decision 0029 record; run-shard skill), no human client. See the runbook's Principle 1 section.
- **Every scenario has an `off` variant.** A feature is proven inert before it is proven live.
- **A scenario names the cards it covers** so the report can show which card has real evidence and which has none.

### 1.3 The runner

Stages, each logging a line and failing closed:

1. **Resolve** the environment: a definition file (see 2.5), the commit, the package version, and the plugin jars (built, or
   downloaded from the CI artifact `plugin-jars`, `.github/workflows/plugin-jars.yml`).
2. **Guard**: refuse unless the project name starts with `scratch-` or the environment is marked test, as
   `golem/src/bench/sheet/guard.ts` does for `bench/sheet/run.sh`.
3. **Up** from pinned images (the digests in `compose/phase0.yml`), health rows of the run-shard skill.
4. **Install**: apply the variant's plugin config to the scratch volume, register and whitelist the bots.
5. **Run** the scenario: open subscribers, execute the steps, wait, close subscribers.
6. **Collect** artifacts: raw messages byte for byte, the validator result per message, RCON replies, the Paper and
   Velocity log slice, the NATS stream counts, the Postgres rows the scenario names.
7. **Assert** against `expect`. A capture with `capture: fixture` is written as a candidate fixture, never into a
   Body-side fixtures directory by the runner.
8. **Down**: reset flags, world, whitelist and tick rate (the runbook's cleanup list), then `down -v` for a scratch project.

Exit statuses: pass, fail, blocked (a `needs` entry is unmet), harness error. A blocked scenario is reported, never
skipped silently.

### 1.4 Captured payloads become fixtures

The artifacts are the evidence that freezes contract shapes. The flow:

- The runner saves each raw message, with its validator output, as an artifact of the run.
- A reviewed change copies a message into the owning card's fixture path (for example
  `golem/src/perception/provenance/fixtures/pickup-real.json`, owned by AN-26b per its card) and pastes the same text in
  the worknote. The package never writes into Body-side fixtures itself.
- The owed captures of AN-26a, AN-27a, AN-47a and AN-51a are the **first scenarios**
  (`S-PROV-01-toss`, `S-PROV-02-break-coreprotect-absent`, `S-PROV-03-break-coreprotect-present`,
  `S-COMBAT-01-kill`, `S-COMBAT-02-survived`, `S-TAKE-01` to `S-TAKE-07` for single chest, double chest, shift-click,
  number-key swap, crafting table, furnace, and the holder table). The runbook is the manual form of exactly these.
- A fixture file carries a header (not part of the payload bytes): scenario id, package version, commit, date.

### 1.5 Controls matrix

Every scenario is run in its variants; the matrix is what proves "inert".

| Scenario | plugin flag off, sheet off | flag on, sheet off | flag on, sheet all-3 (rolls off) | what it proves |
|---|---|---|---|---|
| S-PROV-01-toss | no `provenance.*` message; receipts as baseline | one `pickup`, valid | one `pickup`, valid; Body decisions equal the sheet-off run | flag off is inert; an all-3 sheet is today's bot |
| S-COMBAT-01-kill | no `combat_fact`, no `engaged` | one of each, valid | same; Body fight decisions equal | same |
| S-TAKE-* | no `take` | the expected takes; crafting table sends none | same | same |
| today's-bot baseline (no scenario file) | the existing live lane and bench | | | the default path did not move |

Basis for the sheet column: decision 0328 and the work-packets text say an all-3 sheet with `rolls: false` equals
today's bot in every Body decision the sheet touches (`work-packets-sheet-w9-w12.md:373`), and S12-03's test files
`golem/test/character-control/threat-equivalence.test.ts` and `proficiency-equivalence.test.ts` exist on `main` as the
unit-level proof. The matrix adds the shard-level proof (real server, real events). The treatments follow decision
D-CS-11: A off, B all-3 with d20 off, C all-3 with d20 on, D varied sheets with d20 on
(`work-packets-geldar-c.md:596`). The package uses A and B only; C and D roll dice and belong to the cohort tier.

How the sheet is switched: the `character` block in `shards/phase0.yaml` (lines 149 onward, commented out, "inactive").
The runner must set it per bot without editing the committed file; how a Body reads it per life is not verified here.

### 1.6 Cross-feature scenarios are first-class

A scenario may chain features, and each hop asserts its own output so a break is located:

| Hop | Output asserted | Card | On `main` today |
|---|---|---|---|
| toss | `provenance.pickup` message | AN-26a | listener written, not registered |
| gift observation | the recipient's Body maps it (`observeGift`) | AN-26b | not written |
| Body publishes | an `observation` WorldEvent on `geldar.<shard>.observation` | AN-28b | not written |
| MCP presents | the line the agent would read, with no `ag_` id or coordinates | AN-28a | FixNeeded per `ledger.md:93`; not written |
| evidence | the theory-of-mind evidence row | later W6 to W8 cards | not written |
| XP | the award key in the eventsink | AN-50a registration | not written |

A cross-feature scenario is `blocked` until every hop it names exists, and its report row says which hop. It is the
check that no two cards each pass alone and fail together. The leakage hops belong here too: the scenario asserts the
agent-facing text holds nothing from the raw message (the AN-28b leakage test, run against a real capture).

### 1.7 Regression: this wave plus every earlier wave

The wave test becomes cumulative: the scenarios tagged with this wave and every earlier wave. A wave is never closed
by running only its own scenarios. A scenario that passed in W5 and fails in W7 is a regression the report names by
commit. Scenarios are retired only by a reviewed change that says why.

## 2. What exists, and what to reuse

Each row was checked by reading the file named, 2026-11-19.

| Existing | Evidence | Reuse | Would be duplicated |
|---|---|---|---|
| Live lane: `golem/test/live/*.live.test.ts`, about 11 minutes, own vitest config | `golem/vitest.live.config.ts:7`; root `vitest.config.ts` excludes `**/*.live.test.ts`; run-shard skill step 2 | `withLiveBot`, `TestControl`, `resetBot`, whitelist and registry handling (`fixture.ts`) as the bot driver under the runner | a second fixture for bots and arenas |
| Eventsink integration tests | `GELDAR_IT=1`, `ci.yml:318`, job `integration` has a 20 minute timeout (`ci.yml:301-305`) and a Postgres service, no Paper | keep as is; the package adds only shard-backed rows (events reach Postgres from a real Paper) | a second copy of schema-level eventsink checks |
| Body benchmark | `golem/src/bench/` (`runner.ts`, `results.ts`, `meta.ts`), `bench --record`, `bench-results/<time>-<commit>.json`, `commitLabel` adds `+dirty` (`meta.ts:56-58`) | the report's commit naming and the `+dirty` rule; the scenario-as-module precedent in `golem/src/bench/scenarios/` | its TPS control (`tps.ts`) if a scenario needs a slow server; do not rebuild it |
| Sheet scratch driver | `bench/sheet/run.sh` (`guard`, `up`, `down`, `evidence`, `mine-once`, `leak`), `bench/sheet/phase0-sheet.yml`, `golem/src/bench/sheet/` (`guard.ts`, `leak-check.ts`, `report.ts`) | **the closest precedent**: the guard, the scratch overlay with its own ports and volume, `down -v`, a leak check and a report formatter | the runner's Up and Down stages. Its header calls itself "step 0" and cites a harness "not yet on main": it is a helper, not a runner. Whether it still works end to end is unproven |
| Scratch stack | `deploy/scratch/scratch.sh up|status|down|probe`, resource gates 10 GB RAM and 20 GB disk (`scratch.sh:22-23`), `docs/runbooks/scratch-stack.md` | the resource gates and teardown rules | its NATS rule: it refuses open NATS (`scratch.sh:7-9`), so provenance subjects cannot be read by any role in the table (`geldar.ps1:391-424`). The package needs an owner decision on a test-only subscriber under auth; do not widen a live role |
| Genesis environments | `envs/environment.schema.json`, `envs/test.example.yaml` (project name, ports 25566 / 25576 / 4223, paths, digests), validator `tools/genesis-env` (`validate`), G0-04 merged (#390), G0-03a to d merged | the runner reads ports, project name and image digests from an `envs/<name>.yaml` instead of a private port list. The example file is a placeholder (its header says digests are placeholders) | the port and project names in `bench/sheet/phase0-sheet.yml` |
| Test VM script | `deploy/genesis/New-TestVm.ps1` (G3-04, #770): Hyper-V Gen2 Debian VM on node 3, dry run by default, tested with stub cmdlets (`deploy/test/genesis-test-vm.test.ts`) | a runner host option (2.6). The plan sizes it at 24 GB and 8 vCPUs (`docs/analysis/genesis/plan.md` section 4) | nothing; the VM is the machine, not the runner |
| Genesis stamp and deploy channel | G3-02 forced-command `plan|apply|verify|restore` (in progress), G4-01 `stamp.yml` with `workflow_dispatch` inputs `environment`, `ref`, `mode` (not started), G6-04 ephemeral CI stamp with "the smoke suite and the scripted player", nightly (`docs/analysis/genesis/packets.md:80,98`) | the dispatch shape and the "install on a named environment" idea | **G6-04's scripted player and smoke suite are the same idea as the package's runner.** Decide before either is written: the package's scenarios should be that suite, or G6-04 should call the runner. Otherwise two scripted-player systems exist |
| Hosted runner capacity | `docs/analysis/genesis/g0-02-runner-spike.md`: 4 vCPU, 15983 MB, Postgres, NATS, Paper (2.5 GB) with the real `geldar-core` jar and an empty world; Paper "Done" 50 s, peak 3620 MB | evidence that the package can run on a hosted runner for the reduced profile | Velocity, services, Body hosts, plugin sets and image pull time were not measured there |
| Run protocol | `tools/adam-run` ("writes the run manifest, samples the stack once a minute, applies the abort rules and runs the safe stop", `package.json:4`) | the manifest idea and abort rules for long runs | unverified: its manifest fields; not read in detail |
| Cohort run (W12) | S12-01..07 in `work-packets-sheet-w9-w12.md` (lines 109-118): S12-06 names `tools/cohort-run/` and `protocol.json`; D-CS-11 says `protocol.json` holds every bar (`work-packets-geldar-c.md:671`) | the treatment labels, fresh lives per treatment, an immutable world clone per run (`w9-w12.md:375`), "a missing run is incomplete, not a pass" | **`tools/cohort-run/` and `protocol.json` do not exist on `main`** (`ls tools` at `7efad8ca`); S12-06 is BLOCKED on OD-11 and S12-02, so there is no validator to read. Do not copy numbers from it. The cohort run is model-driven and expensive; the package is scripted and cheap. Keep them separate tiers that share vocabulary |

Reading of the table: the package should **not** invent a shard lifecycle (take `bench/sheet/run.sh` and the genesis
environment file), a bot driver (take the live fixture), or an events assertion layer (take the eventsink tests). The
new parts are the scenario schema, the subscribe-and-capture layer, the variant and controls logic, and the report.

### 2.5 Environment definition

Put the shard under test in an `envs/<name>.yaml` (for example `envs/test-package.yaml`), validated by
`tools/genesis-env validate`. That file already holds the project name, ports, data paths and image digests
(`envs/test.example.yaml`). Whether `compose/phase0.yml` can be driven by it is G0-03 (merged as a to d); I did not
check that `phase0.yml` reads it, so treat that as unverified.

### 2.6 Where it runs: options

| Host | For | Against |
|---|---|---|
| This machine, Docker in WSL | no new infrastructure; the owner's own hardware; the live lane already runs here | Docker in WSL and bind mounts are unproven for this stack (section 4 of this document lists what); one shard at a time; the machine is also the dev machine |
| Dedicated test VM (node 3, `New-TestVm.ps1`) | isolated, sized for the full stack (24 GB, 8 vCPUs), matches the genesis plan | needs the VM built and bootstrapped (G3-01, G3-02 in progress); operator-run; no CI holds the node key (plan.md section 4) |
| Hosted runner (ephemeral stamp) | clean machine every run; no owner hardware; G0-02 shows the reduced profile fits | the full stack is not measured; 16 GB limit; the live lane is excluded from CI today; the run is slow for a hosted job |
| The Colo node | the real machine | **no**: scratch beside a live stack risks the live agents; the repo's own rule keeps scratch off the shared node unless the owner says (`scratch-stack.md`) |

Proposal: seed and develop on this machine (WSL) because it exists today; move to the test VM when G3 lands; keep the
hosted runner as a nightly of the reduced profile only after G6-04 decides its shape. This is a recommendation, not a
ruling.

## 3. Triggers and cost

- **Not per PR.** `ci.yml` runs on `pull_request`, `merge_group`, `push` and `workflow_dispatch` (lines 10-15), and the
  live lane is not in it (no `test:live` in the file; the integration job runs eventsink tests with a Postgres service
  only). A package run takes at least the live lane's 11 minutes plus up and down, uses one shared shard, and mutates it
  (CLAUDE.md). Per PR would queue the merge train behind a slow shared resource.
- **`workflow_dispatch`** with inputs `ref`, `environment` and `through` (the wave), as G4-01 sketches
  (`packets.md:80`). Optional **nightly** against `main` once it is stable, as G6-04 plans for the stamp.
- **Merge-train gate:** none. A wave close runs it by hand through the orchestrator, per the revised Wave test
  procedure (section 6).
- **Cost.** Scripted bots send no model tokens (bots have no Mind; `bench` says "before any model is attached"). The
  package never starts a Mind, never runs `adam up` (port 7410), and never calls Ollama. Runs with a real model
  (cohort, Adam) are a different tier, capped by their own protocol (`protocol.json`, D-CS-11) and by owner approval.
  The cost left is machine time: the 11-minute lane, shard boot (50 s for Paper on a hosted runner, from the spike),
  and disk (the spike measured 2143 MB growth).

## 4. The seed session

The seed session is the [capture runbook](../../runbooks/capture-real-payloads.md), run once by hand by the `ops`
agent. It is the manual form of the first scenarios. Its outputs are the seed:

- the raw payloads, byte for byte, in the four worknotes, which become the first fixtures;
- a list of which listeners are unregistered (the gap), which decides the order of cards;
- the vocabulary the runner needs (which RCON verbs, which actions, which window clicks), learned from the new
  throwaway script (`golem/test/live/scratch/provenance-capture.ts`, proposed, not written);
- the evidence of what works on this machine under WSL.

It cannot run on `main` today. The runbook's first section lists why (verified 2026-11-19 at `7efad8ca`):

1. No config flag exists in code (`provenance.enabled` is not read anywhere; AN-28c adds it, default false).
2. `BlockOwnerSetup.java:83-84` passes no sink to `BlockChangeListener`, and `PickupProvenanceListener` is constructed
   nowhere in `plugin/core/src/main`.
3. `CombatFactListener` and `ContainerTakeListener` are registered nowhere (AN-50a).
4. The card order puts the payload captures before AN-26b and AN-27b, but the captures need AN-28c and AN-50a merged,
   which the order puts last. Someone must choose the order.

Unproven on this machine (nothing was run for either document):

- Docker in WSL with the compose bind mounts (`../plugin/core/build/libs/geldar-core.jar`, `paper-entrypoint.sh`);
- a JDK and Gradle build of the plugin inside WSL (the alternative is copying the two jars);
- `pwsh` 7 running `./geldar.ps1 shard up` in WSL (FX-SECRETS ran only the secrets code there);
- `127.0.0.1` port forwarding from WSL to Windows clients (run everything in WSL to avoid it);
- the `nats` CLI inside `nats:2.15.1-alpine` (the repo's `progress-metrics.md` assumes it);
- `bench/sheet/run.sh up|down` as a whole;
- a CoreProtect-present overlay, which does not exist (`compose/phase0.yml` has no CoreProtect mount; only
  `compose/colo.yml:148` has);
- the `node --experimental-strip-types` validator one-liner;
- whether a furnace take sends a message (the worknote says it passes the holder rule; the capture brief expects
  nothing).

## 5. AN-28b and AN-28c on the default (no-sheet, no-provenance) path

Neither card is on `main`. Conclusions rest on the cards (`work-packets-sheet-w3-w5.md:424-457`) and on the current
code; the final diffs are unverified.

**AN-28b** adds one option, `observations?: boolean`, and one block to `startAdamBody`
(`golem/src/adam/adam-body.ts`, today 413 lines, `watchHurts(bot, hurts, tick)` at line 340). The card says that with
the option absent or false the path is "byte-for-byte today's": a three-argument `watchHurts` and no subscription, and
nothing sets the option in W5. So the default Body is unchanged provided the block is guarded by `env.observations ===
true && env.owners`; review must confirm no line outside it moves. (`startAdamBody` is also called from
`golem/src/players/body-host.ts:46`, which the card says it is not; the option is unset there too.) The benchmark does not
import `adam-body`, so AN-28b cannot move a benchmark number.

**AN-28c** touches the plugin and the NATS role table. Plugin: with `provenance.enabled` unset (code default false),
no provenance message is sent; the break listener short-circuits before reading anything
(`BlockChangeListener.java:62`) and then runs the unchanged owner-change record, and the pickup listener returns on its
first line (`PickupProvenanceListener.java:45-47`). What changes on the default path is one extra boolean read per block
break and one extra listener dispatch per pickup event on the server thread. Its cost is unmeasured. Role table: the
`body` entry gains `provenance.>` in `Sub` and `PubDeny` (`geldar.ps1:403,407`). That applies only where the NATS auth
overlay is used (opt-in; the default phase0 NATS is open, `compose/phase0.yml:39`). Where it is used, it changes the
permission set of every `body` connection, so a malformed entry would break the generated configuration for every user;
that is what the extended `nats-auth.test.ts` and `nats-auth.it.test.ts` are for. No Body publishes or subscribes on
`provenance` today, and `paper` already may publish `geldar.<shard>.>`, so no existing behaviour is denied. The card
says the live node's NATS configuration is changed by the operator by hand; nothing is switched on there.

**Benchmark.** Once per wave at the end, per the SOP (run-shard skill "Wave test procedure": "Run this once per wave,
after the wave branch is merged and checked"). The body-bench skill's trigger is a change to `golem/` actions or
reflexes; neither card touches those. Per card, no.

## 6. Proposed change to the run-shard skill (not applied)

File: `.claude/skills/run-shard/SKILL.md`, section "Wave test procedure". I did not edit it. Apply as a reviewed change
once the package exists. Until then the old text stands.

Change 1, the opening sentence.

Old:

```
Run this once per wave, after the wave branch is merged and checked, on the code you want measured:
```

New:

```
Run this once per wave, after the wave branch is merged and checked, on the code you want measured. The package run in
step 5 covers this wave and every earlier wave, so a wave never closes on its own scenarios alone:
```

Change 2, after step 4 add step 5 and a closing sentence.

Old (the end of step 4):

```
4. Then the benchmark (`body-bench` skill). The live lane, the integration tests and the benchmark use the one shard: run them one at a time.
```

New:

```
4. Then the benchmark (`body-bench` skill), recorded on a clean committed tree with every feature flag unset.
5. Then the test package (`<runner command>`), with `--through <this wave>`: this wave's scenarios plus every earlier
   wave's, each in its `off` and `on` variants (the controls matrix). The package sets feature flags and writes only to
   the scratch volume, so it runs after the recorded benchmark, never before it. Attach its report; it names the commit.
   A scenario reported `blocked` is a finding, not a pass.
The live lane, the integration tests, the benchmark and the package use the one shard: run them one at a time, with
nothing else connected.
```

Change 3, section "Adam and live cases": add one bullet.

Old: (none)

New:

```
- The test package starts its own scripted bots, like the live cases: never run `adam up` before it.
```

`<runner command>` is a placeholder: the command does not exist yet.

## 7. Open questions for the owner or orchestrator

1. Card order for the owed captures (runbook, gap 4): register first, or a throwaway registration branch.
2. Under NATS auth, who may subscribe to `provenance.*` on a scratch stack? The capture works on the open default
   phase0 shard; `scratch.sh` refuses open NATS. No role should be widened.
3. One scripted-player system or two: package versus G6-04.
4. Where scenario data lives and who reviews it (a new package needs a `pnpm-lock.yaml` slot, as S12-06 notes for
   `tools/cohort-run/`).
5. Whether the package's fixtures may live in the repo (they are raw plugin messages, Body-only, never agent-facing, and
   hold test life ids only; no account names).
