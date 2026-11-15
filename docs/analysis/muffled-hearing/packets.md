# Muffled hearing packets

Paths corrected 2026-11-15: the plugin is Java (package dev.geldar.core.proximity), not TypeScript.

Written 2026-11-14. Record: [0199-muffled-hearing](../../decisions/0199-muffled-hearing.md) (Proposed). Spec: 5.2 (earshot), 5.8 (32-block speech rule, information bubbles), 5.9 (`chat` config). Related: 0154 (`heard_sound`), 0181 (prompt budget), 0198 (proximity chat, the cut these packets extend).

Card fields follow [packet-conventions.md](../phase1/packet-conventions.md) section 1, with `owner` and `prove-it` added. The ids are `MH-n` until a wave id is assigned.

## Order

```
0198 proximity chat (plain distance; running elsewhere, lands first)
  |
  +-- MH-0 record ratified (owner rulings)
  |
  +-- MH-7 spec amendment 5.2, 5.8, 5.9   [OWNER APPROVAL point; geldar-93 asks the owner]
        |
        +-- MH-1 contract unblocker (heard_muffled schema, hearingSubject() helper)
              |
              +-- MH-CH NATS ACL pin test + body-role PubDeny (node only in a geldar-93 window)
              |
              +-- MH-2 plugin absorption model (pure code, no wiring)   [needs 0198 merged]
                    |
                    +-- MH-3 ProximityRule uses effective distance + notice emit
                    |     (rewrites 0198's acceptance tests; branch built first)
                    |     |
                    |     +-- MH-8a cost bench on the MH-3 branch (9 and 15 agents);
                    |     |     sets absorption values, margin M, sealed penalty S;
                    |     |     MH-3 does NOT merge until MH-8a is done
                    |     |
                    |     +-- (MH-3 merges) MH-4 golem Body: receive, collapse, sentence
                    |           |
                    |           +-- MH-5 threshold handler + adam-body wiring
                    |                 |
                    |                 +-- MH-6 prompts/ version bump
                    |                 |
                    |                 +-- MH-8b live lane (after MH-5)
```

Order: 0198, MH-7, MH-1, MH-CH, MH-2, MH-3, MH-8a, MH-4, MH-5, MH-6, MH-8b (MH-0 any time before MH-7). MH-8a runs on the MH-3 branch and gates the MH-3 merge. Contract files are merged one at a time (packet-conventions 2). MH-CH and MH-2 may run in parallel after MH-1.

---

## MH-0: ratify the record

- **depends-on:** owner rulings on open questions 2 and 3 in the record
- **owner:** geldar-93 (orchestrator), with the owner
- **size:** S (docs)
- **files:** `docs/decisions/0199-muffled-hearing.md` (number and status only)
- **prove-it:** none; a docs change. Check `pnpm check:repo` passes.

## MH-1: contract unblocker

- **depends-on:** MH-7 merged (owner approved); 0198 not required for the schema
- **owner:** geldar-93 (contract), with geldar-3b reviewing the Appendix A diff
- **size:** S
- **files:** `contract/schemas/heard-muffled-event.schema.json` (new); `contract/schemas/mcp-common.schema.json` (note only, no enum change; see record "Wait interests"); Appendix A perception schema in `docs/spec.md` (documentation of the new event); `contract/src/outcome-words.ts` (new `heardMuffledSentence` stub that returns the fixed text); `contract/src/subjects.ts` (new `hearingSubject(shard, lifeId)` returning `geldar.<shard>.body.<lifeId>.hearing`, beside `snapshotSubject` and `viewSubject`); generated outputs (regenerate, do not edit)
- **prove-it:** a schema test that rejects a `heard_muffled` event with a `x`/`y`/`z` field and with a speaker field, and accepts `direction` and `band` only. Revert the schema's `additionalProperties: false` and the test must fail. A test that `hearingSubject("s","L")` equals `geldar.s.body.L.hearing`; change the format and it fails. Regenerated output matches the generator (CI drift check).

## MH-CH: NATS ACL pin test and body-role PubDeny

