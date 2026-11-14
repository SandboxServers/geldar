# Harness campaign: one Mind in the player kit, with character sheets and local-model support

Ledger for the campaign. Written 2026-11-14 from three inputs and one owner ruling:

- the character-sheet brief and its geldar integration plan (62 packet candidates, waves W0 to W12, written against geldar `8eac28ba`),
- the "v3 kit plan" (the kit as the one Mind, a `local` harness for vLLM and Ollama, an instinct step before each waking),
- the owner's ruling of 2026-11-14: **the in-house Mind (`animus/` in geldar) is abandoned. The Mind is the player kit, with a harness per model family: Claude (the vendor CLI), ChatGPT (the kit's own loop) and local models (vLLM and Ollama, through the same loop).**

Status: **planning. No packet has been dispatched yet.** Decisions D-HC-02 to D-HC-11 were taken by the orchestrator under the owner's delegation on 2026-11-14 and logged as decision 78 in `docs/analysis/scriptorium/worknotes/overnight-decisions.md`; the geldar `D-CS-nn` answers are assumed at their recommended values (marked *assumed*). The campaign is sliced so the first two waves need no such ruling.

## Exit criteria

1. A player can run on the Claude CLI, on a ChatGPT subscription or on a local model served by vLLM or Ollama, from the same character files, the same memory, the same launcher and the same supervisor. A conformance probe decides whether a server is supported.
2. Tokens and turns are metered for every harness, and every world event carries the harness and model that produced it.
3. Every proposal in the character-sheet brief is delivered or explicitly retired by a recorded decision: sheets, the roll engine, threat and proficiency in the Body, the instinct step (idle, failure, novelty, stranger, sanity), the social model, the three new programs, full evidence, morality hooks, lineage, drift, and the cohort comparison across harnesses.
4. Nothing is switched on for a live player by this campaign. Activation is its own owner decision (D-CS-10, D-CS-12).

## Two repositories, three tracks

| Track | Repo | What lives there | Packet ids |
|---|---|---|---|
| **Kit** | `SandboxServers/geldar-scriptorium` | `packages/mind-loop`, transports, the `local` harness, the instinct step, the sheet-to-persona generator, the social model, launcher, supervisor | `HC-nn` |
| **World** | `SandboxServers/geldar` | contract, `psyche/` engine, SQL, eventsink, Golem (the Body), the plugin, operator tools | `AN-nn` (kept from the original plan), `GX-nn` (new) |
| **Cross** | both | the shared engine package, event stamps, cohort protocol | `HC` + `GX` pairs |

The packet cards for the world track are written here so the campaign has one ledger, but they are executed in the geldar repo by that repo's orchestrator, under that repo's rules (`docs/analysis/phase1/packet-conventions.md`). The geldar session owns merges, number reservations (ADR, migration, prompt versions) and deploys. This campaign never touches the Colo or a node.

## What changed when the in-house Mind was dropped

See [retarget-map.md](retarget-map.md) for all 62 original packets. In short:

| Original | Now |
|---|---|
| Body work (threat policy, proficiency, observed-actor evidence, programs, combat and container evidence, property-refusal hook, lineage and drift storage, exporter) | **Kept in geldar** (`AN-nn`, trimmed of every Animus consumer) |
| Mind work in `animus/` (heuristic ports, idle, failure, novelty, stranger, sanity, social model, prompts, persona export, no-call execution) | **Re-targeted to the kit** as `HC-nn`: the **instinct step** (`geldar-instinct`) that the supervisor runs before each waking, and the generators in the launcher |
| Work that needs a Postgres memory store or a commitment scheduler inside the Mind (AN-20, AN-38, AN-48) | **Deferred** (no such store exists in the kit; `BlockedDecision` D-HC-06) |
| Mind-side SQL (social-model rows, heuristic state) | **Replaced** by a kit-local store in the supervisor's state volume (D-HC-04) |

## Decisions

