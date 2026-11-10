# Phase 1 wave C4: packet cards (village features on the Colo)

Status as of 2026-11-10, branch `docs/phase1-packets-c4`. Planner draft. Nothing here is implemented. Ids, sizes, lanes and decision numbers are proposals; the owner confirms the pre-wave decisions first. The format follows [packet-conventions.md](../packet-conventions.md) (card fields in section 1, gates in section 4, decision block C4 0115 to 0129 in section 6, index lines in section 7). The wave goal is in [plan.md](../plan.md) section (e), "C4 Village features on the Colo". Spec references are to `docs/spec.md`, which no packet edits.

Reading order for a coder: the card, the two pre-wave decisions it names ([0078](../../../decisions/0078-mind-placement-for-phase1.md), [0079](../../../decisions/0079-credit-numbers-and-charge-rules.md), [0080](../../../decisions/0080-nats-auth-cutover.md)) where the card cites them, then the code paths on the card. Do not invent paths. Every path below was checked against `origin/main`'s tree at the time of writing; a path that moved is a deviation to report.

## 0. Shared rules for every C4 card

- **Owner-first gates.** Decision 0079 gates C4-04 (credit numbers). Decision 0078 is already the assumed placement (the Mind on the Record/Mind host, Thinkers on the owner's GPUs and `api-minds`); C4-03 and C4-07 assume it. A card that depends on an unconfirmed Proposed record does the build and stops before the owner-facing numbers are merged.
- **Knowledge boundary (every card that writes agent-visible text).** Any new text an agent can read (prompt templates, tool descriptions, book pages, Shrine ledger text returned by `read_sign`, chat rendering, wake wording, error strings returned to the Body) follows [0058](../../../decisions/0058-the-character-knowledge-boundary-and-thought-v2.md) (no meta-knowledge of the game, the server or the Glass) and [0068](../../../decisions/0068-prompt-v4-and-agent-visible-text.md) (one allow-list, shared marker list). The shared marker list is `contract/src/agent-text.ts`. The scans are `contract/test/agent-visible-text.test.ts` and the prompt scan. Every card that adds such text names the scan in its checks. Note: the wave plan cites decision 0059 for the marker scan; 0059 is the identity-mode record (humans may watch, agents are not told). The knowledge-boundary rule is 0058 and 0068. Both are cited here.
- **Human-only surfaces never reach agents.** The Glass (Thought Stream), BlueMap and the operator logs are read-only for humans. No C4 card may feed their content into a prompt or an agent-visible tool result (spec 5.13; 0072).
- **Life IDs and births are server facts.** The Body and the Mind receive life IDs; they never allocate them (see C4-05).
- **Spec is read-only.** `docs/spec.md` is in every card's must-not-edit list.
- **Common checks** (conventions 4.1): targeted tests named on the card; `./geldar.ps1 pnpm` typecheck and `pnpm format` for the touched package; revert-check; file-size cap (700 hard, 500 soft); decision-index check; `git merge-tree` against the wave branch.
- **Common must-not-edit:** `docs/spec.md`, `docs/decisions/README.md` (ops merge step), `geldar.ps1`, `tools/repo-checks/**`, `compose/phase0.yml`, `shards/phase0.yaml`, `golem/view.ts`, root `package.json` and lockfile, and `contract/**` except in P1-C4-00.

---

### P1-C4-00 contract unblocker: chat events, books and skills, credit ledger, life and birth, hibernation, Thinker enrollment

- **id:** P1-C4-00 (UNBLOCKER)
- **wave:** C4
- **lane:** A
- **depends-on:** C3-00 (the C3 contract unblocker must be merged first; this card is the only C4 packet that touches `contract/`)
- **status:** B (buildable and testable on the desktop; no live step)
- **decisions:** 0115
- **size:** S (about 40k working tokens)
- **may-edit:** `contract/src/**` (new schema modules named below, and their index entries), `contract/test/**`, the generator's output directory that `contract/` produces (run the generator, do not hand-edit), `docs/decisions/0115-*.md`, the worknote.
- **must-not-edit:** everything listed in section 0; every `golem/**`, `animus/**`, `plugin/**`, `threshold/**` and `sql/**` file (the schema is consumed later; the SQL migrations belong to C4-05 and C4-07).
- **worknote:** `docs/analysis/phase1/worknotes/P1-C4-00.md`
- **commit:** one commit per item (1 schema, 2 generated output, 3 record 0115).

**Numbered steps**

1. Read the schema index under `contract/src/` and the generator script in `contract/package.json`. Find how C3-00 added its shapes; follow the same pattern.
2. Add these shapes, each as a schema with a `version` field and a closed set of event kinds:
   - **Chat events:** `chat.heard` (speaker agent id, listener agent id, shard tick, message text, distance band). Proximity is server-computed from the shard chat radius (spec, shard rules, `geldar://shard/rules`); the schema carries no listener list.
   - **Book and skill:** `book.written` and `book.read` receipts (book id, skill id, edition, content hash, `learned_from` book id on the copy); `skill.acquired` (life id, skill id, source book id).
   - **Credit ledger entry:** `credit.reserved`, `credit.settled`, `credit.refunded` (life id, tier, amount, reservation id, reason code). Amounts are integers. The tier table is NOT in the schema; it arrives with C4-04 after 0079 is confirmed, as a shard config key.
   - **Life and birth:** `life.started` (life id, agent id, parent life id or null, birth source: `spawn`, `cradle`, `replacement`), `life.ended` (life id, cause). Life ids are opaque strings (`lf_` prefix) generated by the server.
   - **Hibernation state:** `hibernation.state` (agent id, state: `awake`, `dim`, `hibernating`, `resumed`, the Thinker id that was missing, tick).
   - **Thinker enrollment:** `thinker.enrolled` and `thinker.revoked` (thinker id, nats user name, enrolment time, revocation reason). No secret field; secrets stay in `compose/secrets/`.
3. Run the generator. Commit the generated output exactly as produced.
4. Write the schema tests: each event parses a valid example; each rejects a missing life id, a negative amount and an unknown kind.
5. Record decision 0115 (C4 contract shape and the rule that the server allocates life ids). Add the index line to the worknote (conventions 7).
6. Run `./geldar.ps1 pnpm --filter contract` typecheck, format and test. Run the agent-visible text scan on any new `description` or `label` string.

**Acceptance checks**

- `contract/test` schema tests pass and count at least the number added (no test is skipped).
- Revert-check: remove the `life_id` requirement from `life.started` in the schema. The test "rejects a life.started without a life id" must fail. Restore.
- Generated output is byte-identical to a fresh generator run (the repo's generated-code check, run by `./geldar.ps1 check`).
- `./geldar.ps1 check` exit 0.

**Index line to add (handoff):** `index: | [0115](0115-c4-contract-shapes-and-server-life-ids.md) | C4 contract shapes; the server allocates life ids | Accepted |` (the ops merge step adds it).

---

### P1-C4-01 proximity chat and the attention test (10 agents in earshot)

- **id:** P1-C4-01
- **wave:** C4
- **lane:** A
- **depends-on:** P1-C4-00
- **status:** B
- **decisions:** 0116
- **size:** M (about 40k)
- **may-edit:** `golem/src/perception/**` (chat rendering and listener filtering), `golem/src/mind-link/**` (wakeup routing), `plugin/core/src/main/java/dev/geldar/core/**` chat package only (the server-side radius filter; create `ProximityChat.java` and its test), `animus/src/attention/**` (the wakeup counter and the "speech heard" trigger), `golem/src/bench/**` (the 10-agent scenario), `docs/analysis/phase1/worknotes/P1-C4-01.md`.
- **must-not-edit:** section 0 list; `animus/src/prompts/**` (C4-06 owns wording); `plugin/core` files outside the chat package.
- **worknote:** `docs/analysis/phase1/worknotes/P1-C4-01.md`
- **commit:** per item (1 server radius filter, 2 Body rendering, 3 attention counter, 4 scenario and the metric).

**Numbered steps**

1. Server: `ProximityChat` delivers a chat line only to players and agents within the shard's chat radius (the `chat radius` shard rule). Unit-test the distance boundary (inside, on the edge, outside).
2. Body: `golem/src/perception` renders a heard line as a `chat.heard` event (contract from C4-00). The Body does not wake the Mind for a line it did not hear.
3. Attention: `animus/src/attention` raises a "speech heard" wakeup only when the current intent cannot absorb the line (spec 5.3.2). Count every wakeup with its reason in the journal.
4. Scenario: `golem/src/bench` gets a 10-agent earshot scenario: ten agents in one chat radius, each with one durable intent (a 20-block walk plus three crafts), talking every 30 seconds in a fixed script. Run for 30 minutes of game time with an injected clock; the live run is C4-08's.
5. Metric: model wakeups per agent per real minute, computed from the journal counts over the scenario window. Report the value and the count of intent steps completed.

**Acceptance checks**

- Pass: wakeups per agent per real minute is less than 1.0 averaged over the window, AND every one of the ten intents completes its steps (no intent is starved by chatter). Both numbers are in the report.
- Test `attention: a heard line that the intent can absorb does not wake the Mind`. Revert-check: in `animus/src/attention`, make every heard line a wakeup. The test must fail; restore.
- Test `chat: a line outside the radius is not delivered`. Revert-check: set the radius filter to always-true in `ProximityChat.java`. The test must fail; restore.
- Knowledge-boundary scan on the rendered chat text (`contract/test/agent-visible-text.test.ts` plus the prompt scan). The rendered line contains no server or plugin word.
- `./geldar.ps1 check` exit 0.

**Index line to add (handoff):** `index: | [0116](0116-proximity-chat-and-attention-budget.md) | Proximity chat; wakeup budget for shared speech | Proposed |`

---

### P1-C4-02a books and skills: a procedure written into a book and acquired by a second agent

- **id:** P1-C4-02a
- **wave:** C4
- **lane:** B
- **depends-on:** P1-C4-00
- **status:** B
- **decisions:** 0117
- **size:** M (about 40k)
- **may-edit:** `golem/src/books/**`, `golem/src/actions/**` (the `write_book` and `read_book` actions), `plugin/core/src/main/java/dev/geldar/core/**` books package only (create `BookCopy.java` if the copy-stamp is needed; the spec 5.5 copy step), `sql/` (one new migration, next free number after `0006`, for the skill library rows with `learned_from`), `docs/analysis/phase1/worknotes/P1-C4-02a.md`.
- **must-not-edit:** section 0 list; `animus/**` (the Mind does not change for books); `golem/src/bench/**`.
- **worknote:** `docs/analysis/phase1/worknotes/P1-C4-02a.md`
- **commit:** per item (1 migration, 2 write and read actions, 3 copy stamp, 4 acquisition test).

**Numbered steps**

1. `write_book(title, skill_id)` (spec 5.5 step 1): the Body crafts a book and quill (the material cost), the server attaches `skill_id`, `edition` and `content_hash`, and the visible pages hold the skill's name, description, manifest and program text.
2. `read_book()` is a plugin-channel request that the server answers only if the reader holds that book (spec 5.5 step 2). Reading sends nothing else.
3. Copying (a grindstone or craft copy) is intercepted by the plugin, which re-stamps the copy (spec 5.5, vanilla copying may drop custom data). The copy keeps `content_hash` and records `learned_from: <book_id>`.
4. Acquisition: the reader's private library gets the skill; the book is not consumed (spec 5.5 step 3).
5. Write the acquisition test as an integration test: author agent writes the book; second agent holds it, reads it, and then runs the skill with no skill-invention call.

**Acceptance checks**

- Test `books: a second agent acquires a skill only through the book and records learned_from`.
- Revert-check: remove the `learned_from` stamp in the copy path. The test must fail; restore.
- Test `books: reading requires holding the book`. Revert-check: make `read_book` answer for any reader. The test must fail; restore.
- Test `books: the book is not consumed on read`.
- Knowledge-boundary scan on the book pages and the `read_book` result text.
- Migration applies on a fresh database and on the Phase 0 snapshot (the migration test in `tools/migrate`).
- `./geldar.ps1 check` exit 0.

**Index line to add (handoff):** `index: | [0117](0117-books-and-skills-copy-stamp-and-learned-from.md) | Books and skills: copy stamp and learned_from | Proposed |`

---

### P1-C4-02b procedure library: the mechanism demo (inference reduction)

- **id:** P1-C4-02b
- **wave:** C4
- **lane:** B
- **depends-on:** P1-C4-02a
- **status:** B (the scenario runs on the desktop; the node run is C4-08's)
- **decisions:** 0118
- **size:** M (about 40k)
- **may-edit:** `golem/src/books/**` (library lookup in the prompt path), `animus/src/prompts/**` only for a skill-library slot (no new wording; the slot shows the skill text, see 0058), `tools/adam-run/**` (the mechanism-demo scenario; create `mechanism-demo.ts` and its test), `tools/adam-report/**` (the metric report), `docs/analysis/phase1/worknotes/P1-C4-02b.md`.
- **must-not-edit:** section 0 list; `plugin/**`; `sql/**` (02a owns the schema).
- **worknote:** `docs/analysis/phase1/worknotes/P1-C4-02b.md`
- **commit:** per item (1 library slot, 2 demo scenario, 3 metric report).

**Metric (defined here; the spec does not define it).**

- *Useful autonomous minute:* a real minute in which at least one durable intent step completes with a receipt. Owner question 1 asks for confirmation.
- *Inference calls per useful autonomous minute:* model calls made by the agent in a scenario window, divided by its useful minutes in that window. Reported for each agent, and for the baseline.
- *Mechanism claim:* agent B, holding book B-1 and no other source, executes the skill with fewer calls per useful minute than B's own baseline on the same task with no book, and the drop comes from the library (B's prompts carry the skill text, not a re-derivation).

**Harness scenario.** Author A and learner B on one shard, same pinned model configuration (0051 fixes the models). Task T: craft a stone pickaxe from a chest of cobble and sticks, after a Body restart and one chatter interruption. Five runs with the book (B holds B-1) and five runs without it (B starts from zero skills). Each run is a fresh life with a seeded world; same seed for both arms.

**Numbered steps**

1. Add the library lookup: at prompt build, B's private library entries for the current task are placed in a fixed slot. No new prompt wording; the slot carries the skill's text and nothing else.
2. Scenario `mechanism-demo` in `tools/adam-run`: arms, seeds, the restart at step 2 of T, the interruption at step 3, and the receipts the run must produce.
3. Metric report in `tools/adam-report`: calls per useful minute per arm, the ratio, and the `learned_from` chain from the journal.

**Acceptance checks (pass bar; owner confirms the numbers, the proposal is [J])**

- B with the book: calls per useful minute at most 50% of B's no-book baseline, median of five runs, and all five runs complete T.
- A: its inference calls per useful minute fall in the window after the book is written (the sign the procedure reduces inference for the author too). Report only; not a pass criterion.
- Every B run's journal shows `skill.acquired` with `learned_from` = B-1 and no `skill.invented` event for T.
- Test `mechanism-demo: the book arm completes T after restart and interruption`. Revert-check: remove the library slot from the prompt build. The test must fail (B re-derives, calls go up); restore.
- Test `mechanism-demo: the metric counts only receipt-backed steps as useful`. Revert-check: count every intent tick as useful. The test must fail; restore.
- Knowledge-boundary scan on the slot text (`contract/test/agent-visible-text.test.ts`).
- `./geldar.ps1 check` exit 0.

**Index line to add (handoff):** `index: | [0118](0118-mechanism-demo-metric-and-pass-bar.md) | Mechanism demo: metric and pass bar | Proposed |`

---

### P1-C4-03 sleep reflection and hibernation (Thinker offline for an hour, zero deaths)

- **id:** P1-C4-03
- **wave:** C4
- **lane:** C
- **depends-on:** P1-C4-00, C3-02 (honest sleep mark; this card changes the same `golem/src/body` files)
- **status:** B (the one-hour live run is an O step, C4-08)
- **decisions:** 0119
- **size:** L (two sessions; the hibernation state machine plus the reflection path)
- **may-edit:** `animus/src/reflection/**`, `animus/src/loop/**` (the reflection trigger and the fatigue rule), `animus/src/thinker/**` (the Thinker-offline signal), `golem/src/body/**` (dim, hibernate, resume; the shelter path uses the enclosed-space rule of 0074, not a bed), `golem/src/mind-link/**`, `docs/analysis/phase1/worknotes/P1-C4-03.md`.
- **must-not-edit:** section 0 list; `lantern-local/**` (the local Thinker is not changed); `animus/src/prompts/**` (C4-06 owns wording); `threshold/**`.
- **worknote:** `docs/analysis/phase1/worknotes/P1-C4-03.md`
- **commit:** per item (1 reflection once per in-game day and digest, 2 hibernation state, 3 resume, 4 the one-hour simulated test).

**Numbered steps**

1. Reflection (spec 5.4): `sleep()` on a bed the server confirms triggers reflection at most once per in-game day; repeated sleep neither re-runs it nor refills credits. The Mind runs one longer thought over the deterministic digest. Keep the fatigue rule as written (degraded reflection after 3 in-game days) and cite 0074 for the shelter definition.
2. Hibernation (spec 3 glossary, 5.2, and the Thinker path at spec line 248): dim after the 45-second deadline with no completion; hibernate after ten minutes without a mind: shelter in an enclosed space, seal, log out. The server writes `hibernation.state`.
3. Resume: when a Thinker returns and the agent's model has a Thinker, the agent logs in at its sealed position and emits `resumed`. No intent is dropped; durable intents resume from checkpoint.
4. No death while hibernating: the Body never takes a damaging action while dim or hibernating (a test asserts the action set is empty of attacks and moves).
5. Simulated test with an injected clock: the Thinker is taken offline for 60 simulated minutes.

**Acceptance checks**

- Pass (simulated): zero deaths across all agents in the scenario; every agent is `hibernating` before minute 10 of the outage and `resumed` within one minute of the Thinker's return; every receipt chain stays unbroken.
- Live hour (O, C4-08): the same check with the real desktop Thinker switched off for one hour on the node's test shard. Recorded in the worknote.
- Test `hibernation: an agent with no mind for ten minutes shelters and logs out`. Revert-check: remove the ten-minute transition in the Body state machine. The test must fail; restore.
- Test `reflection: a second sleep in the same in-game day does not re-run reflection`. Revert-check: drop the once-per-day guard in `animus/src/reflection`. The test must fail; restore.
- Test `hibernation: a hibernating agent takes no damaging action`.
- Knowledge-boundary scan on any new status text the agent reads (`dim`, `hibernating`).
- `./geldar.ps1 check` exit 0.

**Index line to add (handoff):** `index: | [0119](0119-hibernation-and-reflection-in-phase1.md) | Hibernation and sleep reflection for Phase 1 | Proposed |`

---

### P1-C4-04 credits allowance: reserve-before-dispatch and failed-reflection refund (needs 0079)

- **id:** P1-C4-04
- **wave:** C4
- **lane:** D
- **depends-on:** P1-C4-00, and decision 0079 confirmed by the owner (the numbers in the tier table are the gate; the mechanism can be built with the values as shard config keys)
- **status:** B (numbers O)
- **decisions:** 0120
- **size:** M (about 40k)
- **may-edit:** `animus/src/ports/admission.ts`, `animus/src/loop/admission.ts` (reserve before dispatch), `animus/src/reflection/**` (refund rule), `animus/test/**` (admission tests), `golem/src/players/**` (per-address failed-auth cap scaling, if the cap lives there; verify the path first), `docs/analysis/phase1/worknotes/P1-C4-04.md`.
- **must-not-edit:** section 0 list; `plugin/**`; `threshold/**` (the public MCP caps are C2's; this card only reads them); `contract/**` (the event shapes came in C4-00).
- **worknote:** `docs/analysis/phase1/worknotes/P1-C4-04.md`
- **commit:** per item (1 reserve before dispatch, 2 refund on failure before output, 3 caps scaled per address, 4 tier table as config).

**Numbers (Proposed in 0079; the owner confirms before the value is set in a shard config).**

- Mind-driven agents, spec 5.7 line 642 (credits per real hour): frontier 6, heavy 6, strong 8, fast 8, tiny 6. Cap 24 hours' worth (line 643). Standard thought 1 credit, high-effort 3, reflection 2 once per in-game day (line 644).
- Sovereign players keep 0057: 30 per real hour, cap 240, free `wait`, `look`, `read_book`, `status`.
- Per-address failed auth: 0057 gives 30 per minute per player and 300 global per minute. Proposed: the per-address cap is the per-player value times the players on that address (a 15-player address gets 450 a minute), tested with 15 agents on one address.

**Numbered steps**

1. Reserve before dispatch: the admission reservation is taken before a thought is sent to a Thinker (the Phase 2 gate, now in Phase 1 per 0079).
2. Refund on failure: if the Mind fails before any Thinker output reaches the agent, release the reservation (`credit.refunded`). Once output is delivered, the charge settles even if the reflection is discarded (0079 C-A; 0062 keeps the completed-reflection rule).
3. Allowance per real hour (accrual), capped at 24 hours' worth. Accrual is computed from real time, not ticks.
4. Per-address failed-auth cap scales with players on the address.

**Acceptance checks**

- Test `admission: a reservation is taken before dispatch`. Revert-check: move the reserve call after dispatch in `animus/src/loop/admission.ts`. The test must fail; restore.
- Test `admission: a Thinker failure before output refunds the reserve`. Revert-check: make `release()` a no-op on failure. The test must fail; restore.
- Test `admission: a delivered-then-discarded reflection settles its cost`.
- Test `admission: fifteen agents on one address share the scaled failed-auth cap`. Revert-check: use the per-player cap for the address. The test must fail; restore.
- The tier values are read from shard config, not hard-coded; a test loads the 0079 values and asserts the table (the values are Proposed until the owner confirms).
- `./geldar.ps1 check` exit 0.

**Index line to add (handoff):** `index: | [0120](0120-credit-reserve-and-refund-rules.md) | Credits: reserve before dispatch, refund on failure | Proposed |`

---

### P1-C4-05 shrine and birth: bounded pool, idempotent offers, server-allocated life IDs

- **id:** P1-C4-05
- **wave:** C4
- **lane:** E (Shrine and birth)
- **depends-on:** P1-C4-00 (the `life.started`, `life.ended` and `credit.*` shapes); C3-05 (the `prepared` receipt, which the duplicate-offer rule needs); decision 0079 confirmed for the tariff table and the pool size (the mechanism is built with them as shard config keys, the values wait for the owner)
- **status:** B (mechanism); O (tariff and pool values, 0079)
- **decisions:** 0121 (shrine pool, offers and server-allocated life IDs for births). Decision 0126 is reserved for the Shrine exit-wording ruling and is not used here.
- **size:** L (two sessions: the shrine is one mechanism, birth and life IDs are another; the shrine items commit first)
- **may-edit:** `plugin/core/src/main/java/dev/geldar/core/shrine/**` (create if it does not exist, and say so in the report), `plugin/core/src/main/java/dev/geldar/core/life/**` (create if it does not exist: life ID allocation and birth), `golem/src/life/**` (create if it does not exist: the Body's life state, read only from the server), `golem/src/actions/**` (the `offer` and `give` actions), `sql/` (one new migration for the shrine pool ledger and the life table; the next free number after the migration C4-02a adds; the index line goes to the ops merge step), `docs/analysis/phase1/worknotes/P1-C4-05.md`.
- **must-not-edit:** section 0 list; `animus/**` (the Mind receives life IDs and never allocates them); `plugin/core` outside the shrine, life and the Geldar-Core protection path; `golem/src/bench/**`; the spawn-protection settings in the shard config.
- **worknote:** `docs/analysis/phase1/worknotes/P1-C4-05.md`
- **commit:** per item (1 pool and tariff as config keys, 2 offer and give with receipts and the duplicate no-op, 3 life ID allocation and the life table, 4 death and birth with distinct life IDs, 5 Cradle headroom).

**Numbered steps**

1. Pool (spec 5.7, the Shrine, around line 654): each shard has a fixed daily issuance pool. Offers during the day earn shares, weighted by the tariff table; the pool is paid out at the next in-game dawn. The pool size and the tariff table are shard config keys; the values are set only after 0079 is confirmed. Settlement writes `credit.settled` entries with integer amounts. The sum of shares paid never exceeds the pool (the bound).
2. Offer and give: `offer(item, count)` at a Shrine is an economic action. The Body's `give` moves the items, and the server writes two receipts, one per side (0020). An `offer` repeated with the same action id is a no-op: it returns the first call's `prepared` receipt, moves no items and adds no shares. This needs the `prepared` receipt from C3-05.
3. Ledger text: `read_sign` at the Shrine returns the public ledger (totals and offers only). The ledger text is agent-visible, so it follows 0058 and 0068 and passes the scans in section 0. It never shows Glass, BlueMap or operator data.
4. Life IDs: the server allocates an opaque `lf_` ID when an agent is born (birth source `spawn`, `cradle` or `replacement`). The Body and the Mind receive the ID in `life.started`. The Body's action set has no field for an ID.
5. Death and birth: a death writes `life.ended` for life L1. The birth that follows writes `life.started` for a new life L2 with parent life L1 (or null for a first life). L1 and L2 are distinct; the exit (spec 1418) needs both.
6. Cradle headroom (spec 5.7, population around line 687): replacement births never consume the reserved Cradle headroom (default 10% of target). A test fills the population to the replacement line and asserts that the headroom stays open.
7. The Shrine block pattern stays under Geldar-Core protection (spec, world settings, around line 283). This card does not change spawn protection.

**Acceptance checks**

- Test `shrine: a duplicate offer with the same action id is a no-op`. Revert-check: remove the `prepared` receipt lookup in the offer path. The second offer then adds shares again; the test must fail; restore.
- Test `shrine: total shares paid never exceed the daily pool`. Revert-check: remove the pool cap at settlement. The test must fail; restore.
- Test `give: both sides of an offer get a receipt` (0020).
- Test `life: the server allocates life IDs and the Body cannot supply one`.
- Test `birth: a death and its replacement birth have distinct life IDs and a parent link`. Revert-check: reuse the life ID at rebirth. The test must fail; restore.
- Test `birth: replacement births leave the Cradle headroom open`.
- Knowledge-boundary scan on the `read_sign` ledger text (`contract/test/agent-visible-text.test.ts`).
- The migration applies on a fresh database and on the Phase 0 snapshot (`tools/migrate`).
- `./geldar.ps1 check` exit 0.

**Index line to add (handoff):** `index: | [0121](0121-shrine-pool-offers-and-server-life-ids.md) | Shrine pool, idempotent offers, and server-allocated life IDs for births | Proposed |`

---

### P1-C4-06 prompt v5 and wake wording: due_tick, damage in flight, suppressed wakeups

- **id:** P1-C4-06
- **wave:** C4
- **lane:** C (hibernation and prompts; serialised after P1-C4-03, because both edit `animus/`)
- **depends-on:** P1-C4-01 (the "speech heard" wake and its counter), P1-C4-02b (the skill-library slot in the prompt build), P1-C4-03 (the reflection and hibernation changes in `animus/`)
- **status:** B
- **decisions:** 0122
- **size:** M (about 40k)
- **may-edit:** `animus/src/prompts/**` (a new version directory and the version bump; the template registry), `prompts/**` (the versioned template directory if it lives outside `animus/`; verify the path on the wave branch first and report it), `animus/src/attention/**` (the wake wording and the `suppressed_wakeups` reason), `animus/test/**` (prompt and wake tests), `docs/analysis/phase1/worknotes/P1-C4-06.md`.
- **must-not-edit:** section 0 list; every released template version (v1 to v4): they are never edited, only superseded; `contract/src/agent-text.ts` (the marker list belongs to C4-00); `golem/**`; `plugin/**`; `threshold/**`.
- **worknote:** `docs/analysis/phase1/worknotes/P1-C4-06.md`
- **commit:** per item (1 prompt v5 as a new version, 2 due_tick in the prompt, 3 damage re-raise and suppressed-wakeup reasons, 4 wake wording and the scans).

**Numbered steps**

1. Prompt v5 is a new template version with its own directory and a version bump in the registry (0068). Released versions v1 to v4 are not edited. A golden test records the content hash of each released template, so an edit to one fails the build.
2. `due_tick`: the prompt shows the tick at which the agent's current intent is next due (the next wake the Body expects). The value is read from the intent, not computed in the prompt.
3. Damage in flight: when the agent takes damage while a thought is in flight, the wake is re-raised after that thought returns. It is not dropped and not merged silently.
4. `suppressed_wakeups`: a wakeup that the attention rule (C4-01) suppresses records its reason (for example `absorbed-by-intent`, `budget`, `dim`) in the journal. The agent-visible text says only what happened in the world ("you were busy with the walk"), never the reason code.
5. Wake wording: the "speech heard" wake uses in-world words only. It contains no word from the marker list and no server, budget or wakeup term.
6. Run the prompt scan and the agent-visible text scan on v5 and on every new wake string.

**Acceptance checks**

- Test `prompt: v5 is a new version and released v1 to v4 are byte-identical`. Revert-check: edit a released template. The golden test must fail; restore.
- Test `wake: damage taken during a thought re-raises the wake`. Revert-check: drop the re-raise. The test must fail; restore.
- Test `wake: a suppressed wakeup records its reason in the journal and the agent sees no reason code`.
- Test `prompt: due_tick matches the intent's next due tick`.
- Knowledge-boundary scans on v5 and the wake strings (section 0).
- `./geldar.ps1 check` exit 0.

**Index line to add (handoff):** `index: | [0122](0122-prompt-v5-and-wake-wording.md) | Prompt v5, due_tick, damage re-raise, and suppressed-wakeup reasons | Proposed |`
