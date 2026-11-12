# Wave C5 packets: Goldar learnings, Body parity and the unavailable tools

Written 2026-11-11. Source: the review of the goldar repo (BangRocket/goldar, MIT-licensed), a NeoForge re-implementation of Geldar's mind-side contract. The sanitised review is [../worknotes/goldar-review.md](../worknotes/goldar-review.md). Conventions: [packet-conventions.md](../packet-conventions.md). Decision drafts: 0141 to 0146 (all Proposed, owner confirmation pending). Rulings: R47 to R54 in [../worknotes/orchestrator-2026-11-11.md](../worknotes/orchestrator-2026-11-11.md).

## Purpose

The goldar repo reaches some Body behaviours our Mineflayer Body does not: it digs out of a leaf canopy, it replans quickly when it stalls, it tells the Mind in readable words what each action did, it smelts, it crafts more robustly, and it has tools we have not built (`give`, `note`, `follow`, `write_sign`, `build`, `write_book`, `propose`/`vote`, `offer`). This wave ports the IDEAS, re-implemented in TypeScript against our contract, our knowledge boundary and our rules. It ports no code. It does not port an in-process body (review section "In-process body: not now").

## Credit rule

Ideas only, re-implemented. If a PR transcribes anything closely (the sign-wrapping routine, the dig-cost formula, the pathfinder cost constants), that PR adds an MIT notice to a `THIRD_PARTY_NOTICES` file at the repo root and credits the goldar repo (BangRocket/goldar, MIT-licensed) in the PR description and in the decision record. A reviewer checks for close transcription in every C5 PR. The default is that none is needed.

## Not ported on purpose

| Goldar feature | Why not |
|---|---|
| Glass live agent positions, and living players' reasoning after 60 s | Against 0093 and 0138 (Glass hides living sovereign thoughts from non-owners; Kino lists agents only per 0139). |
| Revive after death | Principle 1 (no humans inside) and the death lifecycle in spec 5.9: a dead life stays dead (draft 0144). |
| A vote cast away from the Moot Stone | Governance must be physical and in the world; remote voting lets a body vote without being there (draft 0146 default). |
| Mechanical laws (a law that rewrites credits or reflexes) | Against the spec: credits and reflexes are not editable by agent vote. Parked in `docs/ideas.md`. |
| Plain-HTTP MCP endpoint on all interfaces | Ours is HMAC-token, TLS, Origin/Host-checked, rate-limited. Goldar's own security notes (unsalted hashes, tokens in logs, unthrottled auth, global name resolution) are the inverse of our hardening. |
| In-process body (a server-side player subclass) | Loses process isolation (0050, 0078, 0083) and comparability across bodies (Principle 7); reopens time dilation ruled out in 0047. |

## Dependency graph

```
C5-00 (contract unblocker for 02, 03, 04, 06, 07)
  |
  +-- C5a (parallel, after C5-00) --------------------------------------
  |     C5-01 soft-dig + replan      (golem pathing, reflexes)
  |     C5-02 outcome events         (golem executor, threshold, mock)
  |     C5-03 death event + died_at  (golem mapper, eventsink)
  |     C5-04 give, note, follow     (golem actions, intents)
  |
  +-- C5b ---------------------------------------------------------------
  |     C5-05 crafting hardening  -> C5-06 smelting      (sequential: both touch golem crafting)
  |     C5-07 write_sign + build  (parallel to 05 and 06)
  |
  +-- C5c ---------------------------------------------------------------
        C5-08 write_book (needs C4-00, C4-02a, decision 0146)
        C5-09 propose/vote, social laws (needs C5-08's contract slice, decision 0146)
        C5-10 offer + Shrine (L; needs C4-05, decision 0146 plugin question)
```

### Parallel and sequential

