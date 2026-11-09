# 0001. The contract is JSON Schema with code generation

- Status: Accepted
- Date: 2026-11-08
- Spec: section 13, open decision 2i; Appendices A, C, D, H

## Decision

`contract/` holds the single definition of every message that crosses a component boundary: the perception snapshot (Appendix A), thoughts with intents and actions (Appendix C), action records and receipts (section 7), the Thinker protocol frames (Appendix H) and the NATS event envelope. It is written as JSON Schema (draft 2020-12). A generator turns it into TypeScript types and precompiled validators; later it also produces the Java types for Geldar-Core, MCP tool definitions and capability docs. Generated output is committed, and CI fails when it differs from what the schemas produce.

## Why

The spec's appendices already drift from each other, and five components (Golem, Animus, Lantern, the plugin, the event sink) speak these messages. JSON Schema is what the Gateway already validates against (Appendix H, `additionalProperties: false`), what Ollama and vLLM accept for constrained output, and what MCP tool definitions are written in. Protobuf would need a second schema for each of those.

## Consequences

- Nobody edits generated code; a change starts in `contract/schemas/`.
- The generator tools are chosen in packet P0-01 and pinned like any dependency.
- The appendices in `docs/spec.md` become illustrative; when they disagree with `contract/`, the contract wins and the spec gets a note.
