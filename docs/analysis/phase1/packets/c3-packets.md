# Phase 1 wave C3 packet cards

Status as of 2026-11-10, branch `docs/phase1-packets-c3`. Packets P1-C3-00 to C3-10 for wave C3 (population and operability), in the card format of [packet-conventions.md](../packet-conventions.md) (section 1). The wave is in [plan.md](../plan.md) (C3, section (e) and the C3 section after it). The schedule and the decision blocks come from the wave breakdown; the decision block for C3 is 0105 to 0114 (conventions section 6).

Rules for reading these cards:

- Anything marked **[J]** is planner judgment (a proposal). The coder may not change it without an "index line to add" request or an owner answer.
- Decisions 0074, 0043, 0064 and 0052 are accepted and bind C3. 0076 (backup) and 0079 (credits) are not used by C3.
- File paths are on `origin/main` (the repo layout is the same in every worktree). Line numbers were read on 2026-11-10; the coder re-checks them before editing.
- The card-level `may-edit` lists are exhaustive. Anything else is out of scope.
- Live steps (node, real client, wall clock) are O. They are never part of a B packet's acceptance.

## 1. Shared facts the cards rely on

| Fact | Where | Consequence for C3 |
|---|---|---|
| The `prepared` receipt is never written. The Body sends `accepted` and `running`, runs the action, then writes one receipt with phase `committed` or `aborted`. | `golem/src/body/executor-action.ts:60-93` | C3-05 adds the `prepared` write before the run and keeps the receipt id `receiptIdFor(action_id, phase)`. |
| The `sleep` MCP tool writes the days-since-sleep mark before the Body answers. | `threshold/mcp/src/tools/sleep.ts` (around lines 96 to 103) | C3-02 moves the write after a completed Body result. |
| The Body's `sleep` finds a bed within 32 blocks and nothing else. | `golem/src/actions/sleep.ts:48` | C3-03 makes an enclosed shelter a valid sleep (decision 0074, point 2). |
| `isEnclosed` checks the six cells around the Body. | `golem/src/body/view.ts:112` | The shelter test for C3-03 and the `enclosed` field already exist. |
| The MCP contract already accepts `do: "build"` with a `blueprint` of up to 512 blocks, each offset in [-256, 256]. The Body has no handler. | `contract/src/generated/mcp-tools.ts:150-209` (generated; edit the schema in `contract/`, then regenerate) | C3-03 implements the handler; no schema change is needed unless C3-00 finds one. |
| A Body run is limited by `max_block_operations`; the tracker counts block operations for the intent. | `golem/src/body/executor-intent.ts:99`, `golem/src/body/limits.ts:76` | Build cost is counted against this tracker (section 3). |
| Sovereign players' intents write events only, not rows in `intents`, `actions` or `receipts`. | `docs/analysis/phase0/known-gaps.md` (Corrections, perception, shelter) | C3-01 writes the rows; C3-00 adds the columns it needs. |
| The `intents`, `actions` and `receipts` tables are keyed by `life_id`. `receipts` already allows phase `prepared` and has `UNIQUE (action_id, phase)`. | `sql/0001_init.sql:30-47` | No table is rebuilt; C3-00 adds columns and one table. |
| The owner cap is 20 for the owner and 3 by default, enforced by trigger. | `shards/phase0.yaml:103-104`, `sql/0006_owner_cap_trigger.sql`, decision 0052 | C3-04 moves the roster and the cap into the database and keeps the trigger. |
| The thought deadline is `deadline_s: 25` after dispatch. | `shards/phase0.yaml:59`, known-gaps (thought deadline) | C3-04 measures it; it does not change the value. |
| The eventsink DLQ has steps in its README and no command. | `eventsink/README.md` ("Dead letters and replay", around lines 14 to 18) | C3-07 adds the replay command. |
| The TPS reader uses the world tick counter across `server_tps` events, over a 5-minute window. | `tools/adam-run/src/tick-rate.ts:8-9` | C3-07 runs it live for the first time. |
| `tick_rate: 20` is the gate; no time dilation in Phase 0. | `shards/phase0.yaml:5`, decisions 0038 and 0047 | The benchmark pass rule uses 20 TPS. |
| The wait cursor is shard-wide JetStream sequence, with about 20 literal `c_N` sites. | known-gaps (wait cursor); `threshold/mcp/src` | C3-05 makes it per-life; the coder counts the sites at start. |

## 2. Persistence tables and migration numbering

**Migration numbering.** The next free number on `origin/main` is `0007` (existing: `0001` to `0006`). C1-05a (journals append-only) and C2 may merge first. C3-00 takes the next free number when it merges, names it `sql/NNNN_c3_sovereign_rows.sql`, and writes the number in its worknote. A merged migration is never edited. If two C3 packets need a migration, only C3-00 writes one; the others request it. **[J]**

**Tables and columns C3-00 adds (contract and migration only; no code path changes in C3-00):**

| Object | Shape | Used by |
|---|---|---|
| `intents.source` | `TEXT NOT NULL DEFAULT 'thinker' CHECK (source IN ('thinker','sovereign'))` | C3-01 |
| `intents.player_id` | `TEXT NULL REFERENCES mcp_players(player_id)` | C3-01 |
| `actions.source` | same as `intents.source` | C3-01 |
| `wait_cursors` | `life_id TEXT PRIMARY KEY REFERENCES agents, cursor BIGINT NOT NULL DEFAULT 0, updated_seq BIGINT NOT NULL DEFAULT 0` | C3-05 |
| `mcp_roster` | `player_name TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES mcp_owners, max_agents INT NOT NULL DEFAULT 1 CHECK (max_agents BETWEEN 1 AND 4), created_at TIMESTAMPTZ NOT NULL DEFAULT now()` | C3-04 |

Columns `intents.state`, `actions.state` and `receipts.phase` are not changed. `paused` stays events-only, as decision 0043 says. The `prepared` phase is already allowed.

**Roster and cap [J]:** `mcp_roster` holds the Minecraft names an owner may run agents as, and `max_agents` is the agents-per-player limit. The owner cap stays with `mcp_owners` and trigger `0006`. Decision 0052 (owner cap 20) is the record; the spec 5.15.6 difference is an owner item.

**Intent and action record rules.** Decision 0043 point 3 applies to sovereign intents too: the `accepted` event carries goal, program, arguments, preconditions, wake_on and limits; `interrupted` becomes `cancelled` with an `interrupted:` reason. Sovereign rows use the same projection code.

## 3. Build action contract and handler semantics (C3-03)

