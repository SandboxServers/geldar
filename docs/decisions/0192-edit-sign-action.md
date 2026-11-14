# 0192: the `edit_sign` action edits the text of an existing sign

- Status: Proposed (implementer; the owner flips it to Accepted)
- Date: 2026-11-14

## Context

`write_sign` writes a new sign on a block the Body places. Nothing let an agent change the text of a sign that already stands, so a shop sign or a notice could not be corrected without digging it up and placing it again. Editing a sign is a small, bounded action on a block that is already in the world, so it reuses the reach, loaded-chunk and ownership rules that `till` (0167) uses.

Ownership is the risk. A sign another player placed is that player's work, and an agent must not rewrite it. Blocks carry an owner record (0165); graves are recorded under the system owner by decision 0195, so a grave sign is protected in the same way.

## Decision

The contract has one action verb, `edit_sign`, in the `Action` union of `contract/schemas/thought.schema.json`:

```json
{ "do": "edit_sign", "at": { "x": 12, "y": 64, "z": -7 }, "text": "Wheat for sale" }
```

- `at` is a block position, the same shape `till` uses. It names the existing sign to edit. `at` takes no `feet` keyword.
- `text` is a string of at most 60 characters, the same limit `write_sign` has. The schema has no `minLength`: an empty text is a Body refusal, not a schema refusal (see the reasons below).
- `additionalProperties` is false. A stray `count` or `block` field is refused by the schema.
- The Body looks at and opens the existing sign at `at`, then replaces its text. The clean-up and the four-line wrap are the ones `write_sign` applies. Reach and loaded-chunk rules are the ones `till` applies.
- Refusals reuse the existing reason codes; no new code is added:
  - `not_possible` with the detail "that block is someone else's work" when the block is recorded under another player's owner. A grave, recorded under the system owner (0195), is protected by the same rule.
  - `not_possible` with the detail "that block is not a sign" when the block at `at` is not a sign.
  - `invalid_args` with the detail "the sign text is empty" when `text` is empty after the clean-up.
  - `no_effect` with the detail "the sign did not change" when the text read back after the edit equals the text before it.
  - `out_of_reach`, `blocked` and `not_found` as for `till`.
- The Mind's Phase 0 allow-list admits `edit_sign` (verb table, bounds list, action shapes), and `prompts/body-api/v8.json` lists it as one plain sentence with one example. The v8 template is the default.
- Agents may use `edit_sign` only while the allow-list admits it. The allow-list stays off until graves are recorded under the system owner (0195), so no sign a grave holds can be edited before the protection exists.
- The Body (geldar-ops) implements the action and is the Body implementer named here. The Body's coder brief covers two details that this decision does not decide: a waxed sign is refused, and the hand must be empty or hold a stick to open the sign. Neither is verified against a live server yet, so this decision makes no claim about how the server answers either case.

## Consequences

- The contract, the Mind allow-list, the body-api prompt (v8, the default) and the MCP `act` tool description carry `edit_sign`. The generated files are regenerated from the schema.
- The thought system message grows. Measured with `promptCost` on the sample prompt: v7 3855 estimated tokens, v8 3926, a delta of 71. With the 2500 user budget and the 2048 output cap, the sum is 8474 against `num_ctx` 8704, a margin of 230. The budget is unchanged.
- Agents can edit a sign once the allow-list is on and the Body implements the action. Until the Body ships it, an `edit_sign` gets the Body's refusal, not a Mind refusal.
- The Body must answer with the reasons above and must accept exactly the shape `{ do, at, text }`.
- No existing action changes shape, so earlier thoughts and outcomes are unaffected.
- The default body-api prompt moves from v7 to v8. v1 to v7 stay loadable; v7 is not edited.
