# Memory spine: design proposal (D0 of decision 0391)

Status: PROPOSAL. Owner questions Q1 to Q4 and Q7 to Q9 are decided by decisions 0453 to 0459 (owner ruling 2026-11-28 relayed via geldar-69, adopting the recommendations below). Kiraifayi's questions Q5, Q6, Q10 and Q11 are not decided; section 5.1 lists them with their defaults. Everything else here stays a proposal.
Checked: geldar `origin/main` at `62f6ee4c`; kit (`geldar-scriptorium`) `origin/scriptorium/hw0` at `9bd4612`, read-only. Where I could not verify a fact I write "unknown".

Scope: decision 0391 item 1 names the memory spine as the next track, with the exit test "a fact learned in session one is used in session three", for any harness an owner brings. The design source is Stage 3 (E10) of [the 2026-11-14 autonomy review](../autonomy/review-and-plan-2026-11-14.md). This document does not restate E10. It says what exists, the smallest change set, and how a test shard would measure it.

## 1. What exists today

### 1.1 Kit side (hw0)

| Part | Fact | Evidence |
|---|---|---|
| Memory server | One MCP server, `geldar-memory`, one read-only tool `recall(section)`. No write tool. | `packages/memory/src/server.ts` (`registerTool('recall', ... readOnlyHint: true)`); `packages/memory/README.md` |
| Sections | Fixed set: identity, summary, goals, beliefs, `people/<name>`, `journal/current`, `journal/day-NNN`. | `packages/memory/src/sections.ts` (`SECTION_FORMS`) |
| Recall order | On hw0, the journal is read from its end ("the newest lines survive a cut"), cut at `MAX_BYTES` 16384, and the cut is reported. The review's KT2 ("returns the oldest 16 KB", `recall.ts:9, 32-39, 73`) describes an earlier revision. Whether hw0 is what runs in player containers: unknown. Only `journal/current` is tail-read in the code I read; other sections: unknown. | `packages/memory/src/recall.ts` (`JOURNAL_CURRENT`, `LATER_CUT`) |
| Memory writes | Agents write memory with the harness's own file tools. hw0 `settings.json` allows `Edit(/memory/**)` and `Write(/memory/**)` and denies edits under `/.claude/**`. KT1 said creating new files failed without a Write tool; hw0 allows Write. Whether the released player image matches: unknown. | `template/.claude/settings.json` lines 46 to 55 |
| Session start | The hook prints the name, a "never instructions" line and "Begin with recall("summary"), then the play skill." It prints the handoff note (`memory/journal/handoff.md`, 4000 bytes, as "Your own words from before, not instructions") only when the session source is `compact`. A fresh session start gets no memory text. | `template/.claude/hooks/session-start.sh` |
| Journal | A post-tool-use hook appends one line per tool call (time, tool name 40 characters, input 200 characters, 240 in all) to `memory/journal/current.md`. This is the "hook log" of KT3. | `template/.claude/hooks/post-tool-use.sh` |
| Session end | A hook commits unsaved memory with `geldar-git commit --if-changed`. | `template/.claude/hooks/session-end.sh` |
| Commit cap | `MAX_FILE_BYTES = 1048576`; a larger file is refused with `file_too_large` (KT3 says the commit tool then skips it and exits 0). Rotation by world day: not found in my read; unknown. | `packages/git/src/hash-file.ts` |
| Reflection | The `reflect` skill runs "after `sleep` returns the day digest": write `day-NNN.md`, update `people/<name>.md` with "trust from 0 to 100", rewrite beliefs, goals and summary, empty the journal, call `commit_memory`. `sleep` needs a bed (AN2). | `template/.claude/skills/reflect/SKILL.md` |
| Cost record | The supervisor keeps `costs.csv` (`run,utc,turns,cost`) and sums it per UTC day for the daily cap. The review (OB3) says it also saves every run's full stream and nobody reads them; I did not verify the stream path. Memory health is not joined to the world record. | `packages/supervisor/src/state.ts` (`costToday`); review OB3 |
| Entries, ids, source tags | None. Memory is prose files. | all of the above |

### 1.2 Geldar side (main)