- **Input (already in the contract):** `do: "build"`, `blueprint: { name, blocks[] }`. `name` matches `^[a-z][a-z0-9_]{0,63}$`. `blocks` has at most 512 items. Each item is `{ block, dx, dy, dz }`, with each offset an integer in [-256, 256]. Offsets are relative to the Body's feet cell in the snapshot the plan was made from.
- **Refusal before any placement:** more than 512 blocks is refused by the schema (MCP side) and again by the Body with reason `invalid_args`. Zero blocks is refused as `invalid_args`.
- **Budget (atomic):** a build of N blocks costs N against `limits.max_block_operations` (tracker in `golem/src/body/limits.ts`). If the intent's remaining budget is less than N, the Body refuses the whole build with `limit_reached` before the first block. There is no partial build. **[J]**
- **Order:** place from the lowest `dy` upward, then `dx`, then `dz`, so that supports exist before the block on top of them. **[J]**
- **Place preconditions, checked per block just before the place:** (1) the target cell is air or a replaceable block (grass, snow layer, tall grass); (2) the cell is within reach of the Body; (3) the cell below is solid where the block needs support; (4) no entity stands in the cell; (5) the item is in inventory, with the count the blueprint needs in total; (6) the snapshot revision still matches the Body's (the plan is refused with `stale_snapshot` if the Body moved to another cell).
- **Failure in the middle:** the first failed block stops the build. The result is `failed` with `detail: { placed, failed_index, reason }`. Blocks already placed stay placed; the agent is woken with the detail. **[J]**
- **Receipts:** the build spends items, so it uses the two-phase receipt. `prepared` is written before the first place, with the item counts; `committed` after every block is placed; `aborted` with `detail` (at most 256 characters) otherwise.
- **Shelter result:** a completed build is checked with `isEnclosed` (`golem/src/body/view.ts:112`). The snapshot's `enclosed` flag then reports it.

## 4. Honest sleep mark (C3-02, with C3-03 for enclosed rest)

- The MCP `sleep` tool returns the Body's result. It writes the days-since-sleep mark only when the Body result is `completed` with a rest outcome.
- A `refused` or `failed` result writes no mark and reports the Body's `reason`. The fatigue clock keeps running.
- A sleep in a bed or in an enclosed shelter (decision 0074, point 2) counts as rest. C3-02 changes only the MCP side, so it accepts the bed case the Body already has. C3-03 teaches the Body to accept an enclosed rest within the same result shape.
- No retry or override: the tool does not write a mark to "cover" a refused sleep.

## 5. Crash reconciliation test matrix (C3-06)

The Body writes `body_started` on start (new field, decision 0110). On boot the reconciler reads the checkpoint (NATS KV `geldar-checkpoints`, key `<life_id>`, decision 0043) and the intents and actions rows, then acts as in the matrix. Each row is one unit test with an in-memory fake sink, and one Postgres integration test under `GELDAR_IT=1`.

| # | Case | State before the crash | Expected after reconciliation | Test name |
|---|---|---|---|---|
| 1 | No checkpoint, no running action | Clean stop | No-op; `body_started` recorded | `reconcile: clean stop is a no-op` |
| 2 | No checkpoint, running action | `actions.state = running`, no checkpoint for the life | Action `aborted` with detail `crash_no_checkpoint`; receipt `aborted`; intent `cancelled` with reason `interrupted:crash` | `reconcile: running action without checkpoint is aborted` |
| 3 | Checkpoint present, same generation | Checkpoint generation equals `body_generation` | Resume from checkpoint; no receipt written twice | `reconcile: resume from checkpoint at the same generation` |
| 4 | Checkpoint present, older generation | Generation in KV below the current one | Checkpoint discarded; action `aborted` with `crash_generation_mismatch` | `reconcile: stale generation is discarded` |
| 5 | Prepared, no final receipt | `receipts` has `prepared`, no `committed` or `aborted` | `aborted` with `crash_after_prepare`; the inventory is re-read and the item delta is not applied twice | `reconcile: prepared without final receipt is aborted once` |
| 6 | Prepared and committed | Both rows exist | No change (idempotent) | `reconcile: committed receipt is not rewritten` |
| 7 | Crash loop | Reconciler crashes mid-way and runs again | Same final rows as one run (idempotent) | `reconcile: second run is a no-op` |
| 8 | Torn write | Checkpoint newer than the action row | The checkpoint's generation wins; the action row is corrected | `reconcile: checkpoint newer than action row wins` |

Acceptance for C3-06: every row passes; each test is revert-checked by removing the reconcile call for its case (the test then fails). The Phase 0 gap (known-gaps, crash reconciliation: no-checkpoint case and running actions not closed) is closed only when rows 2, 3 and 5 pass.

## 6. N-bot benchmark design (C3-07, live part O)

- **N values [J]:** 1, 5, 10 and 15 bots. Fifteen is the top of the C3 target (10 to 15 agents, plan.md C3).
- **Scenario:** the existing scenario set in `docs/analysis/phase0/bench-results.md` (wood-to-stone-tools, food, shelter, bed, chest, blocked-path), each run 10 times per N, plus a 30-minute steady-state run at N = 15 (a long run: campaign-end gate, 0130; not a wave gate).
- **TPS threshold [J]:** pass needs (a) a mean of at least 19.0 TPS over every 5-minute window (`TICK_WINDOW_MS`, `tools/adam-run/src/tick-rate.ts:9`), and (b) no 5-minute window below 18.0. The gate value is 20 (`shards/phase0.yaml:5`); 19.0 allows for the bots' own load. Owner confirms the numbers (owner question O-4).
- **Measurement on the shared node:** the run uses the off-peak window agreed with the owner. The node also runs the production game server and CI, so the run records load on those (CPU, memory, TPS of the production shard) before and after. A bench that drops the production shard below its own gate is a fail, whatever N.
- **Pass means:** all four N values meet the TPS threshold; at least 90 percent of actions succeed per scenario at N = 1 and N = 10; p50 and p95 are recorded for each row in the table; no run ends in an unexplained `life_ended`. The result rows go to `bench-results.md` with the commit, N, TPS and the node's load note (no addresses).
- **Not pass:** a TPS dip below 18.0, or a dip that the run cannot explain.

## 7. Chaos-day scenarios (C3-09, live part O; the day runs at the end of the phase, 0130)

Each scenario has a fixed expected outcome. A scenario passes when the observed outcome matches; any unexpected death, duplicate receipt, or lost event is a fail.