| id | Question | Status | Answer used by the packets |
|---|---|---|---|
| D-HC-01 | One Mind: the kit, with a harness per model family; freeze the in-house Mind | **Accepted** by the owner, 2026-11-14 (decision 77) | Yes. Answers geldar review E21 row 5 |
| D-HC-02 | How the kit and the Body share the roll engine | **Accepted** (decision 78) | `psyche/` is written once in geldar and **mirrored** into the kit as `packages/psyche`, pinned by a recorded tree hash with a CI test (HC-17, GX-02). A published package is a later option |
| D-HC-03 | Where the sheet lives | **Accepted** (decision 78) | The world database is canonical (AN-04). The kit gets a copy that only the supervisor can read, written by the launcher at `new` and refreshed by an explicit owner command. Never in the workspace, never in the model's environment (see HC-26's child-environment test) |
| D-HC-04 | Where the instinct step keeps state and its audit | **Accepted** (decision 78) | A kit-local store and `instinct.jsonl` in the supervisor volume (`geldar-sup-<id>`), plus a source tag on every act it settles. No Postgres access from the kit. The operator export (HC-37) reads the volume |
| D-HC-05 | The `local` harness API | **Accepted** (decision 78) | OpenAI-style chat completions with plain function tools, nothing else. No `tool_choice`. The kit validates arguments itself. A server is supported if `local-check` passes (v3 plan section 3.4) |
| D-HC-06 | Commitments and promises in the kit | **Accepted: deferred** (decision 78) | The kit has markdown memory, no commitment store. AN-20 (scheduled wakes), AN-38 (law-weighted wakes) and AN-48 (promise outcomes) wait for a design (HC-33 is the question card) |
| D-HC-07 | Sanity veto | **Accepted** (decision 78) | Round 1: owned-loop harnesses (ChatGPT, local) only, as a pre-act check inside `mind-loop`. The Claude harness gets it later through a PreToolUse hook, behind its own card |
| D-HC-08 | Metering | **Accepted** (decision 78) | Tokens and turns per day for every harness. A token cap is added next to the dollar cap. The dollar cap stays for Claude |
| D-HC-09 | Instinct step default | **Accepted** (decision 78) | Off. A per-world switch and a declared arm. Never settles a first-time sighting, speech addressed to the agent, or a failure past the cap |
| D-HC-10 | Packet size | **Accepted** (decision 78) | Haiku coder, about 40k working tokens for kit cards (the kit convention); world cards may use up to 50k. Anything over is split before dispatch |
| D-HC-11 | Live activation | **Accepted** (decision 78) | This campaign merges inactive code only. No ranger, no Picard, no live shard changes |
| D-HC-12 | The sanity veto needs the sheet's common_sense in the loop | **Accepted** (decision 79) | One derived integer is delivered on descriptor 4 to owned-loop harnesses only; the model never sees it; HC-26c proves it |
| D-HC-13 | Temperament wordings (HC-25) | **Accepted for merge, owner approval before use** (decision 79) | Kit B wrote its own bank of three wordings per field. Merging is inactive code. The owner approves the wordings before any persona uses them |
| D-HC-14 | What d20-off means for the moral hooks | **Accepted** (decision 79) | Hooks fail open: with rolls off a hook never refuses. This avoids the geldar B finding that the recommended deterministic rule makes law 3 at DC 11 refuse every time |
| D-CS-01 to D-CS-18 | The geldar behavioural questions in `decisions-before-packets.md` | **Assumed** (decision 78) | **Assumed: the recommended answers** (heuristics choose means to adopted goals, never goals; d20-off defined per function; eventsink owns XP; both moral hooks default off; behaviour-based drift default off; fallback after a two-call allowance). Packets that depend on one name it. If the owner changes an answer, the named packets are re-sliced |

Mapping note: where this campaign says "heuristic" it means a function inside the instinct step (HC), not the Mind of geldar. Where the geldar plan says "Mind", read "kit".

## Waves

The kit track starts first because it needs no behavioural ruling and is what the owner asked for. The world track's W1 and W2 can run in parallel with it once the early D-CS answers are recorded.

