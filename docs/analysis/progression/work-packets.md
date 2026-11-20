# Progression work packets (colo v1)

## Dispatch rules

- One `packet-coder` per packet, in its own worktree from `origin/main`. One-packet waves: no integration branch.
- **No progression code merges before D-PR-01** (Cadacious accepts revised 0385). Packets may be written, committed, pushed and reviewed; their PRs stay open.
- Rules inlined here, since the coder does not read CLAUDE.md:
  - A behaviour change needs a test that fails when the change is reverted. Check that it does.
  - Files: soft cap 500 lines, hard cap 700 (JSON counts). Near the cap now: `threshold/mcp/src/config.ts` 474, `contract/src/index.ts` 595, `golem/src/body/executor.ts` 501, `contract/schemas/thought.schema.json` 412. Put new logic in new files.
  - LF line endings. Pin exact versions; no new dependencies are expected.
  - Never edit generated code: change `contract/schemas/`, run `./geldar.ps1 pnpm --filter @geldar/contract generate`, commit the output.
  - Migrations: `sql/NNNN_slug.sql`, never edited after merge, each inserts its own `schema_migrations` row (`sql/README.md`). The next free number was 0067 on 2026-11-19; check `ls sql` before using it.
  - Agent-visible text is fixed fact: no should, try, must, hurry, soon, now, best, recommend, goal, quest, score, rank, leaderboard, test, server, and nothing in `MARKER_WORD` (`contract/src/agent-text.ts`). Decisions 0058, 0059, 0068, 0154.
  - Every number from the design is PLACEHOLDER: keep it in one params file, named, with the design section beside it.
- No live lane, no Docker, no `adam up`. X5 belongs to the orchestrator.
- The line references below were read on 2026-11-19 at `b400ed32`. Re-read before editing; if a referenced shape is not there, stop and report.

## Wave X1: unblockers (parallel)

| Packet | Unblocks | Parallel |
|---|---|---|
| X1 | X2c, X4 | With X2a, X2b |
| X2a | X2c | With X1, X2b |
| X2b | X2c | With X1, X2a |

### X1: the `progression.enabled` flag, off by default

Branch `progression/x1-flag`.

1. **Shard yaml.** Add `progression: { enabled: false }` to `shards/colo-mind.yaml` (beside `body_actions`, line 29), `shards/phase0.yaml` and `bench/sheet/scratch-shard.template.yaml`, each with a comment citing 0385.
2. **MCP.** New file `threshold/mcp/src/config-progression.ts` exporting `progressionEnabled(root: Record<string, unknown>): boolean`. A missing `progression` block or `enabled` key means false; a non-object block or non-boolean value throws `progression.enabled must be true or false`. Model it on `golem/src/adam/adam-config.ts:67-74` (`body_actions`). Add `progression: { enabled: boolean }` to `McpConfig` and set it in `parseMcpConfig` (`threshold/mcp/src/config.ts:186`).
3. **Eventsink.** In `eventsink/src/xp/xp-config.ts` add `progressionEnabled(env)`: true only for `GELDAR_PROGRESSION === '1'`. In `eventsink/src/sink-plan.ts` add `progression: boolean` to `SinkPlan`; when it is true but `xpEnabled(env)` is false or `GELDAR_SHEET_SHARD` is unset, throw `GELDAR_PROGRESSION needs GELDAR_XP=1 and GELDAR_SHEET_SHARD`. Add `GELDAR_PROGRESSION:` (empty) to `compose/opt-in/sheet-sink.yml` with a comment.
4. **Docs.** A row for `progression.enabled` in `docs/reference/shard-config.md` and for `GELDAR_PROGRESSION` wherever eventsink env is documented (grep `GELDAR_XP` in `docs/`).

Tests: `config-progression.test.ts` (missing means false; `true` reads true; `'yes'` throws); `sink-plan.test.ts` (progression without XP throws; without the shard throws; unset means false). Revert check: removing the throw fails the new sink-plan case.

Checks: `./geldar.ps1 pnpm --filter @geldar/mcp test`, `./geldar.ps1 pnpm --filter @geldar/eventsink test`, then `./geldar.ps1 check`.

Commit subject: `Progression: the progression.enabled flag, off by default (0385)`

Out of scope: any award, text or goto change; turning the flag on anywhere.

### X2a: completed actions carry the region they happened in

Branch `progression/x2a-region`. Why: the novelty key is (class, target, 64 by 64 region), and action records carry no position (`contract/schemas/action-record.schema.json`, `additionalProperties: false`; `result` is free-form).

1. Find where the Body finishes an action with the bot in scope. `golem/src/body/executor-action.ts:141` sets `record.result = { ...run.result }` but has no bot there; the caller in `golem/src/body/executor.ts` may. If no position is reachable without threading the bot through more than one function, stop and report.
2. On a completed action, add `region: { rx: Math.floor(x / 64), rz: Math.floor(z / 64), dim }` to `record.result`, from the bot's position at completion. `dim` is the dimension string the chunk-visited event uses. Add nothing for failed or cancelled actions.
3. Do not change the schema: `result` already accepts any object. Add one sentence to the `result` description in `action-record.schema.json` naming `region`, and regenerate.

Tests: an executor test that a completed `mine` record has `result.region` equal to the floored position, and a failed one has none. Revert check: without the stamp, the first test fails.

Checks: `./geldar.ps1 pnpm --filter @geldar/golem test -- executor`, `./geldar.ps1 pnpm --filter @geldar/contract check:generated`, then `./geldar.ps1 check`.