| # | Scenario | Action | Expected outcome |
|---|---|---|---|
| 1 | Kill the Body mid-action | `docker kill` on the Body container while a `build` is placing blocks | Reconciliation (C3-06, matrix rows 2 and 5); each agent wakes with an `aborted` receipt; no block placed twice |
| 2 | NATS restart | Restart the NATS container for 30 s | Body reconnects; no duplicate events (`source_event_id`); MCP reports the gap and recovers |
| 3 | Postgres restart | Restart the Postgres container | Writes wait and resume; no receipt lost; no journal row lost |
| 4 | Disk nearly full | Fill the data volume to 95 percent (test volume only) | Writes refused with an alarm; nothing silently dropped; the runbook (C3-08) clears it |
| 5 | Thinker offline 15 minutes | Stop the Thinker process | Intents keep running; no wake storm; no death in the window |
| 6 | MCP container recreated | Recreate the MCP container | Event replay is bounded (C1-07, 60 minutes); no action duplicated |
| 7 | Velocity restarted | Restart the proxy | Players reconnect; whitelist from the registry |
| 8 | Restore to scratch shard | Restore the latest backup (C1-05b, deferred by 0130) to a scratch shard; runs only at the end-of-phase chaos day | Checkpoint and journals match the manifest |

The owner signs off the written result (plan.md C3, owner vs agents).

## 8. Soak definition

- **Soak gate (campaign-end gate, resolved by decision 0130).** Continuous, 10 to 15 agents, intents running, on the node, 7 days, run once at the end of the phase after C4 freeze. It is not a C3 gate, and C3-10 does not start it. Exit check for the gate: fewer than one model wakeup per agent per real minute while intents run; no unexplained life end; no unexplained TPS window below 18.0.
- **O-soak: resolved (0130).** One soak, at the end of the phase: the 7-day run in plan.md. The 72-hour soak gate proposed earlier is withdrawn. No soak runs in C3.
- **Measurement:** the wakeup count comes from the event stream (`events` table, `world_day`, `world_tick`), not from logs.

## 9. Cards

Worknotes follow the convention (`docs/analysis/phase1/worknotes/C3-nn.md`). Unblocker ids are `P1-C3-00` in the schedule; the worknote and the branch use `C3-00`. Every card's `commit` line lists the subjects; each item is its own commit.

### P1-C3-00: contract and migration for sovereign rows, wait cursor and roster (unblocker)

