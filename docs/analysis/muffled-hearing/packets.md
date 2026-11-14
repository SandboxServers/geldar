# Muffled hearing packets

Written 2026-11-14. Record: [XXXX-muffled-hearing](../../decisions/XXXX-muffled-hearing.md) (Proposed; number assigned by geldar-93). Spec: 5.2 (earshot), 5.8 (32-block speech rule, information bubbles), 5.9 (`chat` config). Related: 0154 (`heard_sound`), 0181 (prompt budget), 0198 (proximity chat, the cut these packets extend).

Card fields follow [packet-conventions.md](../phase1/packet-conventions.md) section 1, with `owner` and `prove-it` added. The ids are `MH-n` until a wave id is assigned.

## Order

```
MH-0 record ratified (owner rulings 2 and 3)
  |
  +-- MH-1 contract unblocker (heard_muffled schema, Appendix A, mcp-common note)
        |
        +-- MH-2 plugin absorption model (pure code, no wiring)      [needs 0198 merged]
        |     |
        |     +-- MH-3 ProximityRule uses effective distance + notice emit
        |           |
        |           +-- MH-4 golem Body: receive, collapse, sentence
        |                 |
        |                 +-- MH-5 threshold handler + adam-body wiring
        |                       |
        |                       +-- MH-6 prompts/ version bump
        |
        +-- MH-7 spec 5.2, 5.8, 5.9 amendment (lands before MH-3 merges)
  |
  +-- MH-8 cost bench and live lane (ops, last; one at a time)
```

Merge in this order. Contract files are merged one at a time (packet-conventions 2). MH-2 and MH-7 may run in parallel after MH-1.

---

## MH-0: ratify the record

- **depends-on:** owner rulings on open questions 2 and 3 in the record
- **owner:** geldar-93 (orchestrator), with the owner
- **size:** S (docs)
- **files:** `docs/decisions/XXXX-muffled-hearing.md` (number and status only)
- **prove-it:** none; a docs change. Check `pnpm check:repo` passes.

## MH-1: contract unblocker

- **depends-on:** none (0198 not required for the schema)
- **owner:** geldar-93 (contract), with geldar-3b reviewing the Appendix A diff
- **size:** S
- **files:** `contract/schemas/heard-muffled-event.schema.json` (new); `contract/schemas/mcp-common.schema.json` (note only, no enum change; see record "Wait interests"); Appendix A perception schema in `docs/spec.md` (documentation of the new event); `contract/src/outcome-words.ts` (new `heardMuffledSentence` stub that returns the fixed text); generated outputs (regenerate, do not edit)
- **prove-it:** a schema test that rejects a `heard_muffled` event with a `x`/`y`/`z` field and with a speaker field, and accepts `direction` and `band` only. Revert the schema's `additionalProperties: false` and the test must fail. Regenerated output matches the generator (CI drift check).

## MH-2: plugin absorption model

- **depends-on:** MH-1; 0198 merged to main
- **owner:** geldar-93 via a packet-coder (plugin)
- **size:** M
- **files:** `plugin/core/src/chat/absorption.ts` (new; the material table and the pure function `effectiveDistance(speaker, listener, blockAt)`); `plugin/core/src/chat/absorption.test.ts` (new); `plugin/core/src/chat/absorption-table.ts` (new, the table only, so it can be read without the algorithm)
- **prove-it:**
  - a test per table row (every material in decision step 4 has a pinned value); changing one row fails its test
  - a test that a straight wall of 3 stone blocks between speaker and listener at raw 10 gives `e = 10 + 6 = 16` and the muffled tier when `e` is pushed past 32 by a 15-block wool wall
  - a test that the cast stops at 64 block reads and returns the silent tier, not an exception
  - revert: the absorption add is removed, the wall test must fail

## MH-3: ProximityRule uses effective distance and emits the notice