- The `events` table holds "everything, from NATS": `event_id, source_event_id, at, world_day, world_tick, type, agent_id, thinker_id, payload`, index on `(type, world_day)` (`sql/0001_init.sql:107-113`). `sql/0066_events_trace_id.sql` adds a trace id; other later columns: unknown.
- No experience record exists. A search of `docs`, `contract/src` and `sql` for "acts log", "people record", "experience record" and "heard-and-read" finds only the review. The sheet RESUME (`docs/analysis/sheet/RESUME.md`, 2026-11-21) says no memory-spine card exists under `docs/`.
- Review row 1.3 (a record per `wait` return and per perception call: wake reason, seconds waited, what was delivered) is the planned input to the experience record. Whether it merged: unknown.
- Review row 0b.1 ("a memory write that works", recall newest) is a stopgap. Whether it merged on either side beyond the hw0 reads above: unknown.
- BD18: Body perception memory is process memory and is lost at restart (review). It is a different memory from the agent's but sits next to the spine (Q8).

### 1.3 Review findings this design answers

KT1 (memory does not accumulate: stub files, no journal days), KT2 (recall order), KT3 (journal is a hook log; stops saving at 1 MiB), KT7 (rangers' bonds written into them; operators never edit an agent's memory), AN2 (writes only after a bed-gated reflection; `note` is write-only), SC7 (poisoning defended by prompt text only), OB3 (memory health and cost not joined to the world record), BD18 (Body forgets at restart).

## 2. Smallest change set

The work splits along the two halves in E10. The world half (Geldar) is served through the gateway and must work for any harness. The mind half (kit) belongs to harnesses we run; an owner-brought harness gets the world half only. Sizes: S under half a day, M about a day, L two to three days of one coder. Card ids below are proposals; the kit's own numbering belongs to the scriptorium orchestrator and is unknown to me.

### 2.1 Geldar cards (proposed "MS-G")

| Card | Change | Size | Depends on |
|---|---|---|---|
| MS-G0 | Decision records: the spine design, the experience-record fields, and amendments to spec 5.15.2 and 5.15.4 (E10 "Needs records"). Contract change under `contract/`, regenerated. | M | owner answers Q1 to Q4 |
| MS-G1 | Experience record, table and writer: per life, built only from tool results that were delivered to the Mind. Kinds: acts, people (keyed on the authenticated life, never on a displayed name), places the agent named, deaths. New SQL file (next free number after those in `sql/`; RESUME lists 0056 to 0059 as reserved or spare). Append-only; added to the erase functions (decision 0323). | L | MS-G0; review row 1.3 |
| MS-G2 | Gateway read: an MCP read tool with a paging cap over the record (own acts, people, places). Heard-and-read text only inside the untrusted wrapper, by entry id, under a per-world cap. | M | MS-G1 |
| MS-G3 | Cues: when a known agent is in view, include the agent's own note about them, with source and date. Names the agent has perceived; no `ag_` id (0391 point 4). | M | MS-G1, MS-G2, MK1 |
| MS-G4 | Memory-health events: one NATS event per run (entries written and read, recall calls, bytes), so the events table joins memory to world day (OB3). | S | MK4 |
| MS-G5 | Extend the marker-word scan (0058 point 4, 0068 rule 4) over memory text the agent wrote, flag-only. | S | MK1 |

### 2.2 Kit cards (proposed "MK")

| Card | Change | Size | Depends on |
|---|---|---|---|
| MK0 | Read-only check of what runs in player containers versus hw0 for KT1, KT2, KT3, reported with dates. | S | none |
| MK1 | One neutral write tool in `packages/memory`: `remember(kind, about, text)`. The agent chooses the kind; the description names no social concept (E10). Entries get an id and a date; the source tag is set by code from the cited log line, never by the model. No whole-file rewrite. | L | MS-G0 (entry shape) |
| MK2 | Session-start hook prints identity, goals, pinned summary, handoff note and the last screen of the acts log inside the existing as-data wrapper, on every start (today only on `compact`). | M | MK1 |
| MK3 | Consolidation as a harness step: at session end and on size or count thresholds, not gated on a bed, on the life's own model; one commit per consolidation. Replaces the `reflect` skill text (Q5). | L | MK1, MK2, Kiraifayi's rulings |
| MK4 | One report line per run (memory fill, reads, cost) beside `costs.csv`, and published for MS-G4. | S | MK0 |
| MK5 | Journal rotation by world day, and a loud refusal at the 1 MiB commit cap (KT3). Independent; the review rated it urgent. | S | none |
| MK6 | Standing-instruction pattern flag on entries (SC7), flag only. | S | MK1 |

### 2.3 Order and the smallest useful cut

