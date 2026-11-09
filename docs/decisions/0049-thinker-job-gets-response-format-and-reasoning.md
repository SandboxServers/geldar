# 0049. The Thinker job frame gains `response_format` and `reasoning` (Appendix H)

- Status: Accepted (owner, 2026-11-09, wave 5 planning question Q1)
- Date: 2026-11-09
- Spec: 5.3.4 (validate model output), 5.6 (constrained output, pinned configuration), Appendix H (Thinker protocol); decision 0028

## Decision

1. The `job` frame of the Thinker protocol gets two optional fields: `response_format` (`{type: "json_schema", schema: object}`, the serialized schema at most 64 KiB) and `reasoning` (`off` or `on`). A Thinker that does not support them ignores them; a Thinker that does maps them to its engine's constrained-output and thinking switches (for Ollama: `format` and `think`).
2. The Mind sends a simplified decode schema (only the Phase 0 verbs and programs, no regex patterns, no `oneOf` where the engine cannot compile it) and still validates every output strictly against the full contract schema; the decode schema steers the engine, the validator is the control.
3. Thought jobs default to `reasoning: off`; sleep reflection and escalated effort may use `on`.

## Why

Local models emit think blocks, prose and code fences without constraints, and Qwen3's thinking mode would break the 15 s thought target. Spec 5.3.4 and 5.6 already ask for the engine's constrained mode. Optional fields keep the protocol backward compatible.

## Consequences

- P0-20 changes `thinker-frame.schema.json` and regenerates the contract; `lantern-local` (P0-22) maps the fields to Ollama; the Mind's output normalisation is none (no stripping of think blocks or fences).
- Spec Appendix H gains the two fields; the wording goes through the owner like the other spec edits.
