# 0035. MCP tool schemas: a top-level `oneOf` in `write_book`, and results without a root `type` are not published as `outputSchema`

- Status: Accepted
- Date: 2026-11-09
- Spec: section 5.15.3; Scriptorium Wave 3 packets SC-30a, SC-30b, SC-31b

## Decision

1. The MCP tool schemas live in `contract/schemas/mcp-*.schema.json` and are bundled by the generator into `contract/src/generated/mcp-tools.ts`. Each tool has an input and a result definition in the same schema file.
2. The input of `write_book` has a top-level `oneOf` (a skill book or a text book). Generated TypeScript for it is not usable as a typed argument; consumers cast to `{ title: string; skill_id?: string; text?: string }` (documented in `contract/src/mcp.ts`).
3. The bundled results of `use_skill`, `offer` and `vote` are a `$ref` to `ActionOutcome` and have no root `type`. They are never published as an MCP `outputSchema` (the SDK requires a root `type: "object"`); tools publish only their input schema.
4. Tool-name validation accepts only the listed tool names; aliases such as `look_` are unknown tools.

## Why

The tool contract is the source of truth in JSON Schema (decision 0001), and the generator must keep working with it; MCP clients impose their own shape limits on published schemas.

## Consequences

- Servers validate results against the contract bundle, not against a published output schema.
- Clients must not rely on `outputSchema` for these tools.