- **wave:** C3. **lane:** A. **size:** S (about 40k tokens). **status:** B.
- **depends-on:** C1-00 merged (the contract-first unblocker of C1, so the generator and `check` are the new ones).
- **may-edit:** `contract/` (schema source and the generator's output), `sql/NNNN_c3_sovereign_rows.sql` (new), `contract/test/c3-*.test.ts` (new), `docs/decisions/0105-*.md` (new), `docs/analysis/phase1/worknotes/C3-00.md`.
- **must-not-edit:** `docs/spec.md`, `golem/`, `threshold/`, `tools/`, `shards/`, `compose/`, `geldar.ps1`, `package.json`, `docs/decisions/README.md`, the ledger README, the sql migrations `0001` to `0006`.
- **decisions:** 0105 only.
- **checks:** `./geldar.ps1 pnpm --filter contract test`; generator-up-to-date check; the integration test under `GELDAR_IT=1` against a real Postgres (CI runs it in the Postgres job from C1-00); `./geldar.ps1 check` at the end.
- **steps:**
  1. Run `ls sql/` on `origin/main` and take the next free number (expected `0007`). Write it in the worknote.
  2. Add to the contract source: the `source` and `player_id` fields on intents and actions (section 2), the `wait_cursors` shape and the `mcp_roster` shape. Do not change any enum: `prepared` already exists in receipts.
  3. Run the contract generator (the script in `contract/package.json`). Commit the generated output with the schema, never by hand.
  4. Write `sql/NNNN_c3_sovereign_rows.sql` with exactly the DDL of section 2 (`ADD COLUMN ... DEFAULT 'thinker'` so existing rows stay valid).
  5. Write decision 0105 (status Proposed): the shape of the sovereign rows, the roster table, the migration number. Put the index line in the worknote.
- **acceptance:**
  - A contract test rejects `source = 'other'` on the schema validator (behaviour: schema rejects; line: the enum in the contract source).
  - An integration test applies migrations `0001` to NNNN on an empty database and inserts a row with each new column. Revert-check: delete the `CHECK` on `source` in the migration; the rejection test fails. Restore.
  - The generator check passes with no diff.
- **commit:** `feat(contract): add sovereign intent source, wait cursor and roster schema` (contract, generated output); `feat(sql): add the C3 sovereign rows migration` (migration and decision 0105).
- **on-cap:** commit what passes; write the rest in the worknote.
- **index line to add:** `index: | [0105](0105-c3-sovereign-rows-and-roster.md) | C3 sovereign rows, wait cursor and roster | Proposed |`

### P1-C3-01: intent persistence for sovereign players

- **wave:** C3. **lane:** A. **size:** M (about 40k tokens). **status:** B.
- **depends-on:** P1-C3-00.
- **may-edit:** `threshold/mcp/src/` (the sovereign intent and action write path, one new projection file if needed), `threshold/mcp/test/` (new tests), `eventsink/src/` only where the projection of the `intent` events lives, `docs/analysis/phase1/worknotes/C3-01.md`, `docs/decisions/0106-*.md` (new).
- **must-not-edit:** `docs/spec.md`, `contract/`, `sql/`, `golem/`, `shards/`, `compose/`, `geldar.ps1`, `package.json`, the decisions README.
- **decisions:** 0106 only.
- **checks:** `./geldar.ps1 pnpm --filter @geldar/mcp test` (the package name is in `threshold/mcp/package.json`); typecheck and `pnpm format` for the touched packages; the integration test under `GELDAR_IT=1`.
- **steps:**
  1. Find where a sovereign intent emits its events. Note the file and line in the worknote; known-gaps says "events only".
  2. On `accepted`, insert the `intents` row with `source = 'sovereign'` and `player_id`, using the projection rules of decision 0043 point 3.
  3. On each action, insert the `actions` row with `source = 'sovereign'`. On each receipt from the Body, insert the `receipts` row (phases `prepared`, `committed`, `aborted`).
  4. Apply the retry rule of decision 0043 point 2 to audit writes (retry in order with capped backoff; log the first failure).
  5. Write decision 0106 (status Proposed) for the sovereign write rule.
- **acceptance:**
  - Unit test: an `accepted` sovereign event writes one `intents` row with `source = 'sovereign'`. Revert-check: skip the insert; the test fails.
  - Integration test (`GELDAR_IT=1`): one sovereign play session produces matching `intents`, `actions` and `receipts` rows with the same ids as the events. Revert-check: the same skip; the test fails.
  - Retry test: a sink that fails twice then accepts still writes the row once (no duplicate).
- **commit:** `feat(mcp): write sovereign intent, action and receipt rows` (write path); `test(mcp): cover sovereign row persistence and retry` (tests and decision 0106 if separate).
- **on-cap:** commit what passes; the rest goes to the worknote. If the event source is in `golem/`, stop and request it through an index line; do not edit `golem/`.
- **index line to add:** `index: | [0106](0106-sovereign-intent-row-write-rule.md) | Sovereign intents write rows | Proposed |`

### P1-C3-02: honest sleep mark

- **wave:** C3. **lane:** B. **size:** S (about 25k tokens). **status:** B.
- **depends-on:** none (C1-00 merged). It does not touch the contract.
- **may-edit:** `threshold/mcp/src/tools/sleep.ts`, `threshold/mcp/src/ports.ts` only if the `SleepMarks` port needs a method, `threshold/mcp/test/sleep*.test.ts` (new or existing), `docs/analysis/phase1/worknotes/C3-02.md`, `docs/decisions/0107-*.md` (new).
- **must-not-edit:** `docs/spec.md`, `golem/`, `contract/`, `sql/`, `shards/`, `compose/`, `geldar.ps1`, `package.json`.
- **decisions:** 0107 only. C3-03 does not use 0107 (its record is 0114).
- **checks:** `./geldar.ps1 pnpm --filter @geldar/mcp test`; typecheck and `pnpm format`; `./geldar.ps1 check` at the end.
- **steps:**
  1. Read `threshold/mcp/src/tools/sleep.ts` around lines 90 to 110. The mark write sits before the Body answers.
  2. Move the write after the Body result. Write the mark only for a `completed` result with a rest outcome (section 4).
  3. Return the Body's status and reason in the tool result, so the agent sees a refusal.
  4. Do not change the Body's `sleep` (`golem/src/actions/sleep.ts`); that is C3-03.
  5. Write decision 0107 (status Proposed): the sleep mark is written on a completed Body result only.
- **acceptance:**
  - Refused sleep (fake Body returns `refused`, reason `no_bed`): no mark is written and the reason appears in the tool result. Revert-check: restore the unconditional write before the Body answers; this test fails.
  - Completed sleep: exactly one mark is written. Revert-check: remove the write; this test fails.
  - A failed Body call (transport error) writes no mark.
- **commit:** `fix(mcp): write the sleep mark only on a completed Body result` (code and tests); `docs: record decision 0107 for the honest sleep mark` (decision).
- **on-cap:** commit the passing tests; the rest goes to the worknote.
- **index line to add:** `index: | [0107](0107-honest-sleep-mark.md) | Sleep mark is written on a completed Body result | Proposed |`

### P1-C3-03: shelter intent and the `build` handler

- **wave:** C3. **lane:** C. **size:** M (about 40k tokens). **status:** B.
- **depends-on:** P1-C3-00 (the contract is unchanged, but the `source` column is used for sovereign shelter calls), P1-C3-02 (the sleep path it extends), P1-C3-05 (the `prepared` receipt helper that the build uses; if C3-05 is not merged, C3-03 may not start).
- **may-edit:** `golem/src/actions/build.ts` and `golem/src/actions/build.test.ts` (new), `golem/src/actions/sleep.ts` and its test (enclosed rest), the action registry file that maps `do` names to handlers (find it by grep for `'sleep'` under `golem/src/body/`), the intent program registry (grep for an existing program name such as `hazard` or `burrow`), `golem/src/body/reflexes/panic-burrow.ts` only to export the existing burrow plan, `prompts/thought/v6.md` (new copy of v5 plus the `enclosed` line), `prompts/body-api/v2.json` only if its tool list needs the `build` entry, `tools/adam-report/src/survival.ts` and its test, `docs/analysis/phase1/worknotes/C3-03.md`, `docs/decisions/0107-*.md` (shared number, see C3-02).
- **must-not-edit:** `docs/spec.md`, `contract/` (the `build` schema is already there), `sql/`, `shards/`, `compose/`, `geldar.ps1`, `package.json`, `golem/src/body/executor-action.ts` (C3-05 owns it), `prompts/thought/v5.md` (released, immutable, decision 0068).
- **decisions:** 0114 only (the spare of the C3 block, reassigned here from the shared 0107). Section 3 of these notes and decision 0074 are read, not numbered.
- **checks:** `./geldar.ps1 pnpm --filter @geldar/golem test` (confirm the package name in `golem/package.json`); the prompt golden tests; `tools/adam-report` test; typecheck and `pnpm format`; `./geldar.ps1 check`.
- **steps:**
  1. Write `build.ts` to the semantics of section 3: budget precheck, the 512 bound, the place order, the place preconditions, the partial-failure detail.
  2. Register `build` in the action registry. Two-phase receipt: `prepared` before the first place, `committed` or `aborted` at the end (C3-05 writes the generic `prepared` path; this card calls the same helper).
  3. Teach `sleep.ts` to accept an enclosed rest (`isEnclosed`, `golem/src/body/view.ts:112`) as well as a bed, keeping the result shape of C3-02.
  4. Add the shelter intent: a program that runs the existing burrow plan on demand and then builds the blueprint if the cell is not enclosed. Its parameters: the blueprint name and the radius of the search.
  5. Create `prompts/thought/v6.md`: a copy of v5 with one line that renders `enclosed` from the snapshot. Keep v5 unchanged; prompts load v6 only through the default in decision 0074 (owner confirms the default in the decision).
  6. Update `tools/adam-report/src/survival.ts` so that "enclosed for a night" counts (decision 0074, point 2). Keep the bed rule as a second case.
  7. Write decision 0114 (Proposed), as the record step: an enclosed shelter counts as rest (0074 point 2), the build bound and the shelter intent. Its index line goes in the worknote.
- **acceptance:**
  - Build refuses 513 blocks (`invalid_args`, no placement). Revert-check: remove the bound; the test fails.
  - Build refuses N blocks when the budget is N-1 (`limit_reached`, no placement; no partial build). Revert-check: remove the precheck and let blocks place; the test fails.
  - Partial failure: the third of five blocks is occupied; the result is `failed` with `failed_index: 2`, and the first two stay placed. Revert-check: none needed beyond the test (a behaviour test).
  - Enclosed rest: a sleep in an enclosed cell with no bed completes and the MCP mark is written (C3-02 path). Revert-check: restore the bed-only check; the test fails.
  - Golden test: v6 renders `enclosed`; v5 output is byte-identical to before.
  - Survival: an enclosed night passes the criterion; a night in the open fails it. Revert-check: restore the bed-only rule.
- **commit:** `feat(golem): add the build handler with the 512-block bound and budget check` (build and tests); `feat(golem): accept an enclosed rest and add the shelter intent` (sleep, intent, reflex export); `feat(prompts): add thought template v6 that renders enclosed` (v6 and golden test); `fix(adam-report): count an enclosed night as rest` (survival, with decision 0114).
- **on-cap:** commit the handler and its tests first; the shelter intent and the prompt may move to a follow-up card, recorded in the worknote.
- **record:** step 7: write `docs/decisions/0114-enclosed-rest-and-shelter.md` (Proposed): an enclosed shelter counts as rest (0074 point 2), the build bound and the shelter intent. The file name is a suggestion; the number is reserved.
- **index line to add:** `index: | [0114](0114-enclosed-rest-and-shelter.md) | Enclosed rest counts as sleep; shelter intent and build bound | Proposed |`.

### P1-C3-04: roster and cap in the database, agents-per-player limit, measured thought deadline

- **wave:** C3. **lane:** D. **size:** M (about 40k tokens). **status:** B.
- **depends-on:** P1-C3-00 (the `mcp_roster` table), P1-C1-08 (the `owner add` default cap is read from the yaml, the fix that C1-08 makes).
- **may-edit:** the `owner` and roster command code under `threshold/mcp/src/` (find it by grep for `owner add`), `threshold/mcp/test/` (new roster tests), `lantern-local/src/` only for the deadline measurement (find the module that enforces `deadline_s` by grep), `docs/analysis/phase1/worknotes/C3-04.md`, `docs/decisions/0108-*.md` (new).
- **must-not-edit:** `docs/spec.md`, `contract/`, `sql/` (C3-00 owns it), `golem/` (C3-05 and C3-06 use it), `shards/phase0.yaml` (the deadline value does not change in this card), `compose/`, `geldar.ps1`, `package.json`.
- **decisions:** 0108 only.
- **checks:** `./geldar.ps1 pnpm --filter @geldar/mcp test`; the Lantern package test (name in its `package.json`); the integration test under `GELDAR_IT=1`; typecheck and `pnpm format`.
- **steps:**
  1. Move the roster and the cap into `mcp_roster` and `mcp_owners` (section 2). The owner cap default is read from the database; the yaml value is the initial seed only.
  2. Enforce the agents-per-player limit (`max_agents`, default 1 **[J]**) when a sovereign player is started; refuse with a stable error code.
  3. Keep trigger `0006` as it is; add a test that the trigger still refuses the 21st agent for the owner (decision 0052).
  4. Measure the thought deadline: record the elapsed seconds of each thought job in the thought row (the column is added in C3-00 if the row has none; otherwise use the existing column). Do not change `deadline_s: 25`.
  5. Write decision 0108 (Proposed): roster and cap source of truth, the agents-per-player default.
- **acceptance:**
  - A player with `max_agents = 1` cannot start a second agent (`roster_limit`). Revert-check: remove the check; the test fails.
  - The owner cap comes from the database (`owner add` without `--cap` writes the database value). Revert-check: read the yaml value again; the test fails.
  - The 21st agent for the owner is refused by the trigger (integration, `GELDAR_IT=1`).
  - A thought that takes longer than `deadline_s` records a deadline elapsed value above 25 and an outcome of `deadline`. Revert-check: skip the measurement; the test fails.
- **commit:** `feat(mcp): keep the roster and the owner cap in the database` (roster code and tests); `feat(lantern): record the elapsed time of each thought job` (measurement and test); decision 0108 in its own commit.
- **on-cap:** commit the roster first; the measurement can move to a follow-up card.
- **index line to add:** `index: | [0108](0108-roster-and-cap-source.md) | Roster and cap in the database | Proposed |`

### P1-C3-05: `prepared` receipt, aborted receipts and the per-life wait cursor

- **wave:** C3. **lane:** E. **size:** M (about 40k tokens). **status:** B.
- **depends-on:** P1-C3-00 (the `wait_cursors` table). C3-06 may not start until this card is merged (the two share `golem/src/body`).
- **may-edit:** `golem/src/body/executor-action.ts` (the receipt write, lines 60 to 93), `golem/src/body/executor-action*.test.ts` and `golem/src/body/executor-actions.test.ts`, the reflex abort path under `golem/src/body/reflexes/` (only to write the `aborted` receipt), the `wait` tool and its cursor code under `threshold/mcp/src/` (find the `c_N` sites by grep), `threshold/mcp/test/` (wait tests), `docs/analysis/phase1/worknotes/C3-05.md`, `docs/decisions/0109-*.md` (new).
- **must-not-edit:** `docs/spec.md`, `contract/`, `sql/`, `golem/src/body/executor-intent.ts` (C3-06), `shards/`, `compose/`, `geldar.ps1`.
- **decisions:** 0109 only.
- **checks:** `./geldar.ps1 pnpm --filter @geldar/golem test`; `./geldar.ps1 pnpm --filter @geldar/mcp test`; the integration test under `GELDAR_IT=1` for the wait cursor; typecheck and `pnpm format`.
- **steps:**
  1. Before `runtime.runAction` (line 65), write the `prepared` receipt with `receiptIdFor(actionId, 'prepared')`. It is in the sink's queue before the run starts.
  2. For an action that is abandoned before it runs (a reflex aborted by the plan change), write an `aborted` receipt with detail (at most 256 characters). Today such actions get none.
  3. Replace the shard-wide wait sequence with the per-life cursor in `wait_cursors`. Each `c_N` site reads the life's cursor. The coder lists the sites in the worknote at the start.
  4. Write decision 0109 (Proposed): the `prepared` write order, and the per-life cursor rule.
- **acceptance:**
  - A run writes `prepared` before the run and one final receipt after it. Revert-check: remove the `prepared` write; the test fails.
  - An abandoned reflex action gets exactly one `aborted` receipt. Revert-check: remove the abort write; the test fails.
  - A `wait` on life A is not woken by events for life B (per-life cursor). Revert-check: restore the shard-wide sequence; the test fails.
  - `grep` for the literal `c_N` names in `threshold/mcp/src` shows none left (command output in the report).
- **commit:** `feat(golem): write the prepared receipt before a run and an aborted receipt for an abandoned action`; `feat(mcp): give each life its own wait cursor`; decision 0109 in its own commit.
- **on-cap:** commit the receipt change; the cursor moves to a follow-up card with the sites listed.
- **index line to add:** `index: | [0109](0109-prepared-receipt-and-wait-cursor.md) | prepared receipt and per-life wait cursor | Proposed |`

### P1-C3-06: Body crash reconciliation

- **wave:** C3. **lane:** E. **size:** L (two sessions; about 30 files under `golem/src`). **status:** B.
- **depends-on:** P1-C3-05 (shared `golem/src/body`; serialize). P1-C3-00.
- **may-edit:** `golem/src/body/` (the boot reconciler, new `reconcile.ts` and its tests, `body_started` in the Body status), `golem/src/body/*.test.ts`, `golem/src/body/executor-intent.ts` (the resume path), `docs/analysis/phase1/worknotes/C3-06.md`, `docs/decisions/0110-*.md` (new). If a file passes 500 lines, split it first in its own commit.
- **must-not-edit:** `docs/spec.md`, `contract/` (a new status field goes through C3-00 or an index line), `sql/`, `threshold/`, `shards/`, `compose/`, `geldar.ps1`, `package.json`.
- **decisions:** 0110 only.
- **checks:** `./geldar.ps1 pnpm --filter @geldar/golem test`; the reconciler integration test under `GELDAR_IT=1`; typecheck and `pnpm format`.
- **steps:**
  1. Session 1: write `body_started` and the boot reconciler with the eight-row matrix of section 5. Unit tests with the in-memory sink first.
  2. Session 2: the Postgres integration tests for rows 2, 5 and 7; the torn-write rule (row 8); the revert-checks; decision 0110 (Proposed).
  3. Split any file over 500 lines in its own commit before the reconciler lands.
- **acceptance:** the eight rows of section 5 pass by name. Each row is revert-checked by removing its branch in the reconciler; the test for that row then fails. The known-gaps line (crash reconciliation partial) is closed only when rows 2, 3 and 5 pass.
- **commit:** `refactor(golem): split files over 500 lines` (only if needed); `feat(golem): record body_started and reconcile a crashed Body on boot`; `test(golem): cover the crash reconciliation matrix`; decision 0110.
- **on-cap:** commit the matrix rows that pass, in order 1, 2, 3, 5, 6, 7, 8, 4. Write the rest in the worknote.
- **index line to add:** `index: | [0110](0110-body-crash-reconciliation.md) | Body crash reconciliation and body_started | Proposed |`

### P1-C3-07: N-bot benchmark, harness live checks, DLQ replay, bench evidence (live part O)

- **wave:** C3. **lane:** F. **size:** M for the desktop part; the live part is O, and it runs at the end of the phase (0130). **status:** B/O.
- **depends-on:** P1-C1-10 (the node is up and the load check of C1 is done), P1-C3-06 (the Body reconciles, so a bench crash is explainable).
- **may-edit:** `tools/adam-run/src/` (the bot runner and the TPS and `bodyConnected` checks; `tick-rate.ts` is read-only), `tools/adam-run/test/`, `eventsink/src/` and its `README.md` (the DLQ replay command), `docs/analysis/phase0/bench-results.md` only for the new rows, `docs/analysis/phase1/bench/` (new, for the run's summary files without addresses), `docs/analysis/phase1/worknotes/C3-07.md`, `docs/decisions/0111-*.md` (new).
- **must-not-edit:** `docs/spec.md`, `contract/`, `sql/`, `golem/`, `shards/` (the TPS value and `tick_rate` do not change), `compose/`, `geldar.ps1` (the new commands go in as an index line for the integration packet of the wave), `package.json`.
- **decisions:** 0111 only.
- **checks:** `./geldar.ps1 pnpm --filter @geldar/adam-run test`; DLQ replay test against a fake JetStream; the TPS-window unit tests; live runs only under section 6 of these notes, recorded by the owner's checklist (section 10 owner checklist B).
- **steps:**
  1. Desktop: write the DLQ replay command (the steps in `eventsink/README.md` lines 14 to 18 become a command) with a dry-run default and a test against a fake stream.
  2. Desktop: add the `bodyConnected` five-minute silence abort test and the TPS reader test on recorded `server_tps` fixtures (no node).
  3. Desktop: add the bot runner's N parameter (section 6 values) and its summary writer (no addresses in output).
  4. Live (O): run the owner checklist B1 to B6. Record each run in `bench-results.md` with the commit.
  5. Write decision 0111 (Proposed): the TPS rule and the bench pass rule.
- **acceptance:** the DLQ replay dry run lists the dead letters and the non-dry run replays each once (test); the TPS reader gives 20 TPS on a 20 TPS fixture and flags a 17 TPS fixture (test); revert-check: skip the window check; the flag test fails. The live part passes only when the section 6 pass rule is met on the node, recorded in the worknote.
- **commit:** `feat(eventsink): add the DLQ replay command`; `test(adam-run): cover the bodyConnected abort and the TPS window`; `feat(adam-run): add the N-bot runner and summary writer`; `docs: record bench results for N = 1, 5, 10, 15`; decision 0111.
- **on-cap:** desktop items first; the live runs wait for the owner's checklist. Report the live part as not run, with the reason.
- **index line to add:** `index: | [0111](0111-bench-and-harness-live-checks.md) | Bench pass rule and harness live checks | Proposed |` and the command line for `geldar.ps1` (`dlq replay`, help text from the card).

### P1-C3-08: runbooks (docs only)

- **wave:** C3. **lane:** F. **size:** M (docs). **status:** B.
- **depends-on:** none for drafting; the owner review is O.
- **may-edit:** `docs/runbooks/` (new: kill switch, privacy checklist, restore, rollback, chaos day), `docs/analysis/phase1/worknotes/C3-08.md`.
- **must-not-edit:** `docs/spec.md`, any code, `shards/`, `compose/`, `geldar.ps1`, `package.json`, the decisions README. No IP addresses, account names or personal names in any runbook; use the placeholders `<node>` and `<owner-account>`.
- **decisions:** none.
- **checks:** `./geldar.ps1 check` (the docs-link and secret scans in the repo checks); a grep for IPv4 literals other than `127.0.0.1` in `docs/runbooks/` returns nothing.
- **steps:**
  1. Kill switch: the Glass and BlueMap switch and the MCP token revocation, with the exact commands that exist after C2 (a placeholder until then, marked as such).
  2. Privacy checklist: what a sovereign player's data is, what the Glass shows, what the MCP stores.
  3. Restore and rollback: the steps from C1-05b and the compose rollback.
  4. Chaos day: the scenario table of section 7, with the owner's sign-off line.
- **acceptance:** each runbook names its owner and its last check date; the link check passes; the IPv4 grep returns nothing.
- **commit:** `docs: add C3 runbooks for the kill switch, privacy, restore, rollback and chaos day`.
- **on-cap:** commit the runbooks that are complete; the rest in the worknote.
- **index line to add:** none (docs under `docs/runbooks/`; the README link goes in the ops merge step).

### P1-C3-09: chaos-day scripts (live part O)

- **wave:** C3. **lane:** F. **size:** M for the scripts; the live day is O and runs at the end of the phase (0130). **status:** B/O.
- **depends-on:** P1-C3-06 (scenario 1 needs reconciliation), P1-C3-08 (the runbook is the reference for the day), P1-C1-05b (scenario 8, restore; C1-05b is deferred by 0130, so scenario 8 runs at the end of the phase).
- **may-edit:** `tools/chaos/` (new: one script per scenario of section 7, plus a runner that prints the expected and observed outcome), `tools/chaos/test/` (new), `docs/analysis/phase1/worknotes/C3-09.md`, `docs/decisions/0112-*.md` (new).
- **must-not-edit:** `docs/spec.md`, `contract/`, `sql/`, `golem/`, `threshold/`, `compose/*` (the compose files stay as they are; scripts only call `docker`), `geldar.ps1` (an index line for the wave's integration packet), `package.json` (if a package is needed, use the lockfile rule of conventions section 3 and ask for an index line), `shards/`.
- **decisions:** 0112 only.
- **checks:** `./geldar.ps1 pnpm --filter chaos test` (confirm the package name); script help output; `./geldar.ps1 check` for the repo checks.
- **steps:**
  1. Desktop: write one script per scenario (1 to 8), each with `--dry-run` as the default and a `--confirm` flag to act. A script refuses to run against any shard other than the scratch shard.
  2. Desktop: the runner prints the expected outcome (section 7) and records the observed outcome as JSON, without addresses.
  3. Desktop: tests against a fake Docker (scripts build the `docker` argument lists; tests check the lists).
  4. Live (O): owner checklist C (section 10), read-only steps first.
- **acceptance:** each script refuses a non-scratch shard (test); the dry run prints the expected outcome for each scenario (test); revert-check: remove the scratch-shard guard; the refusal test fails.
- **commit:** `feat(chaos): add the scenario scripts and the runner`; `test(chaos): cover the scratch-shard guard and the dry runs`; decision 0112.
- **on-cap:** the scripts with the guard first. The live day is reported as not run.
- **index line to add:** `index: | [0112](0112-chaos-day-scripts.md) | Chaos-day scripts and the scratch-shard guard | Proposed |`

### P1-C3-10: integration and ops: roll C3 onto the node, the chaos day, the soak (O)

- **wave:** C3. **lane:** A. **size:** L, plus the end-of-phase soak wall clock (0130). **status:** O (the roll-out is this wave's; the soak and the chaos day are campaign-end gates).
- **depends-on:** P1-C3-01 to C3-09 merged; P1-C1-10 (the node); the chaos-day sign-off (O-3). O-soak is resolved by 0130 (one soak, at the end of the phase).
- **may-edit:** `shards/phase0.yaml` or a new `shards/phase1.yaml` (the integration packet owns it; index lines from the others are applied here), `geldar.ps1` (the new commands), `compose/` only the lines the integration needs, `docs/analysis/phase1/results/c3-*.md` (new, results only, no addresses), `docs/analysis/phase1/worknotes/C3-10.md`, `docs/decisions/0113-*.md` (new). This packet takes no number: 0114 is C3-03's (the C3 block is full).
- **must-not-edit:** `docs/spec.md`, `contract/` (fan-out index lines go through the ops merge step), `golem/` and `threshold/` source (fixes go back to the owning card), `docs/analysis/phase0/` ledger README.
- **decisions:** 0113 only.
- **checks:** `./geldar.ps1 check` with the integration case-count floor (conventions 4.2); the owner checklists D (roll-out), C (chaos day) and E (soak) in section 10.3; the wave gates of section 10.2.
- **steps:** follow owner checklists D, C and E exactly, in order, with each stop condition. Record every step's result in the worknote with the time.
- **acceptance:** the roll-out and the short tests pass; the soak gate of section 8 and the chaos day run at the end of the phase (0130), not in this card; no unexplained life end; the 7-day exit run is not started by this card.
- **commit:** `feat(shards): add the Phase 1 C3 shard config`; `docs: record the C3 roll-out results`; decision 0113.
- **on-cap:** stop at the first failed stop condition in the checklist and report it; do not patch the node by hand.
- **index line to add:** none (the packet is the integration owner).

## 10. Wave section

### 10.1 Lane diagram

```
Unblocker (A)   P1-C3-00 ─┬─> C3-01 (A, sovereign rows)
                          ├─> C3-04 (D, roster and cap)  <── C1-08
                          ├─> C3-05 (E, prepared receipt, wait cursor) ─> C3-06 (E, reconciliation) ─┐
                          └─> C3-03 (C, build, shelter, prompt v6)  <── C3-02 (B, honest sleep)     │
                                                                                                    │
Fan-out lanes, desktop:  C3-02 (B)  C3-03 (C)  C3-04 (D)  C3-05 (E)  C3-06 (E)  C3-08 (F, docs)     │
Live-gated (O):          C3-07 (F, after C1-10)  C3-09 (F, after C3-06, C3-08)  <──────────────────┘
Integration + ops (A):   C3-10 (after C3-01 to C3-09 and C1-10; wall clock)
```

Serialization: `golem/src/body` runs C3-05, then C3-06 (one at a time). `golem/src/actions` is C3-03 only. `threshold/mcp/src` is C3-01, C3-02 and C3-04 in that order (C3-02 first, a small change). At most six agents at once (conventions 5).

### 10.2 Wave-boundary gates (conventions 4.2)

1. **Full check:** `./geldar.ps1 check` on the wave branch, with the integration case-count floor. The Postgres job runs the `GELDAR_IT=1` cases.
2. **Reviews per surface, read-only, narrow brief, one fix round:** (a) the sovereign write path and the roster (C3-01, C3-04); (b) the Body's reconciler and receipts (C3-05, C3-06); (c) the build and sleep rules (C3-02, C3-03), reviewed against decision 0074; (d) the bench and chaos scripts (C3-07, C3-09), checked for the scratch-shard guard and for addresses in output.
3. **One live run with a real client** (the only live run per wave; the N-bot, chaos and soak runs are campaign-end gates, 0130), recorded in the worknote, step by step: a sovereign player connects, an agent takes a shelter intent, builds a shelter, sleeps in it, and the MCP reports the sleep result. Owner checklist A.
4. **Retro** in `retro/` for C3.
5. **Owner confirmation** of provisional decisions 0105 to 0113 (or a superseding record), and of O-1 to O-4 below.

### 10.3 Owner checklists (O packets)

Every checklist runs read-only steps first. A stop condition ends the step list; the operator writes the time, the step and the output in the worknote and does not patch the node by hand.

**A. Live client run (wave gate 3).** Desktop only; no node.
- A1. Confirm the branch and commit with `git log -1`. Stop if it is not the wave branch's head.
- A2. Start the desktop shard (the existing desktop command). Read-only: check the Body and the MCP status.
- A3. Connect one real Minecraft client as a sovereign player (not a bot). Stop if the client is not the owner's own account.
- A4. Start a shelter intent. Watch the events. Stop if a death occurs in the first 10 minutes.
- A5. Confirm rows in `intents`, `actions` and `receipts` (read-only queries).
- A6. Stop the run. Record the result in the worknote.

**B. N-bot benchmark (C3-07, live).** On the node, in the agreed off-peak window. Campaign-end gate (0130): not run at a wave boundary.
- B1. Read-only: record the production shard's TPS and CPU for 30 minutes before the run. Stop if the production shard is already below 19 TPS.
- B2. Run N = 1. Read the summary. Stop if the pass rule fails at N = 1.
- B3. Run N = 5, then N = 10, then N = 15, one at a time, with a 15-minute cool-down. Stop at the first N that fails the pass rule.
- B4. Run the 30-minute steady state at N = 15.
- B5. Record the results (no addresses) in `bench-results.md` with the commit.
- B6. Record the production shard's TPS and CPU for 30 minutes after the last run. Stop if it does not return to baseline; the owner decides.

**C. Chaos day (C3-09, live; owner signs off).** On the scratch shard only. Campaign-end gate (0130).
- C1. Confirm the shard name is the scratch shard (the guard refuses otherwise). Stop if it does not match.
- C2. Run every script in dry-run mode. Read the output with the owner.
- C3. Run scenarios 1 to 8 one at a time, in the order of section 7, each with `--confirm`. Record observed and expected outcomes.
- C4. A scenario that does not match its expected outcome is a fail. The day stops after the fail; the owner decides on a re-run.
- C5. The owner signs the written result in the worknote.

**D. Roll-out to the node (C3-10).** Read-only first.
- D1. Read-only: check disk, memory and the current containers on the node. Stop if free disk is under 20 percent.
- D2. Deferred (0130): no backup is taken for roll-out. The shard stays invite-only and unannounced (0070).
- D3. Deploy the C3 images. Read-only health check of every container.
- D4. Start the shard with the C3 config. Stop on the first unhealthy container.

**E. Soak (C3-10): 7 days, campaign-end gate (0130).** Not run at C3. The 72-hour gate is withdrawn.
- E1. Start 10 agents (15 at the end of the first 12 hours, if the TPS rule holds).
- E2. Every 6 hours, read-only: wakeups per agent per real minute, TPS windows, unexplained life ends. Stop if the TPS rule fails for two consecutive windows.
- E3. At 7 days, write the soak result. Pass means: fewer than one wakeup per agent per real minute while intents run; no unexplained life end; no TPS window below 18.0.

**F. Owner decisions before the soak.** The owner answers O-1 to O-4 in writing. No soak starts without O-1 and O-2; the soak runs at the end of the phase (0130).

### 10.4 Ledger rows for later pasting

Paste these rows into the Phase 1 ledger when it is written. This packet does not edit the ledger README.

| Packet | Branch | Expected commit subject | Status | Evidence |
|---|---|---|---|---|
| P1-C3-00 | `phase1/c3-00-contract` | `feat(contract): add sovereign intent source, wait cursor and roster schema` | B | contract generator clean, migration test |
| C3-01 | `phase1/c3-01-sovereign-rows` | `feat(mcp): write sovereign intent, action and receipt rows` | B | integration test under `GELDAR_IT=1` |
| C3-02 | `phase1/c3-02-sleep-mark` | `fix(mcp): write the sleep mark only on a completed Body result` | B | refused-sleep test, revert-check |
| C3-03 | `phase1/c3-03-build` | `feat(golem): add the build handler with the 512-block bound and budget check` | B | build tests, golden prompt test |
| C3-04 | `phase1/c3-04-roster` | `feat(mcp): keep the roster and the owner cap in the database` | B | roster tests, trigger test |
| C3-05 | `phase1/c3-05-receipts` | `feat(golem): write the prepared receipt before a run` | B | receipt and cursor tests |
| C3-06 | `phase1/c3-06-reconcile` | `feat(golem): record body_started and reconcile a crashed Body on boot` | B | matrix rows 1 to 8 |
| C3-07 | `phase1/c3-07-bench` | `docs: record bench results for N = 1, 5, 10, 15` | B/O | desktop tests; live rows in `bench-results.md` |
| C3-08 | `phase1/c3-08-runbooks` | `docs: add C3 runbooks for the kill switch, privacy, restore, rollback and chaos day` | B | link check |
| C3-09 | `phase1/c3-09-chaos` | `feat(chaos): add the scenario scripts and the runner` | B/O | guard tests; live day in `results/` |
| C3-10 | `phase1/c3-10-rollout` | `docs: record the C3 roll-out results` | O | `results/` |

### 10.5 Open owner questions

- **O-soak.** Resolved 2026-11-10 (decision 0130): one 7-day soak at the end of the phase. The 72-hour gate is withdrawn. The chaos day and the N-bot long benchmark are campaign-end gates too.
- **O-2.** Agents-per-player limit: default 1 and maximum 4 in `mcp_roster` (C3-04), or another value?
- **O-3.** Chaos-day sign-off: who signs, and is scenario 4 (disk) allowed on the node or only on a test volume?
- **O-4.** Benchmark numbers: N values (1, 5, 10, 15), the 19.0 mean and 18.0 floor, and the off-peak window on the shared node.
- **O-5.** Prompt v6 (new copy, decision 0074 default) versus an edit to v5 (needs a superseding record under decision 0068).
- **O-6.** Thought deadline: keep 25 seconds until the measurement from C3-04 is in, or change it earlier?
- **O-7.** Shelter definition for the survival criteria (decision 0074 open item), confirmed by C3-03.