- **depends-on:** MH-2; MH-7 merged (spec amendment)
- **owner:** geldar-93 via a packet-coder (plugin)
- **size:** M
- **files:** `plugin/core/src/chat/proximity-rule.ts` (0198's file, extended); `plugin/core/src/chat/muffle-config.ts` (new; `chat.muffle` constants: margin 8, sealed penalty 4, per-line cap 512, per-ray cap 64); `plugin/core/src/chat/proximity-rule.test.ts`; the plugin-to-Body emit (channel to be confirmed, open question 1)
- **prove-it:**
  - a clear pair (no walls, raw 20): words delivered, no notice
  - a muffled pair (wall, `e` = 35): no words, one `heard_muffled` emit with the right direction and band
  - a silent pair (`e` = 50): neither
  - a sealed listener at `e` = 31 becomes muffled (sealed penalty 4 pushes it to 35)
  - a line whose casts exceed 512 reads gives silent to the rest and logs a counter, never the words
  - revert the effective-distance change and the muffled-pair test fails (words delivered through a wall)

## MH-4: golem Body receives, collapses and words the notice

- **depends-on:** MH-3 merged
- **owner:** geldar-ops (golem Body)
- **size:** M
- **files:** `golem/src/perception/heard-muffled-event.ts` (new, parallel to `heard-sound-event.ts`); `golem/src/perception/heard-muffled-event.test.ts`; `golem/src/perception/muffled.ts` (new; collapses notices by direction, at most three per snapshot); `golem/src/adam/adam-body.ts` (wiring only, the existing `heard_sound` path is not changed)
- **prove-it:**
  - a snapshot with five notices in one direction shows one line with the band of the nearest
  - a snapshot never contains a coordinate, a speaker name or a word (scan test over the rendered text)
  - the sentence uses the fixed table; an unknown code is refused, not shown
  - revert the collapse and the three-line cap test fails

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
- **files:** `prompts/` (new version of the snapshot template that adds the muffled-notice line; the released template is not edited in place); `prompts/README` or the template index (version record)
- **prove-it:**
  - a template test that renders the snapshot with and without a muffled notice and checks the rendered prompt stays within `mind.prompt_budget_tokens` (2500) at the 8704 context (decision 0181)
  - the old template version still renders the old output (no in-place edit): check against its frozen fixture
  - revert the new line and the budget test still passes, the version test fails (the version bump is what changes)
- **note:** kit-agent text is scriptorium's and is not in this card.

## MH-7: spec amendment

- **depends-on:** none; must merge before MH-3
- **owner:** geldar-93, with the owner's sign-off on the record
- **size:** S
- **files:** `docs/spec.md` at 5.2 (earshot, one sentence), 5.8 (the 32-block rule, one paragraph and the information-bubbles note), 5.9 (the `chat` block gains `muffle`); no other spec text
- **prove-it:** docs only. Check that the 5.9 block matches the constants in MH-3 (a test that reads the spec block and compares it to `muffle-config.ts` is preferred; if the spec is not parsed by code, a reviewer checks the two by hand and records it)

## MH-8: cost bench and live lane

- **depends-on:** MH-5 merged; the shard up with the plugin jar
- **owner:** ops (runs and reports; edits no code)
- **size:** S
- **files:** none edited; the bench output is recorded in the campaign's bench records
- **prove-it:**
  - the bench with 9 and then 15 agents chatting in one area at 20 TPS: per-line block reads, per-tick cost, and the count of lines that hit the 512-read cap
  - a live lane with a wall between two agents: one clear, one muffled, one silent, and the sealed-room case
  - if the per-line cap is hit in the normal case, the packet is not done; the record's cap values are then revisited
- **run:** one at a time. Shard mutations (tick rate, world) only through `bench` and `test:live`. Live tests start their own stack; `adam up` is not run first.

---

## Shared rules for every card

- No card edits `contract/` except MH-1. Later cards write a request line in their worknote if they need a field.
- No card hand-edits generated code.
- Every behavior change has a test that fails when the change is reverted. The coder checks this before calling the card done.
- Files stay under the 500-line soft cap and the 700-line hard cap.
- Prompt text goes in `prompts/` with a version bump. Kit-agent text is out of scope for these cards.
- Principle 1: nothing here lets a human act in the world.
