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
2. Offer and give: `offer(item, count)` at a Shrine is an economic action. The Body's `give` moves the items, and the server writes two receipts, one per side (0020). An `offer` repeated with the same action id is a no-op: it returns the first call's `prepared` receipt, moves no items and adds no shares. The lookup key is `receiptIdFor(actionId, 'prepared')`, the id C3-05 step 1 writes. This needs the `prepared` receipt from C3-05.
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

### P1-C4-06 prompt v7 and wake wording: due_tick, damage in flight, suppressed wakeups

- **id:** P1-C4-06
- **wave:** C4
- **lane:** C (hibernation and prompts; serialised after P1-C4-03, because both edit `animus/`)
- **depends-on:** P1-C4-01 (the "speech heard" wake and its counter), P1-C4-02b (the skill-library slot in the prompt build), P1-C4-03 (the reflection and hibernation changes in `animus/`)
- **status:** B
- **decisions:** 0122
- **size:** M (about 40k)
- **may-edit:** `animus/src/prompts/**` (a new version directory and the version bump; the template registry), `prompts/**` (the versioned template directory if it lives outside `animus/`; verify the path on the wave branch first and report it), `animus/src/attention/**` (the wake wording and the `suppressed_wakeups` reason), `animus/test/**` (prompt and wake tests), `docs/analysis/phase1/worknotes/P1-C4-06.md`.
- **must-not-edit:** section 0 list; every released template version (v1 to v6): they are never edited, only superseded (v6 is reserved for C3-03, so this card creates v7); `contract/src/agent-text.ts` (the marker list belongs to C4-00); `golem/**`; `plugin/**`; `threshold/**`.
- **worknote:** `docs/analysis/phase1/worknotes/P1-C4-06.md`
- **commit:** per item (1 prompt v7 as a new version, 2 due_tick in the prompt, 3 damage re-raise and suppressed-wakeup reasons, 4 wake wording and the scans).

**Numbered steps**

1. Prompt v7 is a new template version with its own directory and a version bump in the registry (0068). Released versions v1 to v6 are not edited. A golden test records the content hash of each released template, so an edit to one fails the build.
2. `due_tick`: the prompt shows the tick at which the agent's current intent is next due (the next wake the Body expects). The value is read from the intent, not computed in the prompt.
3. Damage in flight: when the agent takes damage while a thought is in flight, the wake is re-raised after that thought returns. It is not dropped and not merged silently.
4. `suppressed_wakeups`: a wakeup that the attention rule (C4-01) suppresses records its reason (for example `absorbed-by-intent`, `budget`, `dim`) in the journal. The agent-visible text says only what happened in the world ("you were busy with the walk"), never the reason code.
5. Wake wording: the "speech heard" wake uses in-world words only. It contains no word from the marker list and no server, budget or wakeup term.
6. Run the prompt scan and the agent-visible text scan on v7 and on every new wake string.

**Acceptance checks**

- Test `prompt: v7 is a new version and released v1 to v6 are byte-identical`. Revert-check: edit a released template. The golden test must fail; restore.
- Test `wake: damage taken during a thought re-raises the wake`. Revert-check: drop the re-raise. The test must fail; restore.
- Test `wake: a suppressed wakeup records its reason in the journal and the agent sees no reason code`.
- Test `prompt: due_tick matches the intent's next due tick`.
- Knowledge-boundary scans on v7 and the wake strings (section 0).
- `./geldar.ps1 check` exit 0.

**Index line to add (handoff):** `index: | [0122](0122-prompt-v7-and-wake-wording.md) | Prompt v7, due_tick, damage re-raise, and suppressed-wakeup reasons | Proposed |`

---

### P1-C4-07 Thinker gateway: per-Thinker NATS users, enrolment and revocation (security review first; B/O)