- **depends-on:** MH-1 (the `hearingSubject()` helper)
- **owner:** geldar-93 (nats-auth generator), geldar-ops reviewing
- **size:** S
- **files:** `tools/repo-checks/src/nats-auth.test.ts` (pin test; it already pins the body deny list); the nats-auth generator in `geldar.ps1` (`Get-NatsUsers`: add `geldar.<s>.body.*.hearing` to the body role's PubDeny, recommended in record decision 9)
- **prove-it:**
  - a test that the existing plugin Pub (`geldar.<s>.>`) and body Sub (`geldar.<s>.body.>`) cover `hearingSubject()`, so a later narrowing fails it
  - a test that the body role cannot publish `geldar.<s>.body.<lifeId>.hearing` (PubDeny) while the plugin role can; remove the PubDeny line and the test fails
- **note:** the generator change reaches a node only in a geldar-93 deploy window (`deploy/README.md`: regenerate, copy, restart `nats`, which drops every client, after a notice). Option B (per-life credentials) is out of scope and needs its own record.

## MH-2: plugin absorption model

- **depends-on:** MH-1; 0198 merged to main (MH-2 constants are placeholders until MH-8a)
- **owner:** geldar-93 via a packet-coder (plugin)
- **size:** M
- **files:** `plugin/core/src/main/java/dev/geldar/core/proximity/Absorption.java` (new; the pure `effectiveDistance(...)` over a block-material lookup, no Bukkit types); `plugin/core/src/main/java/dev/geldar/core/proximity/AbsorptionTable.java` (new, the material table only, so it can be read without the algorithm); `plugin/core/src/main/java/dev/geldar/core/proximity/MuffleConfig.java` (new; the constants: per-ray cap 64, per-line cap 512, margin 8, sealed penalty 4; placeholders until MH-8a); `plugin/core/src/test/java/dev/geldar/core/proximity/AbsorptionTest.java` and `AbsorptionTableTest.java` (new; JUnit 5, beside `ProximityRuleTest.java`)
- **prove-it** (JUnit 5, run by the Gradle `test` task in `plugin/core`):
  - a test per table row (every material in decision step 4 has a pinned value; `AbsorptionTableTest`); changing one row fails its test
  - a test that a straight wall of 3 stone blocks between speaker and listener at raw 10 gives `e = 10 + 6 = 16` and the muffled tier when `e` is pushed past 32 by a 15-block wool wall (`AbsorptionTest`)
  - a test that the cast stops at 64 block reads and returns the silent tier, not an exception (`AbsorptionTest`)
  - revert: the absorption add in `Absorption.effectiveDistance` is removed, the wall test must fail

## MH-3: ProximityRule uses effective distance and emits the notice

This card REWRITES 0198's acceptance tests to gate on effective distance instead of raw distance.

- **depends-on:** MH-2; MH-1; MH-7 merged (spec amendment); MH-8a done before the merge (the branch is built first, MH-8a runs on it and sets the values)
- **owner:** geldar-93 via a packet-coder (plugin)
- **size:** M
- **files:** `plugin/core/src/main/java/dev/geldar/core/proximity/ProximityRule.java` (0198's file, extended: effective distance in place of raw distance); `plugin/core/src/main/java/dev/geldar/core/proximity/ProximityChatListener.java` (0198's file, extended; the plugin-to-Body emit publishes on `hearingSubject()`, record decision 9); `plugin/core/src/test/java/dev/geldar/core/proximity/ProximityRuleTest.java` and `ProximityChatListenerTest.java` (0198's tests, rewritten to gate on effective distance); the constants come from `MuffleConfig.java` (MH-2), not a new file here
- **prove-it** (rule cases in `ProximityRuleTest`; the notice emit and the per-line cap in `ProximityChatListenerTest`):
  - a clear pair (no walls, raw 20): words delivered, no notice
  - a muffled pair (wall, `e` = 35): no words, one `heard_muffled` emit with the right direction and band
  - a muffled speaker directly above (and one directly below) the listener: one `heard_muffled` emit with direction `overhead` (`below`), no words; at exactly 1.0 block horizontal offset the direction is a compass point
  - a silent pair (`e` = 50): neither
  - a sealed listener at `e` = 31 becomes muffled (sealed penalty 4 pushes it to 35)
  - a line whose casts exceed 512 reads gives silent to the rest and logs a counter, never the words
  - revert the effective-distance change and the muffled-pair test fails (words delivered through a wall)

## MH-4: golem Body receives, collapses and words the notice

- **depends-on:** MH-3 merged
- **owner:** geldar-ops (golem Body)
- **size:** M
- **files:** `golem/src/perception/heard-muffled-event.ts` (new, parallel to `heard-sound-event.ts`); `golem/src/perception/heard-muffled-event.test.ts`; `golem/src/perception/muffled.ts` (new; collapses notices by direction, at most three per snapshot); `golem/src/snapshot.ts` (the `heard_muffled` field); `golem/src/mind-link/server.ts` (peeks the inbox into the snapshot, never consumes it); `golem/src/mind-link/server.test.ts`; `golem/src/adam/adam-body.ts` (wiring only, the existing `heard_sound` path is not changed); `golem/src/adam/adam-body.hearing.test.ts`; `golem/src/adam/main.ts` and `golem/src/players/main.ts` (the Body wiring of the two runs)
- **shape sent by the golem:** the snapshot's `heard_muffled` carries only `{direction, band}` per notice; no `kind`, coordinates, speaker or words.
- **lifetime:** a notice uses a 20 s window (`MUFFLED_WINDOW_MS`), not a drain. Every snapshot (act, sleep, status, wait probes, look) shows it until the window ends, so a call that never shows it does not consume it. A same-direction arrival at an equal or farther band does not restart the window; a nearer one does.
- **wording moved:** the sentence for a notice is made in threshold/mcp from `heardMuffledSentence` (MH-5 and MH-6 carry the wording items), not in golem.
- **prove-it:**
  - a snapshot with five notices in one direction shows one line with the band of the nearest
  - a snapshot never contains a coordinate, a speaker name or a word (scan test over the rendered text)
  - the sentence uses the fixed table; an unknown code is refused, not shown
  - revert the collapse and the three-line cap test fails
- **note:** do not reuse golem's `bandOf`: the plugin sends `far` up to 32 blocks (the contract text says 32 since PR #499). Direction is one of the 8 compass points, `overhead` or `below` (overhead/below when the horizontal offset is under 1 block; decision 0199 step 6). Parse with `validateHeardMuffledPayload` from `@geldar/contract`, never a hand-written compass enum; the collapse keys are the 10 direction codes, so overhead and below are never merged into a compass point; word every notice from the fixed table (`heardMuffledSentence`). Add to prove-it: a snapshot with an `overhead` notice and an `n` notice shows two lines.

## MH-5: threshold handler and Body wiring

- **depends-on:** MH-4
- **owner:** geldar-ops (threshold/mcp and the Body side); geldar-93 reviews the handler
- **size:** S
- **files:** `threshold/mcp/src/events/handlers/heard-muffled.ts` (new, beside `heard-sound.ts`); its test; `golem/src/adam/adam-body.ts` (handler registration)
- **prove-it:**
  - a `heard_muffled` event does not wake the Mind (wake interest test: no `wake` emitted with no `sound` interest set; revert the no-wake rule and the test fails)
  - with the `sound` interest set on, the event may wake; this path is tested so the default cannot drift

## MH-6: prompts version bump

- **depends-on:** MH-5
- **owner:** geldar-3b (prompts), geldar-93 reviews
- **size:** S
- **files:** `prompts/` (new version of the snapshot template that adds the muffled-notice line; the released template is not edited in place); `prompts/README.md` or the template index (version record)
- **prove-it:**
  - a template test that renders the snapshot with and without a muffled notice and checks the rendered prompt stays within `mind.prompt_budget_tokens` (2500) at the 8704 context (decision 0181)
  - the old template version still renders the old output (no in-place edit): check against its frozen fixture
  - revert the new line and the budget test still passes, the version test fails (the version bump is what changes)
- **note:** kit-agent text is scriptorium's and is not in this card.

## MH-7: spec amendment

- **depends-on:** 0198 merged; OWNER APPROVAL (geldar-93 asks the owner); must merge before MH-1 and MH-3
- **owner:** geldar-93, with the owner's sign-off on the record
- **size:** S
- **files:** `docs/spec.md` at 5.2 (earshot, one sentence), 5.8 (the 32-block rule, one paragraph and the information-bubbles note), 5.9 (the `chat` block gains `muffle`); no other spec text
- **prove-it:** docs only. Check that the 5.9 block matches the constants in MH-3 (a test that reads the spec block and compares it to `muffle-config.ts` is preferred; if the spec is not parsed by code, a reviewer checks the two by hand and records it)

## MH-8a: cost bench on the MH-3 branch

- **depends-on:** MH-3 branch built (not merged); the shard up with the plugin jar
- **owner:** ops (runs and reports; edits no code)
- **size:** S
- **files:** the bench needs a harness first (amended 2026-11-15 on geldar-93's OK): a bench-only log line in `ChatHearing.judge` behind `chat.muffle.bench_log` (off by default, never in the Colo config), `compose/phase0-bench.yml` and `bench/mh8a/run.ps1` (project geldar-mh8a, loopback ports 26565/14222/26575, `down -v`), and `golem/src/bench/scenarios/muffle-chat.ts` (9 and 15 bots; RCON whitelist, tp and fill are test-harness controls on the throwaway shard only). Ops edits no code; the bench output is recorded in the campaign's bench records. Gates at run time: free RAM above 10 GB and C: above 20 GB; known caveat: after a refused take `reads` shows the full cap.
- **prove-it:**
  - the bench with 9 and then 15 agents chatting in one area at 20 TPS: per-line block reads, per-tick cost, and the count of lines that hit the 512-read cap
  - it must set the absorption values, margin `M` and sealed penalty `S` (all "not measured" proposals in the record) BEFORE MH-3 merges; the chosen values go back into the MH-3 branch and the MH-7 spec block
  - if the per-line cap is hit in the normal case, the packet is not done; the record's cap values are then revisited
- **run:** one at a time. Shard mutations (tick rate, world) only through `bench`. `adam up` is not run first.

## MH-8b: live lane

- **depends-on:** MH-5 merged; the shard up with the plugin jar
- **owner:** ops (runs and reports; edits no code)
- **size:** S
- **files:** none edited
- **prove-it:** a live lane with a wall between two agents: one clear, one muffled, one silent, and the sealed-room case
- **run:** one at a time, through `test:live`. Live tests start their own stack; `adam up` is not run first.

---

## Shared rules for every card

- No card edits `contract/` except MH-1. Later cards write a request line in their worknote if they need a field.
- No card hand-edits generated code.
- Every behavior change has a test that fails when the change is reverted. The coder checks this before calling the card done.
- Files stay under the 500-line soft cap and the 700-line hard cap.
- Prompt text goes in `prompts/` with a version bump. Kit-agent text is out of scope for these cards.
- Principle 1: nothing here lets a human act in the world.
