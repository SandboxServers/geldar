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
