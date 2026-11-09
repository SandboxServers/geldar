# 0046. A scripted stub CLI stands in for the vendor CLI in CI (D-SC-10)

- Status: Accepted (an orchestrator decision of the Scriptorium repo, SC-24a, relayed in writing by its orchestrator and filed by the Phase 0 orchestrator; the owner should confirm the wording)
- Date: 2026-11-09
- Spec: section 5.15.1 (sovereign players); decisions 0044 and 0045 (the corpus and the local live check)

## Decision

A scripted stub CLI (`packages/stub-cli` in the Scriptorium repo) stands in for the vendor CLI in deterministic CI. It replays a scenario file of steps (MCP tool calls with expected substrings) against a real MCP server over HTTP, exits non-zero when a step fails, and never calls a model. Real models run only in the local, owner-run live malicious-book check (D-SC-01, decision 0045), never in CI.

## Why

The launcher, the kit image, the egress proxy, the gate and the template can be tested end to end on every PR without API credits, and the model-dependent half is checked by the owner before each release tag.

## Consequences

- The Geldar mock MCP world (`threshold/mcp-mock`) is the real MCP server such scripted runs talk to; its scenarios and corpus (decision 0044) are part of the CI-tested surface.
- The stub proves plumbing and refusals, not model behaviour; that stays the live check's job.