Commit subject: `Body: completed actions carry their 64-block region (progression X2a)`

Out of scope: eventsink reading it (X2c).

### X2b: the novelty engine (pure)

Branch `progression/x2b-novelty`. Design section 3.2 and 3.4. Pure: no clock, no random, no I/O. Units are integer milli-points.

1. New `eventsink/src/xp/progression-params.ts`: `R_DAYS = 3`, `H_OCCURRENCES = 4`, `FLOOR_FRAC = 0.0625`, `DAILY_CAP_MILLI = 120_000` per domain, `DAILY_CAP_ALL_MILLI = 200_000`, and `BASE_MILLI` per class (gather 4000, mine 6000, farm 4000, craft 5000, explore 2000, deliver 8000, build 5000). Every constant marked PLACEHOLDER with its design section.
2. New `eventsink/src/xp/novelty.ts`:
   - `decayedCount(nMilli, fromDay, toDay): number`, `n * 2^(-(toDay - fromDay) / R)`, rounded down to milli.
   - `noveltyPay(baseMilli, nMilli): number`, `base * 2^(-n / h)`; returns 0 when that is at or below `FLOOR_FRAC * base` (ties pay 0).
   - `capCounted(countedTodayMilli, payMilli, capMilli): number`, the part of `pay` that fits under the cap; the excess is dropped.
   - `awardNovelty(state, key, day): { payMilli, next }`, where `state` is `{ nMilli, day }` for the key: decay to `day`, pay, then `nMilli + 1000` only when paid.
3. No class mapping or I/O here: X2c maps events to keys.

Tests (`novelty.test.ts`), from the design's worked example 3.7: five pays of base 4 are 4.00, 3.36, 2.83, 2.38, 2.00 (to the milli); sixteen pay 23.57 in total and the 17th pays 0; three days later `n` halves to 8 and the next pays 1.00; a 1000-repeat run never exceeds 5.89 × base; a 160-point day counts 120. A test that the module imports nothing but params. Revert check: dropping the floor makes the 17th-pays-0 case fail.

Checks: `./geldar.ps1 pnpm --filter @geldar/eventsink test -- novelty`, then `./geldar.ps1 check`.

Commit subject: `Progression: the pure novelty engine (design 3.2, 3.4)`

## Later packets (blocked; sliced in detail once their decisions land)

### X2c: progression ledger and wiring (D-PR-04, D-PR-05)

- `sql/0067_progression.sql`: `progression_keys(life_id, class, target, region, n_milli, day)`, `progression_day(life_id, domain, world_day, counted_milli)`, `progression_total(life_id, total_milli)`; revoked from `geldar_mcp` as `sql/0050` does, except through X3's read function; `sql/test/check-schema-progression.sql`.
- `eventsink/src/xp/progression-ledger.ts`: with the flag on, the writer (`eventsink/src/writer.ts:106-108`) also applies a novelty award after the existing `applyAward`, with the same evidence-first ordering, so a redelivered event adds nothing.
- Event to key: `mine` → mine or farm (crops, via `matrix.ts`), `craft` → craft, `give` → deliver, `chunk_visited` → explore, completed build intent → build; combat pays nothing (D-PR-06). Region from X2a; day from the envelope's `world_day`.
- Tests: redelivery adds nothing; a replay of one event list gives the same rows.
- Risk: replay depends on per-life processing order.

### X3a: level and claim marker (D-PR-05, D-PR-08)

- Pure `eventsink/src/xp/unlocks.ts`: level from total points with the design table (0, 60, 160, 300 for levels 0 to 3), claim edge (0, 16, 24, 32), place slots (0, 1, 2, 3).
- `progression_claims(life_id, x, y, z, edge, set_day)`, written on a completed `sleep` with `result.detail.bed`, resized on a level change. Marker only, never seen by other agents in v1.

### X3b: named places (D-PR-09)

- Contract: `note` gains an optional `place` name; `goto` gains a `{ place }` target, separate from agent names.
- Body echoes `place` and its position on the note result; eventsink stores `progression_places(life_id, name, x, y, z)` up to the slot cap; the MCP resolves `goto { place }` to a position in `act` through a `SECURITY DEFINER` read function granted to `geldar_mcp`.
- Risk: a Mind agent sent a `place` target it cannot resolve; the refusal text must be a fixed fact.

### X4: what the agent reads (owner approves the text)

- An optional `progression: string[]` in `status` (`threshold/mcp/src/tools/status.ts`, `mcp-world.schema.json`), absent when the flag is off; a pure renderer `threshold/mcp/src/play-view/progression-text.ts`.
- Lines (draft, fixed order): `Level 2. Claim size 24. Next level needs 140 more points.`, `Points counted today: 61 of 200.`, `Places named: 1 of 2.` plus one line per place. The mechanics sentence from design 8.2 goes in the `status` tool description.
- Tests: the banned-word list and `markedWords` scan (as `play-view/situation.test.ts`); a golden fixture; flag off gives no key.

### X5: start and measure (orchestrator)

- Deploy: add `GELDAR_XP`, `GELDAR_SHEET_SHARD` and `GELDAR_PROGRESSION` to colo's eventsink (only after D-PR-04), set `progression.enabled: true` in `shards/colo-mind.yaml` at the D-PR-02 start time, by a reviewed PR.
- Live check: one agent's novelty award, level and status text, end to end.
- Measure (D-PR-03): action-class entropy, distinct (class, target, region) keys per agent per day, repeat ratio, and the verbs outside eat, goto and sleep, before and after the start.
