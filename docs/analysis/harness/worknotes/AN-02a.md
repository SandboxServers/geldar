# AN-02a worknote

- Base sha (first pass, HEAD at session start): `0d488f95` on `phase1/gx-01a-event-stamp` (stacked on PR #353).
- Branch: `phase1/an-02a-sheet-contract` (dispatch name; card said `codex/an-02a-contract-sheet-audit`).
- Decisions: D-CS-03, D-CS-05, D-CS-07 cited as assumed (ADR 0186 on phase1/harness-w1). No number allocated.

## Needs a number

- ADR for the assumed D-CS answers (card: `<allocate via registry>`, P0). Not written.

## The if/then question (resolved)

- Tiny-schema test: Ajv 8.20 strict mode compiles `if/then/else` and validates it correctly. Ajv strict requires the `then` branch to declare the properties it requires (strictRequired), so the `then` blocks repeat `properties`.
- json-schema-to-typescript 16 accepts `if/then` without error but ignores it: the generated TS type shows `roll_event_ids?` and `dropped?` as optional. The validators enforce the conditions. No hand edit of generated code.
- Ajv strict also refuses `type: [a, b, ...]` union types under `additionalProperties`; the scalar map uses `anyOf` instead.

## Generated files changed by `generate`

- `contract/src/generated/types.ts`
- `contract/src/generated/validators.js`
- `contract/src/generated/validators.d.ts`
- `contract/src/generated/mcp-tools.ts` unchanged (no tool added).

## Not in this card's may-edit (flagged for others)

- The WorldEvent types `roll`, `decision`, `sheet_adopted`, `chunk_visited` are not added to `contract/schemas/event.schema.json` (GX-01a must-not-edit, and not in AN-02a's may-edit). If `event.schema.json` has a `type` enum, these types will be refused as WorldEvents until an owner adds them. Index line to add: whoever owns event.schema.json.
- `sql/README.md` index: no SQL in this card.