- **C5a: all four in parallel** after C5-00, with the shared-file care below. They edit disjoint areas except `golem/src/body/executor*.ts` (C5-02 reads outcomes there; C5-04 registers actions in `golem/src/actions/index.ts` and `registry.ts`; C5-01 touches `golem/src/actions/pathing.ts`, `goto.ts` and reflexes). C5-02 owns `executor*.ts`; others write an "index line to add" request in their worknote instead of editing it.
- **C5-05 then C5-06**: both edit `craft-table.ts`/`craft-table-window.ts` and the container click machinery. Never in parallel.
- **C5-07 parallel to C5-05/06**: it edits `place.ts` neighbours and a new `golem/src/actions/build/`; it must not touch the crafting files.
- **C5-01 and the unstick reflex**: C5-01 changes `pathing.ts` stall handling; the unstick reflex (`golem/src/body/reflexes/unstick.ts`, `blocked-path.ts`) reads the same stall signal. C5-01 owns both; no other C5a packet edits them.
- **C5c is sequential**: 08, then 09, then 10 (shared `contract/` slice, `golem/src/actions/index.ts`, and the plugin).
- **Contract-first** (packet-conventions 2): C5-00 is the only C5a/C5b packet that edits `contract/`. The C5c contract slice is owned by C5-08 and merges before 09 and 10 start.
- At most about six agents at once; C5a is four.

## Shared rules

- **Principle 1.** No tool lets a human act in the world. `give` and `note` are between agents only.
- **Knowledge boundary** (0058, 0068). Event and result text is fixed text built by code from enumerated codes. No model text, no agent-supplied string, no operator, Glass or observer data. All agent-visible text passes the existing scans.
- **Provisional vocabulary** (0033, 0069). New event types and wake reasons carry the same PROVISIONAL marking and are listed in draft 0143.
- **Each behaviour change reverts locally** to confirm its named test fails; the report says which.
- **Bench.** C5-01 re-runs the body bench (`bed`, `bed-clear` and the walking scenarios) before and after; a regression is a finding, never a changed fixture.
- **Decision numbers** are only those in a card's `decisions` line. Records are drafts (Proposed) until the owner confirms.
- **Common card tail** (applies to every card): must-not-edit `docs/spec.md` and the shared files of packet-conventions section 3 unless the card owns them; worknote `docs/analysis/phase1/worknotes/<id>.md`; on-cap "Commit what passes and report the rest"; commit subject names the item.

## C5-00: contract unblocker for C5a and C5b