| Wave | Track | Packets | Exit |
|---|---|---|---|
| **HW0** ground truth | Kit | HC-00 to HC-04 | Decision recorded; docs say what is true; the meter and event stamps exist for the harnesses that exist today |
| **HW1** one loop, three transports | Kit | HC-05 to HC-16 | A local model on vLLM or Ollama plays a disposable player through the same supervisor; `local-check` passes on both servers; nothing else changed for Claude or ChatGPT players |
| **W1** durable foundations | World | AN-02 to AN-07 (trimmed), GX-01, GX-02 | Sheet, roll and proficiency contracts, tables and loaders exist and are inactive; the engine is released for mirroring |
| **W2** Body diversity and proficiency | World | AN-08 to AN-12 | Threat policy and exactly-once XP work for Adam and one sovereign Body |
| **HW2** the instinct step | Kit | HC-17 to HC-24 | Off by default; with it on, a disposable player settles routine acts in code with recorded rolls and escalates everything else |
| **HW3** temperament and persona | Kit | HC-25, HC-26 | A sheet becomes birth-time persona sentences; the sheet never reaches the model |
| **W5** observed evidence | World | AN-24 to AN-28 | An observer sees only causal, visible hits, gifts and breaks |
| **HW4** social model | Kit | HC-27 to HC-30 | Estimates update once per valid observation; same policy predicts; prose is bounded |
| **W7** programs | World + kit | AN-44, AN-39, AN-40, AN-41, AN-45 (Body half); HC-31 | Explore, farm and patrol exist and are chosen by eligible idle picks |
| **W8** full evidence | World | AN-46, AN-47, AN-49, AN-51, AN-50 | All proficiency sources and observer evidence rows work, deduplicated. (AN-48 deferred, D-HC-06) |
| **W9** moral hooks and trust | World + kit | AN-52, AN-37, AN-53 (trimmed); HC-32 | Property refusal behind its flag; estimates reach the reflect skill. (AN-38 deferred) |
| **W10** lineage | World + kit | AN-54, AN-42, AN-55 (world half), AN-57; HC-34, HC-35 | Real headless and sovereign children inherit sheets and synthesized prose exactly once |
| **W11** drift | World + kit | AN-58, AN-43, AN-59, AN-60 (world half); HC-36 | Default-off drift with a seven-day window, one-point cap and persona refresh artifact |
| **W12 / HW5** measurement and close | Both | AN-33 to AN-36; HC-37 to HC-39 | A cohort report that separates the harness, the instinct step and the sheet; docs sweep; retro |