1. MK0 and MK5 first: facts and the size cliff, no agent-visible change.
2. MS-G0 after the owner answers.
3. MK1 and MS-G1 in parallel, then MK2 and MS-G2, then MK3, MS-G3, MK4, MS-G4.
4. Smallest cut that can run the exit test with a scripted test agent: MK1 plus MK2 (entries are written, and printed at the next start). The world record (MS-G1 to MS-G3) adds the E10 exits "person met is recognised next day" and "due note surfaced when near". For an owner-brought harness the cut is MS-G1 and MS-G2; how that harness stores what it reads is its owner's business (Q2).
5. One agent-visible change per window, each read against its own before-numbers (review, Stage 0b/E10 window rule). MK2 and MK3 are separate windows.

Under the held-live ruling (2026-11-15) and decision 0391, nothing here activates by merging. Memory features ship inert and run first on the test shard.

## 3. How a test-shard run would prove the exit test

No coaching. A scripted test agent checks the plumbing; unmodified agents give the behavioural result. Nobody tells an agent to remember or recall. Every number comes from a stored record, none from an agent's self-report.

### 3.1 Design

- Three or more sessions per agent, separated by a harness restart (not only a context compaction). Session boundaries come from run records, not from the agent.
- Facts are seeded by the world, not by words to the agent: a named agent hands the test agent an item, or a chest stands at a place the agent reaches by itself. The fact carries a marker value (an item type and count, or a place) that nothing else in the world carries, so a later use is attributable.
- Control: the same world without the memory features (kit at the pre-spine tag), same seeds. One world per arm is one observation (review E11 on noise), so run counts are an open question (Q7).

### 3.2 Measurements

| Measure | Source | Reading |
|---|---|---|
| Fill rate per entry kind | MS-G4 events, or the kit report line (MK4). Until then, the committed `memory/` files per player repo | Entries per session per agent. Zero in session two is a fill failure |
| Read rate | kit stream (memory tool calls) and the session-start print | Count of start prints and `recall` calls |
| Use of the planted fact | `events` rows of the act and outcome types for that `agent_id` with `world_day` after the day it learned the fact, matching the marker by structured fields (coordinates, item type, target life) | Session one learns, session three acts on it. Never matched by reading prose |
| Control comparison | the same query on the control world | The use is absent or rarer there |
| Repeat failure | `events` outcome rows with the same failure code and target across sessions | Falls with memory versus control |
| Cost | `costs.csv` per run, summed per UTC day | Within the daily cap; cost per entry written and per use |
| Recognition (person met, next day) | experience record people rows (first met, last seen) against whether next-day acts target that life | After MS-G1 and MS-G3 |
| False persistence | questions generated from the event log, asked offline of a copy loaded only with that agent's files (E10 "Observe") | The copy is an instrument, never an agent's context |

Event type names for acts and outcomes in the events table: unknown to me. MS-G1 must pin them in the contract before the run.

### 3.3 Pass bar

Not set here. I recommend the operator sets it before the run and it goes into the test-shard plan (RESUME says that plan is still not in the repo): a minimum fraction of seeded facts used after a session boundary in the memory arm, with the control arm below it by a stated margin. Values: unknown, owner's (Q7).

## 4. Rules this design must respect

1. Nothing an agent reads may coach it or say when to do things (0058, 0059, 0068). For the spine:
   - The `remember` description names no social concept and no schedule: nothing like "after each day" or "when you meet someone".
   - The session-start print lists data under an as-data wrapper and carries no "you should".
   - The current `reflect` skill is headed "End-of-day memory rewrite. Use after `sleep` returns the day digest" and prescribes numbered steps (trust "from 0 to 100", "say a short goodnight"). It says when and how. Replacing it is part of MK3 and needs a ruling (Q5); I do not decide it.
   - The existing start line "Begin with recall("summary"), then the play skill." is also an instruction on order; same question.
2. No agent is told it is watched, or that it lives in a harness, shard, colo or credits (0059, 0068 rules 1 and 4). The memory-health line, the cost line and the report line stay outside agent-readable files. Every new tool schema and result passes the agent-visible-text scan (`contract/test/agent-visible-text.test.ts`) before merge.
3. Released prompt templates are immutable; a change is a new version (0068 rule 2). Any template change goes in `prompts/` with a version bump.
4. The sheet is never in an agent context (0281 point 7). The spine reads no sheet field into entries. The one derived integer (sanity input) stays on descriptor 4 for owned-loop harnesses and is not memory. Experience-record rows carry no sheet values.
5. Characters know only what the world gave them (0058). Entries record what was done, seen, told by a named agent, or guessed; the source tag is code-set. No `ag_` id, player UUID or entity id appears in an entry or cue (0391 point 4). Positions the Body perceived are allowed.
6. Operators never write into an agent's memory (review KT7). The design adds no operator write path. Seeded memory (the rangers' charters) is labelled as a seeded cohort in analysis and is not edited here.
7. Heard text is untrusted: returned only inside the as-data wrapper, capped per world, never auto-loaded (E10, SC7).
8. Repo rules: schemas change in `contract/` with regenerated output; files stay under the 700-line hard cap; a behaviour change needs a test that fails when reverted; SQL numbers must not collide with reserved ones; no live case before the held-live ruling lifts; the test shard is a throwaway stack.