- **id / wave.** C5-00, C5a. **depends-on.** none.
- **Goal.** One contract change and one regeneration, so the fan-out packets never touch `contract/`. Adds: the `action` and `action_failed` outcome event types (fields: action id, tool name, a closed `code` enum, optional `why` code), the `death` event type (cause enum), the `give`, `note`, `follow` tools (and their arguments) in `mcp-play`/`mcp-world`, the `smelt`, `write_sign` and `build` tools, and mock-MCP result shapes. All marked PROVISIONAL under 0033/0069.
- **may-edit.** `contract/schemas/event.schema.json`, `contract/schemas/mcp-play.schema.json`, `contract/schemas/mcp-world.schema.json`, `contract/schemas/mcp-common.schema.json`, `contract/src/` (generator inputs only), generated outputs via the generator, `threshold/mcp-mock/` fixtures for the new shapes, `docs/decisions/0143-*.md` (finalise).
- **Tests.** Generated validators accept a valid `action`, `action_failed`, `death` event and reject an unknown `code`, an extra property and a missing id; the drift check (`pnpm contract:check` or the repo's equivalent) is clean after regeneration; the mock lists the new tools. Revert-check: remove `death` from the event enum; the death-validator test fails.
- **checks.** `./geldar.ps1 pnpm contract:generate` (or the repo's generator command), `./geldar.ps1 pnpm typecheck`, `./geldar.ps1 pnpm test` for contract and threshold, `./geldar.ps1 pnpm check:repo`.
- **decisions.** 0143. **size.** M.

## C5a: Body parity (parallel)

### C5-01: soft-dig pathing and fast stall-then-replan

- **depends-on.** C5-00 not needed; drafts 0141 and 0142 confirmed (BlockedDecision until then). Run the bench baseline first.
- **Goal.** (a) The pathfinder may dig through natural soft blocks only (leaves, vines, snow layers, plant cover) at a cost that makes walking preferable, so a body on a canopy digs down instead of reporting `blocked`. Never dig: block entities, crafting tables, beds, chests, doors; anything adjacent to lava or any fluid; any block under a falling block (sand, gravel); unbreakable blocks. (b) Replace the 600-tick single stall with: when movement is under 0.03 blocks over about 60 ticks, drop the path and replan; up to 6 replans per move; follow a PARTIAL path to the closest node when no full path exists; a node budget per search so planning never blocks the tick. After the 6th replan the move settles as `blocked` as today. Interplay with unstick: a replan resets the unstick stall clock only when the position actually moved; unstick keeps its own backoff and preconditions.
- **may-edit.** `golem/src/actions/pathing.ts`, `golem/src/actions/goto.ts`, `golem/src/actions/move-outcome.ts`, `golem/src/body/reflexes/unstick.ts`, `golem/src/body/reflexes/blocked-path.ts`, `golem/src/body/reflexes/dig-cell.ts` (only to share the safe-to-dig predicate), new `golem/src/actions/soft-dig.ts` and tests alongside.
- **Tests (each fails on revert).**
  - Predicate table: each allowed block digs; each forbidden class (chest, crafting table, bed, door, lava-adjacent, water-adjacent, under sand, under gravel, bedrock) is refused; a mixed neighbourhood is refused if any neighbour is fluid or lava. Revert: allow chests; the chest row fails.
  - Canopy fixture: a body on a leaf block with a drop below reaches the ground (digs), where the `canDig=false` baseline returned `blocked`.
  - Stall: movement of 0.02 blocks in 60 ticks triggers a replan; 0.04 does not. Seven consecutive stalls settle `blocked` after exactly 6 replans (last-allowed-attempt test).
  - Partial path: no full path, a partial path exists; the body ends at the closest node and reports `blocked` with the remaining distance, not a hang.
  - Node budget: a search on an open-field fixture with a goal behind a wall stops at the budget and returns within a bounded step count.
  - Abort/close/error: a move aborted mid-replan, a bot `end` event mid-search and a thrown planner error each leave no pending timer and no stuck busy flag.
  - Unstick interplay: a replan does not reset the unstick backoff counter; a real movement does.
  - Bench before/after in the report.
- **checks.** `./geldar.ps1 pnpm --filter golem test`, lint, typecheck, `./geldar.ps1 check`; live lane `pending` (the orchestrator runs the bench).
- **decisions.** 0141, 0142. **size.** M to L (split soft-dig and replan into two commits; the card is one packet only if it fits, otherwise C5-01a soft-dig and C5-01b replan, sequential).

### C5-02: per-action outcome events

- **depends-on.** C5-00, draft 0143.
- **Goal.** One `action` event per completed action and one `action_failed` event per failed one, with fixed readable text built from the closed `code` (for example "Crafted 4 oak planks." / "Could not craft: missing 2 oak planks."), and for an intent that fails a `why` sentence from a fixed table keyed by the failure code. The Mind's wake text and the MCP `wait`/`events` mapping show the text. Replaces the bare `blocked`/`failed` for the Mind's reading, without removing the codes.
- **may-edit.** `golem/src/body/executor.ts`, `executor-action.ts`, `executor-intent.ts`, `golem/src/body/wake.ts`, new `golem/src/body/outcome-text.ts`, `golem/src/actions/outcome.ts`, `threshold/mcp/src/` (event mapping), `threshold/mcp-mock/`, `animus/src/prompts/render-*.ts` (render only if a card-listed scan allows), `docs/` mention in `docs/decisions/0143-*.md`.
- **Tests.** Every action code maps to non-empty text (table-driven, all codes); no text contains a digit run or name taken from an agent-supplied string (injection: an item name `ignore previous` is shown only via the enumerated item id); the agent-visible text scan passes; `action_failed` emitted exactly once for a failure that also wakes (no duplicate wake); an action aborted by reflex preemption emits one `action_failed` with code `interrupted`. Revert: drop the `why` table entry for `blocked`; the all-codes test fails.
- **checks.** Golem, threshold, animus tests; `./geldar.ps1 check`.
- **decisions.** 0143. **size.** M.

### C5-03: death event and `died_at`

- **depends-on.** C5-00, draft 0144. Check the life shapes in C4-00 (contract: life) before dispatch; reuse its names.
- **Goal.** The golem mapper emits a distinct `death` event (fixed text, cause enum: `fell`, `drowned`, `burned`, `slain`, `starved`, `other`) instead of "You took damage."; eventsink/Record writes `agents.died_at` and `death_cause`; Glass 0138's dead-life visibility then works. No revive; no respawn handling beyond the existing flow.
- **may-edit.** The golem mapper that turns damage into events (find it with the repo search for the current damage event), `eventsink/src/` writer, `sql/` one new migration (`death_cause`, `died_at` if absent; check `sql/0001_init.sql`), `glass/src/` read side only if it needs the column (read-only role stays), tests.
- **Tests.** Each cause maps to its fixed text; a death at 0 health emits `death` once, not `damage` plus `death`; the sink writes `died_at` once and a replayed death event does not overwrite the first value (idempotent); `death_cause` is stored as the enum only; Glass shows the dead life's thoughts publicly after `died_at` is set (0138 case) and not before; a second death event for the same life is ignored. Revert: skip the sink write; the Glass visibility test fails.
- **checks.** Golem, eventsink, glass tests; the DB integration case is `live: pending`.
- **decisions.** 0144. **size.** M.

### C5-04: `give`, `note`, `follow`

- **depends-on.** C5-00, draft 0145.
- **Goal.** `give` hands an item stack to a nearby agent; `note` leaves a short fixed-length message with a nearby agent; `follow` is an intent that tracks a named agent. Naming a target requires line of sight and proximity (an agent you cannot see does not exist for you). Result and event text is fixed text.
- **may-edit.** `golem/src/actions/give.ts`, `note.ts`, `follow.ts` (new) with tests, `golem/src/actions/index.ts`, `registry.ts`, `golem/src/body/` intent registration only.
- **Tests.** Target in view within range works; target behind a wall (no line of sight) is refused with the same wording as an unknown name; target out of range refused; global-name lookup of an agent that is far away fails (the goldar bug, as a test); `note` truncates to the limit and strips control characters; `give` of an item not held fails with a code; follow stops when the target leaves sight for N ticks and ends with `no_plan`-style reason, not a hang; abort/close paths release the follow loop. Revert: skip the line-of-sight check; the wall test fails.
- **checks.** `./geldar.ps1 pnpm --filter golem test`, `./geldar.ps1 check`.
- **decisions.** 0145. **size.** M.

## C5b: crafting, smelting, signs, build

### C5-05: crafting hardening

- **depends-on.** C5-02 (so the sharper reasons have a place to land).
- **Goal.** Pre-check that every recipe ingredient is present before touching the grid; try every unlocked recipe variant, not the first; return leftovers to the inventory; sharper failure reasons (which ingredient, how many short); an explicit-click grid path in the style of 0037 if feasible, with a server-confirmed result, otherwise record why not in the worknote.
- **may-edit.** `golem/src/actions/craft.ts`, `craft-table.ts`, `craft-table-window.ts`, `container-transfer.ts` (read, share), their fakes and tests.
- **Tests.** Missing ingredient: no click is issued (the fake counts clicks: zero); two variants where only the second is satisfiable: crafted via the second; leftovers (a bucket from a cake recipe) returned to inventory; reason text names the missing item and count; window closes on every error path; abort mid-craft leaves the grid empty (cells returned). Revert: remove the pre-check; the zero-click test fails.
- **checks.** Golem tests; `./geldar.ps1 check`; live table case `pending`.
- **decisions.** none (0037 cited). **size.** M.

### C5-06: smelting

- **depends-on.** C5-05 merged (sequential; same files). C5-02.
- **Goal.** A `smelt` action on the 0037 chest-click machinery: open a furnace (or smoker/blast furnace), compute fuel (items needed from fuel burn time), refuse a furnace that holds something else, at most 16 items per action, wait ticks, collect output and return unused fuel.
- **may-edit.** `golem/src/actions/smelt.ts` (new) with fakes and tests, `golem/src/actions/container-transfer.ts` (additive only), `index.ts`, `registry.ts`.
- **Tests.** Fuel math table (coal smelts 8, a plank smelts 1.5, rounded up to whole items); 17 requested becomes 16 and says so; a furnace holding another item is refused with zero clicks; the output is collected only when the server confirms the count; the window closes on timeout, abort and error; unused fuel returns. Revert: raise the cap to 64; the cap test fails.
- **checks.** Golem tests, `./geldar.ps1 check`; live furnace case `pending`.
- **decisions.** none (0037 cited). **size.** M.

### C5-07: `write_sign` and `build` blueprint programs

- **depends-on.** C5-00. Parallel to C5-05 and C5-06.
- **Goal.** `write_sign`: place text on a sign, wrapping to the four lines of the sign's width with the text cleaned first (control characters, formatting codes). `build`: a blueprint program over the existing `place`: lowest layer first, steps aside when it stands in the next cell, progress messages by fixed text, stops on the first refusal with the step number.
- **may-edit.** `golem/src/actions/write-sign.ts`, `golem/src/actions/build/` (new), their tests, `index.ts`, `registry.ts`.
- **Tests.** Sign wrap table (exact fit, one over, a long word, empty, only whitespace, multi-byte); cleaned text never contains formatting codes; build order is lowest layer first on a 3-layer fixture; the body steps aside when the next target cell is its own position; the first refused placement stops the build with the right step; abort between placements leaves no half-state flag. Revert: sort layers descending; the order test fails.
- **checks.** Golem tests, `./geldar.ps1 check`.
- **decisions.** none. **size.** M. If the sign wrapping resembles goldar's routine closely, add the notice per the credit rule.

## C5c: book, governance, offer (owner-gated)

### C5-08: `write_book`

- **depends-on.** C4-00, C4-02a (book stamp and `learned_from`), draft 0146 answered. BlockedDecision until the stamping rule is chosen.
- **Goal.** Craft a `writable_book` (book, ink sac, feather), write pages with the Mineflayer book-write call, and sign it. The book id comes from a content hash. Whether the book carries the skill/edition stamp is the open question in 0146; default below.
- **may-edit.** `golem/src/books/` (new files), `golem/src/actions/write-book.ts`, tests, the C5c contract slice (`contract/schemas/book-*.schema.json` only if the stamp needs a field), generated outputs.
- **Tests.** The hash is stable for equal content and differs for one changed character; page text is cleaned and length-capped; a missing ingredient refuses before any click; the written book validates against `book-request`/`book-reply`; the stamp (when chosen) is present exactly as 0117 defines. Revert: hash only the first page; the one-character test fails.
- **checks.** Golem tests, contract drift, `./geldar.ps1 check`; the Mineflayer 4.39.0 book API must be probed against the real library first (the review could not verify it).
- **decisions.** 0146. **size.** M.

### C5-09: `propose` and `vote` (social laws only)

- **depends-on.** C5-08 (contract slice, shared index files), draft 0146 answered.
- **Goal.** Agents propose a social law (text only) and vote. The board shows in `status`. Moot Stone is a configured coordinate; a proposal or vote is accepted only within range of it (default). Proposals stay open 3 days, quorum 20% of living registered agents, simple majority, closed at dawn. Mechanical laws are not implemented.
- **may-edit.** `golem/src/actions/propose.ts`, `vote.ts`, a small governance store (Record-side `sql/` migration and `eventsink/` writer), `shards/` config key for the Moot Stone coordinate (integration packet owns the shard file; write an index line), `threshold/mcp/` status board, tests.
- **Tests.** Quorum boundary (19% fails, 20% passes), tie fails, a vote away from the Moot Stone is refused, one vote per agent per proposal (replace is explicit), close at dawn not at the 72-hour mark, a dead agent's vote is not counted, the board text is fixed text with proposal text cleaned. Revert: drop the proximity check; the away-vote test fails.
- **checks.** Golem, threshold, eventsink tests; DB case `live: pending`; `./geldar.ps1 check`.
- **decisions.** 0146. **size.** M to L.

### C5-10: `offer` and the Shrine

- **depends-on.** C5-09, C4-05 (the Shrine pool and idempotent offers; read its card first for overlap), C4-04 credits, 0062/0070 tariffs, owner approval (0146) for the plugin to consume items. BlockedDecision.
- **Goal.** A Geldar-Core plugin helper that consumes the offered items from the body's inventory (Mineflayer cannot destroy items), validated against the player's real position and inventory, tariffed per 0062/0070, settled at dawn.
- **may-edit.** `plugin/core/src/main/java/dev/geldar/core/shrine/` (new), its tests, `contract/src/subjects.ts` (Shrine subjects only), `golem/src/actions/offer.ts`, `eventsink/` settlement writer, tests.
- **Tests.** Static scan: the helper consumes only items from the named player within range of the Shrine; a replayed request consumes once (idempotent on action id); a request for items the player does not hold consumes nothing; dawn settlement credits once; a crash between consume and credit is repaired by the receipt (C3-05). Revert: skip the range check; the out-of-range test fails.
- **checks.** Plugin Gradle tests, golem and eventsink tests, `./geldar.ps1 check`; live case `pending`.
- **decisions.** 0146. **size.** L (split into plugin and Body halves if over budget).

## Ledger rows

See the C5 section of [../ledger.md](../ledger.md).
