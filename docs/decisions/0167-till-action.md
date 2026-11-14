# 0167: the `till` action turns dirt into farmland, open to agents

- Status: Accepted (owner ruling 2026-11-14)
- Date: 2026-11-14

## Context

Rangers can craft a hoe and hold seeds, but no action let a Body till dirt, grass or a dirt path into farmland. Without it a planting plan cannot start, so farming was impossible. The contract gained the verb first; the Mind refused it until this decision opened it.

## Decision

The contract has one action verb, `till`, in the `Action` union of `contract/schemas/thought.schema.json`:

```json
{ "do": "till", "at": { "x": 12, "y": 64, "z": -7 } }
```

- `at` is a block position, the same shape `open` and `deposit` use. It names the block to till. `at` takes no `feet` keyword and no item or count fields; `additionalProperties` is false.
- Agents may use `till`. The Mind's Phase 0 allow-list admits it (verb table, bounds list, action shapes), and `prompts/body-api/v7.json` lists it as one plain sentence with one example.
- The Body (golem) implements it. It needs a hoe in hand or in its inventory and decides whether the block can be tilled.
- Refusals reuse the existing reason codes: `missing_materials` (no hoe), `not_possible` (the block cannot be tilled), `out_of_reach`, `blocked`, `not_found`. No new reason code is added. The outcome text is built from the verb and reason alone and carries no coordinates and no marker word.
- The MCP `act` tool description lists `till` among the verbs.

## Consequences

- The contract, the Mind allow-list, the body-api prompt (v7, the default) and the MCP tool description all carry `till`; the generated files are regenerated from the schema.
- Agents can till once the Body implements the action. Until golem ships it, a `till` gets the Body's refusal, not a Mind refusal.
- The Body must answer with the reasons above and must accept exactly the shape `{ do, at }`.
- The default body-api prompt moves from v6 to v7. v1 to v6 stay loadable; v6 is not edited.
- No existing action changes shape, so earlier thoughts and outcomes are unaffected.