HW1 is the first thing to dispatch. It has no external dependency except the already-merged ChatGPT harness (PR #103).

## Packet ledger

**104 cards are written** in the card files: 58 kit cards (HC-00 to HC-39, with splits, plus HC-40), 40 world cards kept or re-sliced from the original plan (AN-nn, with splits) and 6 new world cards (GX-01a/b/c, GX-02, GX-03, GX-04). The exact list, with each card's dependencies and size, is [ledger.md](ledger.md), generated from the card files by `tools-ledger.mjs`. The table below summarises it by original packet and wave. Cards were split (a, b, c) when the author judged one over its size; the summary rows name the packet, not each split.

Status values: **Ready** (prescriptive card, dependencies merged or in the same wave), **BlockedDependency**, **BlockedDecision**, **Writing**, **Review**, **Done**. Nothing is `Ready` until the card file listed is committed and its wave branch exists. "Card" is the file holding the packet.

| Packet | Title | Repo | Wave | Depends on | Status | Card |
|---|---|---|---|---|---|---|
| HC-00 | Record D-HC-01 to D-HC-11 as a decision in `docs/decisions/` | kit | HW0 | none | Writing | [kit A](work-packets-kit-a.md) |
| HC-01 | Docs: `clients.md`, `architecture.md` and `chatgpt.md` describe three harnesses | kit | HW0 | none | Writing | kit A |
| HC-02 | Record the ChatGPT harness live acceptance (ops) | kit | HW0 | PR #103 | Writing | kit A |
| HC-03 | Token and turn meter and cap for every harness | kit | HW0 | none | Writing | kit A |
| HC-04 | Stamp harness and model on supervisor records and keeper checkpoints | kit | HW0 | HC-03 | Writing | kit A |
| HC-05 | Extract `packages/mind-loop` from `packages/chatgpt` | kit | HW1 | HC-01 | Writing | kit A |
| HC-06 | Transport interface; move the Responses transport behind it | kit | HW1 | HC-05 | Writing | kit A |
| HC-07 | The `chat` transport (chat completions, function tools) | kit | HW1 | HC-06 | Writing | kit A |
| HC-08 | `harness: "local"`: settings, supervisor, compose, both launchers | kit | HW1 | HC-07 | Writing | kit A |
| HC-09 | Egress allowlist entry for the configured local endpoint | kit | HW1 | HC-08 | Writing | kit A |
| HC-10 | Context budget and trimming | kit | HW1 | HC-05 | Writing | kit A |
| HC-11 | Tool-call validation and one corrective retry | kit | HW1 | HC-05 | Writing | kit A |
| HC-12 | Image flag: text-only worlds for text-only models | kit | HW1 | HC-05 | Writing | kit A |
| HC-13 | `local-check` conformance probe (library and both launchers) | kit | HW1 | HC-08 | Writing | kit A |
| HC-14 | Conformance workflow against Ollama and vLLM with a small model | kit | HW1 | HC-13 | Writing | kit A |
| HC-15 | Docs: `docs/local-models.md`, onboarding, troubleshooting keys | kit | HW1 | HC-13 | Writing | kit A |
| HC-16 | HW1 integration, owner acceptance run (ops) and wave close | kit | HW1 | HC-09 to HC-15 | Writing | kit A |
| HC-17 | Mirror the roll engine as `packages/psyche`, pinned by hash | kit | HW2 | AN-03, GX-02 | Writing | [kit B](work-packets-kit-b.md) |
| HC-18 | `packages/instinct` and `geldar-instinct`: world link, result protocol | kit | HW2 | HC-17 | Writing | kit B |
| HC-19 | Supervisor runs the instinct step before each waking | kit | HW2 | HC-18, HC-04 | Writing | kit B |
| HC-20 | Failure counting, falling insight, per-agent retry cap | kit | HW2 | HC-18 | Writing | kit B |
| HC-21 | Idle choice: habits, weighted picks, think draw | kit | HW2 | HC-18 | Writing | kit B |
| HC-22 | Novelty from authorized knowledge | kit | HW2 | HC-18 | Writing | kit B |
| HC-23 | Sanity veto inside `mind-loop` (owned-loop harnesses) | kit | HW2 | HC-11, HC-17 | Writing | kit B |
| HC-24 | HW2 integration against a fake world and wave close | kit | HW2 | HC-19 to HC-23 | Writing | kit B |
| HC-25 | Sheet-to-persona generator for `geldar-play new` | kit | HW3 | HC-17 | Writing | kit B |
| HC-26 | Supervisor-only sheet delivery and the child-environment test | kit | HW3 | HC-17, D-HC-03 | Writing | kit B |
| HC-27 | Social model store and evidence updates (kit-local) | kit | HW4 | AN-28, HC-18 | Writing | [kit C](work-packets-kit-c.md) |
| HC-28 | Prediction and the stranger policy | kit | HW4 | HC-27 | Writing | kit C |
| HC-29 | Bounded social prose as prompt facts | kit | HW4 | HC-27 | Writing | kit C |
| HC-30 | HW4 integration and wave close | kit | HW4 | HC-28, HC-29 | Writing | kit C |
| HC-31 | Idle binding for the new Body programs | kit | W7 | AN-45, HC-21 | Writing | kit C |
| HC-32 | Estimates reach the reflect skill as facts | kit | W9 | HC-29 | Writing | kit C |
| HC-33 | Promises in the kit: the design question and an adapter spike | kit | W8 | D-HC-06 | BlockedDecision | kit C |
| HC-34 | `geldar-play new --parents`: child creation handoff | kit | W10 | AN-54, AN-55 | Writing | kit C |
| HC-35 | Seed prose synthesis through the player's own harness | kit | W10 | HC-34 | Writing | kit C |
| HC-36 | Drift trigger at sleep and the persona refresh artifact | kit | W11 | AN-43, HC-25 | Writing | kit C |
| HC-37 | Operator export of the supervisor volume's ledgers | kit | HW5 | HC-19 | Writing | kit C |
| HC-38 | Cohort arms by harness in the launcher and fixtures | kit | HW5 | HC-16, HC-37 | Writing | kit C |
| HC-39 | Campaign close: docs sweep, retro | kit | HW5 | all | Writing | kit C |
| GX-01 | Stamp harness and model on every world event | world | W1 | HC-04 | Writing | [geldar A](work-packets-geldar-a.md) |
| GX-02 | Release the `psyche/` engine for mirroring | world | W1 | AN-03 | Writing | geldar A |
| GX-03 | Owner-authenticated read of an owner's own life sheet, for the launcher | world | W10 | AN-04, AN-05 | Writing | geldar C |
| GX-04 | Move the pieces of `animus/` the live player path imports | world | W1 | none | Writing | [extra](work-packets-extra.md) |
| HC-40 | A ChatGPT usage limit is a limited run, not a failed cycle | kit | HW0 | HC-06b | Writing | extra |
| AN-02 to AN-07 | Contract, engine, SQL, loaders (Body and roster only), audit projection, wiring | world | W1 | see card | Writing | geldar A |
| AN-08 to AN-12 | Threat, proficiency evidence, XP, query and cache, integration | world | W2 | AN-07 | Writing | geldar A |
| AN-24 to AN-28 | Observed attacker, gift, break, integration | world | W5 | AN-12 | Writing | [geldar B](work-packets-geldar-b.md) |
| AN-44, 39, 40, 41, 45 | Programs (Body) | world | W7 | AN-28 | Writing | geldar B |
| AN-46, 47, 49, 50, 51 | Evidence and proficiency sources | world | W8 | AN-45 | Writing | geldar B |
| AN-52, AN-37, AN-53 | Property refusal and wiring | world | W9 | AN-50 | Writing | geldar B |
| AN-54, 42, 55, 57 | Lineage (world half) | world | W10 | AN-53 | Writing | [geldar C](work-packets-geldar-c.md) |
| AN-58, 43, 59, 60 | Drift (world half) | world | W11 | AN-57 | Writing | geldar C |
| AN-33 to AN-36 | Export, metrics, cohort fixtures, close | world | W12 | AN-60, HC-37 | Writing | geldar C |
| AN-00, AN-01 | Replaced by HC-00; the Codex adapters stay optional | world | W0 | none | Retired / optional | [retarget-map.md](retarget-map.md) |
| AN-13 to 23, 29 to 32, 38, 20, 48, 61 | The Mind work | | | | Retargeted or deferred | [retarget-map.md](retarget-map.md) |

## Numbers to reserve (recommendations, as seen at geldar `a1c6fb2a`)

The geldar coordinator reserves these through geldar's own registry; the cards say `<allocate via registry>`. Highest decision on main is 0181 (0169 and 0173 are in flight), so 0182 and up; SQL migrations 0037 and up (0035 and 0036 are in flight); body-api v7 is taken by `till` (decision 0167), so the new programs would use v8; thought prompt versions are not needed. The registry file's own next-free lines are stale. Re-check the day a card is dispatched.

## How to work this campaign

Follow the `campaign-packet` skill (`.claude/skills/campaign-packet/SKILL.md`): one integration branch per wave (`scriptorium/hw<N>`), one worktree per packet, a fresh reviewer per packet, a wave reviewer, then docs, retro and process. Dispatch rules are in each card file's header. World cards are dispatched in the geldar repo under its own rules.

Honest limits of this document set:

- The cards were written by parallel authors from the code and checked against each other only by reading their headers, shared-contract sections and open-items lists (the stamp field names agree: `harness` and `model`, `X-Geldar-Harness` and `X-Geldar-Model` on the wire). Every card marks names it could not confirm `(to confirm)`; their open-items sections are the first thing to resolve before a wave is dispatched. The kit cards (A, B, C) were written against `geldar-scriptorium` at `ea1e0ed` (rc18 plus `main`), reading the code. The world cards were written against `geldar` `main` at `907f5b8a` and the integration plan's `8eac28ba`. File names that did not exist when written are marked *new*; names that were not found are marked *to confirm* in the card. A card with *to confirm* items is not `Ready`.
- The social, lineage and drift cards are slices of a design that the brief leaves open in places; they say so and name the decision.
- The behavioural numbers (thresholds, DCs, sampling windows) are the brief's first guesses and stay unmeasured.