- **id:** P1-C4-07
- **wave:** C4
- **lane:** F (Thinker gateway)
- **depends-on:** P1-C4-00 (the `thinker.enrolled` and `thinker.revoked` shapes); decision 0078 confirmed by the owner (Thinkers on the owner's GPUs, joining the Mind placement); decision 0080 confirmed by the owner (the T-1 Phase 1 path and the cutover gate)
- **status:** B (the gateway, CLI and tests build on the desktop); O (enrolling a real Thinker, and any bind to a non-loopback interface, which waits for the security review in step 1)
- **decisions:** 0123 (the Phase 1 Thinker gateway: per-Thinker NATS user under 0080 T-1, enrolment and revocation), 0124 (mTLS or NATS accounts for Thinker identity in Phase 1). Only 0123 and 0124 are used here.
- **size:** L (two sessions: the review and the gateway; then the CLI and the live nats-server tests)
- **may-edit:** `tools/thinker-gateway/**` (create: the gateway service, the `enroll` and `revoke` CLI, and their tests), `compose/nats-auth.yml` (the per-Thinker user entries; verify the file on the wave branch first; the shard command is the owner of the secrets path), `docs/runbooks/thinker-enrolment.md` (create: enrolment, revocation as a user delete, and the stop conditions), `docs/analysis/phase1/worknotes/P1-C4-07.md` (the security review record goes here).
- **must-not-edit:** section 0 list; `compose/secrets/**` (generated by the shard command, never committed and never written into a brief or a log); `geldar.ps1` (the enrolment command is an index line to C4-08); `threshold/**`; `lantern-local/**`; `plugin/**`; any port in the compose files beyond the gateway's own, and no new public port (0071 owns the port list).
- **worknote:** `docs/analysis/phase1/worknotes/P1-C4-07.md`
- **commit:** per item (1 security review record, 2 gateway with loopback bind, 3 per-Thinker users and the enrolment CLI, 4 revocation and the live nats-server tests, 5 runbook).

**Numbered steps**

1. Security review first, read-only, before the gateway listens on any non-loopback interface. A reviewer who did not write the gateway reads the design and the code, and writes the threat model into the worknote. Minimum scope: a stolen Thinker credential, a revoked Thinker reconnecting, one Thinker reading another's subjects, one shard reading another's subjects, a compromised GPU host, and the enrolment CLI leaking a credential. The review ends with a list of findings; the packet cannot bind to a non-loopback interface while any finding is open at high.
2. Gateway: the process binds to `127.0.0.1` only until step 1 passes. Thinker traffic goes through the gateway; no Thinker holds a broad NATS credential.
3. Per-Thinker NATS user (0080, T-1): each Thinker gets its own user, with publish and subscribe rights only to its inbox subjects and the request subject for its tier. No `>` wildcard. The per-life subjects follow the decision in 0080 (scope by shard, and the Body subscribes to its own life).
4. Enrolment CLI: `enroll <thinker> <tier>` creates the NATS user, writes the credential under `compose/secrets/`, and writes `thinker.enrolled`. The CLI never prints the credential.
5. Revocation: `revoke <thinker>` deletes the NATS user (0080, consequence 3: a user delete, not a token rotation) and writes `thinker.revoked` with a reason. A revoked Thinker is refused on its next connection.
6. Thinker identity (0124): the packet records either (a) NATS user credentials only in Phase 1, the default recommendation under 0080, or (b) mTLS client certificates from the step-ca path in spec 6.5 with the NATS account behind them. The choice is an owner question (gating). The packet implements the one chosen and records the other as deferred to Phase 2 (0080 T-2).
7. Runbook `docs/runbooks/thinker-enrolment.md`: enrolment, revocation, what to check after each, and the stop conditions. The owner runs the enrolment on the real GPU hosts (plan (e), C4 owner items), not the packet.

**Acceptance checks**

- Step 1 record exists in the worknote before any non-loopback bind is merged, with its finding list.
- Test `gateway: a Thinker publishes and subscribes only on its own subjects`. Revert-check: grant the `>` wildcard to a Thinker user. The test must fail; restore.
- Test `gateway: a revoked Thinker is refused on its next connection` (0080 gate 2). Revert-check: skip the user delete in `revoke`. The test must fail; restore.
- Test `gateway: no subject from one shard is readable from another` (0080 gate 3). Run against a live `nats-server` (a real server in the integration suite, not a mock; 0080 gate 1 covers every role).
- Test `enrol: the enrolment CLI never prints the credential`.
- The revert-check of the overlay: with the overlay removed, the live test fails (0080 gate 4).
- `./geldar.ps1 check` exit 0.

**Index lines to add (handoff):** `index: | [0123](0123-phase1-thinker-gateway-and-per-thinker-nats-users.md) | Phase 1 Thinker gateway: per-Thinker NATS users, enrolment and revocation | Proposed |` and `index: | [0124](0124-thinker-identity-mtls-or-nats-accounts.md) | Thinker identity in Phase 1: NATS credentials or mTLS | Proposed |`

---

### P1-C4-08 integration and ops exit run: deploy to the node, Thinker onboarding, the Phase 1 exit (INTEGRATION + OPS, O)

- **id:** P1-C4-08
- **wave:** C4
- **lane:** G (integration and ops)
- **depends-on:** P1-C4-00 to P1-C4-07 merged to the wave branch; the wave-boundary gates in the wave section below passed up to step 3 (the live run with a real client)
- **status:** O (every node step is run by the owner or ops, one step at a time; the desktop integration steps are B)
- **decisions:** 0125 (the Phase 1 exit run: the mapping of each exit item to its evidence, the runbooks, and the stop conditions). Decision 0126 is the owner's Shrine exit-wording ruling; this packet cites it and does not write it.
- **size:** L (two sessions: the desktop integration and the wave gates; then the node run, which is an ops session)
- **may-edit:** `geldar.ps1` (the integration packet owns it under section 3: the Thinker enrolment command and the `exit-run` command, each with its help text), `tools/repo-checks/**` (the integration case-count floor), `compose/phase0.yml` and any new compose file for C4 (listed in section 3), `shards/phase0.yaml` (the C4 shard config keys: the tier table, the pool, the tariffs, after 0079), `golem/view.ts` (the integration packet owns it), `docs/runbooks/**` (C4 runbooks: exit run, Thinker onboarding, rollback; create the folder if it does not exist), `docs/analysis/phase1/worknotes/P1-C4-08.md`.
- **must-not-edit:** section 0 list; `docs/decisions/README.md` (ops merge step); `docs/spec.md`; the Phase 0 runbooks outside the C4 additions.
- **worknote:** `docs/analysis/phase1/worknotes/P1-C4-08.md`
- **commit:** per item (1 integration and the case-count floor, 2 exit-run harness and mapping, 3 runbooks, 4 the node run record, written by ops).

**Numbered steps (desktop, B)**

1. Merge the wave branch, run the full `./geldar.ps1 check`, and record the integration case count. The floor is the count at the start of wave C4; the check fails if it drops.
2. Map each Phase 1 exit item (spec line 1418) to a test agent, an expected receipt or journal row, and a test name. The mapping is the exit record. The Shrine item is scoped by 0126 (owner ruling); until 0126 is accepted, the Shrine and birth items are marked open, not passed.
3. Write the runbooks: exit run, Thinker onboarding, rollback.

**Numbered steps (node, O; owner or ops runs each one; read-only first)**

1. Preflight, read-only: confirm the commit hash on the node, `docker compose ps` and the logs with a tail limit, and an external port scan. Do not run `adam up` or `adam up --help` on a live node. Stop if a container is unhealthy or a port is open that 0071 does not list.
2. Backup taken and its restore verified (0076), before any deploy. Stop if the restore test has not passed.
3. Deploy with the deploy account the owner provides (plan (f), item 3). Read the compose config diff first; stop if it adds a public port.
4. Thinker onboarding (owner): enrol the desktop Thinker with the enrolment CLI (C4-07). Check that the NATS user exists and that a single test thought round-trips for one test agent. Stop if a credential appears in any log or output.
5. Hibernation hour (C4-03's live check): switch off the desktop Thinker for one hour on the test shard, watching read-only. Stop on any agent death, or any agent not `hibernating` before minute 10.
6. Mechanism demo on the node (C4-02b), then the spec exit run with the test agents, following the exit record from step 2 of the desktop part. Read the plan for each item before the run starts.
7. Rollback, if needed: revert the compose change, and revoke every Thinker enrolled in this run (a user delete, 0080).

**Acceptance checks**

- Every Phase 1 exit item passes or is listed as open with its reason; no item is marked passed without its receipt or journal row.
- The integration case count is at or above the floor, and the count is in the worknote.
- The node run record has the commit hash, the start and end times, and each step's result.
- The owner signs the exit record, with the runbooks reviewed.
- `./geldar.ps1 check` exit 0 on the desktop.

**Index lines to add (handoff):** `index: | [0125](0125-phase1-exit-run-and-runbooks.md) | Phase 1 exit run: evidence per exit item, runbooks, stop conditions | Proposed |`

---

## 10. Wave C4: lanes, gates, the soak, and the ledger

Status as of 2026-11-10. This section is the wave plan for C4 under the same rules. The cards above are the packets; this section sets the order, the gates, the soak, and what the owner must answer first.

### 10.1 Lanes and order

```
                       P1-C4-00  (lane A, contract unblocker)
          +-------------+--------------+-----------------+----------------+
          |             |              |                 |                |
   lane A:           lane B:        lane C:           lane D:          lane E:
   C4-01 chat        C4-02a books   C4-03 reflection  C4-04 credits    C4-05 shrine
          |             |          and hibernation    (waits 0079)     and birth
          |          C4-02b demo        |                               (waits C3-05)
          |             |               |
          +-------------+-------+-------+
                                |
                          C4-06 prompt v7 (lane C, after 01, 02b, 03)

   lane F:  C4-07 Thinker gateway (after 00; security review before any bind;
            waits 0078 and 0080 confirmed)
   lane G:  C4-08 integration and ops exit run (last; O)
```

- Fan-out after C4-00 merges to the wave branch: lanes A, B, C (03), D (after 0079), E (after C3-05), and F (after 0078 and 0080).
- Lanes do not share files except where a card says so (`animus/` in lane C: 03 then 06; `sql/` in lanes B and E: a migration number is taken at merge, and the later one renumbers).
- At most about six agents at once (conventions section 5). Lanes A to E fan out first; F starts only after its owner decisions.

### 10.2 Wave-boundary gates (conventions 4.2)

1. Full `./geldar.ps1 check`, with the integration case-count floor set at the start of the wave. Reason: CI skipped 43 integration tests in Phase 0.
2. One read-only review per surface, with a narrow brief. The surfaces: Body (golem), Mind (animus and prompts), chat and attention, books and skills, credits and admission, shrine and birth, hibernation and reflection, Thinker gateway. The next round aims only at the fixes.
3. One live run with a real client, not a mock, recorded step by step in the worknote. The run: an Adam-class agent connected through the Thinker gateway (C4-07), and a ranger (a real Minecraft client, operated by a person) on the same test shard. Steps: (a) read-only preflight; (b) the ranger joins and the agent sees the ranger's chat within the radius; (c) the agent takes one durable intent (the 20-block walk plus three crafts) and the ranger talks in earshot; (d) the wakeup count is read from the journal; (e) the agent offers at the Shrine and the ranger reads the ledger with `read_sign`; (f) the run stops, and the journal is checked for an unbroken receipt chain. A step that fails stops the run.
4. The wave retro in `docs/analysis/phase1/retro/wave-c4.md` (create).
5. Provisional decisions from the wave (0115 to 0126) get an owner confirmation or a superseding record before the campaign boundary.

### 10.3 Campaign-boundary gates (conventions 4.3)

1. An adversarial campaign review in the Phase 0 style: nine reviewers, one per surface, none of whom wrote the code, aggressive and investigative. The surfaces: the MCP endpoint; Glass; the Lakitu feed; the Minecraft port; NATS; the Thinker gateway; the credit and shrine economy; books, skills and chat (the agent-visible text); and the hibernation, birth and data paths (life IDs and the migrations). Each reviewer reports findings with a severity; the next round fixes only the high findings.
2. The full soak and the chaos run (below; length per O-soak, 10.5).
3. A security review of every public surface, as in conventions 4.3.3: the MCP endpoint, Glass, the Lakitu feed, the Minecraft port, NATS, and the Thinker gateway (which stays private until this review passes).
4. Spec-amendment reconciliation against the table in [decision 0073](../../../decisions/0073-spec-is-never-edited.md). Every row gets a status (settled, open, or amended by the owner). A packet never edits the spec; the owner does, one line at a time. Rows to check: the observers sentence (0068), the owner cap (0052), the "player" and "agent" terms, the personal names, the sovereign OAuth line (0054), the Mind placement (0050 and 0078), the Observatory edge (0071), the port and SRV line (0071), the Phase 1 exit wording (0126), and the four-public-ports line (0071).
5. The campaign retro in `docs/analysis/phase1/retro/campaign.md` (create).

### 10.4 The soak, as a test

The soak is a test in `tools/soak/` (create). It runs the agents and reads only the journal, the receipt tables and the metric endpoint. The verdict is computed by the test; nobody writes a verdict by hand, and a threshold is never changed to pass (conventions section 5).

- **Run:** 10 to 15 agents, one shard on the node. The length is open (O-soak, 10.5 and 10.6). Under option (A) a 72-hour gate runs at C3 and one 7-day run runs at exit after the C4 freeze; under option (B) a 7-day run runs throughout. No packet schedules a duration until the owner answers. The first hour is warm-up and is not counted.
- **Measured, sampled every real minute:** model wakeups per agent per real minute, and the intent steps completed; deaths and their causes; the receipt chain (every action has its prepared receipt and its final receipt, 0020, 0027); the credit ledger (reserved minus refunded minus settled, per life, at the end of each real day, must equal the open reservations); container memory (the slope per day of each container's resident set); NATS reconnects; MCP 5xx count; hibernation episodes and the time to `resumed`.
- **Thresholds (pass):** wakeups below 1.0 per agent per real minute, averaged over the counted window, while intents run (the plan's C3 exit target); zero deaths caused by the Body while hibernating (C4-03); every receipt chain unbroken; the credit ledger reconciles every day; no container's resident set grows by more than a limit set in the test before the run starts; zero unexplained MCP 5xx.
- **How counted:** a real minute is counted when at least one agent is awake. Wakeups are counted from the journal by reason, not from the logs. The window is the run's duration minus the warm-up hour.
- **Chaos (part of the same campaign gate):** restart each container in turn; take NATS down for five minutes; the desktop Thinker off for one hour (the C4-03 check); recreate the MCP container (the replay bound from the first ranger run, plan (g)). Each one has a written result in the campaign worknote.

### 10.5 The soak length: open owner question O-soak

The plan's C3 section says seven days (plan.md lines 156 and 161). The wave schedule in the C3 cards (C3 section 8, C3-10) proposes a 72-hour soak gate at C3. The two do not agree, and no packet states a duration as settled. The options are the same as in C3:

- (A) The wave schedule: a 72-hour soak gates C3, and one 7-day run happens once after the C4 feature freeze as the Phase 1 exit run (this changes plan.md C3 exit).
- (B) plan.md as written: a 7-day soak throughout.

Until the owner answers O-soak in writing, the 7-day run is not scheduled and CAMP-C4-B is not dated. The answer is recorded in a decision with a number from the registry.

### 10.6 Open owner questions that gate the wave

1. Decision 0078 (Mind placement) confirmed: gates C4-03 and C4-07.
2. Decision 0079 (credit numbers and charge rules) confirmed: gates the values in C4-04 and C4-05. The mechanisms can be built before.
3. Decision 0080 (NATS auth cutover, T-1 for Phase 1) confirmed: gates C4-07.
4. The Shrine exit wording (spec line 1414 excludes the Shrine and permadeath; line 1418 requires them): the owner's ruling is decision 0126. Gates the exit record in C4-08.
5. O-soak: the soak length and schedule, option (A) or option (B) in 10.5. Gates the soak rows in 10.8 and the exit run.
6. Thinker identity: NATS credentials only in Phase 1, or mTLS from the step-ca path (C4-07, 0124).
7. Which GPU hosts enrol as Thinkers, and whether the gateway is reachable over the LAN or a VPN in Phase 1 (plan (e), C4 owner items).
8. The mechanism-demo pass bar (C4-02b, proposal [J]) and the useful-minute definition.
9. The rangers for the live run in 10.2, step 3, and the date.

### 10.7 Ledger rows (for pasting; the ledger README is not edited by this packet)

| id | title | lane | depends | status |
|---|---|---|---|---|
| P1-C4-00 | Contract unblocker: chat, books, credits, life and birth, hibernation, Thinker enrolment | A | C3-00 | B |
| P1-C4-01 | Proximity chat and the attention test | A | P1-C4-00 | B |
| P1-C4-02a | Books and skills: copy stamp and learned_from | B | P1-C4-00 | B |
| P1-C4-02b | Procedure library: the mechanism demo | B | P1-C4-02a | B (numbers O) |
| P1-C4-03 | Sleep reflection and hibernation | C | P1-C4-00, C3-02 | B (live hour O) |
| P1-C4-04 | Credits allowance: reserve before dispatch, refund on failure | D | P1-C4-00, 0079 | B (numbers O) |
| P1-C4-05 | Shrine pool and birth: idempotent offers, server life IDs | E | P1-C4-00, C3-05, 0079 | B (values O) |
| P1-C4-06 | Prompt v7 and wake wording | C | P1-C4-01, P1-C4-02b, P1-C4-03 | B |
| P1-C4-07 | Thinker gateway: per-Thinker NATS users, enrolment | F | P1-C4-00, 0078, 0080 | B; enrolment O |
| P1-C4-08 | Integration and ops: Phase 1 exit run on the node | G | P1-C4-00 to P1-C4-07 | O |

### 10.8 Campaign and soak rows (for later, not in the wave ledger)

| id | title | lane | depends | status |
|---|---|---|---|---|
| CAMP-C4-A | Adversarial campaign review (nine reviewers) | review | P1-C4-08 | O |
| CAMP-C4-B | Full soak and chaos (length per O-soak) | ops | CAMP-C4-A | O (O-soak) |
| CAMP-C4-C | Public-surface security review | review | CAMP-C4-A | O |
| CAMP-C4-D | Spec-amendment reconciliation (0073 table) | owner | CAMP-C4-C | O |
| CAMP-C4-E | Campaign retro | owner | CAMP-C4-D | O |