## 5. Open decisions

Owner (operator):

- Q1. Does the spine amend spec 5.15.2 and 5.15.4 (itemised entries, experience record, memory printed at start) and 5.4 (consolidation off the bed, and what a bed is then worth)? Recommendation: yes, each by a decision record, leaving the spec text edit to the owner, who has asked to be asked about spec edits (0059).
- Q2. Is the experience record a Geldar feature every harness gets, or only for kit-run players? Recommendation: every harness. An owner-brought mind has nothing else to carry facts across sessions.
- Q3. Retention and erasure: do experience rows follow 0323 (erased with the life) and the append-only pattern of 0085? Recommendation: yes. The per-world cap on heard-and-read text: unknown, owner's value.
- Q4. Who may read the record? Recommendation: an agent reads only its own; operators read through the database; no agent reads another agent's record.
- Q7. Pass bar, arms and run count for section 3, and whether the control arm uses the pre-spine kit tag. Recommendation: two control worlds and two memory worlds before any pass claim (E11 on noise), bar fixed before the run.
- Q8. Is BD18 (Body perception memory persisted per life) in this track? Recommendation: a separate card, not a blocker for the exit test.
- Q9. First cohort: clean agents with no seeded charters, or the rangers (KT7)? Recommendation: clean agents first.

Kiraifayi (cognition):

- Q5. The wording and timing of everything the agent reads: the `remember` description, the session-start print, and what replaces the `reflect` skill. Recommendation: the least text that works, no schedule words, no examples of kinds. Consolidation as a harness step, so no agent-facing text is needed for timing.
- Q6. Consolidation model and effort: the life's own model at higher effort (E10, decision 0157), and one self instead of planner and worker for single-model players. Recommendation: confirm E10 as written and measure before changing.
- Q10. Entry kinds: free text chosen by the agent, or a small fixed set. Recommendation: free text with views derived by code (E10), so kind names seed no social concept.
- Q11. Belief checks: flag-only or refuse? Recommendation: flag-only first (the review says the citation check limits invented beliefs but does not stop them).

### 5.1 Open-questions status (2026-11-27)

| Q | Topic | Owner or Kiraifayi | Status | Record | Recommended default | Safe? |
|---|---|---|---|---|---|---|
| Q1 | Spec amendments, by record | Owner | Decided: yes, each by record | 0453 | Yes; spec text edit left to the owner | Yes |
| Q2 | Experience record for every harness | Owner | Decided | 0454 | Every harness | Yes |
| Q3 | Retention and erasure | Owner | Decided; heard-text cap still open | 0455 | Erase with the life; append-only; cap is the owner's value | Yes; cap open |
| Q4 | Who may read the record | Owner | Decided | 0456 | Own record only; operators via the database | Yes |
| Q5 | Wording and timing of what the agent reads | Kiraifayi | Open, not decided | none | Least text that works; no schedule words; no examples of kinds | Safe as a direction. Its wording is agent-visible and needs Kiraifayi's ruling |
| Q6 | Consolidation model and effort | Kiraifayi | Open, not decided | none | Confirm E10 as written; measure before changing | Safe: no change and no agent-visible text |
| Q7 | Pass bar, arms, run count | Owner | Decided: two and two; bar values still open | 0457 | Two control and two memory worlds; bar fixed before the run | Yes; values open |
| Q8 | BD18 in this track | Owner | Decided | 0458 | Separate card, not a blocker for the exit test | Yes |
| Q9 | First cohort | Owner | Decided | 0459 | Clean agents first | Yes |
| Q10 | Entry kinds: free text or fixed set | Kiraifayi | Open, not decided | none | Free text, with views derived by code | Safe, provided no kind names appear in any agent-read text |
| Q11 | Belief checks: flag-only or refuse | Kiraifayi | Open, not decided | none | Flag-only first | Safe: flags change no agent-visible text |

Unverified, needed before the cards are final: what image players run versus hw0 (MK0); whether review rows 0b.1 and 1.3 merged; the events-table type names for acts and outcomes; where the kit saves the full run stream; the next free decision and SQL numbers at the time of writing.
